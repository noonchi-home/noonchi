"use client"

// 21st.dev「Basic Item」(id 28573, bundui/item1) 받은 코드.
// 바꾼 것: 없음(Basic Item 꾸러미의 의존 부품 separator.tsx 그대로, bg-border는 border=line 토큰 별칭).
// 원래 글 크기: 없음. 받은 코드에 글 크기가 없다. 글 크기를 넣으면 npm run lint(scripts/lint-ui-type.ts)가 막는다.

import * as React from "react"
import * as SeparatorPrimitive from "@radix-ui/react-separator"

import { cn } from "@/lib/utils"

const Separator = React.forwardRef<
  React.ElementRef<typeof SeparatorPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof SeparatorPrimitive.Root>
>(
  (
    { className, orientation = "horizontal", decorative = true, ...props },
    ref
  ) => (
    <SeparatorPrimitive.Root
      ref={ref}
      decorative={decorative}
      orientation={orientation}
      className={cn(
        "shrink-0 bg-border",
        orientation === "horizontal" ? "h-[1px] w-full" : "h-full w-[1px]",
        className
      )}
      {...props}
    />
  )
)
Separator.displayName = SeparatorPrimitive.Root.displayName

export { Separator }
