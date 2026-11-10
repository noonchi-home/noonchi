import { MapPin, WifiOff } from "lucide-react";
import { useContext, type ReactNode } from "react";
import type { PlanStep, PlanView, StepKind } from "../../../src/contract/plan.ts";
import { Avatar, AvatarFallback } from "../components/ui/avatar";
import { Item, ItemActions, ItemContent, ItemDescription, ItemMedia, ItemTitle } from "../components/ui/item";
import { LiquidGlass } from "../components/ui/liquid-glass";
import { Status } from "../components/ui/status";
import { PreDrawing } from "./motion";
import { KIND_ICON, Segments } from "./steps";
import { WORDS } from "./words";

/**
 * 할 일 진행도(LiquidGlass 알약 + Item sm, 부품 원래 글 크기 text-sm): 단계 아이콘, 할 일, 단계 번호·지금 계획 단계 이름(기다리기 단계는 「기다리는 중 · 이름」), 단계 막대. 트윈 안에만 둔다.
 * 계획이 있을 때만 그린다. 한 단계 안에서는 그대로다(늘어나는 진행 막대·반짝이는 칩 없음). 마우스를 받지 않는다.
 * copy면 미리 그려 보는 알약이라 진행도 표시(data-progress)와 읽어 주기(status)를 달지 않는다.
 */
function TaskProgress({ plan, step, copy = false }: { plan: PlanView; step: PlanStep; copy?: boolean }) {
  const I = KIND_ICON[step.kind];
  const n = plan.steps.findIndex((s) => s.id === step.id) + 1;
  return (
    <div data-progress={copy ? undefined : true} className="pointer-events-none absolute left-4 top-4 flex max-w-[calc(100%-2rem)]">
      <LiquidGlass mode="opaque" className="min-w-0">
        <Item size="sm" className="min-w-0 flex-nowrap py-2">
          <ItemMedia>
            <Avatar className="size-7" aria-hidden="true">
              <AvatarFallback tone="brand"><I className="size-4" /></AvatarFallback>
            </Avatar>
          </ItemMedia>
          <ItemContent role={copy ? undefined : "status"} aria-live={copy ? undefined : "polite"} className="min-w-0 flex-row items-baseline gap-2">
            <ItemTitle className="block min-w-0 shrink truncate">{plan.goal}</ItemTitle>
            <ItemDescription className="shrink-0">
              <span className="tabular-nums">{`${n}/${plan.steps.length}`}</span>
              <span> · </span>
              <span>{step.kind === "wait" ? `${WORDS.waiting} · ${step.label}` : step.label}</span>
            </ItemDescription>
          </ItemContent>
          <ItemActions className="w-20 shrink-0">
            <Segments plan={plan} />
          </ItemActions>
        </Item>
      </LiquidGlass>
    </div>
  );
}

/** 계획이 없을 때 미리 그려 볼 계획: 단계 종류마다 한 칸(글 없음, 끝난 칸·지금 칸·남은 칸). */
const SAMPLE: PlanView = {
  id: "predraw", revision: 0, source: "planner", goal: "", judgment: "", dryRun: false, robot: { position: null, room: null }, path: [], legs: [],
  steps: (Object.keys(KIND_ICON) as StepKind[]).map((kind, i) => ({ id: kind, kind, label: "", status: i === 0 ? "done" : i === 1 ? "active" : "pending" })),
  status: "running", updatedAt: "",
};

/**
 * 미리 그려 보는 진행도 알약: 그 계획(없으면 SAMPLE)의 단계마다 그 단계가 지금인 알약을 거의 투명하게(opacity 0.01) 겹쳐 그린다.
 * 단계가 바뀔 때 알약을 처음 다시 그리는 GPU 일(타일 그리기·셰이더 만들기)을 화면이 뜰 때 끝내 둔다. 마우스를 받지 않는다.
 */
function PreDrawProgress({ plan }: { plan: PlanView | null }) {
  const p = plan?.steps.length ? plan : SAMPLE;
  return (
    <div data-predraw aria-hidden="true" className="pointer-events-none absolute inset-0" style={{ opacity: 0.01 }}>
      {p.steps.map((s) => <TaskProgress key={s.id} plan={p} step={s} copy />)}
    </div>
  );
}

/**
 * 트윈 칸(왼쪽에서 남은 너비와 화면 높이를 다 쓴다, 판은 대시보드 폰 칸과 함께 쓰는 한 판): 칸을 꽉 채운 지도 자리(map)와
 * 그 위 왼쪽 위 할 일 진행도(계획이 있을 때만, 계획 전 지켜보기에는 없다), 오른쪽 위 칩(클로이드 위치를 모를 때, 연결이 끊겼을 때만).
 * 마스코트 말풍선·마스코트도 지도 위에 얹힌다. 칸은 늘 같은 자리·크기다. 화면이 뜰 때 미리 그려 보는 동안(PreDrawing)만 PreDrawProgress를 둔다.
 */
export function TwinPane({ plan, step, robotKnown, connected, map }: {
  plan: PlanView | null;
  step: PlanStep | null;
  robotKnown: boolean;
  /** 서버와 실시간 연결: 끊김 false, 모름 null. */
  connected: boolean | null;
  map: ReactNode;
}) {
  const offline = connected === false;
  const predraw = useContext(PreDrawing);
  return (
    <section aria-label="트윈" data-twin className="relative h-full min-h-0 min-w-0 flex-1">
      <div data-map className="absolute inset-0 overflow-hidden">{map}</div>
      {plan && step && <TaskProgress plan={plan} step={step} />}
      {predraw && <PreDrawProgress plan={plan} />}
      {(!robotKnown || offline) && (
        <div data-chips className="pointer-events-none absolute right-4 top-4 flex flex-col items-end gap-2">
          {!robotKnown && (
            <Status>
              <MapPin className="size-3.5" aria-hidden="true" />
              {WORDS.noRobot}
            </Status>
          )}
          {offline && (
            <Status variant="error" role="status" aria-live="polite">
              <WifiOff className="size-3.5" aria-hidden="true" />
              {WORDS.offline}
            </Status>
          )}
        </div>
      )}
    </section>
  );
}
