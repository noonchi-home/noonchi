import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { ServerMessage } from "../../../src/contract/events.ts";
import { BubbleLayer } from "../bubbles/BubbleLayer";
import { checkList, type ChecksState } from "../checks/checks";
import { useChecks } from "../checks/use-checks";
import { useDevices } from "../lib/use-devices";
import { useEvents } from "../lib/use-events";
import { useHealth } from "../lib/use-health";
import { TwinStage } from "../twin/TwinStage";
import { useAnchors } from "../twin/use-anchors";
import { useViewer } from "../twin/viewer";
import { wholeCamera, type TwinEngine } from "../twin3d/engine";
import { LiveQueue, attachLive } from "../twin3d/live";
import { BAKE_VIEWS } from "../twin3d/projection";
import { Twin3D, useLayoutBox } from "../twin3d/Twin3D";
import { DashboardScreen } from "./DashboardScreen";
import { hubOf } from "./hub";
import type { PhoneSlot } from "./PhonePane";
import { WORDS } from "./words";

declare global {
  interface Window { __twin3d?: { engine: TwinEngine | null; ready: boolean } }
}

/** 트윈 위에 얹힌 것: 말풍선이 덮지 않을 자리. */
const AVOID = "[data-say-card], [data-mascot], [data-progress], [data-chips]";

/** 확인 목록만 말풍선으로. 두뇌 줄은 장면의 식탁(dining_table)에 붙는다. 자리는 확인한 것만 센다. 말풍선은 트윈 위에 얹힌 것(AVOID)을 비킨다. */
function Overlay({ devices, checks, focusId }: { devices: ReturnType<typeof useDevices>["devices"]; checks: ChecksState; focusId: string | null }) {
  const v = useViewer();
  const table = useMemo(() => v?.objects().find((o) => o.type === "dining_table") ?? null, [v]);
  const list = useMemo(() => checkList(checks, table?.id ?? null), [checks, table]);
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

/** 구운 3D 트윈(TwinStage와 같은 틀): 집 전체 카메라로 그린 캔버스 + 그 위 덮개 층. 종류를 정하기 전에는 캔버스 없이 덮개만. 엔진이 뜨고 버려질 때 onEngine, 첫 그림을 그리면 onReady. */
function BakedStage({ home, onEngine: toLive, onReady: toReady, children }: {
  home: string | null;
  onEngine: (engine: TwinEngine | null) => void;
  onReady: () => void;
  children?: ReactNode;
}) {
  const box = useRef<HTMLElement>(null);
  const size = useLayoutBox(box);
  const v = home ? BAKE_VIEWS[home] : undefined;
  const view = useMemo(() => (v && size.width && size.height ? wholeCamera(v, size) : null), [v, size]);
  const debug = useMemo(() => new URLSearchParams(location.search).has("debug"), []);
  const onEngine = useCallback((engine: TwinEngine | null) => {
    toLive(engine);
    if (debug) window.__twin3d = { engine, ready: false };
  }, [debug, toLive]);
  const onReady = useCallback(() => {
    if (debug && window.__twin3d) window.__twin3d.ready = true;
    toReady();
  }, [debug, toReady]);
  return (
    <section ref={box} className="absolute inset-0" aria-label="3D 트윈">
      {home && view && <Twin3D key={home} home={home} box={size} view={view} onEngine={onEngine} onReady={onReady} />}
      <div className="pointer-events-none absolute inset-0 *:pointer-events-auto">{children}</div>
    </section>
  );
}

/**
 * 대시보드: 서버에서 받은 것(health·/events·기기·확인 목록)을 화면 틀(DashboardScreen)에 넘긴다.
 * 트윈 칸 지도 자리: 한양목련처럼 구운 3D가 있는 집은 three.js 캔버스(BakedStage), 다른 집은 iframe 뷰어(TwinStage)와 그 위 확인 목록 말풍선.
 * 구운 트윈의 가전 상태·배치는 같은 소켓 메시지로 바꾸고, 엔진이 뜨기 전에 온 메시지는 모아 두었다가 엔진이 뜨면 넣는다.
 * 대시보드 폰 칸은 폰 서버가 켜져 있으면 실시간 영상, 아니면 연결 QR이다.
 * 대시보드에는 입력이 없다: 요청·승인은 폰에서 음성으로 온다. 설정에서 집을 바꾸면 다시 불러온다.
 */
export function Dashboard() {
  const { devices, apply } = useDevices();
  const health = useHealth();
  const { checks, onMessage: toChecks } = useChecks();
  const [connected, setConnected] = useState<boolean | null>(null);
  const [focusId, setFocusId] = useState<string | null>(null);
  const [viewerReady, setViewerReady] = useState(false);
  const [bakedReady, setBakedReady] = useState(false);
  const homeId = health?.home?.id ?? null;
  const live = useRef<ReturnType<typeof attachLive> | null>(null);
  const queue = useRef(new LiveQueue());
  const kindRef = useRef<"three" | "iframe" | null>(null);
  const onMessage = useCallback((m: ServerMessage) => {
    if (m.type === "hello" && homeId && m.home && m.home !== homeId) {
      location.reload(); // 설정에서 집을 바꿨다
      return;
    }
    apply(m);
    toChecks(m);
    if (m.type === "agent" && m.event === "action" && m.action.deviceId) setFocusId(m.action.deviceId);
    if (live.current) live.current.handle(m);
    else if (kindRef.current !== "iframe") queue.current.push(m);
  }, [apply, toChecks, homeId]);
  useEvents(onMessage, setConnected);
  const kind = useTwinKind(homeId, health !== null);
  kindRef.current = kind;
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
  const hub = useMemo(() => hubOf(health, connected), [health, connected]);
  const phone: PhoneSlot = health?.eye ? { kind: "live", url: hub.phoneUrl } : { kind: "qr", url: hub.phoneUrl };
  const map = kind === "iframe"
    ? (
      <TwinStage>
        <Overlay devices={devices} checks={checks} focusId={focusId} />
        <MapReady onReady={setViewerReady} />
      </TwinStage>
    )
    : <BakedStage home={kind === "three" ? homeId : null} onEngine={onEngine} onReady={onBakedReady} />;
  // 트윈이 없는 집은 기다리지 않는다
  const mapReady = (kind === "iframe" ? viewerReady : kind === "three" && bakedReady) || health?.twin === false;
  return (
    <DashboardScreen
      index={0} plan={null} step={null} robotKnown connected={connected} map={map} mapReady={mapReady}
      phone={phone} boxes={[]} frame={null} observation={null} action={WORDS.wait} say="" facing="video" hub={hub}
    />
  );
}
