import { MapPin, WifiOff } from "lucide-react";
import type { ReactNode } from "react";
import type { PlanStep, PlanView } from "../../../src/contract/plan.ts";
import { Avatar, AvatarFallback } from "../components/ui/avatar";
import { Item, ItemActions, ItemContent, ItemDescription, ItemMedia, ItemTitle } from "../components/ui/item";
import { LiquidGlass } from "../components/ui/liquid-glass";
import { Status } from "../components/ui/status";
import { KIND_ICON, Segments } from "./steps";
import { WORDS } from "./words";

/**
 * 할 일 진행도(LiquidGlass 알약 + Item sm, 부품 원래 글 크기 text-sm): 단계 아이콘, 할 일, 단계 번호·지금 계획 단계 이름, 단계 막대. 트윈 안에만 둔다.
 * 계획이 있을 때만 그린다. 한 단계 안에서는 그대로다(늘어나는 진행 막대·반짝이는 칩 없음). 마우스를 받지 않는다.
 */
function TaskProgress({ plan, step }: { plan: PlanView; step: PlanStep }) {
  const I = KIND_ICON[step.kind];
  const n = plan.steps.findIndex((s) => s.id === step.id) + 1;
  return (
    <div data-progress className="pointer-events-none absolute left-4 top-4 flex max-w-[calc(100%-2rem)]">
      <LiquidGlass mode="opaque" className="min-w-0">
        <Item size="sm" className="min-w-0 flex-nowrap py-2">
          <ItemMedia>
            <Avatar className="size-7" aria-hidden="true">
              <AvatarFallback tone="brand"><I className="size-4" /></AvatarFallback>
            </Avatar>
          </ItemMedia>
          <ItemContent role="status" aria-live="polite" className="min-w-0 flex-row items-baseline gap-2">
            <ItemTitle className="block min-w-0 shrink truncate">{plan.goal}</ItemTitle>
            <ItemDescription className="shrink-0">
              <span className="tabular-nums">{`${n}/${plan.steps.length}`}</span>
              <span> · </span>
              <span>{step.label}</span>
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

/**
 * 트윈 칸(왼쪽에서 남은 너비와 화면 높이를 다 쓴다, 판은 대시보드 폰 칸과 함께 쓰는 한 판): 칸을 꽉 채운 지도 자리(map)와
 * 그 위 왼쪽 위 할 일 진행도(계획이 있을 때만, 계획 전 지켜보기에는 없다), 오른쪽 위 칩(클로이드 위치를 모를 때, 연결이 끊겼을 때만).
 * 마스코트 말풍선·마스코트도 지도 위에 얹힌다. 칸은 늘 같은 자리·크기다.
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
  return (
    <section aria-label="트윈" data-twin className="relative h-full min-h-0 min-w-0 flex-1">
      <div data-map className="absolute inset-0 overflow-hidden">{map}</div>
      {plan && step && <TaskProgress plan={plan} step={step} />}
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
