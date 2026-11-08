// 21st.dev「Alert」(id 11326, coss.com/alert) 받은 코드.
// 바꾼 것: red·emerald·amber → error·ok·warn 토큰(/5 바탕, /30 테두리는 그대로), info variant 뺌, dark: 줄 지움, import "./utils" → @/lib/utils, text-sm → body-sm 토큰. 폰 사진 요청용 brand variant(brand 바탕, on-brand 글·아이콘)와 size lg(headline 토큰, 제목 굵기도 headline 700: AlertTitle font-medium을 덮음)를 더함.
import { cva, type VariantProps } from "class-variance-authority";
import type * as React from "react";
import { cn } from "@/lib/utils";

const alertVariants = cva(
  "relative grid w-full items-start gap-x-2 gap-y-0.5 rounded-xl border px-3.5 py-3 text-body-sm has-[>svg]:grid-cols-[calc(var(--spacing)*4)_1fr] [&>svg]:h-[1lh] [&>svg]:w-4",
  {
    defaultVariants: {
      variant: "default",
      size: "default",
    },
    variants: {
      variant: {
        default:
          "bg-transparent text-card-foreground [&>svg]:text-muted-foreground",
        error:
          "border-error/30 bg-error/5 text-error [&>svg]:text-error",
        success:
          "border-ok/30 bg-ok/5 text-ok [&>svg]:text-ok",
        warning:
          "border-warn/30 bg-warn/5 text-warn [&>svg]:text-warn",
        brand:
          "border-brand bg-brand text-on-brand [&>svg]:text-on-brand",
      },
      size: {
        default: "",
        lg: "text-headline *:data-[slot=alert-title]:font-bold",
      },
    },
  },
);

export function Alert({
  className,
  variant,
  size,
  ...props
}: React.ComponentProps<"div"> &
  VariantProps<typeof alertVariants>): React.ReactElement {
  return (
    <div
      className={cn(alertVariants({ variant, size }), className)}
      data-slot="alert"
      role="alert"
      {...props}
    />
  );
}

export function AlertTitle({
  className,
  ...props
}: React.ComponentProps<"div">): React.ReactElement {
  return (
    <div
      className={cn("font-medium [svg~&]:col-start-2", className)}
      data-slot="alert-title"
      {...props}
    />
  );
}

export function AlertDescription({
  className,
  ...props
}: React.ComponentProps<"div">): React.ReactElement {
  return (
    <div
      className={cn(
        "flex flex-col gap-2.5 text-muted-foreground [svg~&]:col-start-2",
        className,
      )}
      data-slot="alert-description"
      {...props}
    />
  );
}

export function AlertAction({
  className,
  ...props
}: React.ComponentProps<"div">): React.ReactElement {
  return (
    <div
      className={cn(
        "flex gap-1 max-sm:col-start-2 max-sm:mt-2 sm:row-start-1 sm:row-end-3 sm:self-center",
        className,
      )}
      data-slot="alert-action"
      {...props}
    />
  );
}
