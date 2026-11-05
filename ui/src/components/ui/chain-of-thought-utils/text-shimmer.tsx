"use client";

// Chain of Thought(21st.dev id 28391)가 쓰는 글 반짝임. motion-primitives TextShimmer 모양:
// 글자 모양으로 자른 바탕에 밝은 띠가 오른쪽에서 왼쪽으로 지나간다. disableShimmer면 그냥 글, invertLight면 띠와 바탕 색을 바꾼다.
import * as React from "react";
import { motion } from "motion/react";
import { cn } from "@/lib/utils";

export type TextShimmerProps = {
  children: React.ReactNode;
  className?: string;
  duration?: number;
  spread?: number;
  invertLight?: boolean;
  disableShimmer?: boolean;
};

function TextShimmerComponent({ children, className, duration = 2, spread = 2, invertLight = false, disableShimmer = false }: TextShimmerProps) {
  const length = typeof children === "string" ? children.length : 12;
  const dynamicSpread = React.useMemo(() => length * spread, [length, spread]);
  if (disableShimmer) return <span className={cn("relative inline-block", className)}>{children}</span>;
  return (
    <motion.span
      className={cn(
        "relative inline-block bg-[length:250%_100%,auto] bg-clip-text text-transparent",
        "[background-repeat:no-repeat,padding-box] [--bg:linear-gradient(90deg,#0000_calc(50%-var(--spread)),var(--base-gradient-color),#0000_calc(50%+var(--spread)))]",
        invertLight
          ? "[--base-color:var(--color-foreground)] [--base-gradient-color:var(--color-muted-foreground)]"
          : "[--base-color:var(--color-muted-foreground)] [--base-gradient-color:var(--color-foreground)]",
        className,
      )}
      initial={{ backgroundPosition: "100% center" }}
      animate={{ backgroundPosition: "0% center" }}
      transition={{ repeat: Infinity, duration, ease: "linear" }}
      style={{ "--spread": `${dynamicSpread}px`, backgroundImage: "var(--bg), linear-gradient(var(--base-color), var(--base-color))" } as React.CSSProperties}
    >
      {children}
    </motion.span>
  );
}

export const TextShimmer = React.memo(TextShimmerComponent);
