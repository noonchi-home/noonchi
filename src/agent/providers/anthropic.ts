// Anthropic(Claude) 공급자: Messages API 도구 사용, 직접 돌리는 루프의 한 단계(step)씩.
// Claude Opus 5.5는 생각(thinking)이 항상 켜져 있어 thinking 인자는 보내지 않고 effort로 깊이를 정한다.
// 응답 content(생각 블록 포함)는 그대로 대화에 덧붙인다(앞 대화를 고치지 않는다). 키가 없으면 요청을 보내지 않고 실패한다.

import Anthropic from "@anthropic-ai/sdk";
import type { LlmProvider, StepOptions, StepResult, ToolCallResult } from "../agent.js";
import { toolJsonSchema } from "../tools.js";

export type Effort = "low" | "medium" | "high" | "xhigh" | "max";

export interface AnthropicProviderOptions {
  apiKey: string;
  model?: string;
  baseURL?: string;
  effort?: Effort;
  maxTokens?: number;
  /** 서버 쪽 거절 대체(fallbacks: "default"). 기본 켬. */
  fallbacks?: boolean;
  maxHistory?: number;
}

interface State {
  messages: Anthropic.Beta.BetaMessageParam[];
}

export class AnthropicProvider implements LlmProvider {
  readonly name = "anthropic";
  readonly model: string;
  readonly effort: Effort;
  readonly fallbacks: boolean;
  readonly #apiKey: string;
  readonly #baseURL?: string;
  readonly #maxTokens: number;
  readonly #maxHistory: number;
  #client?: Anthropic;

  constructor(opts: AnthropicProviderOptions) {
    this.#apiKey = opts.apiKey;
    this.#baseURL = opts.baseURL;
    this.model = opts.model || "claude-opus-5-5";
    this.effort = opts.effort ?? "low";
    this.fallbacks = opts.fallbacks ?? true;
    this.#maxTokens = opts.maxTokens ?? 16000;
    this.#maxHistory = opts.maxHistory ?? 80;
  }

  private get client(): Anthropic {
    this.#client ??= new Anthropic({ apiKey: this.#apiKey, ...(this.#baseURL ? { baseURL: this.#baseURL } : {}) });
    return this.#client;
  }

  createState(): State {
    return { messages: [] };
  }

  addUserMessage(state: unknown, text: string): void {
    const s = state as State;
    // 너무 길어지면 새 대화로 시작한다(앞 대화를 잘라 고치지 않는다)
    if (s.messages.length > this.#maxHistory) s.messages = [];
    s.messages.push({ role: "user", content: text });
  }

  async step(state: unknown, opts: StepOptions): Promise<StepResult> {
    const s = state as State;
    if (!this.#apiKey) throw new Error("ANTHROPIC_API_KEY가 없습니다");
    const tools: Anthropic.Beta.BetaTool[] = opts.tools.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: toolJsonSchema(t) as Anthropic.Beta.BetaTool.InputSchema,
    }));
    const res = await this.client.beta.messages.create({
      model: this.model,
      max_tokens: this.#maxTokens,
      system: opts.system,
      messages: s.messages,
      tools,
      tool_choice: opts.allowTools ? { type: "auto" } : { type: "none" },
      output_config: { effort: this.effort },
      cache_control: { type: "ephemeral" },
      ...(this.fallbacks ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {}),
    });
    s.messages.push({ role: "assistant", content: res.content });
    if (res.stop_reason === "refusal") return { text: "죄송해요, 이 요청은 처리할 수 없어요.", calls: [] };
    const calls = res.content.flatMap((b) => (b.type === "tool_use" ? [{ id: b.id, name: b.name, args: b.input }] : []));
    const text = res.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("\n");
    if (res.stop_reason === "max_tokens" && calls.length === 0) return { text: text || "답이 너무 길어 중간에 끊겼어요.", calls: [] };
    return { text, calls };
  }

  addToolResults(state: unknown, results: ToolCallResult[]): void {
    const s = state as State;
    s.messages.push({
      role: "user",
      content: results.map((r) => ({ type: "tool_result" as const, tool_use_id: r.call.id, content: r.content, ...(r.isError ? { is_error: true } : {}) })),
    });
  }

  addExchange(state: unknown, user: string, assistant: string): void {
    const s = state as State;
    s.messages.push({ role: "user", content: user }, { role: "assistant", content: assistant });
  }
}
