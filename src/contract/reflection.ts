// 하루 마치기·밤 반성 화면이 주고받는 것(src/server/finish-day.ts, src/brain/history/reflection-detail.ts, ui/src/dashboard/reflection.ts).

/** 시스템 날짜 상태. shift: 지금까지 넘긴 날 수, finish: 하루 마치기를 켰는가(FINISH_DAY=1), closing: 하루 마치기 중. */
export interface DayView { today: string; real_today: string; shift: number; finish: boolean; closing: boolean }
export interface FinishResult { ok: true; from: string; to: string; version: number; applies_day: string }

/** 후보 발생 하나의 판정: followed 창(5분) 안에 그 일을 함, not_followed 안 함, answered_no 「그대로 둬요」 답, unseen 못 봄. 시각은 HH:MM:SS. */
export type MomentVerdict = "followed" | "not_followed" | "answered_no" | "unseen";
export interface CheckMoment { day: string; at: string; verdict: MomentVerdict; action_at: string | null; via: "person" | "answer" | null }
