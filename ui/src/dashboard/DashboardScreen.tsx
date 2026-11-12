import { useEffect, useMemo, useRef, type ReactNode } from "react";
import type { PlanStep, PlanView } from "../../../src/contract/plan.ts";
import { LiquidGlass } from "../components/ui/liquid-glass";
import { Separator } from "../components/ui/separator";
import type { SeenStore } from "./masks";
import { useBoxSize } from "./fit";
import type { HubState } from "./hub";
import { pageLayout, type PageLayout } from "./layout";
import { Mascot, type Facing } from "./Mascot";
import { MASCOT } from "./mascot-image";
import { PreDrawing, useFontsLoaded, usePredecode, usePreDraw, useReducedMotionNow } from "./motion";
import { PhonePane, type PhoneSlot } from "./PhonePane";
import { SayCard } from "./SayCard";
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
  /** PAM이 본 관찰 한 문장(없으면 아직 판단 없음)과 도출한 행동(없으면 대기). */
  observation: string | null;
  action: string;
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
 * 대시보드. 머리줄 막대·맨 아래 줄 없이 화면 크기로 정한 자리(layout.ts)에 놓는다:
 * 왼쪽에 트윈(칸을 꽉 채운 지도와 그 위 할 일 진행도(계획이 있을 때), 남은 너비), 오른쪽에 대시보드 폰 칸 「폰 카메라」(세로 9:16 영상에 YOLO 상자, 안쪽 위에 떠 있는
 * FSM·행동 반투명 카드, 영상이 없으면 연결 QR)가 화면 높이를 다 쓴다. 두 칸은 틈 없이 한 판(LiquidGlass, 바깥 모서리만 둥긂)으로 붙고 사이에 세로 나눔선(Separator) 하나만 있다.
 * 마스코트는 판 없이 가운데 축을 나눔선 위에 두고 아래 끝을 화면 밑 선에 댄다(누르면 설정 창). 보는 쪽은 facing 그대로다(transform).
 * 말풍선(그 순간 말)은 트윈 아래쪽 지도 위, 마스코트 왼쪽에 얹힌 꼬리 없는 카드 하나다.
 * 자리·크기는 화면 크기로만 정해지고 단계가 바뀌어도 그대로다. 말풍선 말은 opacity·transform으로 바뀐다(SayCard).
 * 글꼴 조각·마스코트 그림 풀기·지도 첫 그림이 다 되면 한 번 미리 그려 보고(usePreDraw, 단계가 바뀔 때는 하지 않는다) 그 뒤 main에 data-ready를 달고 onReady를 부른다.
 */
export function DashboardScreen({ index, plan, step, robotKnown, connected, map, mapReady, phone, seen, observation, action, say, facing, hub, settingsOpen, onReady }: ScreenProps) {
  const main = useRef<HTMLElement>(null);
  const view = useBoxSize(main);
  const L = useMemo(() => pageLayout(view, MASCOT), [view]);
  const reduced = useReducedMotionNow();
  const decoded = usePredecode([MASCOT.src]);
  // 지금 화면 글이 쓰는 글꼴 조각을 받는다(처음 나오는 글자가 새 조각을 받으면 글을 다시 그린다)
  const text = JSON.stringify([say, plan?.goal, plan?.steps.map((s) => s.label), observation, action, WORDS]);
  const fonts = useFontsLoaded("Noto Sans KR Variable", text);
  const phase = usePreDraw(fonts && decoded && mapReady);
  const ready = phase === "done";
  const report = useRef(onReady);
  report.current = onReady;
  useEffect(() => { if (ready) report.current?.(); }, [ready]);
  const stage = { left: L.twin.left, top: L.twin.top, width: L.video.left + L.video.width - L.twin.left, height: L.twin.height };
  const card = { left: L.card.left - L.video.left, top: L.card.top - L.video.top, width: L.card.width, height: L.card.height };

  return (
    <main ref={main} data-step={index} data-ready={ready || undefined} className="relative h-full w-full overflow-hidden">
      <LiquidGlass mode="opaque" radius={16} className="absolute flex" style={{ left: stage.left, top: stage.top, width: stage.width, height: stage.height }}>
        <PreDrawing.Provider value={phase === "drawing"}>
          <TwinPane plan={plan} step={step} robotKnown={robotKnown} connected={connected} map={typeof map === "function" ? map(L) : map} />
        </PreDrawing.Provider>
        <Separator orientation="vertical" data-divider />
        <PhonePane slot={phone} seen={seen} observation={observation} action={action} width={L.video.width} card={card} connected={connected} />
      </LiquidGlass>
      <SayCard say={say} box={L.bubble} animate={!reduced} />
      <Mascot image={MASCOT} hub={hub} box={L.mascot} imageBox={L.image} logoBox={L.logo} facing={facing} settingsOpen={settingsOpen} />
    </main>
  );
}
