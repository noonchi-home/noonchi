import { useCallback, useEffect, useRef, useState } from "react";
import { Alert, AppState } from "react-native";
import type { SceneJson, Vec2 } from "../../src/contract/layout";
import type { ControlMode, SetupView, ThinqDevicesView } from "../../src/contract/setup";
import { ConnectedPlan } from "./ConnectedPlan";
import { ConnectedStations } from "./ConnectedStations";
import { Action, Choice, Copy, Failure, Field, Heading, Loading, Panel, useResource, useSettingTask, useTask } from "./ConnectedUi";
import { connectedHouse, readForHome, type ConnectedHub, type StartPosition } from "./connected-hub";

type Page = "house" | "appliances" | "devices" | "mode" | "position" | "stations" | "layout";
type Save = (setup?: SetupView, chosen?: string) => Promise<void>;
type Context = { hub: ConnectedHub; home: string; onSaved: Save; onBlock: (value: boolean) => void };
const labels: Record<Page, string> = {
  house: "집 고르기", appliances: "가전 연결", devices: "읽을 가전 선택", mode: "모드",
  position: "시작 위치", stations: "자리·구역", layout: "배치 보정",
};

export function ConnectedSettings({ hub, setup, onSaved, onBlock, onDisconnect, initialPage, backToHome, backToHouse }: {
  hub: ConnectedHub; setup: SetupView; onSaved: Save; onBlock: (value: boolean) => void; onDisconnect: () => void;
  initialPage?: "position" | "house"; backToHome?: () => void; backToHouse?: () => void;
}) {
  const [page, setPage] = useState<Page | undefined>(initialPage);
  const [busy, setBusy] = useState(false);
  const block = useCallback((value: boolean) => { setBusy(value); onBlock(value); }, [onBlock]);
  const context = { hub, home: setup.home?.id ?? "", onSaved, onBlock: block };
  if (page) return <Panel>
    <Heading>{labels[page]}</Heading>
    {page === "house" && <HouseSetting {...context} setup={setup} />}
    {page === "appliances" && <ApplianceSetting key={`${hub.origin}/${context.home}`} {...context} setup={setup}
      onChooseDevices={() => setPage("devices")} />}
    {page === "devices" && <DevicesSetting {...context} setup={setup} />}
    {page === "mode" && <ModeSetting {...context} setup={setup} />}
    {page === "position" && <PositionSetting {...context} />}
    {page === "stations" && <ConnectedStations {...context} />}
    {page === "layout" && <LayoutSetting {...context} />}
    <Action title={backToHome ? "홈으로" : backToHouse ? "집 관리로" : "설정 목록으로"} disabled={busy} secondary
      onPress={backToHome ?? backToHouse ?? (() => setPage(page === "devices" ? "appliances" : undefined))} />
  </Panel>;
  const summaries: Record<Page, string> = {
    house: setup.home?.name.replace(/\s*[(（].*$/, "").trim() || "미선택",
    appliances: Object.keys(setup.pairs).length ? `${Object.keys(setup.pairs).length}개 연결` : "미연결",
    devices: setup.home ? `${setup.devices.length}개` : "집 선택 필요",
    mode: setup.mode === "live" ? "운영 모드" : "테스트 모드",
    position: setup.position.start ? "설정 가능" : "사용 불가",
    stations: setup.home ? "설정 가능" : "집 선택 필요",
    layout: setup.position.layout ? "설정 가능" : "사용 불가",
  };
  const enabled: Record<Page, boolean> = {
    house: !!setup.homes.length, appliances: !!setup.home, devices: !!setup.home, mode: !!setup.home,
    position: setup.position.start, stations: !!setup.home, layout: setup.position.layout,
  };
  return <Panel><Heading>설정</Heading>
    {setup.home && <Copy>{summaries.house}</Copy>}
    {(Object.keys(labels) as Page[]).filter(key => key !== "devices" && (key !== "house" || !setup.home)).map(key => <Choice key={key} title={labels[key]} value={summaries[key]}
      disabled={setup.switching || !enabled[key]} onPress={() => setPage(key)} />)}
    <Copy>{hub.origin}</Copy>
    <Action title="서버 연결 끊기" secondary onPress={() => Alert.alert("서버 연결 끊기", "다시 연결하려면 대시보드의 QR이 필요해요.", [
      { text: "취소", style: "cancel" }, { text: "연결 끊기", style: "destructive", onPress: onDisconnect },
    ])} />
  </Panel>;
}

function HouseSetting({ setup, hub, onSaved, onBlock }: Context & { setup: SetupView }) {
  const [selected, select] = useState(setup.home?.id);
  const task = useSettingTask(onBlock);
  return <>
    {setup.homes.map(home => <Choice key={home.id} title={home.name} selected={selected === home.id}
      onPress={() => select(home.id)} disabled={task.busy} />)}
    <Failure>{task.error}</Failure>
    <Action title="집 저장" disabled={!selected || task.busy} onPress={() => void task.run(async () => {
      if (!selected) return;
      const next = await hub.write<SetupView>("/api/setup/home", { home: selected });
      if (next.home?.id !== selected || next.switching) throw new Error(next.error ?? "집을 바꾸지 못했어요.");
      await hub.get<{ scene: SceneJson }>("/api/scene");
      await onSaved(next, selected);
    })} />
  </>;
}

function DevicesSetting({ setup, hub, home, onSaved, onBlock }: Context & { setup: SetupView }) {
  const [sources, setSources] = useState(() => Object.fromEntries(setup.devices.map(device => [device.id, device.source.kind])));
  const task = useSettingTask(onBlock);
  return <><Copy>트윈 가전에서 가상 신호를 사용할 기기를 골라 주세요.</Copy>
    {setup.devices.map(device => <Choice key={device.id} title={`${device.roomLabel} · ${device.label}`}
      value={sources[device.id] === "virtual" ? "가상 신호" : "신호 없음"} selected={sources[device.id] === "virtual"}
      disabled={task.busy} onPress={() => setSources(previous => ({
        ...previous, [device.id]: previous[device.id] === "virtual" ? "none" : "virtual",
      }))} />)}
    <Failure>{task.error}</Failure>
    <Action title="가전 설정 저장" disabled={task.busy} onPress={() => void task.run(async () => {
      await onSaved(await hub.write<SetupView>("/api/setup/devices", { home, sources }));
    })} />
  </>;
}

function ModeSetting({ setup, hub, onSaved, onBlock }: Context & { setup: SetupView }) {
  const [mode, select] = useState<ControlMode>(setup.mode);
  const task = useSettingTask(onBlock);
  function save() {
    const write = (confirm?: true) => void task.run(async () => {
      await onSaved(await hub.write<SetupView>("/api/setup/mode", confirm ? { mode, confirm } : { mode }));
    });
    if (mode === "test") return write();
    Alert.alert("운영 모드로 바꿀까요?", "연결한 실제 가전이 움직일 수 있어요.", [
      { text: "취소", style: "cancel" }, { text: "운영 모드로 바꾸기", onPress: () => write(true) },
    ]);
  }
  return <>
    <Choice title="테스트 모드" value="트윈에서만 동작" selected={mode === "test"} disabled={task.busy} onPress={() => select("test")} />
    <Choice title="운영 모드" value="연결한 가전 사용"
      selected={mode === "live"} disabled={task.busy || (!setup.thinq.ready && !setup.ir?.ready)} onPress={() => select("live")} />
    <Failure>{task.error}</Failure>
    <Action title="모드 저장" disabled={task.busy || mode === setup.mode} onPress={save} />
  </>;
}

function ApplianceSetting({ home, setup, hub, onSaved, onBlock, onChooseDevices }: Context & { setup: SetupView; onChooseDevices: () => void }) {
  const task = useSettingTask(onBlock);
  const [requested, request] = useState(false);
  const available = !!home && !setup.switching && setup.thinq.ready && (setup.mode === "live" || home === connectedHouse.id);
  const read = useCallback(async (signal: AbortSignal) => {
    if (!requested || !available) return null;
    return readForHome(hub, home, async () => {
      const result = await hub.get<ThinqDevicesView>(`/api/setup/thinq?home=${encodeURIComponent(home)}`, signal);
      if (result.home !== home || !Array.isArray(result.devices)) throw new Error("허브에서 열린 집을 다시 확인해 주세요.");
      return result.devices;
    }, signal);
  }, [available, home, hub, requested]);
  const devices = useResource(read);
  const [selected, select] = useState<string>();
  const [target, setTarget] = useState<string | null>(null);
  useEffect(() => {
    const state = AppState.addEventListener("change", next => {
      if (next === "active") { request(false); select(undefined); setTarget(null); }
    });
    return () => state.remove();
  }, []);
  const device = setup.devices.find(entry => entry.id === selected);
  const list = requested && available ? devices.value : null;
  const checking = requested && available && devices.value === undefined && !devices.error;
  return <><Heading>LG ThinQ API 기본 연결</Heading>
    <Copy>{setup.home?.name.replace(/\s*[(（].*$/, "").trim()}</Copy>
    {!setup.thinq.ready ? <Copy>허브에 ThinQ 연결 설정이 없어요.</Copy>
      : !available ? <Copy>이 집의 ThinQ 기기는 운영 모드에서 확인할 수 있어요.</Copy>
        : !requested ? <Copy>허브에 설정됨 · 조회 전</Copy>
          : checking ? <Loading>기기 확인 중</Loading>
            : devices.error ? <Failure>{devices.error}</Failure>
              : list && <Copy>조회 성공 · 기기 {list.length}개</Copy>}
    <Action title="LG ThinQ 기기 확인" disabled={!available || checking || task.busy}
      onPress={() => { select(undefined); setTarget(null); if (requested) devices.refresh(); else request(true); }} />
    {list && !setup.devices.some(item => item.pairable) && <Copy>이 집에는 연결할 가전이 없어요.</Copy>}
    {list && list.length > 0 && list.every(item => !item.kind) && <Copy>연결할 수 있는 ThinQ 기기가 없어요.</Copy>}
    {list && list.length > 0 &&
      setup.devices.filter(item => item.pairable).map(item => <Choice key={item.id} title={item.label}
        value={list.find(entry => entry.id === setup.pairs[item.id])?.name ?? "연결 안 됨"} selected={selected === item.id}
        disabled={task.busy} onPress={() => { select(item.id); setTarget(setup.pairs[item.id] ?? null); }} />)}
    {device && list && <>
      <Choice title="연결 안 함" selected={target === null} disabled={task.busy} onPress={() => setTarget(null)} />
      {list.filter(item => item.kind === device.kind).map(item => <Choice key={item.id}
        title={item.name} value={item.model} selected={target === item.id} disabled={task.busy} onPress={() => setTarget(item.id)} />)}
      <Action title="연결 저장" disabled={task.busy} onPress={() => void task.run(async () => {
        await onSaved(await hub.write<SetupView>("/api/setup/pairs", { home, pairs: { [device.id]: target } }));
      })} />
    </>}
    <Failure>{task.error}</Failure>
    <Copy>리모컨(IR) · Matter</Copy>
    <Action title="읽을 가전 선택" disabled={task.busy} onPress={onChooseDevices} secondary />
  </>;
}

type PoseView = { start: StartPosition | null };

function PositionSetting({ hub, home, onSaved, onBlock }: Context) {
  const read = useCallback((signal: AbortSignal) => readForHome(hub, home, async () => {
    const [pose, scene] = await Promise.all([hub.get<PoseView>("/api/phone/start-pose", signal),
      hub.get<{ scene: SceneJson }>("/api/scene", signal)]);
    return { ...pose, ...scene };
  }, signal), [hub, home]);
  const resource = useResource(read);
  if (!resource.value) return resource.error ? <><Failure>{resource.error}</Failure><Action title="다시 불러오기" onPress={resource.refresh} /></> : <Loading />;
  return <PositionEditor {...resource.value} hub={hub} home={home} onSaved={onSaved} onBlock={onBlock} />;
}

function PositionEditor({ start, scene, hub, home, onSaved, onBlock }: Context & PoseView & { scene: SceneJson }) {
  const [at, setAt] = useState(start?.position);
  const [direction, setDirection] = useState(String(start?.yaw_deg ?? 0));
  const [label, setLabel] = useState(start?.label ?? "");
  const [facing, setFacing] = useState(start?.facing_label ?? "");
  const [pickDirection, setPickDirection] = useState(false);
  const edited = useRef({ label: false, facing: false });
  const task = useSettingTask(onBlock);
  const yaw = direction.trim() ? Number(direction) : Number.NaN;
  const radians = yaw * Math.PI / 180;
  const ready = !!at && Number.isFinite(yaw);
  function aim(value: string) {
    setDirection(value);
    if (!edited.current.facing) setFacing("");
  }
  return <>
    <Copy>{pickDirection ? "서 있는 자리에서 바라볼 곳을 도면에서 눌러 주세요." : "폰을 켤 자리를 도면에서 눌러 주세요."}</Copy>
    <ConnectedPlan scene={scene} label="시작 위치와 방향 선택"
      guides={at ? [{ points: Number.isFinite(yaw) ? [at, [at[0] + Math.cos(radians), at[1] + Math.sin(radians)]] : [at] }] : []}
      onPoint={task.busy ? undefined : point => {
        if (at && pickDirection) {
          if (Math.hypot(point[0] - at[0], point[1] - at[1]) < 0.3) return;
          const degrees = Math.round(Math.atan2(point[1] - at[1], point[0] - at[0]) * 180 / Math.PI);
          aim(String((degrees + 360) % 360));
          setPickDirection(false);
        } else {
          setAt(point);
          if (!edited.current.label) setLabel("");
          if (!edited.current.facing) setFacing("");
        }
      }} />
    <Action title={pickDirection ? "자리 고르기" : "바라볼 방향 고르기"} disabled={!at || task.busy}
      onPress={() => setPickDirection(value => !value)} secondary />
    <Field label="방향(도)" value={direction} onChangeText={aim} keyboardType="numbers-and-punctuation" />
    <Field label="자리 이름" value={label} placeholder="자동 이름" onChangeText={value => { edited.current.label = true; setLabel(value); }} />
    <Field label="방향 이름" value={facing} placeholder="자동 이름" onChangeText={value => { edited.current.facing = true; setFacing(value); }} />
    <Failure>{task.error}</Failure>
    <Action title="시작 위치 저장" disabled={!ready || task.busy} onPress={() => void task.run(async () => {
      await hub.write("/api/phone/start-pose", { home, position: at, yaw_deg: yaw, label, facing_label: facing });
      await onSaved();
    })} />
    {start && <Action title="저장한 시작 위치 지우기" disabled={task.busy} secondary onPress={() => Alert.alert("시작 위치를 지울까요?", "", [
      { text: "취소", style: "cancel" }, { text: "지우기", style: "destructive", onPress: () => void task.run(async () => {
        await hub.write("/api/phone/start-pose/clear", { home });
        await onSaved();
      }) },
    ])} />}
  </>;
}

type LayoutStatus = { edits: number; dirty: boolean; items: { id: string; op: string }[] };

function LayoutSetting({ home, hub, onSaved, onBlock }: Context) {
  const read = useCallback((signal: AbortSignal) => hub.get<LayoutStatus>("/api/layout", signal), [hub]);
  const layout = useResource(read);
  const task = useSettingTask(onBlock);
  if (!layout.value) return layout.error ? <><Failure>{layout.error}</Failure><Action title="다시 불러오기" onPress={layout.refresh} /></> : <Loading />;
  const change = (operation: "save" | "reset") => void task.run(async () => {
    await hub.write(`/api/layout/${operation}`, { home });
    await onSaved();
  });
  return <>
    <Copy>{layout.value.dirty ? "아직 저장하지 않은 배치 변경이 있어요." : "배치 변경이 저장되어 있어요."}</Copy>
    <Copy>배치 보정 {layout.value.edits}개</Copy>
    {layout.value.items.map(item => <Copy key={item.id}>{item.id}</Copy>)}
    <Failure>{task.error}</Failure>
    <Action title="배치 변경 저장" disabled={!layout.value.dirty || task.busy} onPress={() => change("save")} />
    <Action title="배치 변경 되돌리기" disabled={!layout.value.edits || task.busy} secondary onPress={() =>
      Alert.alert("배치 변경을 되돌릴까요?", "이 집의 배치 보정을 모두 지우고 원래 도면을 불러와요.", [
        { text: "취소", style: "cancel" }, { text: "되돌리기", style: "destructive", onPress: () => change("reset") },
      ])} />
  </>;
}
