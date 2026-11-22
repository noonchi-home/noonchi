// 시연 2번(토요일 저녁 TV와 맥주)의 간추린 합성 기록(2026-11-22): 실제 AI 실험용. 기록 DB(HistoryDb)에 서버가 남기는 글과 같은 모양의 줄을 직접 쓴다. PAM·OpenAI를 부르지 않는다.
// 21일(월요일부터 3주). 날마다 저녁 창(18:59~20:32)만 있고 19시에 TV를 켜서 20시 30분에 끈다. 토요일에는 19시 2분 30초에 일어나 냉장고에서 맥주 캔을 꺼내 와 마시고(TV 켠 지 3분 안),
// TV를 끈 뒤 캔을 싱크대에 놓는다(사용자가 직접). 첫 두 토요일은 낮 14시~14시 30분에도 TV를 보지만 맥주는 마시지 않는다(시각 맥락이 붙게 하는 반례).
// 줄 모양: 사람 보임·사람 TV 보는 중·거실 TV 켜짐 · 카메라로 봄(src/world/labels.ts CHANGE_TEXT), VLM: 영어 한 문장(15초마다, 표현은 셋을 돌려 쓴다). 판단 기록(decision)에는 사람 상태(fsm.state)를 싣는다.
// 무작위가 없다: 같은 옵션이면 같은 기록이다. 이 파일은 가짜 AI 답(fakeBeerHandlers)도 함께 둔다(실제 AI를 부르기 전 시운전과 시험이 쓴다).
import type { HistoryDb } from "../src/brain/history/db.js";
import { candidateFsmOf } from "../src/brain/pam/adopt.js";
import { CUP_FSM_MEMORY } from "../src/brain/decision.js";
import type { CandidateFsm } from "../src/contract/pam.js";
import type { ChunkView, MarkView } from "../tests/helpers/pam.js";

export const TV_START_ON = "사용자가 돌아와 TV를 본다.";
export const TV_END_ON = "사용자가 TV 보기를 끝내고 다른 일로 넘어간다.";
export const TV_END_WHEN = "같이 마시는 중이었다.";
export const BEER = "맥주 가져다주기";
export const CAN = "맥주 캔 치우기";

const DAY_MS = 86_400_000;
export const addDays = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
const at = (day: string, hms: string) => Date.parse(`${day}T${hms}+09:00`);
const sec = (hms: string) => { const [h, m, s] = hms.split(":").map(Number); return h! * 3600 + m! * 60 + (s ?? 0); };
const hms = (s: number) => `${String(Math.floor(s / 3600)).padStart(2, "0")}:${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;

const SIT = ["A person sits on the sofa watching TV.", "A person is sitting on the couch looking at the TV screen.", "A person relaxes on the sofa in front of the TV."];
const SIT_BEER = ["A person sits on the sofa drinking from a beer can while watching TV.", "A person holds a beer can and watches TV on the couch.", "A person sips a beer on the sofa in front of the TV."];

export interface BeerRecordOptions {
  /** 첫 날(월요일이어야 토요일이 6일째마다 온다). */
  startDay?: string;
  /** 날 수(기본 21). */
  days?: number;
  /** 낮 TV(맥주 없음)를 더할 토요일 수(앞 토요일부터, 기본 2). */
  saturdayDaytime?: number;
  /** VLM 줄 간격(초, 기본 15). */
  vlmEverySec?: number;
}
export interface BeerRecordStats { days: string[]; saturdays: string[]; daytimeSaturdays: string[]; rowsByKind: Record<string, number>; linesByDay: Record<string, number> }

/** 날마다 한 번씩 부르는 쓰기 도우미: 줄 종류별 개수를 센다. */
function writer(db: HistoryDb, stats: BeerRecordStats) {
  let n = 0;
  return {
    add: (kind: "detection" | "world" | "device", day: string, time: string, text: string) => { db.add(kind, at(day, time), text); stats.rowsByKind[kind] = (stats.rowsByKind[kind] ?? 0) + 1; stats.linesByDay[day] = (stats.linesByDay[day] ?? 0) + 1; },
    vlm: (day: string, time: string, summary: string) => { db.add("world", at(day, time), `VLM: ${summary}`); stats.rowsByKind.world = (stats.rowsByKind.world ?? 0) + 1; stats.linesByDay[day] = (stats.linesByDay[day] ?? 0) + 1; },
    /** 판단 기록: 사람 상태. from·next_index는 화살표가 일어난 때만(그때 on·to가 그 화살표). */
    decide: (day: string, time: string, state: string, arrow?: { from: string; next: number; to: string; on: string }) => {
      db.add("decision", at(day, time), "대기", { subject: `pam-${++n}`, data: { fsm: { state, from: arrow?.from ?? null, next_index: arrow?.next ?? -1, to: arrow?.to ?? null, on: arrow?.on ?? null, when: null, action: null, learned: false } } });
      stats.rowsByKind.decision = (stats.rowsByKind.decision ?? 0) + 1;
    },
  };
}

/** TV를 보는 한 번(켜짐 → 끝). beer가 있으면 맥주 가져오기·마시기·캔 치우기가 들어간다. */
function session(w: ReturnType<typeof writer>, day: string, i: number, start: string, end: string, beer: boolean, every: number): void {
  const s = sec(start), e = sec(end);
  w.add("detection", day, hms(s - 20), "사람 보임");
  w.add("world", day, hms(s - 15), "사람 거실에 있음");
  w.decide(day, hms(s - 10), "away");
  w.add("device", day, hms(s), "거실 TV 켜짐");
  w.add("world", day, hms(s + 2), "거실 TV 켜짐 · 카메라로 봄");
  w.add("world", day, hms(s + 5), "사람 TV 보는 중");
  w.vlm(day, hms(s + 5), "A person sits on the sofa and turns on the TV.");
  w.decide(day, hms(s + 10), "watching_tv", { from: "away", next: 1, to: "watching_tv", on: TV_START_ON });
  const fetchFrom = s + 150, fetchTo = s + 210;   // 맥주: 켠 지 2분 30초~3분 30초
  for (let t = s + every; t < e; t += every) {
    if (beer && t >= fetchFrom && t < fetchTo) continue;
    const drinking = beer && t >= fetchTo;
    const pick = (drinking ? SIT_BEER : SIT)[(Math.floor(t / every) + i) % 3]!;
    w.vlm(day, hms(t), pick);
    if ((t - s) % 300 === 0) w.decide(day, hms(t + 1), "watching_tv");
  }
  if (beer) {
    w.vlm(day, hms(fetchFrom), "A person stands up from the sofa and walks to the refrigerator.");
    w.vlm(day, hms(fetchFrom + 20), "A person opens the refrigerator and takes out a beer can.");
    w.vlm(day, hms(fetchFrom + 45), "A person walks back to the sofa holding a beer can.");
  }
  w.add("device", day, hms(e), "거실 TV 꺼짐");
  w.add("world", day, hms(e + 2), "거실 TV 꺼짐 · 카메라로 봄");
  w.vlm(day, hms(e + 5), "A person turns off the TV and stands up from the sofa.");
  w.decide(day, hms(e + 10), "away", { from: "watching_tv", next: -1, to: "away", on: TV_END_ON });
  if (beer) {
    w.vlm(day, hms(e + 30), "A person carries the beer can to the kitchen sink.");
    w.vlm(day, hms(e + 60), "A person puts the beer can into the sink.");
    w.vlm(day, hms(e + 80), "A person walks out of the living room.");
  } else {
    w.vlm(day, hms(e + 30), "A person walks out of the living room.");
  }
  w.add("detection", day, hms(e + 120), "사람 안 보임");
}

/** 기록 DB에 21일(기본) 간추린 기록을 쓴다. 쓴 날과 줄 수를 돌려준다. */
export function beerRecords(db: HistoryDb, o: BeerRecordOptions = {}): BeerRecordStats {
  const start = o.startDay ?? "2026-10-12", days = o.days ?? 21, daytime = o.saturdayDaytime ?? 2, every = o.vlmEverySec ?? 15;
  if (new Date(`${start}T00:00:00Z`).getUTCDay() !== 1) throw new Error("startDay must be a Monday so that Saturdays fall on days 6, 13, 20, ...");
  const stats: BeerRecordStats = { days: [], saturdays: [], daytimeSaturdays: [], rowsByKind: {}, linesByDay: {} };
  const w = writer(db, stats);
  for (let i = 0; i < days; i++) {
    const day = addDays(start, i);
    const saturday = i % 7 === 5;
    stats.days.push(day);
    if (saturday) stats.saturdays.push(day);
    if (saturday && stats.daytimeSaturdays.length < daytime) { stats.daytimeSaturdays.push(day); session(w, day, i, "14:00:00", "14:30:00", false, every); }
    session(w, day, i, "19:00:00", "20:30:00", saturday, every);
  }
  return stats;
}

// ── 가짜 AI 답(실제 AI를 부르기 전 시운전과 시험용) ─────────────────────────────────────────────────────────────

/** 후보 FSM: «TV 보기 시작 → 맥주 가져다주기»(자리에 없음)와 «TV 보기 끝 → 맥주 캔 치우기»(TV 보는 중). 행동 없는 같은 사건 화살표는 next에서 뺀다(로봇 FSM은 seed에서 다시 가져온다). */
export const BEER_CANDIDATES: CandidateFsm = (() => {
  const c = candidateFsmOf(CUP_FSM_MEMORY);
  const away = c.states.find((s) => s.id === "away")!;
  away.next = away.next.filter((e) => e.on !== TV_START_ON);
  away.rules.push({ to: "watching_tv", action: BEER, candidates: [{ on: TV_START_ON }] });
  c.states.find((s) => s.id === "watching_tv")!.rules.push({ to: "*", action: CAN, candidates: [{ on: TV_END_ON, when: TV_END_WHEN }] });
  return c;
})();

const timesOf = (lines: string[], text: string) => lines.filter((l) => l.includes(text)).map((l) => l.substring(0, 8));
/** 덩어리: 줄마다 한 덩어리(가짜). */
export const fakeChunk = (v: ChunkView) => ({ chunks: v.lines.map((l) => ({ start: l.substring(0, 8), end: l.substring(0, 8), text: l.substring(11) })) });
/** 시각 찾기(가짜): TV 보기 시작 = 「사람 TV 보는 중」 줄, TV 보기 끝 = 「거실 TV 꺼짐 · 카메라로 봄」 줄, 행동 = 사용자가 맥주를 꺼내는 줄·캔을 싱크대에 놓는 줄. 안 보인 구간 없음. */
export const fakeMark = (v: MarkView) => ({
  candidates: v.candidates.map(([state, candidate]) => ({ state, candidate, times: candidate.includes("TV를 본다") ? timesOf(v.lines, "사람 TV 보는 중") : candidate.includes("TV 보기를 끝내고") ? timesOf(v.lines, "거실 TV 꺼짐 · 카메라로 봄") : [] })),
  actions: v.actions.map((action) => ({ action, times: action === BEER ? timesOf(v.lines, "takes out a beer can") : action === CAN ? timesOf(v.lines, "puts the beer can into the sink") : [] })),
  unseen: [] as { start: string; end: string }[],
});
