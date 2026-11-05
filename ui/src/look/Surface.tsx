import type { ReactNode } from "react";
import { GlassEffect } from "../components/ui/liquid-glass";
import { LiquidGlassCard } from "../components/ui/liquid-weather-glass";
import { cn } from "../lib/utils";
import { useLook } from "./look";

/**
 * 패널·알약·말풍선의 바깥 판.
 * 부품 모양: 흰 카드(Chat Panel 테마의 bg-surface·shadow-card). plain이면 판을 비워 둔다(안쪽 Chat Panel 틀이 카드일 때).
 * 유리 모양: 패널은 Liquid Weather Glass(id 4567), 알약·말풍선은 Liquid Glass(id 2882).
 */
export function Surface({ kind, className, contentClassName, plain, children }: {
  kind: "panel" | "pill" | "bubble";
  className?: string;
  contentClassName?: string;
  plain?: boolean;
  children: ReactNode;
}) {
  const look = useLook();
  if (look === "glass") {
    if (kind === "panel") {
      return (
        <LiquidGlassCard data-surface="glass" draggable={false} borderRadius="24px" className={cn("bg-white/15", className)} contentClassName={contentClassName}>
          {children}
        </LiquidGlassCard>
      );
    }
    return <GlassEffect data-surface="glass" className={cn(kind === "pill" ? "rounded-full" : "rounded-xl", className)}>{children}</GlassEffect>;
  }
  return (
    <div data-surface="card" className={cn(!plain && "bg-surface shadow-card", kind === "pill" ? "rounded-full" : "rounded-card", className)}>
      <div className={contentClassName}>{children}</div>
    </div>
  );
}
