import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { PlanStep, PlanView } from "../../../src/contract/plan.ts";
import type { TraceRow } from "../../../src/contract/trace.ts";
import { Button } from "../components/ui/button";
import { Separator } from "../components/ui/separator";
import { LiquidGlass } from "../components/ui/liquid-glass";
import type { SeenStore } from "./masks";
import { useBoxSize, type BoxSize } from "./fit";
import type { HubState } from "../lib/hub";
import { MINIMAP_ASPECT, nextAspect, pageLayout, type PageLayout, type Rect } from "./layout";
import { Mascot } from "./Mascot";
import { ModeBubble } from "./ModeBubble";
import { MASCOT } from "../lib/mascot-image";
import { PreDrawing, useFontsLoaded, usePredecode, usePreDraw } from "./motion";
import { PhonePane, type PhoneSlot } from "./PhonePane";
import type { Talk } from "./data";
import type { StatusRow, TimelineData } from "./timeline";
import { StatusTable } from "./StatusTable";
import { TimelineCard } from "./TimelineCard";
import { TraceTable } from "./TraceTable";
import { TalkBox } from "./TalkBox";
import { TwinPane } from "./TwinPane";
import { WORDS } from "./words";
import { bentoLayout, sceneLayout, type TwinView } from "./bento-layout";
import { actionConditions } from "./action-conditions";

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
  map: ReactNode | ((layout: PageLayout, view: TwinView) => ReactNode);
  view?: "scene" | "overview";
  overviewHref?: string;
  narration?: ReactNode;
  trace?: readonly TraceRow[];
  command?: string | null;
  onPhoneDelay?: (ms: number) => void;
  /** 지도가 첫 그림을 다 그렸는가. */
  mapReady: boolean;
  phone: PhoneSlot;
  /** 마지막 물체 모양(seen) 저장소. 대시보드 폰 칸의 마스크 층만 듣는다. */
  seen: SeenStore;
  /** 메시지 상자: 다듬은 생각·한 일 최근 세 줄(data.ts talkOf). 줄이 없으면 null. */
  talk: Talk | null;
  /** 메시지 상자 왼쪽 시간 줄 카드: 사람 · 예상 · 로봇 구간(timeline.ts timelineOf). 첫 판단 전이면 null(카드 없음). */
  timeline?: TimelineData | null;
  statusRows?: readonly StatusRow[];
  /** 시간 줄의 지금(ms). 없으면 브라우저 시계로 흐른다(가짜 단계 화면만 멈춘 때를 준다). */
  timelineNow?: number;
  /** 지금 행동의 모드(data.ts modeNow). 모르면 null이고 모드 말풍선은 눈치 모드다. */
  mode: "noonchi" | "coach" | null;
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

/** 폰·트윈·시간 줄·메시지를 고정 칸에 둔다. 집 전체 보기에서는 넓은 지도 위에 작은 대시보드 폰 칸을 얹는다. */
export function DashboardScreen({ index, plan, step, robotKnown, connected, map, mapReady, view: screenView, overviewHref, narration, trace, command, onPhoneDelay, phone, seen, talk, timeline = null, statusRows, timelineNow, mode, hub, settingsOpen, onReady, tzMinutes = null }: ScreenProps) {
  const main = useRef<HTMLElement>(null);
  const view = useBoxSize(main, screenView === "scene");
  const [aspect, setAspect] = useState(() => nextAspect(MINIMAP_ASPECT, phone.kind === "image" ? phone : null));
  const [feedAspect, setFeedAspect] = useState(() => nextAspect(0, phone.kind === "image" ? phone : null));
  const onVideoSize = useCallback((size: BoxSize | null) => {
    setAspect(now => nextAspect(now, size));
    setFeedAspect(nextAspect(0, size));
  }, []);
  const tiled = narration !== undefined;
  const traceHeight = trace === undefined ? 0 : 192;
  const scene = useMemo(() => screenView === "scene" ? sceneLayout(view, MASCOT, feedAspect) : null, [view, feedAspect, screenView]);
  const twinView: TwinView = scene || tiled ? "space" : "overview";
  const L = useMemo(() => scene ?? (tiled ? bentoLayout(view, MASCOT, feedAspect, traceHeight) : { ...pageLayout(view, MASCOT, aspect), trace: null }), [scene, view, aspect, feedAspect, tiled, traceHeight]);
  const decoded = usePredecode([MASCOT.src]);
  // 지금 화면 글이 쓰는 글꼴 조각을 받는다(처음 나오는 글자가 새 조각을 받으면 글을 다시 그린다)
  const text = JSON.stringify([talk, timeline?.spans.map((s) => s.text), timeline?.gap?.text, plan?.goal, plan?.steps.map((s) => s.label), WORDS, "0123456789"]);
  const fonts = useFontsLoaded("Noto Sans KR Variable", text);
  const phase = usePreDraw(fonts && decoded && mapReady);
  const ready = phase === "done";
  const report = useRef(onReady);
  report.current = onReady;
  useEffect(() => { if (ready) report.current?.(); }, [ready]);

  const twin = (
    <PreDrawing.Provider value={phase === "drawing"}>
      <TwinPane robotKnown={robotKnown} connected={connected} map={typeof map === "function" ? map(L, twinView) : map} chipsRight={L.chipsRight} tzMinutes={tzMinutes} tiled={!!scene || tiled} />
    </PreDrawing.Provider>
  );
  const mascot = <Mascot image={MASCOT} hub={hub} box={L.mascot} imageBox={L.image} logoBox={L.logo} settingsOpen={settingsOpen} />;
  if (scene) {
    const rows = trace ?? NO_TRACE;
    const { confirmed, current, next } = actionConditions(plan, step, rows, connected);
    const phoneBox = { left: 0, top: 0, width: Math.max(0, scene.video.width - 2), height: Math.max(0, scene.video.height - 2) };
    return (
      <main ref={main} data-bento data-step={index} data-ready={ready || undefined} className="relative h-full w-full overflow-x-hidden overflow-y-auto">
        <ScenePanel name="Vision" box={scene.video}>
          <PhonePane slot={phone} seen={seen} box={phoneBox} connected={connected} command={command ?? null} onDelay={onPhoneDelay} onVideoSize={onVideoSize} />
        </ScenePanel>
        <ScenePanel name="Digital Twin" box={scene.twin}>
          {twin}
          {overviewHref && <div className="absolute right-14 top-2 z-30">
            <Button asChild variant="outline" size="sm"><a href={overviewHref}>집 전체</a></Button>
          </div>}
        </ScenePanel>
        <ScenePanel name="Action Conditions" box={scene.conditions}>
          <div data-scene-scroll>
            <dl data-action-conditions>
              <dt data-action-confirmed={confirmed !== null || undefined}>확인한 사실</dt><dd>{confirmed ?? "—"}</dd>
              <dt data-action-current={current !== null || undefined}>확인 중</dt><dd>{current ?? "대기 중"}</dd>
              <dt>확인 후</dt><dd>{next ?? "—"}</dd>
            </dl>
          </div>
        </ScenePanel>
        <ScenePanel name="Agent Trace" box={scene.trace}>
          <div data-scene-scroll tabIndex={0}><TraceTable rows={rows} /></div>
        </ScenePanel>
        {mascot}
      </main>
    );
  }
  const stacked = L.twin.top !== L.video.top;
  return (
    <main ref={main} data-bento={tiled || undefined} data-step={index} data-ready={ready || undefined} className={tiled ? "relative h-full w-full overflow-x-hidden overflow-y-auto" : "relative h-full w-full overflow-hidden"}>
      {tiled ? <div className="absolute flex" style={{ left: L.twin.left, top: L.twin.top, width: L.twin.width, height: L.twin.height }}>{twin}</div> :
        <LiquidGlass mode="opaque" radius={16} className="absolute flex" style={{ left: L.twin.left, top: L.twin.top, width: L.twin.width, height: L.twin.height }}>{twin}</LiquidGlass>}
      <PhonePane slot={phone} seen={seen} box={L.video} connected={connected} command={tiled ? command ?? null : undefined} onDelay={onPhoneDelay} onVideoSize={onVideoSize} />
      {tiled ? <>
        <Separator className="absolute" style={{ left: L.pad, top: L.timeline.top - 1, width: stacked ? L.video.width : L.video.width + L.gap + L.twin.width }} />
        {stacked ? <>
          <Separator className="absolute" style={{ left: L.pad, top: L.twin.top - 1, width: L.twin.width }} />
          <Separator className="absolute" style={{ left: L.pad, top: L.bubble.top - 1, width: L.bubble.width }} />
        </> : <Separator orientation="vertical" className="absolute" style={{ left: L.twin.left - 1, top: L.pad, height: L.bubble.top + L.bubble.height - L.pad }} />}
        {statusRows && <StatusTable rows={statusRows} progress={plan && step && index > 0 ? { label: step.label, index, total: plan.steps.length } : undefined} box={L.timeline} tzMinutes={tzMinutes} />}
        <section aria-label="현재 상황" className="absolute flex min-w-0 flex-col overflow-auto px-4 py-2 sm:px-6" style={{ ...L.bubble, width: Math.max(0, L.mascot.left - L.bubble.left - 4) }}><div className="my-auto shrink-0">{narration}</div></section>
        {trace && L.trace && (L.trace.top === L.twin.top
          ? <Separator orientation="vertical" className="absolute" style={{ left: L.trace.left - 1, top: L.trace.top, height: L.trace.height }} />
          : <Separator className="absolute" style={{ left: L.trace.left, top: L.trace.top - 1, width: L.trace.width }} />)}
        {trace && L.trace && <section aria-label="Trace" tabIndex={0} className="absolute overflow-auto" style={{ ...L.trace }}>
          <TraceTable rows={trace} />
        </section>}
      </> : <>
        <TalkBox talk={talk} box={L.bubble} mascotWidth={0} />
        {statusRows ? <StatusTable rows={statusRows} box={L.timeline} tzMinutes={tzMinutes} /> :
          <TimelineCard data={timeline} box={{ width: L.timeline.width, height: L.timeline.height }} className="pointer-events-none absolute z-50" style={{ left: L.timeline.left, top: L.timeline.top }} now={timelineNow} />}
      </>}
      {mascot}
      {!tiled && <ModeBubble mode={mode} layout={L} mascot={MASCOT} />}
    </main>
  );
}
