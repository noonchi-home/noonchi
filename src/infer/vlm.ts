// VLM 사진 분석 어댑터(모델 호출 하나에 어댑터 하나). 형식이 틀리면 한 번만 다시 묻는다(maxAttempts, 기본 2).
// signal이 끊기면 HTTP 요청도 끊고 다시 묻지 않는다(aborted: true). 다시 묻는 요청도 같은 signal·같은 제한 시간 안에서 한다.
import { estimateCostUsd } from "./cost.js";
import type { ModelEndpoint } from "./endpoints.js";
import { OpenAICompatClient, type ChatPart } from "./openai-compat.js";

export interface VlmJson<T> { value: T | null; costUsd: number; model: string; attempts: number; error?: string; aborted?: boolean }

export interface VlmRequest<T> {
  prompt: string;
  /** 사진 앞에 둘 글(감지 목록 등). */
  texts?: string[];
  images: Buffer[];
  /** 사진마다 그 사진 바로 앞에 둘 설명(촬영 시각 등). */
  captions?: string[];
  schema: { name: string; schema: Record<string, unknown> };
  parse: (text: string) => T;
  maxAttempts?: number;
  signal?: AbortSignal;
}

const reasonOf = (s: AbortSignal | undefined): string => (s?.reason instanceof Error ? s.reason.message : "끊김");

export class VlmClient {
  private readonly chat: OpenAICompatClient;
  constructor(private readonly ep: ModelEndpoint, opts: { fetchImpl?: typeof fetch; timeoutMs?: number } = {}) {
    this.chat = new OpenAICompatClient(ep, opts);
  }

  get model(): string {
    return this.ep.model;
  }

  async json<T>(o: VlmRequest<T>): Promise<VlmJson<T>> {
    const content: ChatPart[] = [{ type: "text", text: o.prompt }, ...(o.texts ?? []).map((text) => ({ type: "text" as const, text }))];
    o.images.forEach((img, i) => {
      const caption = o.captions?.[i];
      if (caption) content.push({ type: "text", text: caption });
      content.push({ type: "image_url", image_url: { url: `data:image/jpeg;base64,${img.toString("base64")}`, detail: "high" } });
    });
    const max = Math.max(1, Math.min(2, o.maxAttempts ?? 2));
    let cost = 0, model = this.ep.model, attempts = 0;
    while (attempts < max && !o.signal?.aborted) {
      attempts++;
      try {
        const r = await this.chat.chat({ messages: [{ role: "user", content }], schema: o.schema, signal: o.signal });
        cost += estimateCostUsd(r.model, r.usage);
        model = r.model;
        try { return { value: o.parse(r.text), costUsd: cost, model, attempts }; } catch { /* 형식 오류: 다시 묻는다 */ }
      } catch (e) {
        return { value: null, costUsd: cost, model, attempts, error: (e as Error).message, ...(o.signal?.aborted ? { aborted: true } : {}) };
      }
    }
    if (o.signal?.aborted) return { value: null, costUsd: cost, model, attempts, error: reasonOf(o.signal), aborted: true };
    return { value: null, costUsd: cost, model, attempts, error: `형식이 ${attempts}번 틀림` };
  }
}
