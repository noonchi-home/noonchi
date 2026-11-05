import type { HealthView } from "../../../src/contract/events.ts";
import { cn } from "../lib/utils";
import { Surface } from "../look/Surface";

const chip = "whitespace-nowrap rounded-full px-2.5 py-1";
const MODE: Record<HealthView["mode"], { text: string; className: string }> = {
  test: { text: "시험 모드", className: "" },
  live: { text: "실제 모드", className: "bg-orange-tint font-medium text-orange" },
};

/** 위 가운데 알약: 연결·집·운영 모드·허브·에이전트·트윈 없음·설정 다시 하기. 판은 모양마다 다르다(Surface). */
export function StatusPill({ connected, health }: { connected: boolean | null; health: HealthView | null }) {
  const mode = health ? MODE[health.mode] : null;
  const conn = connected === null ? "연결 중…" : connected ? "실시간 연결됨" : "연결 끊김 · 다시 연결 중";
  const hub = health ? `허브 ${health.hub}${health.transport ? ` · ${health.transport}` : ""}` : "허브 -";
  const agent = health ? `에이전트 ${health.provider ?? "없음"}${health.model ? ` · ${health.model}` : ""}` : "에이전트 -";
  return (
    <section aria-label="집 상태" className="absolute left-1/2 top-3 z-50 max-w-[calc(100%-1.5rem)] -translate-x-1/2">
      <Surface kind="pill" className="p-1">
        <div className="flex items-center gap-1 overflow-x-auto text-xs font-normal text-ink-2">
          <span role="status" aria-live="polite" className={cn(chip, "flex items-center gap-1.5 font-medium", connected ? "text-green" : "text-ink-2")}>
            <span aria-hidden="true" className={cn("size-2 rounded-full", connected ? "bg-green" : connected === false ? "bg-red" : "bg-ink-3")} />
            {conn}
          </span>
          <span className={chip}>{`집 ${health?.home?.name ?? "-"}`}</span>
          {mode && <span className={cn(chip, mode.className)}>{mode.text}</span>}
          <span className={chip}>{hub}</span>
          <span className={chip}>{agent}</span>
          {health && !health.twin && <span className={cn(chip, "text-red")}>3D 트윈 없음</span>}
          <a href="/setup/" className={cn(chip, "bg-field text-ink transition-colors hover:bg-hover-2")}>설정 다시 하기</a>
        </div>
      </Surface>
    </section>
  );
}
