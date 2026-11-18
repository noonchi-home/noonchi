"use client";

// 21st.dev「Avatar」(id 1293, shadcn/avatar) 받은 코드.
// 바꾼 것: AvatarFallback tone prop(data-tone)에 토큰 색(ok·off(ink-3)·error·warn·brand·marker-a 바탕, 글 on-status·on-brand·marker-a-ink)을 단다.
// shape logo(로고 얼굴 상자: rounded-logo, cream 바탕, 얼굴은 상자의 84% 크기로 가운데(안 여백 8%), contain), size md(20px 번호 동그라미, 글 text-xs)·marker(설정 시작 자리 36px 동그라미, 굵게, 글 크기는 감싼 글)·state(메시지 상자 FSM 카드 상태 원 88px, 글 text-xs 줄 16px 가운데)를 더했다.
// 원래 글 크기: text-xs(12px). 받은 코드는 글 크기 없이 감싼 글을 따르고, 번호 동그라미(md)만 text-xs다. 더 큰 글은 npm run lint(scripts/lint-ui-type.ts)가 막는다.

import * as React from "react";
import * as AvatarPrimitive from "@radix-ui/react-avatar";

import { cn } from "@/lib/utils";

export type AvatarTone = "ok" | "off" | "error" | "warn" | "brand" | "marker-a";

const TONE: Record<AvatarTone, string> = {
  ok: "bg-ok text-on-status",
  off: "bg-ink-3 text-on-status",
  error: "bg-error text-on-status",
  warn: "bg-warn text-on-status",
  brand: "bg-brand text-on-brand",
  "marker-a": "bg-marker-a text-marker-a-ink",
};

const Avatar = React.forwardRef<
  React.ElementRef<typeof AvatarPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof AvatarPrimitive.Root> & { shape?: "circle" | "logo"; size?: "md" | "marker" | "state" }
>(({ className, shape = "circle", size, ...props }, ref) => (
  <AvatarPrimitive.Root
    ref={ref}
    data-shape={shape}
    data-size={size}
    className={cn(
      "group/avatar relative flex h-10 w-10 shrink-0 overflow-hidden rounded-full",
      shape === "logo" && "rounded-logo bg-cream",
      size === "md" && "size-5",
      size === "marker" && "size-9 leading-none font-bold",
      size === "state" && "size-[88px] text-xs leading-4 text-center",
      className,
    )}
    {...props}
  />
));
Avatar.displayName = AvatarPrimitive.Root.displayName;

const AvatarImage = React.forwardRef<
  React.ElementRef<typeof AvatarPrimitive.Image>,
  React.ComponentPropsWithoutRef<typeof AvatarPrimitive.Image>
>(({ className, ...props }, ref) => (
  <AvatarPrimitive.Image
    ref={ref}
    className={cn("aspect-square h-full w-full group-data-[shape=logo]/avatar:m-auto group-data-[shape=logo]/avatar:size-[84%] group-data-[shape=logo]/avatar:object-contain", className)}
    {...props}
  />
));
AvatarImage.displayName = AvatarPrimitive.Image.displayName;

const AvatarFallback = React.forwardRef<
  React.ElementRef<typeof AvatarPrimitive.Fallback>,
  React.ComponentPropsWithoutRef<typeof AvatarPrimitive.Fallback> & { tone?: AvatarTone }
>(({ className, tone, ...props }, ref) => (
  <AvatarPrimitive.Fallback
    ref={ref}
    data-tone={tone}
    className={cn(
      "flex h-full w-full items-center justify-center rounded-full bg-muted",
      tone && TONE[tone],
      "group-data-[size=md]/avatar:text-xs",
      className,
    )}
    {...props}
  />
));
AvatarFallback.displayName = AvatarPrimitive.Fallback.displayName;

export { Avatar, AvatarImage, AvatarFallback };

export default Avatar;
