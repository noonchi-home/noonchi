// 도움 기록(시나리오 2): 사람에게 가져다준 일을 끝까지 마치면 한 줄로 남긴다. 「20:02 · 책상에서 공부 중 · 물 한 잔 요청 · 전달 완료」.
// 대시보드 메시지 상자(SAY_DONE_MS 동안)와 기록 DB help 줄에 같은 글이 간다. 여러 날의 help 줄이 습관 찾기(src/brain/history/routines.ts)의 입력이다.
import type { WorldView } from "../contract/world.js";
import type { BusNode, Outbox } from "../bus/index.js";
import type { AssistanceOutcome } from "../contract/assistance-outcome.js";

export { assistanceOutcome } from "../contract/assistance-outcome.js";

export function publishAssistanceOutcome(act: BusNode | Outbox, outcome: AssistanceOutcome): void {
  if ("push" in act) act.push("/act/assistance_outcome", outcome);
  else act.post(async () => { await act.publish("/act/assistance_outcome", outcome); });
}
import type { HelpRecord, HelpVia } from "../contract/history.js";
import { STUDY_ACTIVITIES, WATER_ACTION } from "./tasks.js";

export type { HelpRecord, HelpVia } from "../contract/history.js";
export { STUDY_ACTIVITIES } from "./tasks.js";

/** 도움 기록에 쓰는 사용자 하던 일의 신선도(ms): 가져다주는 동안 본 것. */
export const ACTIVITY_MS = 5 * 60_000;

/** 기록하는 행동: 사람에게 무엇을 가져다주는 일. */
export const HELP_ACTIONS: readonly string[] = [WATER_ACTION];

const REQUEST_TEXT: Record<string, Record<HelpVia, string>> = {
  [WATER_ACTION]: { call: "물 한 잔 요청", speech: "물 한 잔 요청", habit: "습관 기반 도움" },
};
const RESULT_TEXT: Record<string, Record<HelpVia, string>> = {
  [WATER_ACTION]: { call: "전달 완료", speech: "전달 완료", habit: "물 전달 완료" },
};

/** 집 시간대의 HH:MM. */
export function clockText(atMs: number, offsetMinutes: number): string {
  const d = new Date(atMs + offsetMinutes * 60_000);
  return `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
}

/** 하던 일 글: 공부 묶음이면 「공부 중」, 아니면 없음. */
export function activityText(activity: string | null): string | null {
  return activity && STUDY_ACTIVITIES.includes(activity) ? "공부 중" : null;
}

/** 끝낸 도움 한 줄. place_label이 없으면 자리 없이, 하던 일을 모르면 하던 일 없이 쓴다. */
export function helpRecord(i: {
  atMs: number; askedMs: number; offsetMinutes: number; action: string; via: HelpVia; place: string | null; placeLabel: string | null; world: WorldView | null;
}): HelpRecord {
  const person = i.world?.person ?? null;
  // 놓을 때 폰이 책상을 비춰 사용자가 화면 밖일 수 있다: 최근(ACTIVITY_MS 안) 본 하던 일을 쓴다
  const seen = person?.facts.activity;
  const activity = seen && i.atMs - seen.at_ms <= ACTIVITY_MS ? seen.value : null;
  const doing = activityText(activity);
  const where = i.placeLabel ? `${i.placeLabel}에서${doing ? ` ${doing}` : ""}` : doing;
  const parts = [clockText(i.atMs, i.offsetMinutes), where, REQUEST_TEXT[i.action]?.[i.via] ?? i.action, RESULT_TEXT[i.action]?.[i.via] ?? "완료"].filter((p): p is string => !!p);
  return {
    at_ms: i.atMs, asked_ms: i.askedMs, action: i.action, via: i.via, place: i.place, place_label: i.placeLabel, activity, room: activity ? person?.room ?? null : null,
    result: "done", text: parts.join(" · "),
  };
}
