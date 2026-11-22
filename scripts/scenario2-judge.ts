// 시나리오 2(침실 1 책상) 판정: 합성 재생 기록(tests/helpers/scenario2-replay.ts S2Event)이 정한 차례를 지켰는가.
// 부른 날: 부름 → 책상으로 가기 → 「무엇을 도와드릴까요?」 → 답 → 물 한 잔 가져다주기(답으로 시작) → 냉장고 → 물병 → 싱크대 → 따르기 → 컵 → 책상 → 놓기 → 도움 기록(부탁) → 대기 자리로.
// 습관 날: 부르지 않음 → 습관 시각 방문(까닭 글) → 관찰 자리로 가기 → PAM이 배운 화살표로 물 한 잔 → 같은 전달 → 도움 기록(습관) → 대기 자리로. 묻거나 부르지 않는다.
export type S2Kind = "call" | "habit_visit" | "visit_go" | "go" | "ask" | "answer" | "water" | "pick" | "do" | "place" | "done" | "record" | "return" | "photo";
export interface S2Event { kind: S2Kind; at: number; text?: string; target?: string; via?: string; learned?: boolean }

const DESK = "desk_small_ce7e768b", FRIDGE = "fridge_bbc363a3", SINK = "sink_counter_kitchen";
type Want = { kind: S2Kind; ok?: (e: S2Event) => boolean; name: string };
const go = (target: string): Want => ({ kind: "go", ok: (e) => e.target === target, name: `go:${target}` });
const DELIVERY: Want[] = [
  go(FRIDGE), { kind: "pick", ok: (e) => /물병/.test(e.target ?? ""), name: "pick:물병" }, go(SINK), { kind: "do", name: "do:따르기" },
  { kind: "pick", ok: (e) => /컵/.test(e.target ?? ""), name: "pick:컵" }, go(DESK), { kind: "place", ok: (e) => e.target === DESK, name: "place:책상" },
];
export const CALL_DAY: Want[] = [
  { kind: "call", name: "call" }, go(DESK), { kind: "ask", ok: (e) => e.text === "무엇을 도와드릴까요?", name: "ask" }, { kind: "answer", name: "answer" },
  { kind: "water", ok: (e) => e.via === "answer", name: "water:answer" }, ...DELIVERY,
  { kind: "record", ok: (e) => e.via === "call" && /^\d\d:\d\d · 책상에서 공부 중 · 물 한 잔 요청 · 전달 완료$/.test(e.text ?? ""), name: "record:call" },
  { kind: "return", ok: (e) => e.target === "desk_watch", name: "return:desk_watch" },
];
export const HABIT_DAY: Want[] = [
  { kind: "habit_visit", ok: (e) => e.text === "평소 물을 찾는 시간이에요. 책상을 확인할게요.", name: "habit_visit" },
  { kind: "visit_go", ok: (e) => e.target === "desk_watch", name: "visit:desk_watch" },
  { kind: "water", ok: (e) => e.via === "pam" && e.learned === true, name: "water:pam-learned" }, ...DELIVERY,
  { kind: "record", ok: (e) => e.via === "habit" && / · 책상에서 공부 중 · 습관 기반 도움 · 물 전달 완료$/.test(e.text ?? ""), name: "record:habit" },
  { kind: "return", ok: (e) => e.target === "desk_watch", name: "return:desk_watch" },
];
/** 차례대로 찾고(사이의 사진·끝남은 건너뜀), 빠진 첫 단계나 나오면 안 되는 일(습관 날의 부름·질문)을 돌려준다. */
export function judgeScenario2(events: readonly S2Event[], want: readonly Want[], forbid: readonly S2Kind[] = []): { passed: boolean; firstMismatch: string | null } {
  const bad = events.find((e) => forbid.includes(e.kind));
  if (bad) return { passed: false, firstMismatch: `unexpected:${bad.kind}` };
  let i = 0;
  for (const w of want) {
    const j = events.findIndex((e, k) => k >= i && e.kind === w.kind && (!w.ok || w.ok(e)));
    if (j < 0) return { passed: false, firstMismatch: `missing:${w.name}` };
    i = j + 1;
  }
  return { passed: true, firstMismatch: null };
}
