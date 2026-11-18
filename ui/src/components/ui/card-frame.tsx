// 21st.dev「Card」(id 1551, shadcn/card) 받은 코드.
// 바꾼 것: 대시보드 메시지 상자 안 FSM 카드 틀로 Card만 둔다(CardHeader·CardTitle·CardDescription·CardContent·CardFooter는 안 써서 뺐다). 꾸밈(rounded-lg·border·bg-card·shadow-sm)은 그대로, 색은 토큰 별칭(card·border·shade).
// 원래 글 크기: 없음. Card 틀에는 글 크기가 없다(받은 코드의 CardTitle text-2xl·CardDescription text-sm은 뺐다). 글 크기를 넣으면 npm run lint(scripts/lint-ui-type.ts)가 막는다.
import * as React from "react"

import { cn } from "@/lib/utils"

const CardFrame = React.forwardRef<
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
CardFrame.displayName = "CardFrame"

export { CardFrame }
