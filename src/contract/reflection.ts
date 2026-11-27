// 하루 마치기·밤 반성 화면이 주고받는 것(src/server/finish-day.ts, src/brain/history/reflection-detail.ts, ui/src/dashboard/reflection.ts).

/** 시스템 날짜 상태. shift: 지금까지 넘긴 날 수, finish: 하루 마치기를 켰는가(FINISH_DAY=1), closing: 하루 마치기 중. */
export interface DayView { today: string; real_today: string; shift: number; finish: boolean; closing: boolean }
export interface FinishResult { ok: true; from: string; to: string; version: number; applies_day: string }
