import type { ReactNode } from "react";
import { Avatar, AvatarImage } from "./ui/avatar";
import { LiquidGlass } from "./ui/liquid-glass";
import { cn } from "../lib/utils";

/**
 * 실제 폰 위 줄(data-phone-zone=top): 왼쪽 위 미어캣(lead), 그 옆 지금 할 명령 한 줄(text, 없으면 null). 상태 표시줄 아래에서 시작한다(안전 영역, 없으면 28px + 8px).
 * 명령 말풍선은 글 너비만큼만 차지한다(남은 너비를 채우지 않음, 긴 명령은 화면 안에서 줄을 바꾼다, 2026-11-20 사용자 「말풍선 글자 크기만큼만 나오게 해 줘」).
 * 실제 폰 화면(ui/src/phone PhoneScreen, lead는 설정 단추)과 대시보드 비전 미니맵만 보기(ui/src/dashboard MinimapView)가 같은 부품·배치·글로 쓴다.
 * 자리(fixed 등)는 놓는 쪽이 className으로 주거나 이 줄을 자리 잡은 칸 안에 놓는다.
 */
export function PhoneTopLine({ lead, text, className }: { lead: ReactNode; text: string | null; className?: string }) {
  return (
    <div data-phone-zone="top" className={cn("flex items-start gap-2 px-4 pt-[calc(max(env(safe-area-inset-top),28px)+8px)]", className)}>
      {lead}
      {text !== null && (
        <LiquidGlass mode="opaque" radius={16} role="status" aria-live="polite" className="min-w-0" contentClassName="px-3.5 py-3">
          <p data-phone-text="명령" className="break-keep">{text}</p>
        </LiquidGlass>
      )}
    </div>
  );
}

/** 위 줄 미어캣 얼굴(실제 폰은 설정 단추 안). */
export function MeerkatFace() {
  return <Avatar shape="logo" className="size-10"><AvatarImage src="/brand/face-128.png" alt="" /></Avatar>;
}
