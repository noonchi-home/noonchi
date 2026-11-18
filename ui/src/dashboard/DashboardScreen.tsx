import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { PlanStep, PlanView } from "../../../src/contract/plan.ts";
import { LiquidGlass } from "../components/ui/liquid-glass";
import type { SeenStore } from "./masks";
import { useBoxSize, type BoxSize } from "./fit";
import type { HubState } from "../lib/hub";
import { MINIMAP_ASPECT, nextAspect, pageLayout, type PageLayout } from "./layout";
import { Mascot } from "./Mascot";
import { ModeBubble } from "./ModeBubble";
import { MASCOT } from "../lib/mascot-image";
import { PreDrawing, useFontsLoaded, usePredecode, usePreDraw } from "./motion";
import { PhonePane, type PhoneSlot } from "./PhonePane";
import type { Talk } from "./data";
import type { FsmNow } from "./fsm";
import type { GoalLine } from "./goal-line";
import { TalkBox } from "./TalkBox";
import { TwinPane } from "./TwinPane";
import { WORDS } from "./words";

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
  /** 지도가 첫 그림을 다 그렸는가. */
  mapReady: boolean;
  phone: PhoneSlot;
  /** 마지막 물체 모양(seen) 저장소. 대시보드 폰 칸의 마스크 층만 듣는다. */
  seen: SeenStore;
  /** 메시지 상자: 다듬은 생각·한 일 최근 세 줄(data.ts talkOf). 줄이 없으면 null. */
  talk: Talk | null;
  /** 메시지 상자 오른쪽 FSM 카드: 습관 FSM·지금 상태·목표(fsm.ts fsmOf). 습관 그림을 받기 전이면 null(빈 카드). */
  fsm?: FsmNow | null;
  /** 목표 한 줄(goal-line.ts goalLineOf). 목표가 없으면 null. */
  goal?: GoalLine | null;
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

/**
 * 대시보드. 머리줄 막대·맨 아래 줄·오른쪽 칸 없이 트윈이 화면 전체(여백 안)를 쓰고, 나머지는 화면 크기로 정한 자리(layout.ts)에 트윈 위로 얹는다:
 * 트윈(칸을 꽉 채운 지도와 그 위 할 일 진행도)은 둥근 판(LiquidGlass) 하나다. 오른쪽 위에 비전 미니맵 「폰 카메라」(가로 16:9, 영상 위 마스크·이름표, 영상이 없으면 연결 QR),
 * 오른쪽 아래에 마스코트(판 없이 아래 끝을 화면 밑 선에 댄다, 누르면 설정 창), 마스코트 위에 생각 말풍선(PAM의 생각 한 문장과 상태·판단 칩, PAM이 대기면 숨김),
 * 트윈 아래쪽에 말풍선 카드(그 순간 말, 꼬리 없는 카드 하나, 마스코트 왼쪽까지)다. 마스코트가 보는 쪽은 facing 그대로다(transform).
 * 자리·크기는 화면 크기와 미니맵 영상 비율로만 정해지고 단계가 바뀌어도 그대로다. 미니맵 높이는 들어오는 영상 비율을 따르고(폰을 돌리거나 영상 종류가 바뀔 때만 바뀐다,
 * 비율 차이가 ASPECT_STEP 안이면 그대로), 처음 그림부터 가짜 단계 그림 비율을 쓴다. 말풍선 말·생각은 opacity·transform으로 바뀐다(SayCard·ThoughtCard).
 * 글꼴 조각·마스코트 그림 풀기·지도 첫 그림이 다 되면 한 번 미리 그려 보고(usePreDraw, 단계가 바뀔 때는 하지 않는다) 그 뒤 main에 data-ready를 달고 onReady를 부른다.
 */
export function DashboardScreen({ index, plan, step, robotKnown, connected, map, mapReady, phone, seen, talk, fsm = null, goal = null, mode, hub, settingsOpen, onReady, tzMinutes = null }: ScreenProps) {
  const main = useRef<HTMLElement>(null);
  const view = useBoxSize(main);
  const [aspect, setAspect] = useState(() => nextAspect(MINIMAP_ASPECT, phone.kind === "image" ? phone : null));
  const onVideoSize = useCallback((size: BoxSize | null) => setAspect((now) => nextAspect(now, size)), []);
  const L = useMemo(() => pageLayout(view, MASCOT, aspect), [view, aspect]);
  const decoded = usePredecode([MASCOT.src]);
  // 지금 화면 글이 쓰는 글꼴 조각을 받는다(처음 나오는 글자가 새 조각을 받으면 글을 다시 그린다)
  const text = JSON.stringify([talk, fsm, goal, plan?.goal, plan?.steps.map((s) => s.label), WORDS]);
  const fonts = useFontsLoaded("Noto Sans KR Variable", text);
  const phase = usePreDraw(fonts && decoded && mapReady);
  const ready = phase === "done";
  const report = useRef(onReady);
  report.current = onReady;
  useEffect(() => { if (ready) report.current?.(); }, [ready]);

  return (
    <main ref={main} data-step={index} data-ready={ready || undefined} className="relative h-full w-full overflow-hidden">
      <LiquidGlass mode="opaque" radius={16} className="absolute flex" style={{ left: L.twin.left, top: L.twin.top, width: L.twin.width, height: L.twin.height }}>
        <PreDrawing.Provider value={phase === "drawing"}>
          <TwinPane robotKnown={robotKnown} connected={connected} map={typeof map === "function" ? map(L) : map} chipsRight={L.chipsRight} tzMinutes={tzMinutes} />
        </PreDrawing.Provider>
      </LiquidGlass>
      <PhonePane slot={phone} seen={seen} box={L.video} connected={connected} onVideoSize={onVideoSize} />
      <TalkBox talk={talk} fsm={fsm} goal={goal} box={L.bubble} />
      <Mascot image={MASCOT} hub={hub} box={L.mascot} imageBox={L.image} logoBox={L.logo} settingsOpen={settingsOpen} />
      <ModeBubble mode={mode} layout={L} mascot={MASCOT} />
    </main>
  );
}
