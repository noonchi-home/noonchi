import type { ReactNode } from "react";
import { cn } from "../lib/utils";

/**
 * 패널·알약·말풍선의 바깥 판: 흰 카드(Chat Panel 테마의 bg-surface·shadow-card).
 * plain이면 판을 비워 둔다(안쪽 Chat Panel 틀이 카드일 때).
 */
export function Surface({ kind, className, contentClassName, plain, children }: {
  kind: "panel" | "pill" | "bubble";
  className?: string;
  contentClassName?: string;
  plain?: boolean;
  children: ReactNode;
}) {
  return (
    <div className={cn(!plain && "bg-surface shadow-card", kind === "pill" ? "rounded-full" : "rounded-card", className)}>
      <div className={contentClassName}>{children}</div>
    </div>
  );
}
