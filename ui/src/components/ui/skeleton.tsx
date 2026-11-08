// 21st.dev「Skeleton」(id 1588, shadcn/skeleton) 받은 코드.
// 바꾼 것: data-slot을 붙이고 움직임 줄이기 설정에서는 반짝임을 끈다(motion-reduce:animate-none). bg-muted는 그대로(muted=cream).
// 원래 글 크기: 없음. 받은 코드에 글 크기가 없다. 글 크기를 넣으면 npm run lint(scripts/lint-ui-type.ts)가 막는다.
import { cn } from "@/lib/utils"

function Skeleton({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      data-slot="skeleton"
      className={cn("animate-pulse motion-reduce:animate-none rounded-md bg-muted", className)}
      {...props}
    />
  )
}

export { Skeleton }
