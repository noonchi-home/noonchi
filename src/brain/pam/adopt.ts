// 반성 후보의 채택 검사(석준 님 ai 저장소 pam/trigger_check.py, origin/main 48d56a1 그대로). 모델을 부르지 않는다.
//   채택(c → a) ⇔ k/n ≥ 0.75 이고 Σ_{i=k..n} C(n,i) p0^i (1-p0)^(n-i) < 0.01,  p0 = max(다른 때 비율, 0.01)
// 하루마다: 후보 c가 그 출발 상태에서 일어난 때, 행동 a를 한 때, 사람이 안 보인 구간(로봇이 그 행동을 한 구간도 더한다). 시각은 자정부터 초.
// 후보 뒤 검사 창(기본 5분, 같은 후보가 다시 나오면 거기까지) 안에 행동이 오면 따라온 것이고 행동 앞 마지막 후보만 공로를 받는다. 창이 안 보인 구간에 걸리고
// 행동이 없으면 못 봄이다. 그 행동을 물은 질문의 답(answered, 이 저장소가 더한 칸)이 창 안에 있으면 안 보였어도 본 것이다(행동이 없으면 따라오지 않은 것).
// 다른 때 비율은 후보 창에 닿지 않고 안 보인 구간과 겹치지 않는 창 길이 칸 가운데 행동이 든 칸의 몫이다.
// 로봇 FSM 만들기(adoptedFsm)는 석준 님 predictor_fsm을 사람 상태 FSM 화살표로 옮긴 것이다: 통과 후보마다 화살표 하나(PAM 답이 화살표 번호로 가리킨다).
import type { Candidate, CandidateFsm, Ctx } from "../../contract/pam.js";
import { ctxKey, ctxMatches, dowOfDay, slotOf, DOW_COUNT, SLOT_COUNT } from "../ctx.js";
import { ASK_ACTION, LEARNED_ACTIONS } from "../../act/tasks.js";
import { edgeLearned, validateMemory, type FsmEdge, type FsmMemory, type FsmState } from "../decision.js";

/** 기본 검사 창(초). 다른 때 칸도 창 길이다. */
export const FOLLOW_SECONDS = 300;
/** 따라온 비율 하한(석준 님 2026-11-18 전에는 0.8). */
export const RATE_MIN = 0.75;
/** 우연일 확률 상한(석준 님 원래 0.001, 2026-11-22 사용자 결정으로 0.01). */
export const ALPHA = 0.01;
export const FLOOR = 0.01;

/** 하루치 검사 입력(자정부터 초). unseen에는 사람이 안 보인 구간과 로봇이 그 행동을 한 구간이 함께 든다. answered는 그 행동을 물은 질문에 답한 때(이 계획이 더한 칸). */
export interface CheckDay { start: number; end: number; candidate: number[]; action: number[]; unseen: [number, number][]; answered?: number[] }
export interface CheckResult { n: number; k: number; unknown: number; rate: number; base_rate: number; p0: number; p_value: number; passed: boolean }

const comb = (n: number, k: number) => { let r = 1; for (let i = 1; i <= k; i++) r = (r * (n - k + i)) / i; return r; };
/** P(X ≥ k), X ~ Binomial(n, p). */
export const binomialTail = (k: number, n: number, p: number): number => { let s = 0; for (let i = k; i <= n; i++) s += comb(n, i) * p ** i * (1 - p) ** (n - i); return s; };

/** 후보가 일어난 때마다 하나인 기회: 몇째 날, 언제(자정부터 초), 따라옴·안 따라옴·못 봄. */
interface Opportunity { day: number; at: number; outcome: "followed" | "missed" | "unknown" }

/** 하루들을 기회 목록과 다른 때 칸 수(행동이 든 칸 수)로 나눈다. 맥락 없는 검사와 맥락 탐색이 함께 쓴다. */
function scan(days: readonly CheckDay[], window: number): { opps: Opportunity[]; other: number; withAction: number } {
  if (!Number.isInteger(window) || window < 1) throw new Error("The check window must be a positive whole number of seconds.");
  const opps: Opportunity[] = [];
  let other = 0, withAction = 0;
  days.forEach((d, day) => {
    const ordered = [...d.candidate].sort((a, b) => a - b);
    ordered.forEach((moment, i) => {
      // 반열린 창 [low, high): 후보 뒤 창, 같은 후보가 다시 나오면 거기까지. 행동 앞 마지막 후보만 공로를 받는다
      const low = moment + 1;
      let high = moment + window + 1;
      const repeat = ordered.slice(i + 1).find((later) => later > moment);
      if (repeat !== undefined && repeat < high) high = repeat;
      let outcome: Opportunity["outcome"];
      if (d.action.some((a) => low <= a && a < high)) outcome = "followed";
      // 「그대로 둬요」 답: 사람이 떠나 안 보였어도 본 것이고 따라오지 않은 것(Codex b115d69 P2: 빠뜨리면 거절이 쌓여도 채택이 유지됐다)
      else if ((d.answered ?? []).some((a) => low <= a && a < high)) outcome = "missed";
      else if (d.unseen.some(([s, e]) => s < high && e > low)) outcome = "unknown";
      else outcome = "missed";
      opps.push({ day, at: moment, outcome });
    });
    for (let slot = d.start; slot < d.end; slot += window) {
      const slotEnd = slot + window;
      if (d.candidate.some((m) => slot <= m + window && slotEnd > m)) continue;
      if (d.unseen.some(([s, e]) => s < slotEnd && e > slot)) continue;
      other++;
      if (d.action.some((a) => slot <= a && a < slotEnd)) withAction++;
    }
  });
  return { opps, other, withAction };
}

/** 기회들을 센다: n(본 것), k(따라온 것), 못 본 것. */
function tally(opps: readonly Opportunity[]): { n: number; k: number; unknown: number } {
  let n = 0, k = 0, unknown = 0;
  for (const o of opps) {
    if (o.outcome === "unknown") unknown++;
    else { n++; if (o.outcome === "followed") k++; }
  }
  return { n, k, unknown };
}

/** 지난 날을 모두 모아 n·k·다른 때 비율을 세고 두 검사를 한다. window는 검사 창(초). */
export function checkCandidate(days: CheckDay[], window = FOLLOW_SECONDS): CheckResult {
  const { opps, other, withAction } = scan(days, window);
  const { n, k, unknown } = tally(opps);
  const base = other ? withAction / other : 0;
  const p0 = Math.max(base, FLOOR);
  const rate = n ? k / n : 0;
  const p = n ? binomialTail(k, n, p0) : 1;
  return { n, k, unknown, rate, base_rate: base, p0, p_value: p, passed: n > 0 && rate >= RATE_MIN && p < ALPHA };
}

/** 날짜가 붙은 하루치 검사 입력(맥락 탐색용). date는 YYYY-MM-DD이고 요일을 구하는 데 쓴다. */
export interface CtxDay extends CheckDay { date: string }
/** 규칙 하나의 검사 결과. ctx가 null이면 맥락 없는 규칙이다. 맥락 규칙에서 base_rate는 «맥락 없을 때의 비율»(남은 기회 전체의 따라온 비율)이다. */
export interface RuleCheck extends CheckResult { ctx: Ctx | null }

const SINGLE_CTXS: Ctx[] = [
  ...Array.from({ length: DOW_COUNT }, (_, dow): Ctx => ({ dow })),
  ...Array.from({ length: SLOT_COUNT }, (_, slot): Ctx => ({ slot })),
];
const PAIR_CTXS: Ctx[] = Array.from({ length: DOW_COUNT * SLOT_COUNT }, (_, i): Ctx => ({ dow: Math.floor(i / SLOT_COUNT), slot: i % SLOT_COUNT }));

/** 맥락 탐색(2026-11-22 사용자 결정): 맥락 없음 → 하나(요일 또는 시각 칸) → 둘(요일 + 시각 칸). 앞 단계가 통과하면 거기서 멈춘다.
 *  첫 줄은 늘 맥락 없는 검사 결과다(통과하면 그것뿐이다). 통과하지 못하면 맥락 규칙을 찾는다: 남은 기회에서 통과한 것 가운데 맞힌 횟수가 가장 많은 것
 *  (같으면 비율이 높은 것, 그다음 우연일 확률이 낮은 것, 그다음 요일·시각 칸 번호가 앞선 것)을 고르고, 그 규칙이 다룬 기회를 뺀 남은 기회로 다시 찾는다.
 *  맥락 규칙의 통과 기준은 비율 RATE_MIN 이상이고 우연일 확률이 ALPHA 미만이다. 평소 비율은 남은 기회 전체의 따라온 비율(바닥값 FLOOR)이다. */
export function findRules(days: CtxDay[], window = FOLLOW_SECONDS): RuleCheck[] {
  const first: RuleCheck = { ...checkCandidate(days, window), ctx: null };
  if (first.passed) return [first];
  const { opps } = scan(days, window);
  const dows = days.map((d) => dowOfDay(d.date));
  const inside = (o: Opportunity, c: Ctx) => ctxMatches(c, dows[o.day]!, slotOf(o.at));
  const out: RuleCheck[] = [first];
  let remaining = opps;
  for (;;) {
    const all = tally(remaining);
    const base = all.n ? all.k / all.n : 0;
    const p0 = Math.max(base, FLOOR);
    let best: RuleCheck | null = null;
    for (const stage of [SINGLE_CTXS, PAIR_CTXS]) {
      for (const ctx of stage) {
        const { n, k, unknown } = tally(remaining.filter((o) => inside(o, ctx)));
        if (!n) continue;
        const rate = k / n;
        const p = binomialTail(k, n, p0);
        if (rate < RATE_MIN || !(p < ALPHA)) continue;
        const cand: RuleCheck = { n, k, unknown, rate, base_rate: base, p0, p_value: p, passed: true, ctx };
        if (best === null || k > best.k || (k === best.k && (rate > best.rate || (rate === best.rate && p < best.p_value)))) best = cand;
      }
      if (best) break;   // 하나 단계에서 통과가 있으면 둘 단계는 시험하지 않는다
    }
    if (!best) break;
    out.push(best);
    remaining = remaining.filter((o) => !inside(o, best!.ctx!));
  }
  return out;
}

/** 검사 결과가 묶이는 열쇠: (출발 상태, 행동, 사건, 조건). 상태 id·후보 글은 반성이 바꾸지 않는다. */
export const adoptKey = (state: string, action: string, c: Candidate) => JSON.stringify([state, action, c.on, c.when ?? null]);
const trig = (on: string, when?: string | null) => JSON.stringify([on, when ?? null]);

/** 로봇 FSM: seed 상태는 seed 화살표 차례 그대로(사용자가 정한 습관은 늘), 통과한 배우는 행동 후보가 같은 트리거의 묻기(또는 행동 없는) 화살표를
 *  그 자리에서 바꾸고, 새 트리거면 끝에 더한다. 사용자가 정한 습관 자리와 트리거가 같은 후보·배우는 행동이 아닌 후보는 넣지 않는다. 후보 FSM은 바꾸지 않는다.
 *  ctxs: 통과한 후보(adoptKey)마다 맥락 목록(findRules). 있으면 맥락 없는 화살표를 바꾸지 않고(다른 때는 그대로 묻는다) 맥락마다 맥락 있는 행동 화살표를 끝에 더한다. */
export function adoptedFsm(c: CandidateFsm, passed: ReadonlySet<string>, seed: FsmMemory, ctxs?: ReadonlyMap<string, readonly Ctx[]>): FsmMemory {
  const states: FsmState[] = c.states.map((s) => {
    const own = seed.states.find((x) => x.id === s.id);
    const next: FsmEdge[] = own ? own.next.map((e) => ({ ...e })) : [];
    for (const e of s.next) if (!next.some((x) => trig(x.on, x.when) === trig(e.on))) next.push({ to: e.to, on: e.on });
    for (const r of s.rules) {
      if (!LEARNED_ACTIONS.includes(r.action)) continue;
      for (const cand of r.candidates) {
        const key = adoptKey(s.id, r.action, cand);
        if (!passed.has(key)) continue;
        const edge: FsmEdge = { to: r.to, on: cand.on, ...(cand.when ? { when: cand.when } : {}), action: r.action };
        const contexts = ctxs?.get(key) ?? [];
        if (contexts.length) {
          const at = next.findIndex((x) => trig(x.on, x.when) === trig(cand.on, cand.when) && !x.ctx);
          if (at !== -1 && next[at]!.action && next[at]!.action !== ASK_ACTION) continue;   // 사용자가 정한 습관 자리와 같은 트리거
          for (const ctx of contexts) if (!next.some((x) => x.ctx && x.action === r.action && trig(x.on, x.when) === trig(cand.on, cand.when) && ctxKey(x.ctx) === ctxKey(ctx))) next.push({ ...edge, ctx });
          continue;
        }
        const at = next.findIndex((x) => trig(x.on, x.when) === trig(cand.on, cand.when) && !x.ctx);
        if (at === -1) next.push(edge);
        else if (!next[at]!.action || next[at]!.action === ASK_ACTION) next[at] = edge;
      }
    }
    // seed 상태의 하는 일 값은 seed 것(Codex b115d69 P2: 후보 값을 쓰면 정한 습관이 붙는 대상이 바뀐다). 설명만 후보 것
    return { id: s.id, description: s.description, activity: [...(own ?? s).activity], next };
  });
  // seed 상태는 후보 FSM에 늘 같은 id로 있다(validateCandidateFsm이 막는다)
  return validateMemory({ initial_state: c.initial_state, states }, "fsm") as FsmMemory;
}

/** 로봇 FSM → 후보 FSM 모양: 행동 없는 화살표는 next로, seed가 아닌 행동 화살표는 후보 하나짜리 rules로(같은 상태·도착·행동이면 한 규칙에 모은다).
 *  그날 후보 판본이 아직 없을 때 반성 요청의 후보 FSM이다. */
export function candidateFsmOf(m: FsmMemory): CandidateFsm {
  return {
    initial_state: m.initial_state,
    states: m.states.map((s) => {
      const rules: CandidateFsm["states"][number]["rules"] = [];
      for (const e of s.next) {
        if (!e.action || !edgeLearned(s.id, e)) continue;
        const cand: Candidate = { on: e.on, ...(e.when ? { when: e.when } : {}) };
        const same = rules.find((r) => r.to === e.to && r.action === e.action);
        // 맥락만 다른 화살표(토요일·일요일)는 후보로는 같은 트리거이므로 한 번만 넣는다(후보는 서로 달라야 한다)
        if (same) { if (!same.candidates.some((x) => x.on === cand.on && (x.when ?? null) === (cand.when ?? null))) same.candidates.push(cand); }
        else rules.push({ to: e.to, action: e.action, candidates: [cand] });
      }
      return { id: s.id, description: s.description, activity: [...s.activity], next: s.next.filter((e) => !e.action).map(({ to, on }) => ({ to, on })), rules };
    }),
  };
}
