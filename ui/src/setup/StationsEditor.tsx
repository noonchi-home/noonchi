import { useEffect, useState, type RefObject } from "react";
import type { SetupStationsView } from "../../../src/contract/setup";
import type { Station, StationMap, SurfaceFront, Zone } from "../../../src/contract/stations";
import { Button } from "../components/ui/button";
import { Card } from "../components/ui/card";
import { Input } from "../components/ui/input";
import { LineDrawSvg } from "../components/ui/line-draw-svg";
import { Label } from "../components/ui/label";
import { SelectNative } from "../components/ui/select-native";
import { Status } from "../components/ui/status";
import type { AptViewer } from "../lib/twin-viewer";
import { call, failText, isOk } from "./setup-api";
import { arrowPath, canvasBox, screenOf, useFloorClicks, type Pos } from "./start-pick";

type Kind = "station" | "zone" | "front";
type Option = { id: string; name: string };
type Scene = { plan: { rooms: { id: string; label?: string }[] }; objects: (Option & { room: string; category: string; mount?: string })[] };
const labels = { station: "대기·관찰 자리", zone: "사람이 머무는 구역", front: "가구 앞 설 자리" };
const url = "/api/setup/stations";

function Many({ title, items, values, onChange }: { title: string; items: Option[]; values: string[]; onChange: (v: string[]) => void }) {
  return <Label>{title}<SelectNative multiple aria-label={title} value={values}
    onChange={e => onChange(Array.from(e.currentTarget.selectedOptions, o => o.value))}>
    {items.map(i => <option key={i.id} value={i.id}>{i.name}</option>)}
  </SelectNative></Label>;
}

type CanvasProps = { viewer: AptViewer | null; frame: RefObject<HTMLIFrameElement | null>; box: RefObject<HTMLDivElement | null> };

function FloorOutline({ viewer, frame, box, points, polygon }: CanvasProps & { points: Pos[]; polygon: boolean }) {
  const [drawing, setDrawing] = useState({ path: "", width: 1, height: 1 });
  useEffect(() => {
    if (!viewer || !frame.current || !box.current) return;
    const iframe = frame.current, parent = box.current;
    let raf = 0;
    function project() {
      const rect = canvasBox(viewer!, iframe, parent);
      const width = parent.clientWidth || rect.width, height = parent.clientHeight || rect.height;
      const pixels = points.map(p => {
        const v = screenOf(viewer!, rect, p);
        return { x: Math.round(v.x + rect.left), y: Math.round(v.y + rect.top), visible: v.visible };
      });
      let path = "";
      if (pixels.length && pixels.some(p => p.visible)) {
        const first = pixels[0];
        if (pixels.length === 1) path = `M${first.x-3},${first.y}h6m-3,-3v6`;
        else if (polygon) path = pixels.map((p,i) => `${i ? "L" : "M"}${p.x},${p.y}`).join("") + (pixels.length >= 3 ? "Z" : "");
        else path = arrowPath({width, height, spot:first, tip:pixels[1]});
      }
      setDrawing(old => old.path === path && old.width === width && old.height === height ? old : {width,height,path});
      raf = requestAnimationFrame(project);
    }
    project();
    return () => cancelAnimationFrame(raf);
  }, [viewer, frame, box, points, polygon]);
  return <div aria-label={polygon ? "선택한 구역 경계" : "선택한 자리 방향"} className="pointer-events-none absolute inset-0 overflow-hidden">
    <LineDrawSvg {...drawing} tone="cloidHeading" strokeWidth={3}/>
  </div>;
}

export function StationsEditor({ home, viewer, frame, box }: { home: string } & CanvasProps) {
  const [map, setMap] = useState<StationMap | null>(null);
  const [saved, setSaved] = useState<StationMap | null>(null);
  const [scene, setScene] = useState<Scene | null>(null);
  const [status, setStatus] = useState("");
  const [saving, setSaving] = useState(false);
  const [room, setRoom] = useState("");
  const [kind, setKind] = useState<Kind>("station");
  const [id, setId] = useState("");
  const [pick, setPick] = useState<"position" | "look_at" | "polygon" | "add" | null>(null);
  const [furniture, setFurniture] = useState("");
  useEffect(() => {
    let active = true;
    void Promise.all([call<SetupStationsView>(url), call<{ok:true;scene:Scene}>("/api/scene")]).then(([r,s]) => {
      if (!active) return;
      if (!isOk(r) || r.json.home !== home || !isOk(s)) { setStatus("자리 설정을 불러오지 못했어요."); return; }
      setMap(r.json.map); setSaved(r.json.map); setScene(s.json.scene);
      setRoom(r.json.map.stations[0]?.room ?? s.json.scene.plan.rooms[0]?.id ?? "");
    });
    return () => { active = false; };
  }, [home]);

  const stations = map?.stations.filter(s => s.room === room) ?? [];
  const zones = map?.zones.filter(z => z.room === room) ?? [];
  const fronts = map?.surface_fronts.filter(f => f.room === room) ?? [];
  const objects = scene?.objects.filter(o => o.room && o.category !== "structure" && o.mount !== "opening") ?? [];
  const rooms = scene?.plan.rooms.map(r => ({id:r.id,name:r.label ?? r.id})) ?? [];
  const options = kind === "station" ? stations : kind === "zone" ? zones : fronts.map(f => ({ id:f.surface_id, name:objects.find(o=>o.id===f.surface_id)?.name ?? f.surface_id }));
  const selected = (options.find(o => o.id === id) ?? options[0])?.id ?? "";
  const s = kind === "station" ? stations.find(v=>v.id===selected) : undefined;
  const z = kind === "zone" ? zones.find(v=>v.id===selected) : undefined;
  const f = kind === "front" ? fronts.find(v=>v.surface_id===selected) : undefined;
  const available = objects.filter(o=>o.room===room && !fronts.some(v=>v.surface_id===o.id));
  const surface = available.find(o=>o.id===furniture)?.id ?? available[0]?.id;
  function update(patch: Partial<Station>, zone?: Partial<Zone>, front?: Partial<SurfaceFront>) {
    if (!map) return;
    if (s) setMap({...map, stations:map.stations.map(v=>v===s ? {...s,...patch} : v)});
    if (z && zone) setMap({...map, zones:map.zones.map(v=>v===z ? {...z,...zone} : v)});
    if (f && front) setMap({...map, surface_fronts:map.surface_fronts.map(v=>v===f ? {...f,...front} : v)});
  }
  function add(p: Pos) {
    if (!map || !room) return;
    const key = crypto.randomUUID();
    if (kind === "station") {
      setMap({...map,stations:[...map.stations,{id:key,name:"새 관찰 자리",room,roles:["observe"],position:p,look_at:p,rooms:[room],surfaces:[],observes_zone_ids:[]}]});
      setId(key); setPick("look_at");
    } else if (kind === "zone") {
      setMap({...map,zones:[...map.zones,{id:key,name:"새 구역",room,polygon:[p]}]});
      setId(key); setPick("polygon");
    } else if (surface) {
      setMap({...map,surface_fronts:[...map.surface_fronts,{surface_id:surface,room,position:p,look_at:p,near_m:0.4}]});
      setId(surface); setPick("look_at");
    }
  }
  useFloorClicks(viewer, p => {
    if (saving || !pick) return;
    if (pick === "add") { add(p); return; }
    if (pick === "polygon" && z) { update({}, { polygon:[...z.polygon,p] }); return; }
    if (pick === "position" || pick === "look_at") update({[pick]:p}, undefined, {[pick]:p});
    setPick(null);
  });
  function remove() {
    if (!map) return;
    if (s) setMap({...map,stations:map.stations.filter(v=>v!==s),kitchen_entry:map.kitchen_entry===s.id?null:map.kitchen_entry,meal_watch:map.meal_watch===s.id?null:map.meal_watch});
    if (z) setMap({...map,zones:map.zones.filter(v=>v!==z),stations:map.stations.map(v=>({...v,observes_zone_ids:v.observes_zone_ids.filter(k=>k!==z.id)}))});
    if (f) setMap({...map,surface_fronts:map.surface_fronts.filter(v=>v!==f)});
    setPick(null); setId("");
  }
  async function save() {
    if (!map || saving) return;
    setSaving(true); setPick(null);
    const r = await call<SetupStationsView>(url,{home,map},"PUT");
    if (isOk(r) && r.json.home === home) { setSaved(r.json.map); setMap(r.json.map); setStatus("저장했어요."); }
    else setStatus(failText(r,"저장하지 못했어요."));
    setSaving(false);
  }
  const p = s ?? f;
  const observing = map?.stations.filter(v=>v.roles.includes("observe")) ?? [];
  return <>{(z || p) && <FloorOutline viewer={viewer} frame={frame} box={box} points={z?.polygon ?? [p!.position,p!.look_at]} polygon={Boolean(z)}/>}
    <Card role="region" aria-label="자리·구역 편집" className="relative flex flex-col gap-2 p-3 lg:absolute lg:right-3 lg:bottom-16 lg:top-24 lg:w-72 lg:overflow-y-auto">
    {status && <Status>{status}</Status>}
    {map && <fieldset disabled={saving} className="flex flex-col gap-2">
      <Label>방<SelectNative value={room} onChange={e=>{setRoom(e.target.value);setId("");setPick(null);}}>{rooms.map(v=><option key={v.id} value={v.id}>{v.name}</option>)}</SelectNative></Label>
      <Label>편집할 항목<SelectNative value={kind} onChange={e=>{setKind(e.target.value as Kind);setId("");setPick(null);}}>{Object.entries(labels).map(([k,v])=><option key={k} value={k}>{v}</option>)}</SelectNative></Label>
      <Label>{labels[kind]}<SelectNative value={selected} onChange={e=>{setId(e.target.value);setPick(null);}}>{options.map(v=><option key={v.id} value={v.id}>{v.name}</option>)}</SelectNative></Label>
      {kind==="front" && <Label>추가할 가구<SelectNative value={surface??""} onChange={e=>setFurniture(e.target.value)}>{available.map(o=><option key={o.id} value={o.id}>{o.name}</option>)}</SelectNative></Label>}
      <div><Button size="sm" disabled={!room || (kind==="front" && !surface)} onClick={()=>setPick("add")}>추가</Button> <Button size="sm" variant="outline" disabled={!selected} onClick={remove}>지우기</Button></div>
      {(s || z) && <Label>이름<Input value={(s??z)!.name} onChange={e=>update({name:e.target.value},{name:e.target.value})}/></Label>}
      {s && <>
        <Many title="자리 용도" items={[{id:"standby",name:"대기"},{id:"observe",name:"관찰"}]} values={s.roles} onChange={roles=>update({roles:roles as Station["roles"]})}/>
        <Many title="보이는 방" items={rooms} values={s.rooms} onChange={rooms=>update({rooms})}/>
        <Many title="보이는 가구·가전" items={objects} values={s.surfaces} onChange={surfaces=>update({surfaces})}/>
        <Many title="보이는 구역" items={map.zones} values={s.observes_zone_ids} onChange={observes_zone_ids=>update({observes_zone_ids})}/>
      </>}
      {p && <><Button variant="outline" aria-pressed={pick==="position"} onClick={()=>setPick("position")}>발 위치 고르기</Button><output>{p.position.join(", ")} m</output>
        <Button variant="outline" aria-pressed={pick==="look_at"} onClick={()=>setPick("look_at")}>바라볼 곳 고르기</Button><output>{p.look_at.join(", ")} m</output></>}
      {f && <Label>도착 거리 · 미터<Input type="number" step="0.05" min="0.05" value={f.near_m} onChange={e=>update({},undefined,{near_m:Number(e.target.value)})}/></Label>}
      {z && <><Button variant="outline" onClick={()=>setPick("polygon")}>꼭짓점 찍기</Button><output>{z.polygon.map(p=>p.join(", ")).join(" · ")}</output>
        <Button variant="outline" disabled={!z.polygon.length} onClick={()=>update({},{polygon:z.polygon.slice(0,-1)})}>마지막 점 취소</Button></>}
      {pick && <Status>{pick==="look_at"?"트윈에서 바라볼 곳을 눌러 주세요.":pick==="polygon"?"구역의 꼭짓점을 차례로 눌러 주세요.":"트윈에서 바닥 자리를 눌러 주세요."}</Status>}
      {(["kitchen_entry","meal_watch"] as const).map(key=><Label key={key}>{key==="kitchen_entry"?"주방 입구 관찰":"식탁 관찰"}
        <SelectNative value={map[key]??""} onChange={e=>setMap({...map,[key]:e.target.value||null})}><option value="">자리 없음</option>{observing.map(v=><option key={v.id} value={v.id}>{v.name}</option>)}</SelectNative></Label>)}
      {!stations.some(v=>v.roles.includes("standby")) && <Status>이 방의 대기 자리가 없어요.</Status>}
      <div><Button disabled={map===saved} onClick={()=>void save()}>저장</Button> <Button variant="outline" onClick={()=>{setMap(saved);setPick(null);setStatus("");}}>되돌리기</Button></div>
    </fieldset>}
  </Card></>;
}
