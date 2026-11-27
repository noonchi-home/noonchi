// 배운 도움 습관의 시각 계기(시나리오 2): 습관 시각(가운데 −5분 ~ +폭)이 되면 부르지 않아도 그 자리를 보는 관찰 자리로 확인하러 간다(하루 한 번).
// 가서 본 관찰(공부 중·마실 물 없음)로 판단(PAM)이 배운 화살표의 행동을 고른다. 방문은 사용자 찾기(RoomWatch)와 같은 /goal/intent offer다.
// 그날은 도착 결과(/act/directive_result arrived)가 와야 마친다. 취소·실패·거둠·기한 넘김이면 습관 창 안에서 RETRY_GAP_MS 뒤 다시 간다.
import type { DirectiveResult, GoalIntent } from "../contract/machines.js";
import type { StationMap } from "../contract/stations.js";
import { WATER_ACTION } from "../act/tasks.js";
import { minuteOfDay, type HelpRoutine } from "../brain/index.js";
import { josa } from "../shared/korean.js";

/** 가운데 시각보다 이만큼(분) 먼저부터 확인하러 간다. */
export const HABIT_LEAD_MIN = 5;
/** 방문 기한(ms). */
const VISIT_MS = 60_000;
/** 방문이 끝나지 못한 뒤 다시 보내기까지(ms). 폰이 다른 일 중이면 그 일이 끝날 틈을 준다. */
export const HABIT_RETRY_GAP_MS = 30_000;
/** 행동 → 「평소 <무엇>을 찾는 시간이에요」의 무엇. */
const WANT: Record<string, string> = { [WATER_ACTION]: "물" };

/** 습관으로 확인하러 갈 때 생각 말풍선 글. */
export const habitNote = (r: Pick<HelpRoutine, "action" | "place_label">): string =>
  `평소 ${josa(WANT[r.action] ?? r.action, "을/를")} 찾는 시간이에요. ${josa(r.place_label, "을/를")} 확인할게요.`;

export class HabitWatch {
  private serial = 0;
  /** 도착해서 마친 날·습관. */
  private done = new Set<string>();
  /** 보낸 방문(결과를 기다림). */
  private pending: { id: string; key: string; until: number } | null = null;
  /** 끝나지 못한 방문 뒤 다시 보낼 수 있는 때. */
  private retryAt = new Map<string, number>();
  constructor(private readonly send: (i: GoalIntent) => void) {}

  private missed(at: number) {
    const job = this.pending;
    if (!job) return;
    this.pending = null;
    this.retryAt.set(job.key, at + HABIT_RETRY_GAP_MS);
  }

  /** 방문 결과: 도착이면 그날을 마치고, 아니면 잠시 뒤 다시 간다. */
  result(r: DirectiveResult) {
    const job = this.pending;
    if (!job || r.id !== job.id) return;
    if (r.outcome === "arrived") { this.done.add(job.key); this.pending = null; return; }
    this.missed(r.at_ms);
  }

  /** 관리자가 방문을 거뒀다(다른 일·중단). */
  revoked(id: string, now: number) {
    if (this.pending?.id === id) this.missed(now);
  }

  /** dayOf: ms → 시스템 날짜(하루 한 번의 「하루」, 하루 마치기로 넘긴 날도 센다). 250ms마다 기록 DB를 읽지 않게 시각 창 안 습관이 있을 때만 묻는다. */
  tick(i: { now: number; rev: number; map: StationMap | null; routines: readonly HelpRoutine[]; offsetMinutes: number; busy: boolean; dayOf: (ms: number) => string }) {
    if (this.pending && i.now >= this.pending.until) this.missed(this.pending.until);
    if (!i.map || i.busy || this.pending) return;
    const minute = minuteOfDay(i.now, i.offsetMinutes);
    let day: string | null = null;
    for (const r of i.routines) {
      if (minute < r.center_min - HABIT_LEAD_MIN || minute > r.center_min + r.window_min) continue;
      const key = JSON.stringify([(day ??= i.dayOf(i.now)), r.action, r.place]);
      if (this.done.has(key)) continue;
      if (i.now < (this.retryAt.get(key) ?? -Infinity)) continue;
      const station = i.map.stations.find((s) => s.roles.includes("observe") && s.surfaces.includes(r.place));
      if (!station) continue;
      const id = `habit:${++this.serial}`;
      this.pending = { id, key, until: i.now + VISIT_MS };
      this.send({ op: "offer", kind: "visit", id, rev: i.rev, goal_id: null, target_id: station.id, until_ms: i.now + VISIT_MS, note: habitNote(r) });
      return;
    }
  }
}
