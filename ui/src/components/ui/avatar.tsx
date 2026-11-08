"use client";

// 21st.dev「Avatar」(id 1293, shadcn/avatar) 받은 코드.
// 바꾼 것: shape=logo(받은 rounded-full 대신 rounded-logo, cream 바탕, 안 여백 8%, 그림 contain: 로고 얼굴 상자), AvatarFallback tone(ok·ink-3·error·warn·brand·marker-a·marker-b 바탕, 글 on-status·on-brand·marker-*-ink 토큰),
// 번호 크기 size md(20px, caption: 트윈 말풍선 번호)·marker(설정 A·B, 22px 굵게). AvatarFallback bg-muted는 그대로(muted=cream).
import * as React from "react";
import * as AvatarPrimitive from "@radix-ui/react-avatar";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const avatarVariants = cva("group/avatar relative flex h-10 w-10 shrink-0 overflow-hidden rounded-full", {
  variants: {
    shape: { circle: "", logo: "rounded-logo bg-cream" },
    size: {
      default: "",
      md: "size-5 text-caption font-semibold",
      marker: "size-9 text-[22px] leading-none font-bold",
    },
  },
  defaultVariants: { shape: "circle", size: "default" },
});

const Avatar = React.forwardRef<
  React.ElementRef<typeof AvatarPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof AvatarPrimitive.Root> & VariantProps<typeof avatarVariants>
>(({ className, shape, size, ...props }, ref) => (
  <AvatarPrimitive.Root
    ref={ref}
    data-shape={shape ?? "circle"}
    className={cn(avatarVariants({ shape, size }), className)}
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
    className={cn("aspect-square h-full w-full group-data-[shape=logo]/avatar:object-contain group-data-[shape=logo]/avatar:p-[8%]", className)}
    {...props}
  />
));
AvatarImage.displayName = AvatarPrimitive.Image.displayName;

const fallbackTone = cva("flex h-full w-full items-center justify-center rounded-full bg-muted", {
  variants: {
    tone: {
      default: "",
      ok: "bg-ok text-on-status",
      off: "bg-ink-3 text-on-status",
      error: "bg-error text-on-status",
      warn: "bg-warn text-on-status",
      brand: "bg-brand text-on-brand",
      "marker-a": "bg-marker-a text-marker-a-ink",
      "marker-b": "bg-marker-b text-marker-b-ink",
    },
  },
  defaultVariants: { tone: "default" },
});

const AvatarFallback = React.forwardRef<
  React.ElementRef<typeof AvatarPrimitive.Fallback>,
  React.ComponentPropsWithoutRef<typeof AvatarPrimitive.Fallback> & VariantProps<typeof fallbackTone>
>(({ className, tone, ...props }, ref) => (
  <AvatarPrimitive.Fallback
    ref={ref}
    data-tone={tone ?? "default"}
    className={cn(fallbackTone({ tone }), className)}
    {...props}
  />
));
AvatarFallback.displayName = AvatarPrimitive.Fallback.displayName;

export { Avatar, AvatarImage, AvatarFallback };

export default Avatar;
