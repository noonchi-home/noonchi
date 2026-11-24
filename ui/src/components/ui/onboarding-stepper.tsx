// 21st.dev「Onboarding Stepper Progress」(id 19143, shadcnspace/progress-02) 받은 코드.
// 바꾼 것: 진행 막대와 현재 단계는 실제 화면 단계에 연결했다. 이름을 붙인 구간으로 나눴고 퍼센트와 예제 이동 단추는 뺐다.
import { cn } from "@/lib/utils";

interface OnboardingStepperProps {
  steps: readonly string[];
  current: number;
}

export function OnboardingStepper({ steps, current }: OnboardingStepperProps) {
  return <div className="w-full rounded-xl border bg-background p-4">
    <ol aria-label="집 등록 단계" className="grid grid-cols-3 gap-2">
      {steps.map((label, index) => <li key={label} aria-current={index === current ? "step" : undefined} className="space-y-2">
        <span aria-hidden="true" className={cn("block h-1.5 rounded-full", index <= current ? "bg-primary" : "bg-muted")} />
        <span className={cn("block text-xs text-muted-foreground", index === current && "font-semibold text-foreground")}>{label}</span>
      </li>)}
    </ol>
  </div>;
}
