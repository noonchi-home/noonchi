// 에이전트: LLM 공급자 + 도구 호출 루프(최대 6라운드) + 세션별 대화 기억 + 승인 대기 관리.
// 승인 토큰은 LLM에게 보여 주지 않는다. 사용자가 실제 폰 답 단추(confirm, 승인·거절)나 다음 말로만 확정한다.
// 승인 대기는 위험 목록뿐이라(src/agent/policy.ts) 답은 둘 다 이번만이다: 승인이면 실행하고, 거절이면 실행하지 않는다. 둘 다 기억하지 않아 다음에 또 묻는다.
// 늘 듣는 실제 폰의 말(heard)로는 승인 대기에 답하지 않는다(answerAll 없음): 실제 폰 서버(src/server/home.ts)가 말 전체가 승인·거절 답이고
// 말할 때 보인 대기 token이 하나일 때만 answerToken으로 그 대기 하나에 답한다. 글로 한 말은 「승인」「응」「아니」로 대기 전부에 답한다.

import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { AgentAction, AgentEvent, ChatResult, ConfirmResult, PendingView } from "../contract/events.js";
import type { DeviceHub, RoomSpec } from "../contract/devices.js";
import { matchChoice } from "../act/tasks.js";
import { APPROVE } from "../act/prompts.js";
import type { ApprovalAnswer } from "./approval.js";
import { REFUSED_REPLY, RISKY_REPLY, commandName, isRiskyKind, riskyNames, type PendingConfirmation, type Policy } from "./policy.js";
import { askApproval, doneSentence, toolForCommand } from "./phrases.js";
import { buildSystemPrompt } from "./prompts.js";
import { LAYOUT_TOOLS, type LayoutTools } from "./layoutTools.js";
import { observe } from "./observe.js";
import { HEARD_MARK, redactSaid } from "../world/labels.js";
import { AGENT_TOOLS, LEAVE_IT, localBackend, runTool, unverifiedSentence, type ToolBackend, type ToolDef, type ToolResult } from "./tools.js";
import { headWithin } from "../shared/cut.js";

export type { AgentAction, AgentEvent, ChatResult, ConfirmResult, PendingView } from "../contract/events.js";

export interface ToolCall {
  id: string;
  name: string;
  args: unknown;
}

export interface ToolCallResult {
  call: ToolCall;
  content: string;     // 모델에게 줄 JSON 문자열(승인 토큰 없음)
  isError: boolean;
  result: ToolResult;  // 같은 내용(승인 토큰 없음)
}

export interface StepOptions {
  system: string;
  tools: ToolDef[];
  allowTools: boolean; // false면 도구 없이 답해야 한다(라운드 한도)
  /** 끊으면 공급자 요청을 취소한다(계획 모드의 시간 한도·새 판단). */
  signal?: AbortSignal;
  /** 응답 하나의 출력 토큰 상한(없으면 공급자 기본). */
  maxOutputTokens?: number;
  /** 이 도구 하나를 바로 부르게 하고 응답 하나에 호출 하나만 받는다(계획 모드 submit_plan). allowTools가 false면 무시한다. */
  forceTool?: string;
  /** 넘긴 도구 중 하나를 꼭 부르게 하고 응답 하나에 호출 하나만 받는다(관찰 모드). forceTool이 먼저이고, allowTools가 false면 무시한다.
   *  Anthropic은 생각이 늘 켜져 강제하지 못해 병렬 호출만 끈다. */
  requireTool?: boolean;
}

/** 응답 하나의 토큰 사용량. input은 캐시에서 읽은 것(cached)을 포함한 전체 입력이다. */
export interface StepUsage {
  model: string;
  input: number;
  cached: number;
  output: number;
}

export interface StepResult {
  text: string;
  calls: ToolCall[];
  /** 공급자 응답이 사용량을 알려 줄 때만 있다. */
  usage?: StepUsage;
}

/** LLM 공급자: 대화 상태(state)는 공급자 형식으로 공급자가 관리한다. */
export interface LlmProvider {
  readonly name: string;
  readonly model?: string;
  createState(): unknown;
  addUserMessage(state: unknown, text: string): void;
  /** 모델을 한 번 부르고, 응답을 state에 덧붙인 뒤 도구 호출·글을 돌려준다. */
  step(state: unknown, opts: StepOptions): Promise<StepResult>;
  addToolResults(state: unknown, results: ToolCallResult[]): void;
  /** 모델 밖에서 처리한 대화(승인·취소)를 기록한다. */
  addExchange?(state: unknown, user: string, assistant: string): void;
}

/** 서버 안 에이전트에게만 받는 '생각' 인자. MCP 도구에는 없다. */
const REASON = z.string().min(1).max(200).describe("왜 이 도구를 부르는지 한국어 한 문장(기기 id·JSON 없이). 화면의 추론 과정에 보인다.");

function withReason(tool: ToolDef): ToolDef {
  return { ...tool, schema: tool.schema.extend({ reason: REASON }) };
}

export interface AgentOptions {
  hub: DeviceHub;
  policy: Policy;
  provider: LlmProvider;
  rooms?: RoomSpec[];
  maxToolRounds?: number;
  maxSessions?: number;
  onEvent?: (e: AgentEvent) => void;
  /** 배치 보정 도구(find_objects·move_object…)를 켠다. */
  layout?: LayoutTools;
  /** 참이면 들은 말(heard) 차례의 이벤트에도 그 말을 그대로 싣는다(KEEP_HEARD_TEXT). 기본은 「들은 말 있음」으로 가리고, 답 글·도구 까닭에 옮긴 그 말도 뺀다. */
  keepHeard?: boolean;
}

interface Session {
  id: string;
  state: unknown;
  pending: Set<string>;
  lastUsed: number;
  queue: Promise<unknown>;
  /** 지금 차례가 들은 말이고 가려야 하면 그 말(이벤트에 싣지 않는다). */
  hide: string | null;
}

const AFFIRMATIVE = /^(응|어|엉|네|넹|예|그래|좋아|확인|승인|ㅇㅇ|ㅇㅋ|오케이|ok|okay|yes|진행)(요|해|해요|해줘|해주세요|할게|합니다|이요)?[\s.!~,]*(열어\s*줘|해\s*줘|진행해\s*줘|부탁해)?[\s.!~]*$/i;
const NEGATIVE = /^(아니|아냐|ㄴㄴ|싫어|취소|하지\s*마|안\s*돼|no\b|nope|그만|됐어)/i;
const TOKEN_MISSING = "승인 토큰이 없거나 만료되었습니다.";

/** 기록·방송하는 까닭 글 상한. */
const REASON_MAX = 200;

/** 값 안의 모든 글에서 들은 말을 뺀 사본(이벤트로 내보낼 때). */
function hideIn<T>(value: T, said: string): T {
  if (typeof value === "string") return redactSaid(value, [said]) as T;
  if (Array.isArray(value)) return value.map((v) => hideIn(v, said)) as T;
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, hideIn(v, said)])) as T;
  return value;
}

export function isAffirmative(text: string): boolean {
  return AFFIRMATIVE.test(text.trim());
}

/** heard: 늘 듣는 실제 폰이 들은 말. 승인 대기는 말 전체가 승인·거절 답일 때만 확정한다(「승인해 줘」「거절」). */
export interface ChatOptions { heard?: boolean }

export function isNegative(text: string): boolean {
  return NEGATIVE.test(text.trim());
}

/** 오류를 짧은 설명으로(키처럼 보이는 문자열은 가린다). */
export function describeError(e: unknown): string {
  const err = e as { status?: number; name?: string; message?: string };
  const msg = headWithin(String(err?.message ?? e).replace(/(sk-[A-Za-z0-9_-]{4})[A-Za-z0-9_-]+/g, "$1***"), 300);
  return err?.status && !msg.startsWith(String(err.status)) ? `HTTP ${err.status} ${msg}` : msg;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

export class Agent {
  readonly provider: LlmProvider;
  private readonly hub: DeviceHub;
  private readonly policy: Policy;
  private readonly rooms?: RoomSpec[];
  private readonly maxRounds: number;
  private readonly maxSessions: number;
  private readonly keepHeard: boolean;
  /** 자르기 전 까닭(들은 말을 먼저 가린 뒤 자르려고). */
  private readonly rawReason = new WeakMap<AgentAction, string>();
  private readonly layout?: LayoutTools;
  private readonly tools: ToolDef[];
  /** 모델에게 보이는 도구(reason 필수). 실행은 tools로 한다. */
  private readonly modelTools: ToolDef[];
  private readonly sessions = new Map<string, Session>();
  private readonly listeners = new Set<(e: AgentEvent) => void>();
  private prompt?: { key: string; text: string };

  constructor(opts: AgentOptions) {
    this.hub = opts.hub;
    this.policy = opts.policy;
    this.provider = opts.provider;
    this.rooms = opts.rooms;
    this.maxRounds = opts.maxToolRounds ?? 6;
    this.maxSessions = opts.maxSessions ?? 200;
    this.keepHeard = opts.keepHeard === true;
    this.layout = opts.layout;
    this.tools = opts.layout ? [...AGENT_TOOLS, ...LAYOUT_TOOLS] : AGENT_TOOLS;
    this.modelTools = this.tools.map(withReason);
    if (opts.onEvent) this.listeners.add(opts.onEvent);
  }

  subscribe(cb: (e: AgentEvent) => void): () => void {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  }

  /** 사용자 메시지 하나를 처리한다. 같은 세션의 요청은 차례로 처리한다. */
  chat(sessionId: string, message: string, opts: ChatOptions = {}): Promise<ChatResult> {
    const s = this.session(sessionId);
    return this.serialize(s, () => this.handle(s, message, opts));
  }

  /** 승인 토큰과 답으로 대기 중인 명령에 답한다(실제 폰 답 단추, POST /api/agent/confirm). 거절이면 실행하지 않는다. */
  confirm(token: string, choice: ApprovalAnswer = "approve"): Promise<ConfirmResult> {
    const s = this.owner(token);
    const run = async () => {
      if (choice === "reject") return this.refuseToken(token, s);
      const r = await this.confirmToken(token, s);
      if (s && r.ok) this.provider.addExchange?.(s.state, "(화면에서 승인 버튼을 눌렀다)", r.reply);
      this.emit({ event: "confirmed", sessionId: s?.id, token, ok: r.ok, reply: r.reply, deviceId: r.deviceId });
      return r;
    };
    return s ? this.serialize(s, run) : run();
  }

  /** 승인 대기 token 하나만 답한다(들은 말의 승인·거절, src/server/home.ts). 다른 대기는 그대로. 지금 대기가 아니면 ok false.
   *  승인이면 실행하고, 거절이면 실행하지 않는다(둘 다 그 대기에 답한 것이라 ok true). */
  answerToken(token: string, answer: ApprovalAnswer): Promise<{ ok: boolean; reply: string }> {
    const s = this.owner(token);
    const run = async () => {
      if (!this.policy.pending().some((p) => p.token === token)) {
        s?.pending.delete(token);
        return { ok: false, reply: "승인할 작업이 없거나 시간이 지나 만료되었어요. 다시 요청해 주세요." };
      }
      if (answer === "reject") return { ok: true, reply: (await this.refuseToken(token, s)).reply };
      const r = await this.confirmToken(token, s);
      if (s) this.provider.addExchange?.(s.state, "(승인이라고 답했다)", r.reply);
      this.emit({ event: "confirmed", sessionId: s?.id, token, ok: r.ok, reply: r.reply, deviceId: r.deviceId });
      return { ok: true, reply: r.reply };
    };
    return s ? this.serialize(s, run) : run();
  }

  /** 승인 대기를 취소한다. */
  cancel(token: string): { ok: boolean; reply: string } {
    const s = this.owner(token);
    s?.pending.delete(token);
    const p = this.policy.consume(token);
    if (!p) return { ok: false, reply: "취소할 승인 대기가 없거나 만료되었어요." };
    this.emit({ event: "cancelled", sessionId: s?.id, token });
    return { ok: true, reply: `${this.label(p.deviceId)} 명령을 취소했어요.` };
  }

  /** 승인 대기 목록(세션을 주면 그 세션 것만). */
  pending(sessionId?: string): PendingView[] {
    if (sessionId === undefined) return this.policy.pending().map((p) => this.view(p));
    const s = this.sessions.get(sessionId);
    if (!s) return [];
    this.prune(s);
    return this.policy.pending().filter((p) => s.pending.has(p.token)).map((p) => this.view(p));
  }

  resetSession(sessionId: string): void {
    this.sessions.delete(sessionId);
  }

  // ── 내부 ────────────────────────────────────────────────

  private async handle(s: Session, message: string, opts: ChatOptions): Promise<ChatResult> {
    const actions: AgentAction[] = [];
    this.prune(s);
    // 늘 듣는 실제 폰이 들은 말은 이벤트(/events 방송)에 싣지 않는다: 돌려주는 답(폰이 읽는 글)은 그대로
    const said = opts.heard && !this.keepHeard && message.trim() ? message.trim() : null;
    s.hide = said;
    let reply: string;
    const waiting = s.pending.size > 0;
    // 들은 말로는 대기 전부에 답하지 않는다(실제 폰 서버가 말할 때 보인 token 하나에만 answerToken으로 답한다)
    const answer = waiting && !opts.heard ? this.spokenAnswer(message) : null;
    if (answer) reply = await this.answerAll(s, message, answer, actions);
    else if (waiting && !opts.heard && isAffirmative(message)) reply = await this.answerAll(s, message, "approve", actions);
    else if (waiting && !opts.heard && isNegative(message)) reply = this.cancelAll(s, message);
    else {
      reply = await this.runModel(s, message, actions);
      // 모델이 쓴 답도 폰으로 나가는 사람용 글이다(기본 거부, src/agent/policy.ts): 위험 가전 이름이 나오면 도구를 썼든 아니든 서버 글로 바꾼다.
      // 그 가전 승인을 기다리는 중이면 정책 승인 안내 글, 아니면 정한 한 줄
      if (riskyNames(reply).length) {
        const kinds = new Map(this.hub.list().map((d) => [d.id, d.kind]));
        const waiting = this.pending(s.id).find((p) => isRiskyKind(kinds.get(p.deviceId)));
        reply = waiting ? askApproval(waiting.reason) : RISKY_REPLY;
      }
    }
    const pendingConfirmations = this.pending(s.id);
    s.hide = null;
    this.emit({
      event: "reply", sessionId: s.id, message: said ? HEARD_MARK : message, reply: said ? redactSaid(reply, [said]) : reply,
      actions: said ? actions.map((a) => this.shown(a, said)) : actions, pendingConfirmations,
    });
    return { sessionId: s.id, reply, actions, pendingConfirmations, provider: this.provider.name };
  }

  /** 이벤트로 내보내는 action: 들은 말을 통째로 가린 사본. 까닭은 자르기 전 글을 가린 뒤 자른다(인용 중간이 잘려 원문 일부가 남지 않게). */
  private shown(a: AgentAction, said: string): AgentAction {
    const raw = this.rawReason.get(a);
    const hidden = hideIn({ ...a, ...(raw !== undefined ? { reason: raw } : {}) }, said);
    return hidden.reason === undefined ? hidden : { ...hidden, reason: headWithin(hidden.reason, REASON_MAX) };
  }

  private async runModel(s: Session, message: string, actions: AgentAction[]): Promise<string> {
    const backend = localBackend(this.hub, this.policy, this.rooms, this.layout);
    const system = this.systemPrompt();
    try {
      this.provider.addUserMessage(s.state, message);
      // 이번 차례에 부른 도구가 넘기기(leave_it)뿐이면 답하지 않는다: 가전 요청이 아닌 말은 판단 모델이 듣고 돕는다(실제 폰은 빈 글을 보이지도 읽지도 않는다)
      const called = new Set<string>();
      for (let round = 0; ; round++) {
        const allowTools = round < this.maxRounds;
        const r = await this.provider.step(s.state, { system, tools: this.modelTools, allowTools });
        if (r.calls.length === 0) return called.size === 1 && called.has(LEAVE_IT) ? "" : r.text.trim() || "(답이 비어 있어요)";
        if (!allowTools) {
          // 한도를 넘긴 호출은 실행하지 않고 결과만 채워 대화 형식을 맞춘다
          this.provider.addToolResults(s.state, r.calls.map((call) => {
            const result: ToolResult = { ok: false, error: `도구 호출 한도(${this.maxRounds}라운드)를 넘어 실행하지 않았습니다.` };
            return { call, content: JSON.stringify(result), isError: true, result };
          }));
          return r.text.trim() || `도구 호출 한도(${this.maxRounds}라운드)를 넘어 멈췄어요. 요청을 나눠서 다시 말씀해 주세요.`;
        }
        const results: ToolCallResult[] = [];
        for (const call of r.calls) {
          called.add(call.name);
          results.push(await this.execute(s, call, backend, actions));
        }
        this.provider.addToolResults(s.state, results);
      }
    } catch (e) {
      // 대화 상태가 어긋났을 수 있으니 새로 시작한다
      s.state = this.provider.createState();
      return `에이전트(LLM) 호출에 실패했습니다: ${describeError(e)}`;
    }
  }

  private async execute(s: Session, call: ToolCall, backend: ToolBackend, actions: AgentAction[]): Promise<ToolCallResult> {
    // 생각(reason)은 떼어 기록만 하고, 도구는 원래 인자로 실행한다
    const { reason, ...args } = isRecord(call.args) ? call.args : {};
    const result = await runTool(call.name, args, backend, this.tools);
    const action: AgentAction = {
      tool: call.name, args, ok: result.ok, message: result.message, error: result.error,
      deviceId: result.device?.id, deviceLabel: result.device?.label, needsConfirmation: result.needsConfirmation ? true : undefined,
      reason: typeof reason === "string" && reason.trim() ? headWithin(reason.trim(), REASON_MAX) : undefined,
      observation: observe(call.name, result),
      at: new Date().toISOString(),
    };
    if (typeof reason === "string" && reason.trim()) this.rawReason.set(action, reason.trim());
    actions.push(action);
    // 들은 말 차례면 내보내는 action은 통째로 가린다(인자·결과 글·관찰·까닭). 실행한 인자와 돌려주는 action은 그대로
    this.emit({ event: "action", sessionId: s.id, action: s.hide ? this.shown(action, s.hide) : action });
    let shown: ToolResult = result;
    if (result.needsConfirmation) {
      s.pending.add(result.needsConfirmation.token);
      const p = this.policy.pending().find((x) => x.token === result.needsConfirmation!.token);
      if (p) this.emit({ event: "pending", sessionId: s.id, pending: this.view(p) });
      const { needsConfirmation, ...rest } = result;
      shown = {
        ...rest,
        pendingApproval: { reason: needsConfirmation.reason },
        message: "사용자 승인을 기다리는 중입니다. 같은 명령을 다시 부르지 말고, 사용자에게 승인할지 물으세요(실제 폰의 답 단추 또는 말).",
      };
    }
    return { call, content: JSON.stringify(shown), isError: !result.ok && !result.needsConfirmation, result: shown };
  }

  /** 대기 중인 승인 모두에 같은 답을 한다(말로 한 답). */
  private async answerAll(s: Session, message: string, choice: ApprovalAnswer, actions: AgentAction[]): Promise<string> {
    const replies: string[] = [];
    for (const token of [...s.pending]) {
      if (choice === "reject") {
        replies.push((await this.refuseToken(token, s)).reply);
        continue;
      }
      const r = await this.confirmToken(token, s);
      if (r.action) actions.push(r.action);
      replies.push(r.reply);
      this.emit({ event: "confirmed", sessionId: s.id, token, ok: r.ok, reply: r.reply, deviceId: r.deviceId });
    }
    const reply = replies.join(" ");
    this.provider.addExchange?.(s.state, message, reply);
    return reply;
  }

  /** 말 전체가 승인 답(승인·거절)이면 그 답. */
  private spokenAnswer(message: string): ApprovalAnswer | null {
    return (matchChoice(message, APPROVE)?.id as ApprovalAnswer | undefined) ?? null;
  }

  /** 거절: 실행하지 않는다. 기억하지 않아 다음에 또 묻는다. */
  private async refuseToken(token: string, s?: Session): Promise<ConfirmResult> {
    s?.pending.delete(token);
    const p = this.policy.consume(token);
    if (!p) return { ok: false, error: TOKEN_MISSING, reply: "승인할 작업이 없거나 시간이 지나 만료되었어요. 다시 요청해 주세요." };
    const reply = REFUSED_REPLY(commandName(this.label(p.deviceId), p.command));
    if (s) this.provider.addExchange?.(s.state, "(거절이라고 답했다)", reply);
    this.emit({ event: "cancelled", sessionId: s?.id, token });
    return { ok: false, reply, deviceId: p.deviceId };
  }

  private cancelAll(s: Session, message: string): string {
    const replies: string[] = [];
    for (const token of [...s.pending]) replies.push(this.cancel(token).reply);
    const reply = replies.join(" ") || "취소할 승인 대기가 없어요.";
    this.provider.addExchange?.(s.state, message, reply);
    return reply;
  }

  private async confirmToken(token: string, s?: Session): Promise<ConfirmResult> {
    s?.pending.delete(token);
    const p = this.policy.pending().find((x) => x.token === token);
    if (!p) return { ok: false, error: TOKEN_MISSING, reply: "승인할 작업이 없거나 시간이 지나 만료되었어요. 다시 요청해 주세요." };
    const r = await this.policy.confirm(this.hub, token);
    const spec = this.hub.list().find((d) => d.id === p.deviceId);
    const label = spec?.label ?? p.deviceId;
    const action: AgentAction = {
      tool: toolForCommand(p.command), args: { device_id: p.deviceId }, ok: r.ok, error: r.error,
      deviceId: p.deviceId, deviceLabel: label, at: new Date().toISOString(),
    };
    const reply = r.ok && r.state?.signal === "none" ? `${label}에 명령을 보냈어요. 신호가 없어 결과는 확인하지 못했어요.`
      : r.ok && r.outcome === "unverified" ? unverifiedSentence(label)
      : r.ok && spec ? doneSentence([label], spec.kind, p.command) : `${label}: ${r.error ?? "실행하지 못했어요."}`;
    action.message = r.ok ? reply : undefined;
    return { ok: r.ok, reply, error: r.error, deviceId: p.deviceId, state: r.state, action };
  }

  private view(p: PendingConfirmation): PendingView {
    return {
      token: p.token, deviceId: p.deviceId, deviceLabel: this.label(p.deviceId), command: p.command, reason: p.reason,
      choices: APPROVE.map(({ id, label }) => ({ id, label })), expiresAt: new Date(p.expiresAt).toISOString(),
    };
  }

  private label(id: string): string {
    return this.hub.list().find((d) => d.id === id)?.label ?? id;
  }

  /** 만료된 토큰을 세션에서 지운다. */
  private prune(s: Session): void {
    const live = new Set(this.policy.pending().map((p) => p.token));
    for (const t of [...s.pending]) if (!live.has(t)) s.pending.delete(t);
  }

  private owner(token: string): Session | undefined {
    for (const s of this.sessions.values()) if (s.pending.has(token)) return s;
    return undefined;
  }

  private session(id: string): Session {
    const key = id || "default";
    let s = this.sessions.get(key);
    if (!s) {
      if (this.sessions.size >= this.maxSessions) {
        const oldest = [...this.sessions.values()].sort((a, b) => a.lastUsed - b.lastUsed)[0];
        if (oldest) this.sessions.delete(oldest.id);
      }
      s = { id: key, state: this.provider.createState(), pending: new Set(), lastUsed: Date.now(), queue: Promise.resolve(), hide: null };
      this.sessions.set(key, s);
    }
    s.lastUsed = Date.now();
    return s;
  }

  private serialize<T>(s: Session, fn: () => Promise<T>): Promise<T> {
    const next = s.queue.then(fn, fn);
    s.queue = next.catch(() => undefined);
    return next;
  }

  private systemPrompt(): string {
    const devices = this.hub.list();
    const key = devices.map((d) => `${d.id}:${d.label}`).join("|");
    if (this.prompt?.key !== key) this.prompt = { key, text: buildSystemPrompt(devices, this.rooms, { layout: !!this.layout }) };
    return this.prompt.text;
  }

  private emit(e: AgentEvent): void {
    for (const cb of [...this.listeners]) {
      try {
        cb(e);
      } catch {
        // 구독자 오류는 무시
      }
    }
  }
}

export function newSessionId(): string {
  return randomUUID();
}
