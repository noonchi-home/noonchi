import type { HealthView } from "../../../src/contract/events.ts";
import { cn } from "../lib/utils";

const chip = "whitespace-nowrap rounded-full px-2.5 py-1";

/** 위 가운데 유리 알약: 연결·집·허브·에이전트·트윈 없음·설정 다시 하기. 글은 옛 헤더 배지 글 그대로. */
export function StatusPill({ connected, health }: { connected: boolean | null; health: HealthView | null }) {
  const conn = connected === null ? "연결 중…" : connected ? "실시간 연결됨" : "연결 끊김 · 다시 연결 중";
  const hub = health ? `허브 ${health.hub}${health.transport ? ` · ${health.transport}` : ""}` : "허브 -";
  const agent = health ? `에이전트 ${health.provider ?? "없음"}${health.model ? ` · ${health.model}` : ""}` : "에이전트 -";
  return (
    <section
      aria-label="집 상태"
      className="glass absolute left-1/2 top-3 z-50 flex max-w-[calc(100%-1.5rem)] -translate-x-1/2 items-center gap-1 overflow-x-auto rounded-full p-1 text-xs text-ink-dim"
    >
      <span role="status" aria-live="polite" className={cn(chip, "flex items-center gap-1.5 font-medium", connected ? "text-on" : "text-ink-dim")}>
        <span aria-hidden="true" className={cn("size-2 rounded-full", connected ? "bg-on" : connected === false ? "bg-alert" : "bg-ink-dim")} />
        {conn}
      </span>
      <span className={chip}>{`집 ${health?.home?.name ?? "-"}`}</span>
      <span className={chip}>{hub}</span>
      <span className={chip}>{agent}</span>
      {health && !health.twin && <span className={cn(chip, "text-alert")}>3D 트윈 없음</span>}
      <a href="/setup/" className={cn(chip, "bg-field text-ink transition-colors hover:bg-field-strong")}>설정 다시 하기</a>
    </section>
  );
}
