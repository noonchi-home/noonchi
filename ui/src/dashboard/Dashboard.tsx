import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { ServerMessage } from "../../../src/contract/events.ts";
import { BubbleLayer } from "../bubbles/BubbleLayer";
import { DecisionLog, type LogView } from "../chat/DecisionLog";
import { checkList, type ChecksState } from "../checks/checks";
import { useChecks } from "../checks/use-checks";
import { useLog } from "../chat/use-log";
import { useDevices } from "../lib/use-devices";
import { useEvents } from "../lib/use-events";
import { useHealth } from "../lib/use-health";
import { EyeBody, EyeWindow } from "../panels/EyeWindow";
import { StatusPill } from "../panels/StatusPill";
import { TwinStage } from "../twin/TwinStage";
import { useAnchors } from "../twin/use-anchors";
import { useViewer } from "../twin/viewer";
import { wholeCamera, type TwinEngine } from "../twin3d/engine";
import { BAKE_VIEWS } from "../twin3d/projection";
import { Twin3D, useLayoutBox } from "../twin3d/Twin3D";

declare global {
  interface Window { __twin3d?: { engine: TwinEngine | null; ready: boolean } }
}

/** 확인 목록만 말풍선으로. 두뇌 줄은 장면의 식탁(dining_table)에 붙는다. 자리는 확인한 것만 센다. 말풍선은 패널(data-panel)을 비킨다. */
function Overlay({ devices, checks, focusId }: { devices: ReturnType<typeof useDevices>["devices"]; checks: ChecksState; focusId: string | null }) {
  const v = useViewer();
  const table = useMemo(() => v?.objects().find((o) => o.type === "dining_table") ?? null, [v]);
  const list = useMemo(() => checkList(checks, table?.id ?? null), [checks, table]);
  const objects = useMemo(() => new Map<string, string>(table ? [[table.id, table.name ?? "식탁"]] : []), [table]);
  const points = useAnchors(list.map((c) => c.deviceId ?? c.objectId!));
  return <BubbleLayer checks={list} devices={devices} objects={objects} points={points} focusId={focusId} avoid="[data-panel]" />;
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

/** 구운 3D 트윈 칸(TwinStage와 같은 틀): 집 전체 카메라로 그린 캔버스 + 그 위 덮개 층. 종류를 정하기 전에는 캔버스 없이 덮개만. */
function BakedStage({ home, children }: { home: string | null; children?: ReactNode }) {
  const box = useRef<HTMLElement>(null);
  const size = useLayoutBox(box);
  const v = home ? BAKE_VIEWS[home] : undefined;
  const view = useMemo(() => (v && size.width && size.height ? wholeCamera(v, size) : null), [v, size]);
  const debug = useMemo(() => new URLSearchParams(location.search).has("debug"), []);
  const onEngine = useCallback((engine: TwinEngine | null) => { if (debug) window.__twin3d = { engine, ready: false }; }, [debug]);
  const onReady = useCallback(() => { if (debug && window.__twin3d) window.__twin3d.ready = true; }, [debug]);
  return (
    <section ref={box} className="absolute inset-0" aria-label="3D 트윈">
      {home && view && <Twin3D key={home} home={home} box={size} view={view} onEngine={onEngine} onReady={onReady} />}
      <div className="pointer-events-none absolute inset-0 *:pointer-events-auto">{children}</div>
    </section>
  );
}

/**
 * A 구조: 3D 트윈이 화면 전체 배경, 그 위에 패널(위 가운데 상태 알약, 왼쪽 위 눈 창, 오른쪽 판단 기록)이 떠 있다.
 * 대시보드에는 입력이 없다: 요청·승인은 폰에서 음성으로 오고, 판단 기록은 서버 메시지로만 쌓인다.
 * 판단 기록의 「폰 화면」 탭을 고르면 폰 화면을 오른쪽 패널에 크게 띄우고 왼쪽 위 눈 창은 숨긴다.
 * 패널은 덮개 층의 바로 아래 자식(눈 창·판단 기록은 그 아래 쌓기 상자의 자식)이라 패널 밖 빈 곳의 마우스는 3D로 간다.
 * 한양목련처럼 구운 3D가 있는 집은 트윈을 three.js 캔버스로(BakedStage), 다른 집은 iframe 뷰어(TwinStage)로 그린다.
 */
export function Dashboard() {
  const { devices, apply } = useDevices();
  const health = useHealth();
  const { turns, onMessage: toLog } = useLog();
  const { checks, onMessage: toChecks } = useChecks();
  const [view, setView] = useState<LogView>("log");
  const [connected, setConnected] = useState<boolean | null>(null);
  const [focusId, setFocusId] = useState<string | null>(null);
  const homeId = health?.home?.id ?? null;
  const onMessage = useCallback((m: ServerMessage) => {
    if (m.type === "hello" && homeId && m.home && m.home !== homeId) {
      location.reload(); // 설정에서 집을 바꿨다
      return;
    }
    apply(m);
    toLog(m);
    toChecks(m);
    if (m.type === "agent" && m.event === "action" && m.action.deviceId) setFocusId(m.action.deviceId);
  }, [apply, toLog, toChecks, homeId]);
  useEvents(onMessage, setConnected);
  const kind = useTwinKind(homeId, health !== null);
  const layer = (
    <>
      <Overlay devices={devices} checks={checks} focusId={focusId} />
      <StatusPill connected={connected} health={health} />
      {/* 640px보다 좁으면 눈 창 아래에 판단 기록을 쌓는다(나란히 두면 판단 기록이 눈 창 접기 단추를 덮는다). 넓으면 상자 없이 각자 자리에 뜬다. */}
      <div className="contents *:pointer-events-auto max-sm:pointer-events-none! max-sm:absolute max-sm:inset-x-3 max-sm:top-16 max-sm:bottom-3 max-sm:flex max-sm:flex-col max-sm:items-end max-sm:gap-3">
        {view === "log" && <EyeWindow health={health} connected={connected} />}
        <DecisionLog turns={turns} view={view} onView={setView} phone={<EyeBody health={health} connected={connected} large />} />
      </div>
    </>
  );
  return (
    <main className="relative h-full w-full overflow-hidden">
      {kind === "iframe" ? <TwinStage>{layer}</TwinStage> : <BakedStage home={kind === "three" ? homeId : null}>{layer}</BakedStage>}
    </main>
  );
}
