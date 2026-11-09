// 21st.dev「Card」(id 1551, shadcn/card) 받은 코드.
// 바꾼 것: CardTitle text-2xl → title 토큰, CardDescription text-sm → body-sm 토큰. shadow-sm은 그대로(색만 shade 토큰). 설정 1~3단계 큰 글(사용자 2026-11-09 「1,2,3 번은 글씨 키워도되겠다」, 「1,2,3 글씨 더 키워도될거같고」): CardTitle size lg(text-3xl)·md(text-xl), CardDescription size lg(text-base)를 더했다.
import * as React from "react"

import { cn } from "@/lib/utils"

const Card = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn(
      "rounded-lg border bg-card text-card-foreground shadow-sm",
      className,
    )}
    {...props}
  />
))
Card.displayName = "Card"

const CardHeader = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn("flex flex-col space-y-1.5 p-6", className)}
    {...props}
  />
))
CardHeader.displayName = "CardHeader"

const CardTitle = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLHeadingElement> & { size?: "default" | "md" | "lg" }
>(({ className, size = "default", ...props }, ref) => (
  <h3
    ref={ref}
    className={cn(
      "text-title font-semibold leading-none tracking-tight",
      size === "md" && "text-xl",
      size === "lg" && "text-3xl",
      className,
    )}
    {...props}
  />
))
CardTitle.displayName = "CardTitle"

const CardDescription = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLParagraphElement> & { size?: "default" | "lg" }
>(({ className, size = "default", ...props }, ref) => (
  <p
    ref={ref}
    className={cn("text-body-sm text-muted-foreground", size === "lg" && "text-base", className)}
    {...props}
  />
))
CardDescription.displayName = "CardDescription"

const CardContent = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div ref={ref} className={cn("p-6 pt-0", className)} {...props} />
))
CardContent.displayName = "CardContent"

const CardFooter = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn("flex items-center p-6 pt-0", className)}
    {...props}
  />
))
CardFooter.displayName = "CardFooter"

export { Card, CardHeader, CardFooter, CardTitle, CardDescription, CardContent }
