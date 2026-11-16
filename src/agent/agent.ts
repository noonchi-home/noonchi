// 에이전트: LLM 공급자 + 도구 호출 루프(최대 6라운드) + 세션별 대화 기억 + 승인 대기 관리.
// 승인 토큰은 LLM에게 보여 주지 않는다. 사용자가 실제 폰 답 단추(confirm, 승인·거절)나 다음 말로만 확정한다.
// 승인 대기는 위험 목록뿐이라(src/agent/policy.ts) 답은 둘 다 이번만이다: 승인이면 실행하고, 거절이면 실행하지 않는다. 둘 다 기억하지 않아 다음에 또 묻는다.
// 늘 듣는 실제 폰의 말(heard)로는 승인 대기에 답하지 않는다(answerAll 없음): 실제 폰 서버(src/server/home.ts)가 말 전체가 승인·거절 답이고
// 말할 때 보인 대기 token이 하나일 때만 answerToken으로 그 대기 하나에 답한다. 글로 한 말은 「승인」「응」「아니」로 대기 전부에 답한다.
// 외부 연락(call_service)도 같은 승인 대기 길로 묻는다: 받는 이는 등록부(contacts)에서 정하고(등록이 없으면 묻지 않고 「…연락처가 등록되지 않았어요.」),
// 승인이면 외부 연락 통로(service, CALL_SERVICE_URL)로 보내고, 통로가 없으면 부르지 않고 「연결 없음」.
// 보낸 뒤 답이 없어 확인 불가면, 접수(2xx)가 확인될 때까지 같은 내용으로 다시 승인된 연락은 같은 id로 보낸다(다시 보내기 기억 retries, 전화 서비스가 같은 id를 한 번만 처리).
// /events로 내보내는 사본은 KEEP_HEARD_TEXT가 꺼져 있으면 외부 연락의 받는 이·보낼 내용을 가린다(실제 폰이 받는 답·대기 목록은 그대로).
// 결과(보냄·거절·연결 없음·실패·확인 불가)는 onService로 알린다(서버가 기록 DB·대시보드 말풍선 카드에 남긴다).

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
import type { ServiceCall, ServiceOutcome, ServiceResult } from "../contract/service.js";
import type { CallServiceSent } from "../infer/call-service.js";
import type { PendingService } from "./policy.js";
import {
  CALL_SERVICE, SERVICE_KINDS, SERVICE_MISSING, SERVICE_UNCONNECTED, ServiceRetryStore, serviceArgs, serviceCancelled, serviceReply, serviceSecrets,
  type ServiceContacts, type ServiceRetryBook,
} from "./service.js";

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
  /** 외부 연락 통로(src/infer/call-service.ts, CALL_SERVICE_URL). 없으면 승인돼도 부르지 않고 「전화 서비스가 아직 연결되지 않았어요.」. */
  service?: ServiceLine | null;
  /** 외부 연락 결과(보냄·거절·연결 없음·실패·확인 불가)마다 부른다. */
  onService?: (r: ServiceResult) => void;
  /** 외부 연락 받는 이 등록부(src/agent/service.ts loadContacts). 없는 종류는 연락하지 않는다. */
  contacts?: ServiceContacts;
  /** 외부 연락 다시 보내기 기억(src/agent/service.ts ServiceRetryStore, 집마다 파일). 없으면 이 프로세스 안에서만. */
  retries?: ServiceRetryBook;
}

/** 승인한 외부 연락을 보내는 곳(CallServiceClient). */
export interface ServiceLine { send(call: ServiceCall, meta: { id: string; approvedAt: string }): Promise<CallServiceSent> }

interface Session {
  id: string;
  state: unknown;
  pending: Set<string>;
  lastUsed: number;
  queue: Promise<unknown>;
  /** 지금 차례가 들은 말이고 가려야 하면 그 말(이벤트에 싣지 않는다). */
  hide: string | null;
  /** 지금 차례에 승인을 물은 외부 연락의 받는 이·보낼 내용(가려야 하면 이벤트 답 글에서 뺀다). */
  secrets: string[];
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

/** 글에서 가릴 글들을 뺀 사본(긴 것부터). */
function hideTexts(text: string, hidden: readonly string[]): string {
  const list = [...new Set(hidden.filter((h) => h.trim()))].sort((a, b) => b.length - a.length);
  return list.length ? redactSaid(text, list) : text;
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
  private readonly service: ServiceLine | null;
  private readonly onService?: (r: ServiceResult) => void;
  private readonly contacts: ServiceContacts;
  private readonly retries: ServiceRetryBook;

  constructor(opts: AgentOptions) {
    this.hub = opts.hub;
    this.policy = opts.policy;
    this.provider = opts.provider;
    this.rooms = opts.rooms;
    this.service = opts.service ?? null;
    this.onService = opts.onService;
    this.contacts = opts.contacts ?? {};
    this.retries = opts.retries ?? new ServiceRetryStore(null);
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
      if (!this.liveTokens().has(token)) {
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
    const call = this.policy.takeService(token);
    if (call) {
      this.emit({ event: "cancelled", sessionId: s?.id, token });
      this.serviceDone(call.call, "refused");
      return { ok: true, reply: serviceCancelled(call.call.kind) };
    }
    const p = this.policy.consume(token);
    if (!p) return { ok: false, reply: "취소할 승인 대기가 없거나 만료되었어요." };
    this.emit({ event: "cancelled", sessionId: s?.id, token });
    return { ok: true, reply: `${this.label(p.deviceId)} 명령을 취소했어요.` };
  }

  /** 승인 대기 목록(세션을 주면 그 세션 것만). */
  pending(sessionId?: string): PendingView[] {
    const all = [...this.policy.pending().map((p) => this.view(p)), ...this.policy.services().map((p) => this.serviceView(p))];
    if (sessionId === undefined) return all;
    const s = this.sessions.get(sessionId);
    if (!s) return [];
    this.prune(s);
    return all.filter((p) => s.pending.has(p.token));
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
    s.secrets = [];
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
      // 외부 연락(위험 가전의 AS센터 전화 등) 승인을 기다리는 중이면 그 승인 질문
      if (riskyNames(reply).length) {
        const kinds = new Map(this.hub.list().map((d) => [d.id, d.kind]));
        const views = this.pending(s.id);
        const waiting = views.find((p) => isRiskyKind(kinds.get(p.deviceId)));
        const calling = views.find((p) => p.service);
        reply = waiting ? askApproval(waiting.reason) : calling ? calling.reason : RISKY_REPLY;
      }
      // 외부 연락 받는 이가 등록되지 않아 막았으면 정한 답(「보호자 연락처가 등록되지 않았어요.」)
      const missing = actions.find((a) => a.tool === CALL_SERVICE && a.error !== undefined && SERVICE_MISSING.has(a.error));
      if (missing) reply = missing.error!;
    }
    const pendingConfirmations = this.pending(s.id);
    s.hide = null;
    // 이벤트 사본: 들은 말과(가려야 하면) 이번 차례 외부 연락의 받는 이·보낼 내용을 뺀다
    const secrets = this.keepHeard ? [] : s.secrets;
    this.emit({
      event: "reply", sessionId: s.id, message: said ? HEARD_MARK : hideTexts(message, secrets), reply: hideTexts(reply, [...(said ? [said] : []), ...secrets]),
      actions: actions.map((a) => this.outward(a, said)), pendingConfirmations: pendingConfirmations.map((p) => this.outwardPending(p)),
    });
    return { sessionId: s.id, reply, actions, pendingConfirmations, provider: this.provider.name };
  }

  /** 이벤트로 내보내는 action: 외부 연락이면 받는 이·보낼 내용을 가리고(publicAction), 들은 말 차례면 그 말을 통째로 가린 사본. */
  private outward(a: AgentAction, said: string | null): AgentAction {
    const pub = this.publicAction(a);
    return said ? this.shown(pub, said) : pub;
  }

  /** 외부 연락 action의 이벤트 사본(KEEP_HEARD_TEXT가 꺼져 있을 때): 종류·가전 id만 두고 받는 이·보낼 내용·승인 질문·모델 까닭을 가린다. 그 밖은 그대로. */
  private publicAction(a: AgentAction): AgentAction {
    if (this.keepHeard || a.tool !== CALL_SERVICE) return a;
    return {
      ...a, args: { kind: a.args.kind, device_id: a.args.device_id ?? null, detail: HEARD_MARK },
      message: a.needsConfirmation ? undefined : a.message, reason: a.reason === undefined ? undefined : HEARD_MARK,
      observation: a.observation === undefined ? undefined : a.needsConfirmation ? `승인 대기 · ${HEARD_MARK}` : a.ok ? a.observation : HEARD_MARK,
    };
  }

  /** 승인 대기의 이벤트 사본: 외부 연락이면(KEEP_HEARD_TEXT가 꺼져 있을 때) 승인 질문을 가린다. 실제 폰이 받는 대기 목록은 pending()이라 그대로다. */
  private outwardPending(p: PendingView): PendingView {
    return p.service && !this.keepHeard ? { ...p, reason: HEARD_MARK } : p;
  }

  /** 이벤트로 내보내는 action: 들은 말을 통째로 가린 사본. 까닭은 자르기 전 글을 가린 뒤 자른다(인용 중간이 잘려 원문 일부가 남지 않게). */
  private shown(a: AgentAction, said: string): AgentAction {
    const raw = this.rawReason.get(a);
    const hidden = hideIn({ ...a, ...(raw !== undefined ? { reason: raw } : {}) }, said);
    return hidden.reason === undefined ? hidden : { ...hidden, reason: headWithin(hidden.reason, REASON_MAX) };
  }

  private async runModel(s: Session, message: string, actions: AgentAction[]): Promise<string> {
    const backend: ToolBackend = {
      ...localBackend(this.hub, this.policy, this.rooms, this.layout),
      service: {
        contacts: this.contacts,
        ask: (call) => {
          const p = this.policy.askService(call);
          s.secrets.push(...serviceSecrets(call));
          return p;
        },
      },
    };
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
    this.emit({ event: "action", sessionId: s.id, action: this.outward(action, s.hide) });
    let shown: ToolResult = result;
    if (result.needsConfirmation) {
      s.pending.add(result.needsConfirmation.token);
      const p = this.pending().find((x) => x.token === result.needsConfirmation!.token);
      if (p) this.emit({ event: "pending", sessionId: s.id, pending: this.outwardPending(p) });
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
    const call = this.policy.takeService(token);
    if (call) {
      const reply = REFUSED_REPLY(SERVICE_KINDS[call.call.kind].what);
      if (s) this.provider.addExchange?.(s.state, "(거절이라고 답했다)", reply);
      this.emit({ event: "cancelled", sessionId: s?.id, token });
      this.serviceDone(call.call, "refused");
      return { ok: false, reply };
    }
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
    const call = this.policy.takeService(token);
    if (call) return this.sendService(call);
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

  /** 외부 연락 대기의 보기: 기기 id는 빈 글(트윈 말풍선·계획에 붙지 않는다), 이름은 고장 난 가전(없으면 빈 글: 실제 폰은 질문만 보인다). */
  private serviceView(p: PendingService): PendingView {
    return {
      token: p.token, deviceId: "", deviceLabel: p.call.device?.label ?? "", service: p.call.kind, reason: p.reason,
      choices: APPROVE.map(({ id, label }) => ({ id, label })), expiresAt: new Date(p.expiresAt).toISOString(),
    };
  }

  /** 지금 승인 대기 token 전부(가전 명령·외부 연락). */
  private liveTokens(): Set<string> {
    return new Set([...this.policy.pending(), ...this.policy.services()].map((p) => p.token));
  }

  /** 승인한 외부 연락: 통로가 있으면 보내고(2xx 보냄, 답 없음·끊김 확인 불가, 그 밖 실패), 없으면 부르지 않는다(연결 없음). 결과를 알리고 답한다.
   *  id는 새 값이고, 같은 내용의 앞 연락이 확인 불가로 남아 있으면 그 id다. 접수(2xx)가 확인돼야 잊는다(닿지 못함·2xx 아닌 답으로는 잊지 않는다). */
  private async sendService(p: PendingService): Promise<ConfirmResult> {
    const id = this.retries.idFor(p.call) ?? randomUUID();
    const at = new Date().toISOString();
    const sent = this.service ? await this.service.send(p.call, { id, approvedAt: at }) : null;
    const outcome: Exclude<ServiceOutcome, "refused"> = !sent ? "unconnected" : sent.ok ? "sent" : sent.unknown ? "unknown" : "failed";
    if (outcome === "unknown") this.retries.unsure(p.call, id);
    else if (outcome === "sent") this.retries.settled(p.call);
    const error = !sent ? SERVICE_UNCONNECTED : sent.ok ? undefined : sent.error;
    const reply = serviceReply(p.call.kind, outcome);
    this.serviceDone(p.call, outcome, id, error);
    const ok = outcome === "sent";
    const action: AgentAction = { tool: CALL_SERVICE, args: serviceArgs(p.call), ok, ...(ok ? { message: reply } : { error }), at };
    return { ok, reply, ...(error ? { error } : {}), action };
  }

  /** 외부 연락 결과 하나를 알린다(구독자 오류는 무시). */
  private serviceDone(call: ServiceCall, outcome: ServiceOutcome, id: string = randomUUID(), error?: string): void {
    try {
      this.onService?.({ id, call, outcome, atMs: Date.now(), ...(error && (outcome === "failed" || outcome === "unknown") ? { error } : {}) });
    } catch {
      // 기록 실패가 답을 막지 않게 한다
    }
  }

  private label(id: string): string {
    return this.hub.list().find((d) => d.id === id)?.label ?? id;
  }

  /** 만료된 토큰을 세션에서 지운다. */
  private prune(s: Session): void {
    const live = this.liveTokens();
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
      s = { id: key, state: this.provider.createState(), pending: new Set(), lastUsed: Date.now(), queue: Promise.resolve(), hide: null, secrets: [] };
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
