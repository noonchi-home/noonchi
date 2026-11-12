// 에이전트 계획 모드: PAM이 고른 행동 하나 → 단계 계획(AgentPlan). 말 요청 에이전트(src/agent/agent.ts)와 같은 공급자(createProvider)를 쓴다.
// 모델은 submit_plan 한 번으로 계획 전체를 낸다(호출 하나가 약 2초라 단계마다 부르면 계획에 10초 넘게 걸렸다). 검사를 통과하면 그 자리에서 끝,
// 틀리면 첫 틀린 단계와 까닭을 돌려주고 고친 전체를 다시 받는다(최대 maxRounds 차례, 답 글만 낸 차례도 센다).
// 시간 한도(timeoutMs)를 넘거나 새 계획이 오면 공급자 요청을 취소 신호로 끊는다(계획은 한 번에 하나).
// 시험은 같은 OpenAI 공급자를 OPENAI_BASE_URL의 가짜 서버에 붙인다(tests/helpers/planner.ts). 규칙으로 계획을 만드는 길은 없다.
import { describeError, type LlmProvider, type ToolCallResult } from "./agent.js";
import { PLANNER_PROMPT, planInput } from "./planInput.js";
import { PlanDraft, SUBMIT_PLAN, planTools, type PlanContext, type PlanResult } from "./planTools.js";

export interface PlannerOptions {
  provider: LlmProvider;
  /** 모델 차례 상한(제출·고친 제출·답 글만 낸 차례). */
  maxRounds?: number;
  /** 계획 하나의 시간 한도(ms). */
  timeoutMs?: number;
  /** 응답 하나의 출력 토큰 상한. */
  maxOutputTokens?: number;
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
      return await this.loop(ctx, ac.signal);
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
    for (let round = 0; round < this.cfg.maxRounds; round++) {
      signal.throwIfAborted();
      const r = await provider.step(state, { system: PLANNER_PROMPT, tools, allowTools: true, forceTool: SUBMIT_PLAN, signal, maxOutputTokens: this.cfg.maxOutputTokens });
      signal.throwIfAborted();
      if (r.calls.length === 0) {
        provider.addUserMessage(state, NUDGE);
        continue;
      }
      // 모양 검사(도구 인자 스키마)를 거치지 않고 submit이 단계마다 번호를 붙여 까닭을 낸다
      const results: ToolCallResult[] = r.calls.map((call) => {
        const res = call.name === SUBMIT_PLAN ? draft.submit(call.args) : { ok: false as const, error: `계획 모드에서는 ${SUBMIT_PLAN}만 부릅니다.` };
        const result = res.ok ? { ok: true as const, data: { steps: res.plan.steps.length } } : { ok: false as const, error: res.error };
        return { call, content: JSON.stringify(result), isError: !result.ok, result };
      });
      if (draft.finished) return { ok: true, plan: draft.finished };
      provider.addToolResults(state, results);
    }
    return { ok: false, error: `모델 차례 ${this.cfg.maxRounds}번 안에 맞는 계획을 내지 못함` };
  }
}
