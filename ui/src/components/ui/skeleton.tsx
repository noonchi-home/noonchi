// 21st.dev「Skeleton」(id 1588, shadcn/skeleton) 받은 코드.
// 바꾼 것: data-slot을 붙이고 움직임 줄이기 설정에서는 반짝임을 끈다(motion-reduce:animate-none). bg-muted는 그대로(muted=cream).
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
