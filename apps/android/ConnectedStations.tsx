import { useCallback, useState } from "react";
import type { SceneJson, SceneObject, Vec2 } from "../../src/contract/layout";
import type { SetupStationsView } from "../../src/contract/setup";
import type { Station, StationMap, SurfaceFront, Zone } from "../../src/contract/stations";
import { ConnectedPlan } from "./ConnectedPlan";
import { Action, Choice, Copy, Failure, Field, Loading, useResource, useSettingTask } from "./ConnectedUi";
import type { ConnectedHub } from "./connected-hub";

type Context = { hub: ConnectedHub; home: string; onSaved: () => Promise<void>; onBlock: (value: boolean) => void };
type Kind = "station" | "zone" | "front";
type PointMode = "add" | "position" | "look_at" | "vertex";
const titles: Record<Kind, string> = { station: "대기·관찰 자리", zone: "사람이 머무는 구역", front: "가구 앞 설 자리" };
const toggle = <T,>(values: T[], value: T) => values.includes(value) ? values.filter(item => item !== value) : [...values, value];

export function ConnectedStations(props: Context) {
  const { hub, home } = props;
  const read = useCallback(async (signal: AbortSignal) => {
    const [stations, scene] = await Promise.all([
      hub.get<SetupStationsView>("/api/setup/stations", signal), hub.get<{ scene: SceneJson }>("/api/scene", signal),
    ]);
    if (stations.home !== home) throw new Error("선택한 집과 자리 설정의 집이 달라요.");
    return { ...stations, ...scene };
  }, [hub, home]);
  const source = useResource(read);
  if (!source.value) return source.error ? <><Failure>{source.error}</Failure><Action title="다시 불러오기" onPress={source.refresh} /></> : <Loading />;
  return <Editor {...props} initial={source.value.map} scene={source.value.scene} />;
}

function isSceneObject(value: unknown): value is SceneObject {
  return !!value && typeof value === "object" && "id" in value && "name" in value && "room" in value
    && typeof value.id === "string" && typeof value.name === "string";
}

function Editor({ hub, home, scene, initial, onSaved, onBlock }: Context & { scene: SceneJson; initial: StationMap }) {
  const rooms = scene.plan.rooms ?? [];
  const objects = scene.objects.filter(isSceneObject);
  const [map, setMap] = useState(initial);
  const [room, chooseRoom] = useState(initial.stations[0]?.room ?? rooms[0]?.id ?? "");
  const [kind, chooseKind] = useState<Kind>("station");
  const [selection, select] = useState("");
  const [surface, setSurface] = useState("");
  const [pointMode, setPointMode] = useState<PointMode>();
  const [near, setNear] = useState("");
  const task = useSettingTask(onBlock);
  const stations = map.stations.filter(item => item.room === room);
  const zones = map.zones.filter(item => item.room === room);
  const fronts = map.surface_fronts.filter(item => item.room === room);
  const station = kind === "station" ? stations.find(item => item.id === selection) : undefined;
  const zone = kind === "zone" ? zones.find(item => item.id === selection) : undefined;
  const front = kind === "front" ? fronts.find(item => item.surface_id === selection) : undefined;
  const available = objects.filter(item => item.room === room && !fronts.some(entry => entry.surface_id === item.id));
  const surfaceId = available.find(item => item.id === surface)?.id ?? available[0]?.id;
  const stationChange = (patch: Partial<Station>) => setMap(current => ({
    ...current, stations: current.stations.map(item => item.id === station?.id ? { ...item, ...patch } : item),
  }));
  const zoneChange = (patch: Partial<Zone>) => setMap(current => ({
    ...current, zones: current.zones.map(item => item.id === zone?.id ? { ...item, ...patch } : item),
  }));
  const frontChange = (patch: Partial<SurfaceFront>) => setMap(current => ({
    ...current, surface_fronts: current.surface_fronts.map(item => item.surface_id === front?.surface_id ? { ...item, ...patch } : item),
  }));

  function add(point: Vec2) {
    const id = `${kind}-${Date.now().toString(36)}`;
    if (kind === "station") {
      setMap(current => ({ ...current, stations: [...current.stations, {
        id, room, name: "새 관찰 자리", roles: ["observe"], position: point, look_at: point, rooms: [room], surfaces: [], observes_zone_ids: [],
      }] }));
      select(id);
      setPointMode("look_at");
    } else if (kind === "zone") {
      setMap(current => ({ ...current, zones: [...current.zones, { id, room, name: "새 구역", polygon: [point] }] }));
      select(id);
      setPointMode("vertex");
    } else if (surfaceId) {
      setMap(current => ({ ...current, surface_fronts: [...current.surface_fronts, {
        surface_id: surfaceId, room, position: point, look_at: point, near_m: 0.4,
      }] }));
      select(surfaceId);
      setNear("0.4");
      setPointMode("look_at");
    }
  }
  function pick(point: Vec2) {
    if (pointMode === "add") return add(point);
    if (pointMode === "vertex" && zone) return zoneChange({ polygon: [...zone.polygon, point] });
    if (pointMode !== "position" && pointMode !== "look_at") return;
    if (station) stationChange({ [pointMode]: point });
    if (front) frontChange({ [pointMode]: point });
    setPointMode(undefined);
  }
  function remove() {
    if (station) setMap(current => ({
      ...current, stations: current.stations.filter(item => item.id !== station.id),
      kitchen_entry: current.kitchen_entry === station.id ? null : current.kitchen_entry,
      meal_watch: current.meal_watch === station.id ? null : current.meal_watch,
    }));
    if (zone) setMap(current => ({
      ...current, zones: current.zones.filter(item => item.id !== zone.id),
      stations: current.stations.map(item => ({ ...item, observes_zone_ids: item.observes_zone_ids.filter(id => id !== zone.id) })),
    }));
    if (front) setMap(current => ({ ...current, surface_fronts: current.surface_fronts.filter(item => item.surface_id !== front.surface_id) }));
    select("");
    setPointMode(undefined);
  }
  function choose(id: string) {
    select(id);
    setPointMode(undefined);
    setNear(String(fronts.find(item => item.surface_id === id)?.near_m ?? ""));
  }
  const options = kind === "station" ? stations : kind === "zone" ? zones
    : fronts.map(entry => ({ id: entry.surface_id, name: objects.find(item => item.id === entry.surface_id)?.name ?? entry.surface_id }));
  const picked = station ?? front;
  const guides = [...zones.map(item => ({ points: item.polygon, closed: true, color: item === zone ? "#a1143e" : "#6b7546" })),
    ...stations.map(item => ({ points: [item.position, item.look_at], color: item === station ? "#a1143e" : "#9e673f" })),
    ...fronts.map(item => ({ points: [item.position, item.look_at], color: item === front ? "#a1143e" : "#42647c" }))];
  const prompt = { add: "추가할 위치", position: "서 있을 위치", look_at: "바라볼 위치", vertex: "구역의 다음 꼭짓점" };
  const observing = map.stations.filter(item => item.roles.includes("observe"));
  const nearValue = near.trim() ? Number(near) : NaN;
  const invalid = map.zones.some(item => item.polygon.length < 3) || (!!front && !(nearValue > 0));

  return <>
    <Copy>편집할 방</Copy>
    {rooms.map(item => <Choice key={item.id} title={item.label ?? item.id} selected={room === item.id} disabled={task.busy}
      onPress={() => { chooseRoom(item.id); choose(""); }} />)}
    {(Object.keys(titles) as Kind[]).map(id => <Choice key={id} title={titles[id]} selected={kind === id} disabled={task.busy}
      onPress={() => { chooseKind(id); choose(""); }} />)}
    {options.map(item => <Choice key={item.id} title={item.name} selected={item.id === selection} disabled={task.busy}
      onPress={() => choose(item.id)} />)}
    {kind === "front" && available.length > 0 && <SelectRows title="추가할 가구" items={available} values={[surfaceId ?? ""]} onToggle={setSurface} disabled={task.busy} />}
    <Action title={`${titles[kind]} 추가`} disabled={task.busy || !room || (kind === "front" && !surfaceId)}
      onPress={() => setPointMode("add")} secondary />
    {pointMode && <Copy>{prompt[pointMode]}을 도면에서 눌러 주세요.</Copy>}
    <ConnectedPlan scene={scene} guides={guides} label={pointMode ? prompt[pointMode] : "자리·구역 도면"}
      onPoint={task.busy || !pointMode ? undefined : pick} />
    {picked && <>
      <Action title="서 있을 위치 고르기" disabled={task.busy} onPress={() => setPointMode("position")} secondary />
      <Action title="바라볼 위치 고르기" disabled={task.busy} onPress={() => setPointMode("look_at")} secondary />
    </>}
    {station && <>
      <Field label="자리 이름" value={station.name} onChangeText={name => stationChange({ name })} />
      {(["standby", "observe"] as const).map(role => <Choice key={role} title={role === "standby" ? "대기 자리" : "관찰 자리"}
        selected={station.roles.includes(role)} disabled={task.busy} onPress={() => {
          const roles = toggle(station.roles, role);
          setMap(current => ({
            ...current, stations: current.stations.map(item => item.id === station.id ? { ...item, roles } : item),
            kitchen_entry: !roles.includes("observe") && current.kitchen_entry === station.id ? null : current.kitchen_entry,
            meal_watch: !roles.includes("observe") && current.meal_watch === station.id ? null : current.meal_watch,
          }));
        }} />)}
      <SelectRows title="보이는 방" items={rooms.map(item => ({ id: item.id, name: item.label ?? item.id }))}
        values={station.rooms} disabled={task.busy} onToggle={id => stationChange({ rooms: toggle(station.rooms, id) })} />
      <SelectRows title="보이는 가구·가전" items={objects} values={station.surfaces} disabled={task.busy}
        onToggle={id => stationChange({ surfaces: toggle(station.surfaces, id) })} />
      <SelectRows title="보이는 구역" items={map.zones} values={station.observes_zone_ids} disabled={task.busy}
        onToggle={id => stationChange({ observes_zone_ids: toggle(station.observes_zone_ids, id) })} />
    </>}
    {zone && <>
      <Field label="구역 이름" value={zone.name} onChangeText={name => zoneChange({ name })} />
      <Action title="꼭짓점 추가" disabled={task.busy} onPress={() => setPointMode("vertex")} secondary />
      <Action title="마지막 꼭짓점 지우기" disabled={task.busy || !zone.polygon.length}
        onPress={() => zoneChange({ polygon: zone.polygon.slice(0, -1) })} secondary />
    </>}
    {front && <Field label="가구와의 거리(m)" value={near} onChangeText={value => {
      setNear(value);
      if (value.trim() && Number(value) > 0) frontChange({ near_m: Number(value) });
    }} keyboardType="decimal-pad" />}
    {(station || zone || front) && <Action title="선택 항목 삭제" disabled={task.busy} secondary onPress={remove} />}
    <SelectRows title="주방 입구 관찰 자리" items={observing} values={[map.kitchen_entry ?? ""]} disabled={task.busy}
      onToggle={id => setMap(current => ({ ...current, kitchen_entry: current.kitchen_entry === id ? null : id }))} />
    <SelectRows title="식사 관찰 자리" items={observing} values={[map.meal_watch ?? ""]} disabled={task.busy}
      onToggle={id => setMap(current => ({ ...current, meal_watch: current.meal_watch === id ? null : id }))} />
    {invalid && <Failure>구역은 꼭짓점 3개 이상이 필요하고 가구와의 거리는 0보다 커야 해요.</Failure>}
    <Failure>{task.error}</Failure>
    <Action title="자리·구역 저장" disabled={task.busy || invalid || initial === map} onPress={() => void task.run(async () => {
      await hub.write("/api/setup/stations", { home, map }, "PUT");
      await onSaved();
    })} />
  </>;
}

function SelectRows({ title, items, values, onToggle, disabled }: {
  title: string; items: { id: string; name: string }[]; values: string[]; onToggle: (id: string) => void; disabled: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  if (!items.length) return null;
  return <>
    <Choice title={title} value={items.filter(item => values.includes(item.id)).length + "개 선택"} disabled={disabled}
      onPress={() => setExpanded(value => !value)} />
    {expanded && items.map(item => <Choice key={item.id} title={item.name} selected={values.includes(item.id)}
      onPress={() => onToggle(item.id)} disabled={disabled} />)}
  </>;
}
