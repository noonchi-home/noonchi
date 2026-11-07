"use client";

// 21st.dev「Tooltip」(id 208, originui/tooltip) 받은 코드.
// 바꾼 것: 「Tooltip with arrow」 데모 그대로 showArrow. Portal에 container prop을 잇는다(말풍선 층 안에 그려 판과 함께 움직인다).
// tone="twin"이면 트윈 위: 테두리 border-border → twin-edge(charcoal 불투명), 화살표 drop-shadow hsl(var(--border)) → var(--twin-edge), 그림자 shadow-float 토큰.
// focus면 테두리 brand 2px(확인한 기기 강조). 글 text-sm → 크기별 토큰(md: label, lg: 이름·verb far, data-line 줄 body).
import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import * as React from "react";

import { cn } from "@/lib/utils";

const TooltipProvider = TooltipPrimitive.Provider;

const Tooltip = TooltipPrimitive.Root;

const TooltipTrigger = TooltipPrimitive.Trigger;

const SIZE = {
  sm: "text-label",
  md: "text-label",
  lg: "text-far [&_[data-slot=status]]:text-far [&_[data-line]]:text-body",
  body: "text-body",
} as const;

const TooltipContent = React.forwardRef<
  React.ElementRef<typeof TooltipPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Content> & {
    showArrow?: boolean;
    container?: HTMLElement | null;
    tone?: "default" | "twin";
    size?: keyof typeof SIZE;
    focus?: boolean;
  }
>(({ className, sideOffset = 4, showArrow = false, container, tone = "default", size = "sm", focus, ...props }, ref) => (
  <TooltipPrimitive.Portal container={container ?? undefined}>
    <TooltipPrimitive.Content
      ref={ref}
      sideOffset={sideOffset}
      data-tone={tone}
      data-focus={focus ? "true" : undefined}
      className={cn(
        "relative z-50 max-w-[280px] rounded-lg border border-border bg-popover px-3 py-1.5 text-popover-foreground animate-in fade-in-0 zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2",
        SIZE[size],
        tone === "twin" && "border-twin-edge shadow-float",
        focus && "border-2 border-brand",
        className,
      )}
      {...props}
    >
      {props.children}
      {showArrow && (
        <TooltipPrimitive.Arrow className={cn("-my-px fill-popover", tone === "twin" ? "drop-shadow-[0_1px_0_var(--twin-edge)]" : "drop-shadow-[0_1px_0_var(--border)]")} />
      )}
    </TooltipPrimitive.Content>
  </TooltipPrimitive.Portal>
));
TooltipContent.displayName = TooltipPrimitive.Content.displayName;

export { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger };

export default Tooltip;
