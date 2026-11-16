// OpenAI 호환 chat completions 한 번(OpenAI·vLLM·가짜 서버가 같은 길). 연결 단계 EFAULT만 다시 보낸다(fetchRetry).
import { fetchRetry } from "../shared/net.js";
import type { ModelEndpoint } from "./endpoints.js";

export type ChatPart = { type: "text"; text: string } | { type: "image_url"; image_url: { url: string; detail?: "low" | "high" } };
export interface ChatMessage { role: "system" | "user"; content: string | ChatPart[] }
export interface ChatReply { text: string; model: string; usage: { prompt: number; completion: number; cached: number }; ms: number }

interface ChatBody {
  model?: string;
  choices?: { message?: { content?: string | null } }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number; prompt_tokens_details?: { cached_tokens?: number } };
}

export class OpenAICompatClient {
  constructor(private readonly ep: ModelEndpoint, private readonly opts: { fetchImpl?: typeof fetch; timeoutMs?: number } = {}) {}

  get model(): string {
    return this.ep.model;
  }

  /** 보내는 주소·모델·키·요청 칸. */
  get endpoint(): ModelEndpoint {
    return { ...this.ep };
  }

  /** signal이나 제한 시간(timeoutMs, 기본 20000)이 끊기면 요청도 끊는다. HTTP 오류는 던진다. */
  async chat(req: { messages: ChatMessage[]; schema?: { name: string; schema: Record<string, unknown> }; maxTokens?: number; signal?: AbortSignal }): Promise<ChatReply> {
    const t0 = performance.now();
    const limit = AbortSignal.timeout(this.opts.timeoutMs ?? 20_000);
    const res = await fetchRetry(`${this.ep.baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", ...(this.ep.apiKey ? { authorization: `Bearer ${this.ep.apiKey}` } : {}) },
      signal: req.signal ? AbortSignal.any([req.signal, limit]) : limit,
      body: JSON.stringify({
        model: this.ep.model, messages: req.messages, max_completion_tokens: req.maxTokens ?? 600, ...this.ep.extraBody,
        ...(req.schema ? { response_format: { type: "json_schema", json_schema: { name: req.schema.name, strict: true, schema: req.schema.schema } } } : {}),
      }),
    }, { fetchImpl: this.opts.fetchImpl });
    if (!res.ok) {
      await res.body?.cancel();
      throw new Error(`모델 HTTP ${res.status}`);
    }
    const b = (await res.json()) as ChatBody;
    return {
      text: b.choices?.[0]?.message?.content ?? "", model: b.model ?? this.ep.model, ms: performance.now() - t0,
      usage: { prompt: b.usage?.prompt_tokens ?? 0, completion: b.usage?.completion_tokens ?? 0, cached: b.usage?.prompt_tokens_details?.cached_tokens ?? 0 },
    };
  }
}
