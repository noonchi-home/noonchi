// 에이전트 계획 모드: PAM이 고른 행동 하나 → 단계 계획(AgentPlan). 말 요청 에이전트(src/agent/agent.ts)와 같은 공급자(createProvider)를 쓴다.
// 모델은 submit_plan 한 번으로 계획 전체를 낸다(호출 하나가 약 2초라 단계마다 부르면 계획에 10초 넘게 걸렸다). 검사를 통과하면 그 자리에서 끝,
// 틀리면 틀린 단계마다 번호와 까닭을 돌려주고 고친 전체를 다시 받는다(최대 maxRounds 차례, 답 글만 낸 차례도 센다).
// 차례마다(모델 호출 하나) 걸린 시간·토큰·모델이 낸 단계·계획 검사가 버린 까닭을 onRound로 낸다(서버가 로그와 기록 DB planner 줄에 남긴다).
// 시간 한도(timeoutMs)를 넘거나 새 계획이 오면 공급자 요청을 취소 신호로 끊는다(계획은 한 번에 하나).
// 시험은 같은 OpenAI 공급자를 OPENAI_BASE_URL의 가짜 서버에 붙인다(tests/helpers/planner.ts). 규칙으로 계획을 만드는 길은 없다.
import { planIdOf } from "../act/tasks.js";
import { describeError, type LlmProvider, type StepUsage, type ToolCallResult } from "./agent.js";
import { PLANNER_PROMPT, planInput } from "./planInput.js";
import { PlanDraft, RESUBMIT_HINT, SUBMIT_PLAN, planTools, withStand, type PlanContext, type PlanResult } from "./planTools.js";

/** 계획 모드 한 차례(모델 호출 하나)의 기록(2026-11-18 tall e1: 미리 만들기가 「모델 차례 3번 안에 맞는 계획을 내지 못함」만 남겨 차례마다 무엇을 버렸는지 몰랐다).
 *  plan 계획 id, n 몇 번째 차례(rounds 차례 상한 안), ms 그 호출 시간, usage 토큰(공급자가 알려 줄 때), steps 모델이 낸 submit_plan steps 그대로(답 글만 냈으면 null),
 *  error 계획 검사가 버린 까닭(틀린 단계마다 번호와 까닭, 통과면 null), last 이 차례로 계획 호출이 끝났는지(통과, 또는 마지막 차례). */
export interface PlanRound { plan: string; task: string; n: number; rounds: number; ms: number; usage: StepUsage | null; steps: unknown; error: string | null; last: boolean }

/** 답 글만 낸 차례의 까닭. */
const NO_CALL = `${SUBMIT_PLAN} 없이 답 글만 냄`;

const seconds = (ms: number) => `${(ms / 1000).toFixed(1)}초`;
const verdictOf = (r: PlanRound) => (r.error === null ? "통과" : `버림 · ${r.error}${r.last ? " · 못 냄" : ""}`);

/** 기록 DB planner 줄 글: 「계획 모드 1/3차례 2.4초 · 버림 · 2번 단계: …」(마지막 차례까지 틀리면 「· 못 냄」), 통과면 「· 통과」. */
export function planRoundText(r: PlanRound): string {
  return `계획 모드 ${r.n}/${r.rounds}차례 ${seconds(r.ms)} · ${verdictOf(r)}`;
}

/** 서버 로그 줄: 계획 id·할 일·차례·시간·토큰(입력·캐시·출력·생각)·버린 까닭, 모델이 낸 단계(종류·동작·대상·물건·이름)와 틀린 단계의 JSON 그대로. */
export function planRoundLine(r: PlanRound): string {
  const u = r.usage;
  const tokens = u ? `토큰 입력 ${u.input}(캐시 ${u.cached})·출력 ${u.output}${u.reasoning !== undefined ? `(생각 ${u.reasoning})` : ""}` : "토큰 모름";
  const steps = Array.isArray(r.steps) ? (r.steps as Record<string, unknown>[]) : null;
  const brief = (s: Record<string, unknown>) => [s.kind, s.act, s.target, s.object, s.item].filter((x) => typeof x === "string" && x).join(" ");
  const wrong = [...new Set([...(r.error ?? "").matchAll(/(\d+)번 단계:/g)].map((m) => Number(m[1])))];
  return [
    `[계획 모드] ${r.plan} ${r.task} ${r.n}/${r.rounds}차례 ${seconds(r.ms)}`, tokens, verdictOf(r),
    ...(steps ? [`낸 단계: ${steps.map((s) => (s && typeof s === "object" ? brief(s) : JSON.stringify(s))).join(" / ")}`] : []),
    ...(steps ? wrong.flatMap((n) => (steps[n - 1] !== undefined ? [`틀린 단계 ${n}: ${JSON.stringify(steps[n - 1])}`] : [])) : []),
  ].join(" · ");
}

export interface PlannerOptions {
  provider: LlmProvider;
  /** 모델 차례 상한(제출·고친 제출·답 글만 낸 차례). */
  maxRounds?: number;
  /** 계획 하나의 시간 한도(ms). */
  timeoutMs?: number;
  /** 응답 하나의 출력 토큰 상한. */
  maxOutputTokens?: number;
  /** 차례마다 부른다(모델 호출이 돌아온 차례만. 끊긴 호출은 없다). */
  onRound?: (r: PlanRound) => void;
}

/** 기본값: 모델 차례 3번, 계획 하나 45초, 응답 하나 출력 4000토큰. */
export const PLANNER_DEFAULTS = { maxRounds: 3, timeoutMs: 45_000, maxOutputTokens: 6000 } as const;

const NUDGE = "답 글 대신 submit_plan으로 계획 전체를 내세요.";

export class Planner {
  private current: AbortController | null = null;
  private readonly cfg: { maxRounds: number; timeoutMs: number; maxOutputTokens: number };

  constructor(private readonly o: PlannerOptions) {
    this.cfg = {
      maxRounds: o.maxRounds ?? PLANNER_DEFAULTS.maxRounds, timeoutMs: o.timeoutMs ?? PLANNER_DEFAULTS.timeoutMs,
      maxOutputTokens: o.maxOutputTokens ?? PLANNER_DEFAULTS.maxOutputTokens,
    };
  }

  /** 계획 하나를 만든다. 앞 계획 호출이 아직 끝나지 않았으면 끊는다. signal이 끊기면(새 판단·「그만」) 이 호출도 끊는다. */
  async plan(ctx: PlanContext, signal?: AbortSignal): Promise<PlanResult> {
    this.current?.abort();
    const ac = new AbortController();
    this.current = ac;
    if (signal?.aborted) ac.abort();
    signal?.addEventListener("abort", () => ac.abort(), { once: true });
    const timer = setTimeout(() => ac.abort(), this.cfg.timeoutMs);
    timer.unref?.();
    try {
      return await this.loop(withStand(ctx), ac.signal);
    } catch (e) {
      return { ok: false, error: ac.signal.aborted ? "시간 안에 계획을 끝내지 못했거나 새 계획으로 바뀜" : `에이전트(LLM) 호출 실패: ${describeError(e)}` };
    } finally {
      clearTimeout(timer);
      if (this.current === ac) this.current = null;
    }
  }

  /** 지금 만드는 계획을 끊는다(집을 닫을 때). */
  abort(): void {
    this.current?.abort();
  }

  private async loop(ctx: PlanContext, signal: AbortSignal): Promise<PlanResult> {
    const { provider } = this.o;
    const draft = new PlanDraft(ctx);
    const tools = planTools(draft);
    const state = provider.createState();
    provider.addUserMessage(state, planInput(ctx));
    const rounds = this.cfg.maxRounds;
    const note = (n: number, ms: number, usage: StepUsage | undefined, steps: unknown, error: string | null) =>
      this.o.onRound?.({ plan: planIdOf(ctx.decision.id), task: ctx.task.name, n, rounds, ms, usage: usage ?? null, steps, error, last: error === null || n === rounds });
    for (let round = 0; round < rounds; round++) {
      signal.throwIfAborted();
      const started = Date.now();
      const r = await provider.step(state, { system: PLANNER_PROMPT, tools, allowTools: true, forceTool: SUBMIT_PLAN, signal, maxOutputTokens: this.cfg.maxOutputTokens });
      const ms = Date.now() - started;
      if (r.calls.length === 0) {
        note(round + 1, ms, r.usage, null, NO_CALL);
        signal.throwIfAborted();
        provider.addUserMessage(state, NUDGE);
        continue;
      }
      // 모양 검사(도구 인자 스키마)를 거치지 않고 submit이 단계마다 번호를 붙여 까닭을 낸다
      const results: ToolCallResult[] = r.calls.map((call) => {
        const res = call.name === SUBMIT_PLAN ? draft.submit(call.args) : { ok: false as const, error: `계획 모드에서는 ${SUBMIT_PLAN}만 부릅니다.` };
        const result = res.ok ? { ok: true as const, data: { steps: res.plan.steps.length } } : { ok: false as const, error: res.error };
        return { call, content: JSON.stringify(result), isError: !result.ok, result };
      });
      const failed = results.find((x) => !x.result.ok)?.result.error;
      const error = draft.finished ? null : failed ? failed.replace(RESUBMIT_HINT, "").trim() : NO_CALL;
      note(round + 1, ms, r.usage, (r.calls[0]!.args as { steps?: unknown } | null)?.steps ?? r.calls[0]!.args, error);
      signal.throwIfAborted();
      if (draft.finished) return { ok: true, plan: draft.finished };
      provider.addToolResults(state, results);
    }
    return { ok: false, error: `모델 차례 ${this.cfg.maxRounds}번 안에 맞는 계획을 내지 못함` };
  }
}
