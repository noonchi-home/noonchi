// 21st.dev「Status Card」(id 38110, redrob-labs/status-card) 받은 코드.
// 바꾼 것: ProtectionStatus의 제목과 점·문장 구조에 공통 토큰과 상태 알림을 연결했다. 장식 아이콘과 보조 문구는 뺐다.
// 원본 구현: https://github.com/redrob-labs/redrob-ui/blob/develop/src/components/ProtectionStatus/ProtectionStatus.tsx
import { cn } from "@/lib/utils";

interface StatusCardProps {
  title: string;
  live: string;
  tone: "safe" | "warn" | "plain";
}

const toneDot = { safe: "bg-ok", warn: "bg-warn", plain: "bg-muted-foreground" } as const;

export function StatusCard({ title, live, tone }: StatusCardProps) {
  return <div className="min-w-0">
    <div className="grid gap-2">
      <h2 className="text-3xl font-semibold leading-none tracking-tight">{title}</h2>
      <p role="status" className="flex items-center gap-1.5 text-body-sm text-muted-foreground">
        <span aria-hidden="true" className={cn("size-2 shrink-0 rounded-full", toneDot[tone])} />
        <span>{live}</span>
      </p>
    </div>
  </div>;
}
