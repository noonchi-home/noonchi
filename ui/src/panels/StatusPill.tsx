import { TriangleAlert } from "lucide-react";
import type { HealthView } from "../../../src/contract/events.ts";
import { Avatar, AvatarImage } from "../components/ui/avatar";
import { Button } from "../components/ui/button";
import { NavbarTitle } from "../components/ui/header-navbar";
import { LiquidGlass } from "../components/ui/liquid-glass";
import { Status, StatusIndicator, StatusLabel } from "../components/ui/status";

const MODE: Record<HealthView["mode"], { text: string; variant: "default" | "warning" }> = {
  test: { text: "시험 모드", variant: "default" },
  live: { text: "실제 모드", variant: "warning" },
};

/** 위 가운데 알약: 로고 짝(얼굴 상자 + NOONCHI), 연결·집·운영 모드·허브·에이전트·트윈 없음·설정 다시 하기. 판은 21st.dev Liquid Glass, 칩은 Status, 링크는 Button. */
export function StatusPill({ connected, health }: { connected: boolean | null; health: HealthView | null }) {
  const mode = health ? MODE[health.mode] : null;
  const conn = connected === null ? "연결 중…" : connected ? "실시간 연결됨" : "연결 끊김 · 다시 연결 중";
  const hub = health ? `허브 ${health.hub}${health.transport ? ` · ${health.transport}` : ""}` : "허브 -";
  const agent = health ? `에이전트 ${health.provider ?? "없음"}${health.model ? ` · ${health.model}` : ""}` : "에이전트 -";
  return (
    // 1440px부터는 눈 창(왼쪽 12px + 224px)과 판단 기록(오른쪽 12px + 380px)이 같은 줄로 올라온다. 알약은 둘 사이 빈칸(12px씩 띄움) 가운데에 두고 빈칸보다 넓어지지 않게 한다. 칩이 빈칸보다 길면 다음 줄로 넘긴다.
    <section aria-label="집 상태" className="absolute left-1/2 top-3 z-50 w-max max-w-[calc(100%-1.5rem)] -translate-x-1/2 min-[1440px]:left-[calc(50%-78px)] min-[1440px]:max-w-[calc(100%-652px)]">
      <LiquidGlass tint={0.6} radius={20} contentClassName="flex flex-wrap items-center justify-center gap-1 p-1">
        <span className="flex shrink-0 items-center gap-1.5 ps-1 pe-2">
          <Avatar shape="logo" className="size-6"><AvatarImage src="/brand/face-64.png" alt="" /></Avatar>
          <NavbarTitle as="span" size="hub">NOONCHI</NavbarTitle>
        </span>
        <Status role="status" aria-live="polite" variant={connected ? "success" : connected === false ? "error" : "default"}>
          <StatusIndicator live={connected === true} />
          <StatusLabel>{conn}</StatusLabel>
        </Status>
        <Status>{`집 ${health?.home?.name ?? "-"}`}</Status>
        {mode && <Status variant={mode.variant}>{mode.text}</Status>}
        <Status>{hub}</Status>
        <Status>{agent}</Status>
        {health && !health.twin && <Status variant="error"><TriangleAlert className="size-3.5" aria-hidden="true" />3D 트윈 없음</Status>}
        <Button asChild variant="secondary" size="sm" className="shrink-0"><a href="/setup/">설정 다시 하기</a></Button>
      </LiquidGlass>
    </section>
  );
}
