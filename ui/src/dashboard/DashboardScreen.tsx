import { useEffect, useMemo, useRef, type ReactNode } from "react";
import type { PlanStep, PlanView } from "../../../src/contract/plan.ts";
import { LiquidGlass } from "../components/ui/liquid-glass";
import type { SeenStore } from "./masks";
import { useBoxSize } from "./fit";
import type { HubState } from "./hub";
import { pageLayout, type PageLayout } from "./layout";
import { Mascot, type Facing } from "./Mascot";
import { MASCOT } from "./mascot-image";
import { PreDrawing, useFontsLoaded, usePredecode, usePreDraw, useReducedMotionNow } from "./motion";
import { PhonePane, type PhoneSlot } from "./PhonePane";
import { SayCard } from "./SayCard";
import type { Thought } from "./data";
import { ThoughtCard } from "./ThoughtCard";
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
  /** 생각 말풍선: PAM의 생각 한 문장·상태·판단. PAM이 대기면 null(말풍선을 숨긴다). */
  thought: Thought | null;
  /** 말풍선 카드 한 문장. */
  say: string;
  facing: Facing;
  hub: HubState;
  /** 설정 창을 연 채 그린다(가짜 단계 화면 찍기). */
  settingsOpen?: boolean;
  /** 화면이 다 뜬 때(data-ready를 단 때) 한 번 부른다. */
  onReady?: () => void;
}

/**
 * 대시보드. 머리줄 막대·맨 아래 줄·오른쪽 칸 없이 트윈이 화면 전체(여백 안)를 쓰고, 나머지는 화면 크기로 정한 자리(layout.ts)에 트윈 위로 얹는다:
 * 트윈(칸을 꽉 채운 지도와 그 위 할 일 진행도)은 둥근 판(LiquidGlass) 하나다. 오른쪽 위에 비전 미니맵 「폰 카메라」(가로 16:9, 영상 위 마스크·이름표, 영상이 없으면 연결 QR),
 * 오른쪽 아래에 마스코트(판 없이 아래 끝을 화면 밑 선에 댄다, 누르면 설정 창), 마스코트 위에 생각 말풍선(PAM의 생각 한 문장과 상태·판단 칩, PAM이 대기면 숨김),
 * 트윈 아래쪽에 말풍선 카드(그 순간 말, 꼬리 없는 카드 하나, 마스코트 왼쪽까지)다. 마스코트가 보는 쪽은 facing 그대로다(transform).
 * 자리·크기는 화면 크기로만 정해지고 단계가 바뀌어도 그대로다. 말풍선 말·생각은 opacity·transform으로 바뀐다(SayCard·ThoughtCard).
 * 글꼴 조각·마스코트 그림 풀기·지도 첫 그림이 다 되면 한 번 미리 그려 보고(usePreDraw, 단계가 바뀔 때는 하지 않는다) 그 뒤 main에 data-ready를 달고 onReady를 부른다.
 */
export function DashboardScreen({ index, plan, step, robotKnown, connected, map, mapReady, phone, seen, thought, say, facing, hub, settingsOpen, onReady }: ScreenProps) {
  const main = useRef<HTMLElement>(null);
  const view = useBoxSize(main);
  const L = useMemo(() => pageLayout(view, MASCOT), [view]);
  const reduced = useReducedMotionNow();
  const decoded = usePredecode([MASCOT.src]);
  // 지금 화면 글이 쓰는 글꼴 조각을 받는다(처음 나오는 글자가 새 조각을 받으면 글을 다시 그린다)
  const text = JSON.stringify([say, plan?.goal, plan?.steps.map((s) => s.label), thought, WORDS]);
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
          <TwinPane plan={plan} step={step} robotKnown={robotKnown} connected={connected} map={typeof map === "function" ? map(L) : map} chipsRight={L.chipsRight} />
        </PreDrawing.Provider>
      </LiquidGlass>
      <PhonePane slot={phone} seen={seen} box={L.video} connected={connected} />
      <ThoughtCard thought={thought} box={L.thought} tail={L.tail} animate={!reduced} />
      <SayCard say={say} box={L.bubble} animate={!reduced} />
      <Mascot image={MASCOT} hub={hub} box={L.mascot} imageBox={L.image} logoBox={L.logo} facing={facing} settingsOpen={settingsOpen} />
    </main>
  );
}
