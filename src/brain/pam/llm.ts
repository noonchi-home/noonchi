// OpenAI 호환 chat completions 한 번(openai SDK). 고치거나 다시 묻지 않는다(maxRetries 0). 잘린 답(finish_reason이 stop도 null도 아님)은 오류다.
// 요청 칸 model, messages, stream=false는 두 모드가 같다. vllm(같은 서버 vLLM)은 temperature·max_tokens·생각 칸 chat_template_kwargs.enable_thinking,
// openai(OpenAI)는 max_completion_tokens·reasoning_effort(none·medium)이고 생각을 켜면 temperature를 보내지 않는다(기본값 1만 받는다).
// 키가 없으면 authorization을 보내지 않는다. 연결 단계 EFAULT만 다시 보낸다(fetchRetry). 넘겨주기(3xx)는 따라가지 않는다.
import OpenAI, { APIError } from "openai";
import { z } from "zod";
import type { PamUsage } from "../../contract/events.js";
import { estimateCostUsd, hasPrice } from "../../infer/cost.js";
import { fetchRetry } from "../../shared/net.js";
import { checkBudget } from "./budget.js";
import { PamLinkError } from "./errors.js";
import type { Generation, PamMessage } from "./prompt.js";
import type { PamSettings } from "./settings.js";

type Role = "predictor" | "reflector";
/** 한 번 부를 때 받는 것: 부른 쪽 취소 신호, 답을 받자마자 알리는 사용량(검사 전이라 틀린 답·잘린 답에도 온다). */
export interface CallOptions { signal?: AbortSignal; onUsage?: (u: PamUsage) => void }

const Usage = z.object({
  prompt_tokens: z.number().optional(), completion_tokens: z.number().optional(), prompt_tokens_details: z.object({ cached_tokens: z.number().optional() }).nullish(),
}).nullish();

function usageOf(reply: unknown, fallbackModel: string): PamUsage | null {
  const r = z.object({ model: z.string().optional(), usage: Usage }).safeParse(reply);
  if (!r.success || !r.data.usage) return null;
  const u = r.data.usage;
  const model = r.data.model || fallbackModel;
  const counts = { prompt: u.prompt_tokens ?? 0, completion: u.completion_tokens ?? 0, cached: u.prompt_tokens_details?.cached_tokens ?? 0 };
  return { model, ...counts, cost_usd: hasPrice(model) ? estimateCostUsd(model, counts) : null };
}

const Reply = z.object({
  choices: z.array(z.object({ message: z.looseObject({}).refine((m) => "content" in m), finish_reason: z.unknown().optional() })).min(1),
});

export class PamLlm {
  private readonly client: OpenAI;

  constructor(private readonly s: PamSettings, o: { fetchImpl?: typeof fetch } = {}) {
    this.client = new OpenAI({
      apiKey: s.apiKey || "no-key", baseURL: s.baseUrl, maxRetries: 0, timeout: s.timeoutMs,
      fetch: (url: string | URL | Request, init?: RequestInit) => {
        const headers = new Headers(init?.headers);
        if (!s.apiKey) headers.delete("authorization");
        return fetchRetry(url instanceof Request ? url.url : url, { ...init, headers, redirect: "manual" }, { fetchImpl: o.fetchImpl });
      },
    });
  }

  body(messages: PamMessage[], g: Generation, role: Role): Record<string, unknown> {
    const s = this.s;
    if (s.thinking === "openai") {
      return { model: s.model, messages, max_completion_tokens: s.maxTokens[role], stream: false,
        reasoning_effort: g.enable_thinking ? "medium" : "none", ...(g.enable_thinking ? {} : { temperature: g.temperature }), ...s.extraBody };
    }
    return { model: s.model, messages, temperature: g.temperature, max_tokens: s.maxTokens[role], stream: false,
      chat_template_kwargs: { enable_thinking: g.enable_thinking }, ...s.extraBody };
  }

  async complete(messages: PamMessage[], g: Generation, role: Role, timeoutMs: number, call: CallOptions = {}): Promise<string> {
    // 막힌 주소(OpenRouter)는 부르지 않는다: 판단·반성은 PAM 준비 안 됨(연결 오류)으로 끝난다
    if (this.s.blocked) throw new PamLinkError(`PAM 준비 안 됨: ${this.s.blocked}`);
    const body = this.body(messages, g, role);
    checkBudget(messages, this.s.maxTokens[role], this.s.maxModelLen);
    let reply: unknown;
    // SDK timeout은 응답 머리를 받으면 풀린다. 본문 읽기까지 이어지는 전체 제한은 따로 끊는 신호로 건다(본문이 멈춰도 끊긴다).
    const limit = call.signal ? AbortSignal.any([AbortSignal.timeout(timeoutMs), call.signal]) : AbortSignal.timeout(timeoutMs);
    try {
      reply = await this.client.chat.completions.create(body as never, { timeout: timeoutMs, signal: limit });
    } catch (e) {
      if (e instanceof PamLinkError) throw e;
      if (e instanceof APIError && typeof e.status === "number") throw new PamLinkError(`PAM LLM HTTP ${e.status}`);
      throw new PamLinkError(`PAM LLM 연결 실패: ${(e as Error).name}`);
    }
    const used = usageOf(reply, this.s.model);
    if (used) call.onUsage?.(used);
    const r = Reply.safeParse(reply);
    if (!r.success) throw new PamLinkError("PAM LLM 답 모양이 chat completions가 아님");
    const choice = r.data.choices[0]!;
    if (choice.finish_reason != null && choice.finish_reason !== "stop") throw new PamLinkError(`PAM LLM 답이 끝나지 않음: ${String(choice.finish_reason)}`);
    const content = (choice.message as { content: unknown }).content;
    if (typeof content !== "string") throw new PamLinkError("PAM LLM 답에 글이 없음");
    return content;
  }
}
