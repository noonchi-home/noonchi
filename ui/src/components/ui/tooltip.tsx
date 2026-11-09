"use client";

// 21st.dev「Tooltip」(id 208, originui/tooltip) 받은 코드.
// 바꾼 것: 「Tooltip with arrow」 데모 그대로 showArrow. Portal에 container prop을 이어 말풍선 층(움직이는 판 안)에 그린다. 크기 size: md(데모 text-xs), lg(이름 줄 text-sm medium, 나머지 text-xs), say(받은 text-sm).
// 원래 글 크기: text-sm(14px). 받은 부품 text-sm, 「Tooltip with arrow」 데모 text-xs다. 더 큰 글은 npm run lint(scripts/lint-ui-type.ts)가 막는다.
// tone twin(트윈·지도·눈 위)이면 테두리·화살표 선 twin-edge, 그림자 shadow-float, 상태 줄 ink-2. focus면 테두리 brand 2px(확인한 기기 강조). 화살표 drop-shadow hsl(var(--border)) → 토큰 변수.

import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import * as React from "react";

import { cn } from "@/lib/utils";

const TooltipProvider = TooltipPrimitive.Provider;

const Tooltip = TooltipPrimitive.Root;

const TooltipTrigger = TooltipPrimitive.Trigger;

/** 글 크기: md(트윈 말풍선) 데모 text-xs, lg(큰 트윈 말풍선) 이름 줄 text-sm medium·상태 줄 text-xs(칩은 Status 제 크기), say(마스코트 한마디) 받은 text-sm. */
const SIZE = {
  md: "text-xs",
  lg: "text-xs [&_[data-part=title]]:text-sm [&_[data-part=title]]:font-medium",
  say: "text-sm",
} as const;

const TooltipContent = React.forwardRef<
  React.ElementRef<typeof TooltipPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Content> & {
    showArrow?: boolean;
    /** 그릴 자리(Portal container). */
    container?: HTMLElement | null;
    size?: keyof typeof SIZE;
    /** twin: 트윈·지도·눈 그림 위 말풍선. */
    tone?: "default" | "twin";
    /** 확인한 기기 강조. */
    focus?: boolean;
  }
>(({ className, sideOffset = 4, showArrow = false, container, size = "md", tone = "default", focus = false, ...props }, ref) => (
  <TooltipPrimitive.Portal container={container ?? undefined}>
    <TooltipPrimitive.Content
      ref={ref}
      sideOffset={sideOffset}
      data-slot="tooltip-content"
      data-size={size}
      data-tone={tone}
      data-focus={focus ? "true" : undefined}
      className={cn(
        "relative z-50 max-w-[280px] rounded-lg border border-border bg-popover px-3 py-1.5 text-popover-foreground animate-in fade-in-0 zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2",
        SIZE[size],
        tone === "twin" && "border-twin-edge shadow-float [&_[data-part=line]]:text-ink-2",
        focus && "border-2 border-brand",
        className,
      )}
      {...props}
    >
      {props.children}
      {showArrow && (
        <TooltipPrimitive.Arrow
          data-slot="tooltip-arrow"
          className={cn(
            "-my-px fill-popover",
            tone === "twin" ? "drop-shadow-[0_1px_0_var(--twin-edge)]" : "drop-shadow-[0_1px_0_var(--border)]",
            focus && "drop-shadow-[0_2px_0_var(--brand)]",
          )}
        />
      )}
    </TooltipPrimitive.Content>
  </TooltipPrimitive.Portal>
));
TooltipContent.displayName = TooltipPrimitive.Content.displayName;

export { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger };

export default Tooltip;
