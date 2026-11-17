// OpenAI 호환 chat completions 한 번(openai SDK). 고치거나 다시 묻지 않는다(maxRetries 0). 잘린 답(finish_reason이 stop도 null도 아님)은 오류다.
// 요청 칸 model, messages, temperature, max_tokens, stream=false는 두 모드가 같다. 생각 칸은 mock(OpenRouter) reasoning.enabled, live(vLLM) chat_template_kwargs.enable_thinking.
// OpenAI(PAM_LLM_PROVIDER=openai)는 max_completion_tokens·reasoning_effort(none·medium)이고 생각을 켜면 temperature를 보내지 않는다.
// 키가 없으면 authorization을 보내지 않는다. 연결 단계 EFAULT만 다시 보낸다(fetchRetry). 넘겨주기(3xx)는 따라가지 않는다.
import OpenAI, { APIError } from "openai";
import { z } from "zod";
import { fetchRetry } from "../../shared/net.js";
import { checkBudget } from "./budget.js";
import { PamLinkError } from "./errors.js";
import type { Generation, PamMessage } from "./prompt.js";
import type { PamSettings } from "./settings.js";

type Role = "predictor" | "reflector";
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
    const thinking = s.thinking === "openrouter" ? { reasoning: { enabled: g.enable_thinking } } : { chat_template_kwargs: { enable_thinking: g.enable_thinking } };
    return { model: s.model, messages, temperature: g.temperature, max_tokens: s.maxTokens[role], stream: false, ...thinking, ...s.extraBody };
  }

  async complete(messages: PamMessage[], g: Generation, role: Role, timeoutMs: number): Promise<string> {
    const body = this.body(messages, g, role);
    checkBudget(messages, this.s.maxTokens[role], this.s.maxModelLen);
    let reply: unknown;
    // SDK timeout은 응답 머리를 받으면 풀린다. 본문 읽기까지 이어지는 전체 제한은 따로 끊는 신호로 건다(본문이 멈춰도 끊긴다).
    const limit = AbortSignal.timeout(timeoutMs);
    try {
      reply = await this.client.chat.completions.create(body as never, { timeout: timeoutMs, signal: limit });
    } catch (e) {
      if (e instanceof PamLinkError) throw e;
      if (e instanceof APIError && typeof e.status === "number") throw new PamLinkError(`PAM LLM HTTP ${e.status}`);
      throw new PamLinkError(`PAM LLM 연결 실패: ${(e as Error).name}`);
    }
    const r = Reply.safeParse(reply);
    if (!r.success) throw new PamLinkError("PAM LLM 답 모양이 chat completions가 아님");
    const choice = r.data.choices[0]!;
    if (choice.finish_reason != null && choice.finish_reason !== "stop") throw new PamLinkError(`PAM LLM 답이 끝나지 않음: ${String(choice.finish_reason)}`);
    const content = (choice.message as { content: unknown }).content;
    if (typeof content !== "string") throw new PamLinkError("PAM LLM 답에 글이 없음");
    return content;
  }
}
