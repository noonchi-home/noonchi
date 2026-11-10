// 에이전트 계획 모드: PAM이 고른 행동 하나 → 단계 계획(AgentPlan). 말 요청 에이전트(src/agent/agent.ts)와 같은 공급자(createProvider)를 쓰고,
// 계획마다 새 대화 상태로 도구 호출 루프를 돈다(최대 maxRounds 차례). 도구는 계획 모드 도구(src/agent/planTools.ts): 읽기·길·단계 더하기·끝내기.
// finish_plan이 통과하면 끝. 시간 한도(timeoutMs)를 넘거나 새 계획이 오면 공급자 요청을 취소 신호로 끊는다(계획은 한 번에 하나).
// 시험은 같은 OpenAI 공급자를 OPENAI_BASE_URL의 가짜 서버에 붙인다(tests/helpers/planner.ts). 규칙으로 계획을 만드는 길은 없다.
import type { DeviceHub, RoomSpec } from "../hub/types.js";
import { describeError, type LlmProvider, type ToolCallResult } from "./agent.js";
import { PLANNER_PROMPT, planInput } from "./planInput.js";
import { PlanDraft, planTools, type PlanContext, type PlanResult } from "./planTools.js";
import type { Policy } from "./policy.js";
import { localBackend, runTool } from "./tools.js";

export interface PlannerOptions {
  provider: LlmProvider;
  hub: DeviceHub;
  policy: Policy;
  rooms?: RoomSpec[];
  /** 도구 호출 차례 상한. */
  maxRounds?: number;
  /** 계획 하나의 시간 한도(ms). */
  timeoutMs?: number;
  /** 응답 하나의 출력 토큰 상한. */
  maxOutputTokens?: number;
}

/** 기본값: 도구 차례 6번, 계획 하나 45초, 응답 하나 출력 4000토큰. */
export const PLANNER_DEFAULTS = { maxRounds: 6, timeoutMs: 45_000, maxOutputTokens: 4000 } as const;

const NUDGE = "답 글 대신 add_step으로 단계를 더하고 finish_plan으로 끝내세요.";

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
    const backend = localBackend(this.o.hub, this.o.policy, this.o.rooms);
    const state = provider.createState();
    provider.addUserMessage(state, planInput(ctx));
    for (let round = 0; round < this.cfg.maxRounds; round++) {
      signal.throwIfAborted();
      const r = await provider.step(state, { system: PLANNER_PROMPT, tools, allowTools: true, signal, maxOutputTokens: this.cfg.maxOutputTokens });
      signal.throwIfAborted();
      if (r.calls.length === 0) {
        provider.addUserMessage(state, NUDGE);
        continue;
      }
      const results: ToolCallResult[] = [];
      for (const call of r.calls) {
        const result = await runTool(call.name, call.args, backend, tools);
        // 모양이 틀려 초안까지 가지 못한 add_step도 틀린 단계로 적는다(같은 응답의 finish_plan이 고치기 전 계획을 끝내지 않게)
        if (call.name === "add_step" && !result.ok) draft.reject(call.args);
        if (draft.finished) return { ok: true, plan: draft.finished };
        results.push({ call, content: JSON.stringify(result), isError: !result.ok, result });
      }
      provider.addToolResults(state, results);
    }
    return { ok: false, error: `도구 차례 ${this.cfg.maxRounds}번 안에 finish_plan으로 끝내지 않음` };
  }
}
