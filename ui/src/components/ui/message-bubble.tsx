// 21st.dev「Message Bubble」(id 36525, syeddhasnainn/message-bubble) 받은 코드.
// 바꾼 것: assistant 말풍선만 남기고 user·system 말풍선, 입력 중 점(TypingDots)·흘려 쓰기(streaming)·시간·보냄 상태 줄·다시 보내기와 그 motion(MotionConfig·AnimatePresence)을 뺐다. text-sm → body-sm 토큰, bg-muted text-foreground → bg-card text-card-foreground, 그림자 shadow-card를 단다. import 'cn' → @/lib/utils.
import * as React from "react"

import { cn } from "@/lib/utils"

type MessageBubbleProps = React.ComponentProps<"div">

function MessageBubble({ children, className, ...props }: MessageBubbleProps) {
  return (
    <div className={cn("flex w-full flex-col", "items-start")}>
      <div
        data-from="assistant"
        data-slot="message-bubble"
        className={cn(
          "w-fit max-w-[85%] rounded-[16px] px-3.5 py-2.5 text-body-sm leading-6 transition-[opacity,translate,scale] duration-200 ease-[cubic-bezier(0.23,1,0.32,1)] starting:opacity-0",
          "starting:translate-y-1 starting:scale-[0.97] motion-reduce:starting:translate-y-0 motion-reduce:starting:scale-100",
          "origin-bottom-left bg-card text-card-foreground shadow-card",
          className,
        )}
        {...props}
      >
        {children}
      </div>
    </div>
  )
}

export { MessageBubble }
export type { MessageBubbleProps }
export default MessageBubble
