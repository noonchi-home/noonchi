// 하루 마치기·밤 반성 화면이 주고받는 것(src/server/finish-day.ts, src/brain/history/reflection-detail.ts, ui/src/dashboard/reflection.ts).

/** 시스템 날짜 상태. shift: 지금까지 넘긴 날 수, finish: 하루 마치기를 켰는가(FINISH_DAY=1), closing: 하루 마치기 중. */
export interface DayView { today: string; real_today: string; shift: number; finish: boolean; closing: boolean }
export interface FinishResult { ok: true; from: string; to: string; version: number; applies_day: string }

/** 후보 발생 하나의 판정: followed 창(5분) 안에 그 일을 함, not_followed 안 함, answered_no 「그대로 둬요」 답, unseen 못 봄. 시각은 HH:MM:SS. */
export type MomentVerdict = "followed" | "not_followed" | "answered_no" | "unseen";
export interface CheckMoment { day: string; at: string; verdict: MomentVerdict; action_at: string | null; via: "person" | "answer" | null }

/** 반성 뒤 검사가 후보를 뺀 까닭(src/brain/history/habits.ts). */
export type DropReason = "habit" | "chance" | "too_few" | "coach" | "unchanged" | "settings";
/** FSM 그림 자료: 상태 id(기억 차례)와 화살표(출발·도착·행동, to "*"는 어느 상태로든). 사건·조건 글과 상태 설명은 싣지 않는다. */
export interface FsmGraphData { states: string[]; edges: { from: string; to: string; action: string | null }[] }
/** 채택 검사 하나(같은 출발 상태·도착·행동은 하나로 묶는다). rate·p_value는 저장된 검사 결과 그대로. */
export interface ReflectionCheck { state: string; to: string | null; action: string; n: number; k: number; unknown: number; rate: number; p_value: number; passed: boolean; moments: CheckMoment[] }
/** 반성 하나(GET /api/reflection/:day). graph: 그날 쓴 FSM(반성 전), after_graph: 반성이 저장한 새 판본(반성이 없거나 실패면 null).
 *  window_s·rate_min·alpha: 채택 검사 창(초)·따라온 비율 기준·우연일 확률 기준(src/brain/pam/adopt.ts). */
export interface ReflectionDetail {
  ok: true; day: string; state: "done" | "failed" | "none"; rejected: boolean; at_ms: number | null;
  before: { version: number } | null; after: { version: number; applies_day: string } | null;
  graph: FsmGraphData;
  after_graph: FsmGraphData | null;
  chunks: { start: string; end: string; state: string | null; room: string | null }[];
  did: { action: string; at: string; via: "person" | "answer" }[];
  candidates: { state: string; to: string | null; action: string }[];
  dropped: { from: string; to: string; action: string; reason: DropReason; seen: number | null; fired: number | null; p: number | null }[];
  checks: ReflectionCheck[];
  learned: { from: string; to: string; action: string; was: string | null; was_to: string | null }[];
  skipped_to: string | null; window_s: number; rate_min: number; alpha: number;
}
