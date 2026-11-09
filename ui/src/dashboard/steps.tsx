import { Bell, Footprints, Hand, Hourglass, Power, type LucideIcon } from "lucide-react";
import type { PlanView, StepKind } from "../../../src/contract/plan.ts";
import { Stepper, StepperBar, StepperItem, StepperTrigger } from "../components/ui/stepper";
import { cn } from "../lib/utils";

export const KIND_ICON: Record<StepKind, LucideIcon> = { move: Footprints, act: Hand, ask: Bell, device: Power, wait: Hourglass };

/** Stepper 지금 단계(1부터). 지금 단계가 없으면 마지막 다음이라 모두 끝난 단계로 보인다. */
const activeOf = (plan: PlanView) => {
  const i = plan.steps.findIndex((s) => s.status === "active");
  return i < 0 ? plan.steps.length + 1 : i + 1;
};

/**
 * 단계 막대(Stepper 「Progress」 데모 막대): 끝난 칸 ok, 지금 칸 brand, 남은 칸 border.
 * 한 단계 안에서는 그대로다(늘어나는 진행 막대가 없다). 매 그림 다시 그려지는 것이 단계가 바뀔 때 자리를 옮기면 Chrome 화면 캡처·공유가 멈춘다.
 */
export function Segments({ plan, className }: { plan: PlanView; className?: string }) {
  return (
    <Stepper value={activeOf(plan)} aria-hidden="true" className={cn("gap-1", className)}>
      {plan.steps.map((s, i) => (
        <StepperItem key={s.id} step={i + 1} completed={s.status === "done"} data-segment={s.status} className="flex-1">
          <StepperTrigger asChild className="w-full flex-col items-start gap-2">
            <StepperBar>
              <span className="sr-only">{i + 1}</span>
            </StepperBar>
          </StepperTrigger>
        </StepperItem>
      ))}
    </Stepper>
  );
}
