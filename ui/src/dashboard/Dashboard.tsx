import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { DeviceView, EyeEvent, ServerMessage } from "../../../src/contract/events.ts";
import type { PlanView } from "../../../src/contract/plan.ts";
import type { TraceRow } from "../../../src/contract/trace.ts";
import { BubbleLayer } from "./bubbles/BubbleLayer";
import { checkList, dashboardChecks, type ChecksState } from "./checks/checks";
import { useChecks } from "./checks/use-checks";
import { useDevices } from "../lib/use-devices";
import { useEvents } from "../lib/use-events";
import { useHealth } from "../lib/use-health";
import { TwinStage, useAnchors, type TwinEngine, LiveQueue, attachLive, BAKE_VIEWS, Twin3D, useLayoutBox } from "../twin";
import { useViewer } from "../lib/twin-viewer";
import { activityFocus, still, wholeOf, wideCamera, type Camera } from "./camera";
import { currentStep, isOpen, stepIndex } from "./data";
import { currentStatusRowsOf } from "./timeline";
import { goalOf, type GoalNow } from "./goal";
import { DashboardScreen } from "./DashboardScreen";
import { debugPhone, debugQuery, useDebugSteps, type Moment } from "./debug";
import { roomSetsOf, twinFrame } from "./frame";
import { homeIndexOf, type HomeIndex } from "./home";
import { hubOf, useMobileUrl } from "../lib/hub";
import type { PageLayout } from "./layout";
import { MapOverlay } from "./MapOverlay";
import { markTone, type MarkTone } from "./trace-marks";
import { CAMERA_MS, useReducedMotionNow } from "./motion";
import type { PhoneSlot } from "./PhonePane";
import { useDash } from "./use-dash";
import { NarrationPane } from "./NarrationPane";
import { narrationOf } from "./narration";
import { usePhoneCommand } from "./use-phone-command";

declare global {
  interface Window { __twin3d?: { engine: TwinEngine | null; ready: boolean } }
}

/** 트윈 위에 얹힌 것: 말풍선이 덮지 않을 자리. */
const AVOID = "[data-mascot], [data-chips], [data-phone]";

/** 확인 목록만 말풍선으로(승인 대기 줄은 뺀다). 두뇌 줄은 장면의 식탁(dining_table)에 붙는다. 자리는 확인한 것만 센다. 말풍선은 트윈 위에 얹힌 것(AVOID)을 비킨다. */
function Overlay({ devices, checks, focusId }: { devices: ReturnType<typeof useDevices>["devices"]; checks: ChecksState; focusId: string | null }) {
  const v = useViewer();
  const table = useMemo(() => v?.objects().find((o) => o.type === "dining_table") ?? null, [v]);
  const list = useMemo(() => dashboardChecks(checkList(checks, table ? { id: table.id } : null)), [checks, table]);
  const objects = useMemo(() => new Map<string, string>(table ? [[table.id, table.name ?? "식탁"]] : []), [table]);
  const points = useAnchors(list.map((c) => c.deviceId ?? c.objectId!));
  return <BubbleLayer checks={list} devices={devices} objects={objects} points={points} focusId={focusId} avoid={AVOID} />;
}

/** 3D 트윈을 다 불러왔으면 알린다. */
function MapReady({ onReady }: { onReady: (ready: boolean) => void }) {
  const v = useViewer();
  useEffect(() => { onReady(v !== null); }, [v, onReady]);
  return null;
}

/** 트윈 칸 종류: 구운 보기가 있는 집이고 /twin/bake/manifest.json이 있으면 three.js("three"), 아니면 iframe 뷰어. 집을 아직 모르면 null. */
function useTwinKind(homeId: string | null, known: boolean): "three" | "iframe" | null {
  const [kind, setKind] = useState<"three" | "iframe" | null>(null);
  useEffect(() => {
    if (!known) return;
    if (!homeId || !BAKE_VIEWS[homeId]) { setKind("iframe"); return; }
    let live = true;
    fetch("/twin/bake/manifest.json", { method: "HEAD" })
      .then((r) => { if (live) setKind(r.ok ? "three" : "iframe"); }, () => { if (live) setKind("iframe"); });
    return () => { live = false; };
  }, [homeId, known]);
  return kind;
}

interface HomeData { index: HomeIndex; tableId: string | null; names: Map<string, string> }
type SceneJson = Parameters<typeof homeIndexOf>[0];

/** 구운 트윈 집의 평면 색인(/api/scene), 식탁 id, 물건 이름. 집을 모르거나 장면을 받지 못하면 null. */
function useHomeData(home: string | null): HomeData | null {
  const [data, setData] = useState<HomeData | null>(null);
  useEffect(() => {
    const cam = home ? BAKE_VIEWS[home] : undefined;
    setData(null);
    if (!cam) return;
    let live = true;
    fetch("/api/scene")
      .then(async (r) => (r.ok ? ((await r.json()) as { scene?: SceneJson }).scene ?? null : null))
      .then((scene) => {
        if (!live || !scene?.plan || !Array.isArray(scene.objects)) return;
        const index = homeIndexOf(scene, cam);
        const table = (scene.objects as { id?: unknown; type?: unknown }[]).find((o) => o.type === "dining_table");
        setData({ index, tableId: typeof table?.id === "string" ? table.id : null, names: new Map([...index.objects].map(([id, o]) => [id, o.name])) });
      }, () => {});
    return () => { live = false; };
  }, [home]);
  return data;
}

/**
 * 구운 3D 트윈(TwinStage와 같은 틀): 캔버스와 그 위 표시 판(MapOverlay: 경로·목적지·확인한 것·어둡게 한 방·말풍선).
 * 계획·맞춘 눈은 대시보드 자료(data.ts)의 것이다. 클로이드(맞춘 눈)는 엔진 장면의 보는 방향 원뿔이다(engine.setEye).
 * 작은 지도는 지금 단계·사람·맞춘 폰 주변을 확대한다.
 * 지금 그린 트레이스 표시(줄 id와 색)는 onTwin으로 알린다(트레이스 칸이 같은 색 점을 붙인다).
 * 바뀌면 CAMERA_MS 동안 옮긴다(움직임 줄이기면 바로). 종류를 정하기 전(home null)에는 캔버스 없이 틀만.
 * 엔진이 뜨고 버려질 때 onEngine, 첫 그림을 그리면 onReady.
 */
function BakedStage({ home, homeData, layout, trace, plans, plan, eye, goal, checks, devices, onEngine: toLive, onReady: toReady, onTwin }: {
  home: string | null;
  homeData: HomeData | null;
  /** 받은 트레이스 줄: 트윈은 가장 최근 활동의 줄을 그 자리에 그린다(trace-marks.ts). */
  trace: readonly TraceRow[];
  /** 트레이스 줄의 계획 id로 자리를 찾을 계획(미리 만든 계획·최근 계획). */
  plans: readonly (PlanView | null | undefined)[];
  layout: PageLayout;
  plan: PlanView | null;
  eye: EyeEvent | null;
  /** 미리 세운 목표(goal.ts): 선 동안 치울 물건 위 빨간 고리. */
  goal: GoalNow | null;
  checks: ChecksState;
  devices: Map<string, DeviceView>;
  onEngine: (engine: TwinEngine | null) => void;
  onReady: () => void;
  onTwin: (marks: ReadonlyMap<string, MarkTone>) => void;
}) {
  const box = useRef<HTMLElement>(null);
  const size = useLayoutBox(box);
  const v = home ? BAKE_VIEWS[home] : undefined;
  const [engine, setEngine] = useState<TwinEngine | null>(null);
  // 트윈 말풍선은 에이전트가 다룬 가전만(두뇌 「지켜봄」·「확인」 말풍선은 그리지 않는다, 2026-11-25 사용자 결정 5-1)
  const list = useMemo(() => dashboardChecks(checks.turn), [checks.turn]);
  // 말풍선·이름표가 비킬 클로이드 자리는 원뿔을 그리는 자리(방 안·벽에서 떨어진 자리)다. 엔진에는 받은 눈을 그대로 넣는다
  const drawn = useMemo(() => (eye && engine && !eye.estimated ? { ...eye, position: engine.stand(eye.position) } : eye), [eye, engine]);
  const frame = useMemo(
    () => (v && homeData ? twinFrame({ plan, eye: drawn, checks: list, anchor: (id) => engine?.anchor(id) ?? null, home: homeData.index, cam: v, world: checks.world ?? null, goal, trace, plans }) : null),
    [v, homeData, plan, drawn, list, engine, checks.world, goal, trace, plans],
  );
  const roomSets = useMemo(() => (frame?.plan && homeData ? roomSetsOf(frame.plan, homeData.index) : []), [frame?.plan, homeData]);
  // 집 전체(모든 방)는 가장 먼 보기다
  const whole = useMemo(() => (homeData ? wholeOf(homeData.index.shapes) : null), [homeData]);
  const focus = frame && homeData ? activityFocus(frame, homeData.index.shapes) : null;
  // 트윈에 그린 트레이스 줄과 그 색을 트레이스 칸에 알린다
  const drawnRows = useMemo(() => new Map((frame?.trace ?? []).map((m) => [m.rowId, markTone(m)] as const)), [frame?.trace]);
  useEffect(() => { onTwin(drawnRows); }, [drawnRows, onTwin]);
  // 맞출 곳(계획 단계는 그 단계에 중요한 것, 지켜보기는 클로이드가 있는 방)을 빈 곳 가운데에 두고 빈 곳을 채우게 당긴다
  const want = !v || size.width <= 0 || size.height <= 0 ? null : wideCamera(v, size, focus, layout.camPad, whole);
  const last = useRef<Camera | null>(null);
  const cam = want && last.current && still(last.current, want) ? last.current : want;
  useLayoutEffect(() => { last.current = cam; });
  const moveMs = useReducedMotionNow() ? 0 : CAMERA_MS;
  // 얹은 것(말풍선 카드·마스코트·미니맵·생각 말풍선) 자리(트윈 칸 px)
  const blocked = useMemo(() => layout.blocked.map((r) => ({
    x0: r.left - layout.twin.left, y0: r.top - layout.twin.top, x1: r.left + r.width - layout.twin.left, y1: r.top + r.height - layout.twin.top,
  })), [layout]);
  const debug = useMemo(() => new URLSearchParams(location.search).has("debug"), []);
  // 맞춘 눈은 3D 원뿔로(엔진이 뜬 뒤에도 마지막 눈을 넣는다)
  useEffect(() => { engine?.setEye(eye); }, [engine, eye]);
  const onEngine = useCallback((e: TwinEngine | null) => {
    setEngine(e);
    toLive(e);
    if (debug) window.__twin3d = { engine: e, ready: false };
  }, [debug, toLive]);
  const onReady = useCallback(() => {
    if (debug && window.__twin3d) window.__twin3d.ready = true;
    toReady();
  }, [debug, toReady]);
  return (
    <section ref={box} className="absolute inset-0" aria-label="3D 트윈">
      {home && cam && <Twin3D key={home} home={home} box={size} view={cam} moveMs={moveMs} onEngine={onEngine} onReady={onReady} />}
      {v && cam && frame && homeData && (
        <MapOverlay
          frame={frame} checks={list} shapes={homeData.index.shapes} roomSets={roomSets} image={v} size={size} cam={cam} engine={engine}
          devices={devices} objects={homeData.names} moveMs={moveMs} blocked={blocked} avoid={AVOID}
        />
      )}
    </section>
  );
}

/**
 * 대시보드: 서버에서 받은 것(health·/events·기기·확인 목록·대시보드 자료)을 화면 틀(DashboardScreen)에 넘긴다.
 * 대시보드 자료(data.ts): 열린 계획의 단계 번호·진행도, 마스코트 방향(열린 계획이면 트윈), 말풍선 카드 말, 생각 말풍선(마지막 유효 판단이 고른 행동과 그 생각·FSM 상태, 대기면 없음), 클로이드 자리를 아는가.
 * 트윈 칸 지도 자리: 한양목련처럼 구운 3D가 있는 집은 three.js 캔버스(클로이드 원뿔 포함)와 그 위 계획 경로·확인한 것·어둡게 한 방(BakedStage),
 * 다른 집은 iframe 뷰어(TwinStage)와 그 위 확인 목록 말풍선.
 * 구운 트윈의 가전 상태·배치는 같은 소켓 메시지로 바꾸고, 엔진이 뜨기 전에 온 메시지는 모아 두었다가 엔진이 뜨면 넣는다.
 * 대시보드 폰 칸은 폰 서버가 켜져 있으면 실시간 영상, 아니면 연결 QR이다. health 전에는 빈 칸이다.
 * 대시보드에는 입력이 없다: 요청·승인은 폰에서 음성으로 온다. 승인 대기는 보이지 않는다. 설정에서 집을 바꾸면 다시 불러온다.
 * ?debug=steps(debug.ts)면 대시보드 자료·확인 목록·대시보드 폰 칸·연결은 가짜 단계 순간 것이고, 트윈과 health는 서버 것이다.
 */
export function Dashboard() {
  const debug = useMemo(() => debugQuery(location.search), []);
  const scene = debug === null;
  const { devices, apply } = useDevices();
  // 서버에 다시 붙을 때(hello)마다 health를 다시 받는다: 서버를 다른 설정(기록 시간대 등)으로 다시 띄웠을 수 있다
  const [hellos, setHellos] = useState(0);
  const health = useHealth(hellos);
  const { checks, onMessage: toChecks } = useChecks();
  const { dash, seen, onMessage: toDash, load } = useDash({ hold: debug !== null });
  const [connected, setConnected] = useState<boolean | null>(null);
  const [awaitingHello, setAwaitingHello] = useState(false);
  const [focusId, setFocusId] = useState<string | null>(null);
  const [viewerReady, setViewerReady] = useState(false);
  const [bakedReady, setBakedReady] = useState(false);
  const [screenReady, setScreenReady] = useState(false);
  // 지금 트윈에 그린 트레이스 줄(id → 색). 같은 내용이면 바꾸지 않는다
  const [onTwin, setOnTwin] = useState<ReadonlyMap<string, MarkTone>>(() => new Map());
  const onTwinMarks = useCallback((marks: ReadonlyMap<string, MarkTone>) => setOnTwin((old) => {
    const same = old.size === marks.size && [...marks].every(([id, tone]) => old.get(id) === tone);
    return same ? old : marks;
  }), []);
  const homeId = health?.home?.id ?? null;
  const homeData = useHomeData(homeId);
  const { command, onMessage: toPhone, onDelay: onPhoneDelay, reset: clearPhone } = usePhoneCommand();
  const live = useRef<ReturnType<typeof attachLive> | null>(null);
  const queue = useRef(new LiveQueue());
  const kindRef = useRef<"three" | "iframe" | null>(null);
  const onMessage = useCallback((m: ServerMessage) => {
    if (m.type === "hello" && homeId && m.home && m.home !== homeId) {
      location.reload(); // 설정에서 집을 바꿨다
      return;
    }
    if (m.type === "hello") {
      setHellos((n) => n + 1);
      setAwaitingHello(false);
    }
    apply(m);
    if (!debug) {
      toChecks(m);
      toDash(m);
      toPhone(m);
    }
    if (m.type === "agent" && m.event === "action" && m.action.deviceId) setFocusId(m.action.deviceId);
    if (live.current) live.current.handle(m);
    else if (kindRef.current !== "iframe") queue.current.push(m);
  }, [apply, toChecks, toDash, toPhone, homeId, debug]);
  const onConnection = useCallback((open: boolean) => {
    setConnected(open);
    if (!open && !debug) {
      setAwaitingHello(true);
      clearPhone();
    }
  }, [clearPhone, debug]);
  useEvents(onMessage, onConnection);
  const onMoment = useCallback((m: Moment) => {
    load(m.messages);
    clearPhone();
    for (const message of m.messages) {
      toChecks(message);
      toPhone(message);
    }
  }, [load, toChecks, toPhone, clearPhone]);
  const kind = useTwinKind(homeId, health !== null);
  kindRef.current = kind;
  // 트윈이 없는 집은 기다리지 않는다
  const mapReady = (kind === "iframe" ? viewerReady : kind === "three" && bakedReady) || health?.twin === false;
  // 가짜 단계 재생은 화면이 다 뜬 뒤(미리 그려 보기 뒤 data-ready)부터 센다
  const moment = useDebugSteps(debug, onMoment, screenReady);
  useEffect(() => { if (kind === "iframe") queue.current.drain(); }, [kind]);
  const onEngine = useCallback((engine: TwinEngine | null) => {
    live.current?.dispose();
    live.current = null;
    if (!engine) { setBakedReady(false); return; }
    const l = attachLive(engine);
    live.current = l;
    for (const m of queue.current.drain()) l.handle(m);
  }, []);
  const onBakedReady = useCallback(() => setBakedReady(true), []);
  const onScreenReady = useCallback(() => setScreenReady(true), []);
  const online = debug ? !debug.offline : connected;
  const mobileUrl = useMobileUrl(hellos);
  const hub = useMemo(() => hubOf(health, online, mobileUrl), [health, online, mobileUrl]);
  const phone: PhoneSlot = debug && moment ? debugPhone(debug, moment, hub.phoneUrl)
    : health?.eye ? { kind: "live", url: hub.phoneUrl } : health || hub.phoneUrl ? { kind: "qr", url: hub.phoneUrl } : { kind: "none" };
  const map = kind === "iframe"
    ? (
      <TwinStage>
        <Overlay devices={devices} checks={checks} focusId={focusId} />
        <MapReady onReady={setViewerReady} />
      </TwinStage>
    )
    : (layout: PageLayout) => (
      <BakedStage home={kind === "three" ? homeId : null} homeData={homeData} layout={layout} trace={dash.trace} plans={tracePlans} plan={dash.plan} eye={dash.eye} goal={goal} checks={checks} devices={devices} onEngine={onEngine} onReady={onBakedReady} onTwin={onTwinMarks} />
    );
  const plan = isOpen(dash.plan) && (!scene || !awaitingHello) ? dash.plan : null;
  // 가짜 단계 화면 상태 표가 읽는 것: 사람 상태·습관 그림(이름)·목표·최근 계획
  const statusRows = useMemo(() => currentStatusRowsOf(dash), [dash.people, dash.robots, dash.habit, dash.goal, dash.plans, dash.plan]);
  const goal = useMemo(() => goalOf(dash), [dash.goal, dash.plan]);
  // 트레이스 줄의 계획 id로 트윈 자리를 찾을 계획: 미리 만든 계획과 최근 계획(열린 계획은 twinFrame이 먼저 본다)
  const tracePlans = useMemo(() => [goal?.plan, ...dash.plans], [goal?.plan, dash.plans]);
  return (
    <DashboardScreen
      index={stepIndex(plan)} plan={plan} step={currentStep(plan)} robotKnown={dash.eye !== null} connected={online} map={map} mapReady={mapReady}
      phone={phone} command={command} onPhoneDelay={onPhoneDelay} narration={debug ? <NarrationPane lines={narrationOf(dash, command, online)} /> : undefined}
      trace={dash.trace} onTwin={onTwin} seen={seen} statusRows={statusRows}
      hub={hub} settingsOpen={debug?.settings} onReady={onScreenReady} tzMinutes={health?.tz_minutes ?? null}
    />
  );
}
