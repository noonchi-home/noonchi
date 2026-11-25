import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { PlanStep, PlanView } from "../../../src/contract/plan.ts";
import type { TraceRow } from "../../../src/contract/trace.ts";
import { Dialog } from "../components/ui/dialog";
import { Separator } from "../components/ui/separator";
import type { SeenStore } from "./masks";
import { useBoxSize, type BoxSize } from "./fit";
import type { HubState } from "../lib/hub";
import { nextAspect, type PageLayout, type Rect } from "./layout";
import { Mascot } from "./Mascot";
import { MASCOT } from "../lib/mascot-image";
import { PreDrawing, useFontsLoaded, usePredecode, usePreDraw } from "./motion";
import { PhonePane, type PhoneSlot } from "./PhonePane";
import type { StatusRow } from "./timeline";
import { SettingsDialog } from "./SettingsDialog";
import { StatusTable } from "./StatusTable";
import { TraceTable } from "./TraceTable";
import type { MarkTone } from "./trace-marks";
import { TwinPane } from "./TwinPane";
import { WORDS } from "./words";
import { bentoLayout, sceneLayout } from "./bento-layout";

/** 대시보드 화면이 받는 것. 화면은 이것만 보고 배치·모양을 정한다. 입력창은 없다. */
export interface ScreenProps {
  /** 0 계획 전 지켜보기, n 계획 n번째 단계. */
  index: number;
  plan: PlanView | null;
  step: PlanStep | null;
  /** 클로이드(맞춘 폰 눈) 자리를 아는가. */
  robotKnown: boolean;
  /** 서버와 실시간 연결: 이어짐 true, 끊김 false, 모름 null. */
  connected: boolean | null;
  /** 트윈 칸을 꽉 채우는 지도(3D 트윈). 함수면 화면 배치(지도 카메라 칸·가린 자리)를 받아 그린다. */
  map: ReactNode | ((layout: PageLayout) => ReactNode);
  /** 가짜 단계 화면(?debug=steps)의 해설 칸. 있으면 그 화면 배치(bentoLayout)다. */
  narration?: ReactNode;
  trace?: readonly TraceRow[];
  /** 지금 트윈에 그린 트레이스 줄 id → 그 표시 색(trace-marks.ts markTone). 트레이스 칸이 같은 색 점을 붙인다. */
  onTwin?: ReadonlyMap<string, MarkTone>;
  command?: string | null;
  onPhoneDelay?: (ms: number) => void;
  /** 지도가 첫 그림을 다 그렸는가. */
  mapReady: boolean;
  phone: PhoneSlot;
  /** 마지막 물체 모양(seen) 저장소. 대시보드 폰 칸의 마스크 층만 듣는다. */
  seen: SeenStore;
  statusRows?: readonly StatusRow[];
  hub: HubState;
  /** 설정 창을 연 채 그린다(가짜 단계 화면 찍기). */
  settingsOpen?: boolean;
  /** 서버 기록 시간대(분, /api/health tz_minutes). 날짜·시간 칩이 쓴다. 모르면 브라우저 시간대. */
  tzMinutes?: number | null;
  /** 화면이 다 뜬 때(data-ready를 단 때) 한 번 부른다. */
  onReady?: () => void;
}

const NO_TRACE: readonly TraceRow[] = [];

function ScenePanel({ name, box, children }: { name: string; box: Rect; children: ReactNode }) {
  return <fieldset data-scene-panel style={{ left: box.left, top: box.top, width: box.width, height: box.height }}>
    <legend data-scene-legend>{name}</legend>
    {children}
  </fieldset>;
}

/** 설정 창 단축키: Ctrl+1(다른 조합키 없이). 화면에는 설정 단추가 없다(2026-11-25 사용자 결정). */
export const isSettingsKey = (e: Pick<KeyboardEvent, "ctrlKey" | "altKey" | "shiftKey" | "metaKey" | "key" | "code">) =>
  e.ctrlKey && !e.altKey && !e.shiftKey && !e.metaKey && (e.code === "Digit1" || e.code === "Numpad1" || e.key === "1");

/** 설정 창 열림: Ctrl+1이면 연다. Esc·바깥 누르기·닫기 단추로 닫힌다. */
function useSettings(initial: boolean): [boolean, (open: boolean) => void] {
  const [open, setOpen] = useState(initial);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!isSettingsKey(e)) return;
      e.preventDefault();
      setOpen(true);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  return [open, setOpen];
}

/**
 * 기본 라이브 보기(세 칸, sceneLayout): 왼쪽 열에 Vision(16:9) 위·트윈 아래, 오른쪽에 Agent Trace를 화면 높이 전체로 둔다.
 * 가짜 단계 화면(narration)은 폰·트윈·상태 표·해설·트레이스 배치(bentoLayout)이고 마스코트를 둔다.
 * 설정 창은 Ctrl+1로만 연다(기본 라이브 보기에는 설정 단추가 없다).
 */
export function DashboardScreen({ index, plan, step, robotKnown, connected, map, mapReady, narration, trace, onTwin, command, onPhoneDelay, phone, seen, statusRows, hub, settingsOpen, onReady, tzMinutes = null }: ScreenProps) {
  const main = useRef<HTMLElement>(null);
  const tiled = narration !== undefined;
  const view = useBoxSize(main, !tiled);
  // 가짜 단계 화면만 영상 비율로 칸 높이를 정한다. 기본 라이브 보기의 Vision 칸은 16:9 고정이다
  const [feedAspect, setFeedAspect] = useState(() => nextAspect(0, phone.kind === "image" ? phone : null));
  const onVideoSize = useCallback((size: BoxSize | null) => setFeedAspect(nextAspect(0, size)), []);
  const traceHeight = trace === undefined ? 0 : 192;
  const scene = useMemo(() => (tiled ? null : sceneLayout(view, MASCOT)), [view, tiled]);
  const L = useMemo(() => scene ?? bentoLayout(view, MASCOT, feedAspect, traceHeight), [scene, view, feedAspect, traceHeight]);
  const [settings, setSettings] = useSettings(!!settingsOpen);
  const decoded = usePredecode([MASCOT.src]);
  // 지금 화면 글이 쓰는 글꼴 조각을 받는다(처음 나오는 글자가 새 조각을 받으면 글을 다시 그린다)
  const text = JSON.stringify([plan?.goal, plan?.steps.map((s) => s.label), WORDS, "0123456789"]);
  const fonts = useFontsLoaded("Noto Sans KR Variable", text);
  const phase = usePreDraw(fonts && decoded && mapReady);
  const ready = phase === "done";
  const report = useRef(onReady);
  report.current = onReady;
  useEffect(() => { if (ready) report.current?.(); }, [ready]);

  const twin = (
    <PreDrawing.Provider value={phase === "drawing"}>
      <TwinPane robotKnown={robotKnown} connected={connected} map={typeof map === "function" ? map(L) : map} chipsRight={L.chipsRight} tzMinutes={tzMinutes} tiled />
    </PreDrawing.Provider>
  );
  if (scene) {
    const phoneBox = { left: 0, top: 0, width: Math.max(0, scene.video.width - 2), height: Math.max(0, scene.video.height - 2) };
    return (
      <main ref={main} data-bento data-step={index} data-ready={ready || undefined} className="relative h-full w-full overflow-x-hidden overflow-y-auto">
        <ScenePanel name="Vision" box={scene.video}>
          <PhonePane slot={phone} seen={seen} box={phoneBox} connected={connected} command={command ?? null} onDelay={onPhoneDelay} onVideoSize={onVideoSize} />
        </ScenePanel>
        <ScenePanel name="Digital Twin" box={scene.twin}>
          {twin}
        </ScenePanel>
        <ScenePanel name="Agent Trace" box={scene.trace}>
          <TraceTable rows={trace ?? NO_TRACE} onTwin={onTwin} />
        </ScenePanel>
        <Dialog open={settings} onOpenChange={setSettings}>
          <SettingsDialog hub={hub} />
        </Dialog>
      </main>
    );
  }
  const stacked = L.twin.top !== L.video.top;
  return (
    <main ref={main} data-bento data-step={index} data-ready={ready || undefined} className="relative h-full w-full overflow-x-hidden overflow-y-auto">
      <div className="absolute flex" style={{ left: L.twin.left, top: L.twin.top, width: L.twin.width, height: L.twin.height }}>{twin}</div>
      <PhonePane slot={phone} seen={seen} box={L.video} connected={connected} command={command ?? null} onDelay={onPhoneDelay} onVideoSize={onVideoSize} />
      <Separator className="absolute" style={{ left: L.pad, top: L.timeline.top - 1, width: stacked ? L.video.width : L.video.width + L.gap + L.twin.width }} />
      {stacked ? <>
        <Separator className="absolute" style={{ left: L.pad, top: L.twin.top - 1, width: L.twin.width }} />
        <Separator className="absolute" style={{ left: L.pad, top: L.bubble.top - 1, width: L.bubble.width }} />
      </> : <Separator orientation="vertical" className="absolute" style={{ left: L.twin.left - 1, top: L.pad, height: L.bubble.top + L.bubble.height - L.pad }} />}
      {statusRows && <StatusTable rows={statusRows} progress={plan && step && index > 0 ? { label: step.label, index, total: plan.steps.length } : undefined} box={L.timeline} tzMinutes={tzMinutes} />}
      <section aria-label="현재 상황" className="absolute flex min-w-0 flex-col overflow-auto px-4 py-2 sm:px-6" style={{ ...L.bubble, width: Math.max(0, L.mascot.left - L.bubble.left - 4) }}><div className="my-auto shrink-0">{narration}</div></section>
      {trace && "trace" in L && L.trace && (L.trace.top === L.twin.top
        ? <Separator orientation="vertical" className="absolute" style={{ left: L.trace.left - 1, top: L.trace.top, height: L.trace.height }} />
        : <Separator className="absolute" style={{ left: L.trace.left, top: L.trace.top - 1, width: L.trace.width }} />)}
      {trace && "trace" in L && L.trace && <section aria-label="Trace" tabIndex={0} className="absolute overflow-auto" style={{ ...L.trace }}>
        <TraceTable rows={trace} onTwin={onTwin} />
      </section>}
      <Mascot image={MASCOT} hub={hub} box={L.mascot} imageBox={L.image} logoBox={L.logo} open={settings} onOpenChange={setSettings} />
    </main>
  );
}
