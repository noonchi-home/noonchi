"use client";

// 21st.dev「Removable Badges」(id 25370, bundui/badge10) 받은 코드.
// 바꾼 것: 꾸러미의 의존 부품 badge.tsx와 받은 빼기 단추 틀을 RemovableBadge로 내보낸다. text-xs → label 토큰, text-foreground/60 → ink-3 토큰, aria-label Delete → 「빼기」.
// 목록 상태(useState)는 뺐다. 글과 빼기 동작은 밖에서 받는다(데이터 연결).
import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { XIcon } from "lucide-react"

import { cn } from "@/lib/utils"

const badgeVariants = cva(
  "inline-flex items-center rounded-full border px-2.5 py-0.5 text-label font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
  {
    variants: {
      variant: {
        default:
          "border-transparent bg-primary text-primary-foreground hover:bg-primary/80",
        secondary:
          "border-transparent bg-secondary text-secondary-foreground hover:bg-secondary/80",
        destructive:
          "border-transparent bg-destructive text-destructive-foreground hover:bg-destructive/80",
        outline: "text-foreground",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
)

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <div className={cn(badgeVariants({ variant }), className)} {...props} />
  )
}

/** 빼기 단추가 붙은 칩(받은 Removable Badges 틀). */
function RemovableBadge({ children, onRemove, removeLabel = "빼기", ...props }: Omit<BadgeProps, "variant"> & { onRemove: () => void; removeLabel?: string }) {
  return (
    <Badge className="gap-0 rounded-md px-2 py-1" variant="outline" {...props}>
      {children}
      <button
        aria-label={removeLabel}
        className="text-ink-3 hover:text-foreground focus-visible:border-ring focus-visible:ring-ring/50 -my-[5px] -ms-0.5 -me-2 inline-flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-[inherit] p-0 transition-[color,box-shadow] outline-none focus-visible:ring-[3px]"
        onClick={onRemove}
        type="button"
      >
        <XIcon aria-hidden="true" size={14} />
      </button>
    </Badge>
  )
}

export { Badge, badgeVariants, RemovableBadge }
