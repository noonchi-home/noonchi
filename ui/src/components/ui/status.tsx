// 21st.dev「Status」(id 25393, diceui/status) 받은 코드.
// 바꾼 것: success·warning·error 바탕 green-500/10·orange-500/10·destructive/10 → 불투명 ok-tint·warn-tint·error-tint, 글·점 → ok·warn·error 토큰(테두리 /20 그대로).
// info variant 뺌, brand variant 더함(cream 바탕, brand 글·점), scrim variant 더함(대시보드 폰 칸 영상 위 YOLO 이름표: scrim-phone 바탕, on-scrim 글·점, 글 크기는 그대로). 점 퍼짐(animate-ping)은 data-live가 있을 때만, 움직임 줄이기면 끈다. radix-ui Slot → @radix-ui/react-slot.
// 원래 글 크기: text-xs(12px). 받은 크기 그대로다. 더 큰 글은 npm run lint(scripts/lint-ui-type.ts)가 막는다.
import { cva, type VariantProps } from "class-variance-authority";
import { Slot } from "@radix-ui/react-slot";
import type * as React from "react";
import { cn } from "@/lib/utils";

const statusVariants = cva(
  "inline-flex w-fit shrink-0 items-center gap-1.5 overflow-hidden whitespace-nowrap rounded-full border px-2.5 py-1 font-medium text-xs transition-colors",
  {
    variants: {
      variant: {
        default:
          "border-transparent bg-muted text-muted-foreground **:data-[slot=status-indicator]:bg-muted-foreground",
        success:
          "border-ok/20 bg-ok-tint text-ok **:data-[slot=status-indicator]:bg-ok",
        error:
          "border-error/20 bg-error-tint text-error **:data-[slot=status-indicator]:bg-error",
        warning:
          "border-warn/20 bg-warn-tint text-warn **:data-[slot=status-indicator]:bg-warn",
        brand:
          "border-transparent bg-muted text-brand **:data-[slot=status-indicator]:bg-brand",
        scrim:
          "border-transparent bg-scrim-phone text-on-scrim **:data-[slot=status-indicator]:bg-on-scrim",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

interface StatusProps
  extends VariantProps<typeof statusVariants>, React.ComponentProps<"div"> {
  asChild?: boolean;
}

function Status(props: StatusProps) {
  const { className, variant = "default", asChild, ...rootProps } = props;

  const RootPrimitive = asChild ? Slot : "div";

  return (
    <RootPrimitive
      data-slot="status"
      data-variant={variant}
      {...rootProps}
      className={cn(statusVariants({ variant }), className)}
    />
  );
}

function StatusIndicator(props: React.ComponentProps<"div"> & { live?: boolean }) {
  const { className, live, ...indicatorProps } = props;

  return (
    <div
      data-slot="status-indicator"
      data-live={live || undefined}
      {...indicatorProps}
      className={cn(
        "relative flex size-2 shrink-0 rounded-full",
        "before:absolute before:inset-0 data-[live]:before:animate-ping motion-reduce:before:animate-none before:rounded-full before:bg-inherit",
        "after:absolute after:inset-[2px] after:rounded-full after:bg-inherit",
        className,
      )}
    />
  );
}

function StatusLabel(props: React.ComponentProps<"div">) {
  const { className, ...labelProps } = props;

  return (
    <div
      data-slot="status-label"
      {...labelProps}
      className={cn("leading-none", className)}
    />
  );
}

export { Status, StatusIndicator, StatusLabel, statusVariants };

export default Status;
