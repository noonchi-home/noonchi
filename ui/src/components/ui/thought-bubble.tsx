// 21st.dev「Message Bubble」(id 36525, syeddhasnainn/message-bubble) 받은 코드.
// 바꾼 것: assistant 말풍선만 남기고 user·system 말풍선, 입력 중 점(TypingDots)·흘려 쓰기(streaming)·시간·보냄 상태 줄·다시 보내기와 그 motion(MotionConfig·AnimatePresence)을 뺐다. 글 크기는 받은 text-sm leading-6 그대로다. bg-muted text-foreground → bg-card text-card-foreground, 그림자 트윈 위 그림자 shadow-float를 단다. 모서리 rounded-[16px] → rounded-3xl 토큰, 빈 동그라미 모양 shape="dot"(rounded-full, 여백 없음: 생각 말풍선 꼬리 점)을 더했다. import 'cn' → @/lib/utils. 말풍선과 동그라미는 트윈 위에서 보이게 테두리 twin-edge 토큰을 단다.
// 원래 글 크기: text-sm(14px). 받은 크기 그대로다. 더 큰 글은 npm run lint(scripts/lint-ui-type.ts)가 막는다.
import * as React from "react"

import { cn } from "@/lib/utils"

type ThoughtBubbleProps = React.ComponentProps<"div"> & { shape?: "bubble" | "dot" }

/** 대시보드 생각 말풍선(설정 화면 MessageBubble과 같은 받은 코드, 글은 받은 크기 text-sm). 표시용이라 화면 코드가 pointer-events-none 칸 안에 놓는다. */
function ThoughtBubble({ children, className, shape = "bubble", ...props }: ThoughtBubbleProps) {
  return (
    <div className={cn("flex w-full flex-col", "items-start")}>
      <div
        data-from="assistant"
        data-slot="thought-bubble"
        data-shape={shape}
        className={cn(
          "w-fit max-w-[85%] rounded-3xl px-3.5 py-2.5 text-sm leading-6 transition-[opacity,translate,scale] duration-200 ease-[cubic-bezier(0.23,1,0.32,1)] starting:opacity-0",
          "starting:translate-y-1 starting:scale-[0.97] motion-reduce:starting:translate-y-0 motion-reduce:starting:scale-100",
          "origin-bottom-left border border-twin-edge bg-card text-card-foreground shadow-float",
          shape === "dot" && "rounded-full p-0",
          className,
        )}
        {...props}
      >
        {shape === "dot" ? null : children}
      </div>
    </div>
  )
}

export { ThoughtBubble }
export type { ThoughtBubbleProps }
export default ThoughtBubble
