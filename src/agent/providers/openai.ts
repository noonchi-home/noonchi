// OpenAI 공급자: Responses API 함수 호출, 직접 돌리는 루프의 한 단계(step)씩.
// 응답 output(추론 항목 포함)을 그대로 input에 덧붙여 다음 호출에 넘긴다. 키가 없으면 요청을 보내지 않고 실패한다.

import OpenAI from "openai";
import type { LlmProvider, StepOptions, StepResult, ToolCallResult } from "../agent.js";
import { toolJsonSchema } from "../tools.js";

export interface OpenAIProviderOptions {
  apiKey: string;
  model?: string;
  baseURL?: string;
  maxHistory?: number;
}

type Item = OpenAI.Responses.ResponseInputItem;

interface State {
  items: Item[];
}

function parseArgs(raw: string): unknown {
  try {
    return raw ? JSON.parse(raw) : {};
  } catch {
    return { __invalid_json: raw };
  }
}

export class OpenAIProvider implements LlmProvider {
  readonly name = "openai";
  readonly model: string;
  readonly #apiKey: string;
  readonly #baseURL?: string;
  readonly #maxHistory: number;
  #client?: OpenAI;

  constructor(opts: OpenAIProviderOptions) {
    this.#apiKey = opts.apiKey;
    this.#baseURL = opts.baseURL;
    this.model = opts.model || "gpt-5.5";
    this.#maxHistory = opts.maxHistory ?? 120;
  }

  private get client(): OpenAI {
    this.#client ??= new OpenAI({ apiKey: this.#apiKey, ...(this.#baseURL ? { baseURL: this.#baseURL } : {}) });
    return this.#client;
  }

  createState(): State {
    return { items: [] };
  }

  addUserMessage(state: unknown, text: string): void {
    const s = state as State;
    if (s.items.length > this.#maxHistory) s.items = [];
    s.items.push({ role: "user", content: text });
  }

  async step(state: unknown, opts: StepOptions): Promise<StepResult> {
    const s = state as State;
    if (!this.#apiKey) throw new Error("OPENAI_API_KEY가 없습니다");
    const res = await this.client.responses.create({
      model: this.model,
      instructions: opts.system,
      input: s.items,
      tools: opts.tools.map((t) => ({ type: "function" as const, name: t.name, description: t.description, parameters: toolJsonSchema(t), strict: false })),
      tool_choice: !opts.allowTools ? "none" : opts.forceTool ? { type: "function" as const, name: opts.forceTool } : "auto",
      ...(opts.allowTools && opts.forceTool ? { parallel_tool_calls: false } : {}),
      ...(opts.maxOutputTokens ? { max_output_tokens: opts.maxOutputTokens } : {}),
    }, opts.signal ? { signal: opts.signal } : undefined);
    s.items.push(...(res.output as unknown as Item[]));
    const calls = res.output.flatMap((o) => (o.type === "function_call" ? [{ id: o.call_id, name: o.name, args: parseArgs(o.arguments) }] : []));
    return { text: res.output_text ?? "", calls };
  }

  addToolResults(state: unknown, results: ToolCallResult[]): void {
    const s = state as State;
    for (const r of results) s.items.push({ type: "function_call_output", call_id: r.call.id, output: r.content });
  }

  addExchange(state: unknown, user: string, assistant: string): void {
    const s = state as State;
    s.items.push({ role: "user", content: user }, { role: "assistant", content: assistant });
  }
}
