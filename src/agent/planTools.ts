// 에이전트 계획 모드의 도구와 계획 검사(docs/superpowers/plans/2026-11-10-agent-plans.md).
// 에이전트는 submit_plan 한 번으로 계획 전체를 낸다. 낼 때마다 전체를 새로 검사해 틀리면 첫 틀린 단계와 이유를 돌려준다(모델이 고친 전체를 다시 낸다).
// 경로는 모델이 아니라 assemblePlan(src/plan/planner.ts)이 이동 단계마다 잇는다. 기기를 바꾸는 도구는 계획 모드에 없다:
// 기기 단계는 도구 이름·인자만 적어 두고, 실행 추적(src/act/track.ts)이 그 단계가 되면 정책(승인 규칙)을 거쳐 부른다.
import { z } from "zod";
import { copyRules } from "../plan/copy.js";
import { ASK_CHOICES, type ActionPrompt } from "../act/prompts.js";
import type { Lesson } from "../act/lessons.js";
import { planIdOf, type Placed, type TaskSpec } from "../act/tasks.js";
import type { DeviceView } from "../contract/events.js";
import type { DraftStep, PlanHead } from "../plan/planner.js";
import { assemblePlan } from "../plan/planner.js";
import type { PlanTarget, PlanView, StepKind, XZ } from "../contract/plan.js";
import type { WorldObject, WorldView } from "../contract/world.js";
import type { RoomSpec } from "../hub/types.js";
import type { FloorPlan } from "../plan/floor.js";
import { ALL_ACTS, CAUTION_LINE, DEVICE_VERB, EXTRA_ITEMS, NOTICES, NOTICE_KEYS, STEP_ACTS, STEP_LABEL, STEP_TEXT, noticeLabel, placeShort, type StepAct } from "../plan/labels.js";
import { KIND_LABELS } from "../model/mapping.js";
import { OBJECT_NAME } from "../world/labels.js";
import { CLASSES, DEVICE_STATES, type DeviceStateKey } from "../world/vocab.js";
import { ConditionSchema, checkCondition, type Condition, type ConditionHome } from "../world/conditions.js";
import type { DecisionRecord } from "../world/decide.js";
import { CONFIRM_RULES, RISKY_NAME_PROBLEM, riskyNames } from "./policy.js";
import { TOOLS, type ToolDef, type ToolResult } from "./tools.js";

/** 에이전트 단계 종류. go·pick·place·do는 사람이 하는 일(실제 폰 명령, do는 그 자리에서 하는 일: 따르기·붓기), ask 질문, say 알림, device 가전 조작, wait 기다리기. */
export type AgentStepKind = "go" | "pick" | "place" | "do" | "device" | "ask" | "say" | "wait";
export const HUMAN_KINDS: readonly AgentStepKind[] = ["go", "pick", "place", "do"];
/** 에이전트 단계 → 화면 단계 종류(src/contract/plan.ts). */
export const VIEW_KIND: Record<AgentStepKind, StepKind> = { go: "move", pick: "act", place: "act", do: "act", ask: "ask", say: "ask", device: "device", wait: "wait" };

/** 알림 단계에 끝나는 조건이 없으면 이만큼(초) 뒤에 넘긴다. */
export const SAY_HOLD_S = 4;

/** 사람이 고를 수 있는 물건 이름(item): 낱말 표 물건 이름과 시나리오 이름. */
export const STEP_ITEMS = [...new Set([...Object.values(CLASSES).filter((c) => c.role === "object").map((c) => c.label), ...EXTRA_ITEMS])] as [string, ...string[]];

/** 손으로 다루는 가전 동작 → hand_device to. 이 동작은 가전 대상에만, 그 가전의 같은 hand_device와 함께만 쓴다. */
export const HAND_ACT: Partial<Record<StepAct, "on" | "off" | "open" | "close">> = { 켜기: "on", 끄기: "off", 열기: "open", 닫기: "close" };
/** 가전마다 사람이 손으로 할 수 있는 동작. 여기 없는 가전·동작은 버린다(이름 표가 아니라 동작으로 막는다). */
export const DEVICE_ACTS: Partial<Record<string, readonly StepAct[]>> = { cooktop: ["켜기", "끄기"], microwave: ["열기", "닫기", "켜기", "끄기"], fridge: ["열기", "닫기"] };
/** 손 조작 동작의 끝 조건에 쓰는 가전 상태 후보(그 가전에 있는 첫 것). */
const HAND_STATES: Record<"on" | "off" | "open" | "close", readonly DeviceStateKey[]> = {
  on: ["on", "running"], off: ["off", "stopped"], open: ["door_open"], close: ["door_closed"],
};

/** 계획 한도: 단계 수(기본 maxSteps, 행동이 따로 정하면 TaskSpec.maxSteps, 가장 길어도 hardMaxSteps), 단계 종류마다 시간 한도(초), 답 단추 수. */
export const PLAN_LIMITS = {
  maxSteps: 8,
  hardMaxSteps: 14,
  timeoutS: { go: [10, 1800], pick: [10, 1800], place: [10, 1800], do: [10, 1800], ask: [10, 1800], say: [SAY_HOLD_S + 1, 600], device: [10, 600], wait: [10, 14_400] } as Record<AgentStepKind, [number, number]>,
  choices: [2, 3] as [number, number],
};

/** 기기 단계에 쓸 수 있는 도구: 기기를 바꾸는 도구(src/agent/tools.ts). */
export const DEVICE_TOOLS = Object.keys(DEVICE_VERB) as [string, ...string[]];

/** 기기 단계 until로 결과를 확인할 수 있는 도구와 그 상태(조건 낱말 가전 상태 키). 여기 없는 도구(밝기·냉난방 설정 등)는 상태 하나로 확인하지 못해 until을 받지 않는다. */
export const TOOL_STATES: Record<string, readonly string[]> = {
  turn_on: ["on", "running", "faucet_on", "water_on", "heating_on"], turn_off: ["off", "stopped", "faucet_off", "water_off", "heating_off"],
  start: ["running"], stop: ["stopped"], lock: ["locked"], unlock: ["unlocked"],
};

/** 실행 단계 하나. id는 화면 단계 id와 같다. */
export interface AgentStep {
  id: string;
  kind: AgentStepKind;
  label: string;
  /** go·place: 평면도 id, pick·do: World State 물건 id 또는 평면도 id, device: 가전 id. */
  target: string | null;
  /** pick·place: 든 World State 물건 id(없으면 null). */
  object: string | null;
  /** 사람 단계: 실제 폰에 보낼 명령(「…주세요」). */
  command: string | null;
  /** ask: 질문과 답. */
  prompt: (ActionPrompt & { ends: string[] }) | null;
  /** say: 알릴 글. */
  text: string | null;
  device: { tool: string; deviceId: string; args: Record<string, unknown> } | null;
  /** do: 사람이 손으로 켜거나 끄는 가전(없으면 null). 위험 목록 가전을 켜는 단계는 실행 추적이 명령 전에 묻는다(riskyHand). */
  hand: { deviceId: string; to: "on" | "off" | "open" | "close" } | null;
  /** do: 위험한 단계 앞에 폰이 읽을 안전 한 줄(없으면 null). */
  caution: string | null;
  /** 끝나는 조건(World State 낱말 조건). 사람 단계는 없으면 「완료」로만 넘긴다. */
  until: Condition | null;
  timeoutMs: number;
  onTimeout: "ask" | "fail";
}

/** 검사를 통과한 계획: 화면 계획(PlanView, 단계 순서·id가 steps와 같다)과 실행 단계. */
export interface AgentPlan { view: PlanView; steps: AgentStep[]; task: string }

/** 계획 결과: 통과한 계획, 또는 버린 까닭. */
export type PlanResult = { ok: true; plan: AgentPlan } | { ok: false; error: string };

export type TaskInfo = TaskSpec;
/** 평면도 물건 하나(가구·가전·도면 설비): id·종류·방·자리와 이름(name 배치 이름, short 비전 상태 줄의 짧은 이름), 싱크볼 가운데(있을 때). */
export interface PlaceInfo { id: string; type: string; room: string | null; position: XZ; name: string; short: string; basin?: XZ }

/** 계획 입력. floor.robot은 손(맞춘 폰 눈) 자리다. placed는 실행 추적이 놓기를 끝낸 물건(이미 치운 것, src/act/track.ts placed):
 *  입력 물건 줄에 「이미 치움」을 붙이고, 그 물건을 집거나 놓는 단계는 버린다. */
export interface PlanContext {
  decision: DecisionRecord;
  task: TaskInfo;
  world: WorldView;
  floor: FloorPlan;
  places: PlaceInfo[];
  rooms: RoomSpec[];
  devices: DeviceView[];
  nowIso: string;
  placed?: Placed;
  /** 지난 수업(코치 행동의 수업 기록, src/act/lessons.ts). 있으면 입력에 [지난 수업]으로 넣는다(단계 이름·순서를 그대로 쓰게). */
  lesson?: Lesson | null;
}


/** 단계 하나의 인자(submit_plan steps의 한 칸 + 번호). 종류마다 쓰는 칸은 PlanDraft.add가 본다. */
export const STEP_ARGS = z.object({
  step: z.number().int().min(1).describe("몇 번째 단계인지(1부터). 고칠 때는 같은 번호로 다시 보낸다"),
  kind: z.enum(["go", "pick", "place", "do", "device", "ask", "say", "wait"]).describe("go 이동·pick 집기·place 내려놓기·do 그 자리에서 하는 일(사람이 함), device 가전 조작, ask 질문, say 알림, wait 기다리기"),
  label: z.string().min(1).max(30).optional().describe("device: 화면 단계 이름(예: 건조기 시작). 그 밖의 단계 이름은 서버가 정한다"),
  target: z.string().min(1).optional().describe("go·place: 평면도 id, pick·do: World State 물건 id 또는 평면도 id, device: 가전 id"),
  object: z.string().min(1).optional().describe("pick·place: 든 World State 물건 id"),
  act: z.enum(ALL_ACTS).optional().describe(`사람 단계 동작: ${Object.entries(STEP_ACTS).map(([k, v]) => `${k} ${v.join("·")}`).join(", ")}. 사람에게 하는 말은 서버가 동작·대상·물건으로 만든다`),
  item: z.enum(STEP_ITEMS).optional().describe("사람 단계·끝 알림의 물건 이름(목록 안). 사람 단계에서 없으면 object·target 물건의 종류 이름"),
  notice: z.enum(NOTICE_KEYS).optional().describe(`say·wait: 알림·기다리기 열쇠(${NOTICE_KEYS.join("·")}). 폰 글과 화면 이름은 서버가 만든다. 끝은 wait에 쓰지 않는다`),
  question: z.string().min(1).max(60).optional().describe("ask: 짧은 질문, 「?」로 끝남(「주세요」 없이)"),
  choices: z.enum(["clear_keep", "yes_no"]).optional().describe("ask: 답 묶음. clear_keep 치워 주세요·그대로 둬요, yes_no 네·아니요"),
  tool: z.enum(DEVICE_TOOLS).optional().describe("device: 기기를 바꾸는 도구 이름"),
  args: z.record(z.string(), z.unknown()).optional().describe("device: 그 도구 인자(device_id 빼고)"),
  hand_device: z.object({ id: z.string().min(1), to: z.enum(["on", "off", "open", "close"]) }).optional()
    .describe("do 켜기·끄기·열기·닫기: 그 대상 가전(id는 target과 같음)과 동작(on·off·open·close). 그 밖의 단계에는 쓰지 않는다"),
  until: z.record(z.string(), z.unknown()).optional().describe("끝나는 조건: World State 조건 JSON(조건 낱말의 키만). wait에는 꼭. place는 자리 사실 또는 트윈 자리(손에 없음, not in_hand)를 any로 묶고, 그 any와 사람이 들고 있지 않음(not person_holding)을 all로 묶는다. 트윈 자리는 위에 놓기면 놓을 면(target) 위, 안에 넣기(싱크대)면 그 면의 싱크볼 안(part basin). 물건 조건은 모두 follow: true"),
  timeout_s: z.number().int().describe("이 단계 시간 한도(초)"),
  on_timeout: z.enum(["ask", "fail"]).optional().describe("시간이 지나면 ask 계속할지 묻기, fail 실패(기본)"),
});
export type StepArgs = z.infer<typeof STEP_ARGS>;

/** 손으로 켜는 가전이 위험 목록(src/agent/policy.ts CONFIRM_RULES: 그 종류를 켜거나 시작하는 명령)인가. 끄는 단계·위험 목록이 아닌 가전은 아니다. */
export function riskyHand(step: Pick<AgentStep, "hand">, devices: readonly { id: string; kind: string }[]): boolean {
  if (step.hand?.to !== "on") return false;
  const kind = devices.find((d) => d.id === step.hand!.deviceId)?.kind;
  return CONFIRM_RULES.some((r) => r.kind === kind && (r.command === "on" || r.command === "start"));
}

const isId = (name: string) => /_\d+$/.test(name);
const worldObject = (w: WorldView, id: string): WorldObject | undefined => w.objects.find((o) => o.id === id);

/** 조건 안의 물건 이름(id·종류). */
export function objectNames(c: Condition, out: string[] = []): string[] {
  if ("all" in c) c.all.forEach((x) => objectNames(x, out));
  else if ("any" in c) c.any.forEach((x) => objectNames(x, out));
  else if ("seq" in c) c.seq.forEach((x) => objectNames(x, out));
  else if ("not" in c) objectNames(c.not, out);
  else if ("for_s" in c) objectNames(c.cond, out);
  else if ("object" in c) out.push(c.object);
  return out;
}

/** 조건 안의 「사람이 들고 있음」(person_holding) 물건 이름(id·종류). */
export function heldNames(c: Condition, out: string[] = []): string[] {
  if ("all" in c) c.all.forEach((x) => heldNames(x, out));
  else if ("any" in c) c.any.forEach((x) => heldNames(x, out));
  else if ("seq" in c) c.seq.forEach((x) => heldNames(x, out));
  else if ("not" in c) heldNames(c.not, out);
  else if ("for_s" in c) heldNames(c.cond, out);
  else if ("person_holding" in c) out.push(c.person_holding);
  return out;
}

/** 화면에 그대로 나가는 글: 60자 아래, 화살표·괄호·구현 이름 없음(npm run lint와 같은 규칙). */
function copyProblem(what: string, text: string | undefined): string[] {
  if (text === undefined) return [];
  const hit = copyRules(text);
  return hit.length ? [`${what}: 화면 글 규칙(${hit.join(", ")})에 맞지 않습니다`] : [];
}

interface Added { step: Omit<AgentStep, "id">; at: XZ | null }

/** 계획 한 번의 초안. 도구(planTools)가 쓰고, OpenAI를 부르지 않는 합성 기록(scripts/seed-history.ts)도 같은 검사로 쓴다. */
export const SUBMIT_PLAN = "submit_plan";

export class PlanDraft {
  private readonly added: Added[] = [];
  private done: AgentPlan | null = null;
  /** 틀린 단계가 있으면 그 번호: 고칠 때까지 끝내기를 받지 않는다. */
  private blocked: number | null = null;
  private readonly home: ConditionHome;

  constructor(readonly ctx: PlanContext) {
    this.home = {
      devices: ctx.devices.map((d) => ({ id: d.id, kind: d.kind, twinAttrs: d.twinAttrs })),
      rooms: ctx.floor.rooms.map((r) => r.id),
      hasPlace: (id) => ctx.floor.objects.has(id),
      hasBasin: (id) => !!ctx.floor.objects.get(id)?.basin,
    };
  }

  get finished(): AgentPlan | null {
    return this.done;
  }

  /** 이 행동 계획의 단계 수 상한. */
  get maxSteps(): number {
    return Math.min(this.ctx.task.maxSteps ?? PLAN_LIMITS.maxSteps, PLAN_LIMITS.hardMaxSteps);
  }

  /** 단계 하나를 검사하고 그 번호(step) 자리에 둔다. 이미 있는 번호면 그 단계와 뒤 단계를 지우고 다시 둔다(고쳐 다시 보낼 때).
   *  틀리면 그 번호부터 지우고 까닭을 돌려준다(모델에게 돌려줄 한국어). 그 뒤 번호는 앞 번호가 없어 받지 않는다. */
  add(raw: unknown): { ok: true; step: number } | { ok: false; error: string } {
    if (this.done) return { ok: false, error: "이미 끝낸 계획입니다." };
    const parsed = STEP_ARGS.safeParse(raw);
    if (!parsed.success) return { ok: false, error: parsed.error.issues.map((i) => `${i.path.join(".") || "(전체)"}: ${i.message}`).join("; ") };
    const n = parsed.data.step;
    if (n > this.maxSteps) return { ok: false, error: `단계는 ${this.maxSteps}개까지입니다.` };
    if (n > this.added.length + 1) return { ok: false, error: `${n}번 앞에 ${this.added.length + 1}번 단계가 없습니다. ${this.added.length + 1}번부터 번호 순서대로 보내세요.` };
    this.added.length = n - 1;
    const r = this.check(parsed.data);
    if (typeof r === "string") {
      this.blocked = n;
      return { ok: false, error: `${n}번 단계: ${r}.` };
    }
    this.blocked = null;
    this.added.push(r);
    return { ok: true, step: n };
  }



  /** submit_plan: 낼 때마다 계획 전체를 새로 검사한다(앞 제출은 남지 않는다). 단계 번호는 배열 순서다.
   *  틀리면 첫 틀린 단계와 까닭에 「전체를 다시 보내라」를 붙여 돌려준다. 다 맞으면 끝낸다(finish). */
  submit(raw: unknown): { ok: true; plan: AgentPlan } | { ok: false; error: string } {
    if (this.done) return { ok: true, plan: this.done };
    const again = (e: string) => ({ ok: false as const, error: `${e} 계획 전체를 고쳐 submit_plan으로 다시 보내세요.` });
    const steps = (raw as { steps?: unknown } | null)?.steps;
    if (!Array.isArray(steps) || steps.length === 0) return again("steps에 단계가 없습니다.");
    if (steps.length > this.maxSteps) return again(`단계는 ${this.maxSteps}개까지입니다.`);
    this.added.length = 0;
    this.blocked = null;
    for (const [i, step] of steps.entries()) {
      const n = i + 1;
      const r = this.add({ ...(step && typeof step === "object" ? step : {}), step: n });
      if (!r.ok) return again(r.error.startsWith(`${n}번 단계`) ? r.error : `${n}번 단계: ${r.error}`);
    }
    const f = this.finish();
    return f.ok ? f : again(f.error);
  }

  /** 계획 전체를 검사하고 끝낸다. */
  finish(): { ok: true; plan: AgentPlan } | { ok: false; error: string } {
    if (this.done) return { ok: true, plan: this.done };
    if (this.added.length === 0) return { ok: false, error: "단계가 없습니다." };
    if (this.blocked !== null) return { ok: false, error: `${this.blocked}번 단계가 틀린 채라 끝내지 않습니다. 그 단계부터 고쳐 다시 더하세요.` };
    const missing = this.ctx.task.allow.need.filter((k) => !this.added.some((a) => a.step.kind === k));
    if (missing.length) return { ok: false, error: `이 할 일(${this.ctx.task.name})에는 ${missing.join(", ")} 단계가 있어야 합니다.` };
    if (this.added.slice(0, -1).some((a) => a.step.kind === "ask")) return { ok: false, error: "질문(ask)은 답으로 갈라지지 않게 마지막 단계에만 둡니다." };
    // 가전 단계는 그 가전 자리에서 사람이 하는 단계(가기·꺼내기·넣기) 뒤에 둔다(사람이 넣기 전에 건조기를 켜지 않게)
    for (const [i, a] of this.added.entries()) {
      const dev = a.step.device?.deviceId;
      const later = dev ? this.added.slice(i + 1).findIndex((b) => HUMAN_KINDS.includes(b.step.kind) && b.step.target === dev) : -1;
      if (later >= 0) return { ok: false, error: `${i + 1}번 가전 단계는 같은 가전 자리에서 사람이 하는 ${i + 2 + later}번 단계 뒤에 둡니다.` };
    }
    // 손으로 켠 위험 목록 가전은 그 뒤에 같은 가전을 끄는 단계가 있어야 한다(켠 채 끝나는 계획을 받지 않는다)
    for (const [i, a] of this.added.entries()) {
      if (!riskyHand(a.step, this.ctx.devices)) continue;
      const dev = a.step.hand!.deviceId;
      if (!this.added.slice(i + 1).some((b) => b.step.hand?.deviceId === dev && b.step.hand.to === "off")) {
        return { ok: false, error: `켠 가전은 계획 안에서 끕니다: ${i + 1}번 단계 뒤에 ${dev}를 끄는 do(hand_device to off)를 두세요.` };
      }
    }
    const { decision, task, floor, nowIso } = this.ctx;
    const id = planIdOf(decision.id);
    const steps: AgentStep[] = this.added.map((a, i) => ({ ...a.step, id: `${id}:${i + 1}` }));
    // 내려놓기 물건은 앞 집기의 World State 물건이다(없으면 그것으로 채움). 집기·내려놓기 조건의 물건도 그 물건이다
    for (const [i, s] of steps.entries()) {
      // 보이는 물건 집기: 조건이 보는 물건과 들고 있음(person_holding) 물건은 그 물건 id나 그 종류만
      if (s.kind === "pick" && s.object && s.until && [...objectNames(s.until), ...heldNames(s.until)].some((n) => n !== s.object && n !== this.clsOf(s.object!))) {
        return { ok: false, error: `${i + 1}번 집기 until은 집는 물건(${s.object})만 봅니다` };
      }
      // 안 보이는 물건 집기(object 없음): 조건이 보는 물건·든 물건은 이 할 일이 집는 종류여야 한다(병 집기를 컵의 손에 있음으로 끝내지 않게).
      // 집는 종류가 없는 할 일(코치·세탁물)은 보지 않는다
      const carry = task.carry ?? task.target;
      if (s.kind === "pick" && !s.object && s.until && carry && [...objectNames(s.until), ...heldNames(s.until)].some((n) => this.clsOf(n) !== carry)) {
        return { ok: false, error: `${i + 1}번 집기 until은 집는 물건 종류(${carry})만 봅니다` };
      }
      // 그 자리에서 하는 일: 대상이 World State 물건이면 조건은 그 물건 id만, 평면도 자리면 이 할 일의 대상 종류만 본다(다른 컵을 보고 끝내지 않게)
      // 들고 있음(person_holding) 물건도 같은 기준이다(그 컵에 따르면서 다른 컵을 든 것으로 끝내지 않게)
      if (s.kind === "do" && s.until) {
        const names = [...objectNames(s.until), ...heldNames(s.until)];
        const thing = s.target && worldObject(this.ctx.world, s.target) ? s.target : null;
        if (thing && names.some((n) => n !== thing)) return { ok: false, error: `${i + 1}번 do until은 그 일을 받는 물건(${thing})만 봅니다` };
        if (!thing && task.target && names.some((n) => this.clsOf(n) !== task.target)) return { ok: false, error: `${i + 1}번 do until은 이 할 일의 대상 종류(${task.target})만 봅니다` };
      }
      if (s.kind !== "place") continue;
      const picked = steps.slice(0, i).reverse().find((p) => p.kind === "pick")?.object ?? null;
      if (s.object && picked && s.object !== picked) return { ok: false, error: `${i + 1}번 내려놓기 물건(${s.object})이 앞에서 집은 물건(${picked})과 다릅니다` };
      s.object ??= picked;
      if (s.until && objectNames(s.until).some((n) => n !== s.object)) return { ok: false, error: `${i + 1}번 내려놓기 until은 든 물건(${s.object ?? "없음"}) id만 봅니다` };
    }
    const draft: DraftStep[] = steps.map((s, i) => ({ kind: VIEW_KIND[s.kind], label: s.label, ...this.viewTarget(s, steps[i + 1]) }));
    const head: PlanHead = {
      id, goal: task.name, judgment: decision.prediction?.reasoning ?? "", source: "brain", dryRun: !steps.some((s) => s.kind === "device"), nowIso,
    };
    this.done = { view: assemblePlan(walkable(floor), head, draft), steps, task: task.name };
    return { ok: true, plan: this.done };
  }

  /** 단계 대상의 부를 이름: 평면도 물건이면 그 종류의 짧은 이름, World State 물건이면 그 종류 이름. 없으면 null. */
  private nameOf(id: string | null): string | null {
    if (!id) return null;
    const fp = this.ctx.floor.objects.get(id);
    if (fp) return placeShort(fp.type) ?? null;
    const o = worldObject(this.ctx.world, id);
    if (o) return OBJECT_NAME[o.cls] ?? null;
    const d = this.ctx.devices.find((x) => x.id === id);
    return d ? KIND_LABELS[d.kind as keyof typeof KIND_LABELS] ?? null : null;
  }

  /** World State 물건의 종류 이름(item 기본값). */
  private itemOf(id: string | null): string | null {
    const o = id ? worldObject(this.ctx.world, id) : undefined;
    return o ? OBJECT_NAME[o.cls] ?? null : null;
  }

  /** 손 조작 동작의 끝 조건: 그 가전이 이 단계 뒤에 그 상태가 됨. 문 상태가 없는 가전의 열기·닫기는 그 가전 설비(카메라)의 열림·닫힘 사실(지금 값, 그 가전 방).
   *  둘 다 없으면 null(사람이 「완료」로 넘긴다). */
  private handUntil(id: string, to: "on" | "off" | "open" | "close"): Condition | null {
    const d = this.ctx.devices.find((x) => x.id === id);
    const key = d ? HAND_STATES[to].find((k) => (d.twinAttrs[DEVICE_STATES[k].attr] ?? []).includes(DEVICE_STATES[k].value)) : undefined;
    if (key) return { device: id, became: key };
    if (!d || (to !== "open" && to !== "close")) return null;
    const fixture = (Object.keys(CLASSES) as (keyof typeof CLASSES)[]).find((k) => CLASSES[k].role === "fixture" && (CLASSES[k] as { deviceKind?: string }).deviceKind === d.kind && (CLASSES[k].facets as readonly string[]).includes("open"));
    if (!fixture) return null;
    const room = this.ctx.floor.objects.get(id)?.room ?? d.room;
    return { fixture, ...(room ? { room } : {}), facts: { open: to === "open" ? "open" : "closed" } };
  }

  private clsOf(id: string): string {
    return worldObject(this.ctx.world, id)?.cls ?? id.replace(/_\d+$/, "");
  }

  /** 평면도 물건이나 World State 물건의 평면 자리. */
  private placeAt(id: string): XZ | null {
    const fp = this.ctx.floor.objects.get(id);
    if (fp) return fp.position;
    const o = worldObject(this.ctx.world, id);
    return o?.position ? [o.position[0], o.position[2]] : null;
  }

  /** 화면 단계 대상과 이동 목적지. 다음 단계가 자리를 아는 물건 집기(또는 그 물건에 하는 일)면 그 물건 앞까지 간다. */
  private viewTarget(s: Omit<AgentStep, "id">, next: Omit<AgentStep, "id"> | undefined): { target?: PlanTarget; to?: XZ } {
    const fp = s.target ? this.ctx.floor.objects.get(s.target) : undefined;
    if (s.kind === "go" && fp) {
      const at = next?.kind === "pick" ? next.object : next?.kind === "do" ? next.target : null;
      const o = at ? worldObject(this.ctx.world, at) : undefined;
      return { target: { objectId: fp.id, ...(fp.room ? { room: fp.room } : {}) }, to: o?.position ? [o.position[0], o.position[2]] : fp.position };
    }
    const thing = s.kind === "pick" ? s.object : s.kind === "do" ? s.target : null;
    const seen = thing ? worldObject(this.ctx.world, thing) : undefined;
    if (thing && (s.kind === "pick" || seen)) {
      return { target: { objectId: thing, ...(seen?.position ? { position: [seen.position[0], seen.position[2]] as XZ } : {}) } };
    }
    if ((s.kind === "pick" || s.kind === "place" || s.kind === "do") && s.target) return { target: { objectId: s.target } };
    if (s.kind === "device" && s.device) return { target: { deviceId: s.device.deviceId } };
    return {};
  }

  /** 단계 칸이 종류에 맞고 대상·조건·글·시간이 맞는지. 맞으면 실행 단계, 아니면 까닭. */
  private check(a: StepArgs): Added | string {
    const errors: string[] = [];
    const { world, floor, devices } = this.ctx;
    const need = (field: keyof StepArgs, ok: boolean) => { if (!ok) errors.push(`${a.kind}에는 ${field}가 있어야 합니다`); };
    const none = (field: keyof StepArgs) => { if (a[field] !== undefined) errors.push(`${a.kind}에는 ${field}를 쓰지 않습니다`); };
    const human = HUMAN_KINDS.includes(a.kind);
    const allow = this.ctx.task.allow;
    if (!allow.kinds.includes(a.kind)) return `이 할 일(${this.ctx.task.name})에는 ${a.kind} 단계를 쓰지 않습니다. 쓸 수 있는 단계: ${allow.kinds.join(", ")}`;
    // 사람 단계(go·pick·place·do): 모델은 동작(act)·대상·물건(item)만 고른다. 단계 이름·폰 명령은 서버 글 틀(STEP_TEXT)로 만들고 모델이 쓴 문장은 받지 않는다
    if (human) {
      need("act", a.act !== undefined);
      if (a.act && !(STEP_ACTS[a.kind as keyof typeof STEP_ACTS] as readonly string[]).includes(a.act)) {
        errors.push(`${a.kind}에는 act ${a.act}를 쓰지 않습니다. 쓸 수 있는 act: ${STEP_ACTS[a.kind as keyof typeof STEP_ACTS].join(", ")}`);
      }
    } else {
      none("act");
      if (a.kind !== "say") none("item");
    }
    // 단계 이름은 가전 단계(device)만 모델이 쓴다(정책 승인 길이라 위험 가전 이름도 받는다). 알림·기다리기는 열쇠(notice), 질문의 답은 묶음 이름으로 고른다
    if (a.kind === "device") need("label", !!a.label);
    if (a.kind !== "say" && a.kind !== "wait") none("notice");
    // 모델이 쓰는 글은 질문 하나다: 위험 가전 이름이 나오면 버린다
    if (a.question !== undefined && riskyNames(a.question).length) errors.push(`question: ${RISKY_NAME_PROBLEM}`);
    if (a.kind !== "ask") { none("question"); none("choices"); }
    if (a.kind !== "device") { none("tool"); none("args"); }
    if (a.kind !== "pick" && a.kind !== "place") none("object");
    // 손으로 다루는 가전은 그 동작(켜기·끄기·열기·닫기)에만: 같은 대상, 같은 동작이어야 한다
    const handTo = a.act ? HAND_ACT[a.act] : undefined;
    if (a.kind === "do" && handTo) {
      const kind = devices.find((d) => d.id === a.target)?.kind;
      if (!kind) errors.push(`손 조작 동작(${a.act})은 가전 대상에만 씁니다: ${a.target ?? "대상 없음"}`);
      else if (!DEVICE_ACTS[kind]?.includes(a.act!)) errors.push(`${KIND_LABELS[kind as keyof typeof KIND_LABELS] ?? kind}에는 ${a.act}를 하지 않습니다. 쓸 수 있는 동작: ${DEVICE_ACTS[kind]?.join(", ") || "없음"}`);
      if (!a.hand_device || a.hand_device.id !== a.target || a.hand_device.to !== handTo) errors.push(`${a.act}에는 hand_device {"id": target, "to": "${handTo}"}가 있어야 합니다(같은 대상, 같은 동작)`);
    } else none("hand_device");
    let target: string | null = a.target ?? null;
    let object: string | null = a.object ?? null;
    const live = (id: string) => { const o = worldObject(world, id); return o && o.status !== "gone" ? o : undefined; };
    // 실행 추적이 놓기를 끝낸 물건(입력 줄 「이미 치움」)은 다시 집거나 놓지 않는다(실행 전 검사가 막아 계획이 끝나 버린다)
    const putAway = (id: string | null) => { if (id && this.ctx.placed?.has(id)) errors.push(`이미 치운 물건입니다(앞 계획이 놓기를 끝냄): ${id}. 「이미 치움」이 없는 물건을 쓰세요`); };
    // 집는 물건 종류: 따로 정한 것(carry, 채워 주기의 병)이 없으면 그 할 일의 대상 종류다
    const carry = this.ctx.task.carry ?? this.ctx.task.target;
    switch (a.kind) {
      case "go":
        need("target", !!target);
        if (target && !floor.objects.has(target)) {
          const inRoom = floor.rooms.some((r) => r.id === target) ? [...floor.objects.values()].filter((o) => o.room === target).map((o) => o.id) : [];
          errors.push(`go target은 평면도 물건 id여야 합니다(방 id 아님): ${target}${inRoom.length ? `. 그 방 물건: ${inRoom.slice(0, 8).join(", ")}` : ""}`);
        }
        break;
      case "pick":
        need("target", !!target);
        if (target && live(target)) object ??= target;
        else if (target && !floor.objects.has(target)) errors.push(`pick target은 보이는 World State 물건 id나 평면도 id여야 합니다: ${target}`);
        if (object && !live(object)) errors.push(`보이는 World State 물건이 아닙니다: ${object}`);
        // 안 보이는 물건(냉장고 안 병)은 그 할 일이 받을 때만(carryUnseen) 평면도 자리로 집는다
        if (carry && (object ? worldObject(world, object)?.cls !== carry : !this.ctx.task.carryUnseen)) errors.push(`이 할 일은 ${carry} 물건을 집습니다`);
        putAway(object);
        break;
      case "place":
        need("target", !!target);
        if (target && !floor.objects.has(target)) errors.push(`place target은 평면도 id여야 합니다: ${target}`);
        if (object && !worldObject(world, object)) errors.push(`World State 물건이 아닙니다: ${object}`);
        if (object && carry && worldObject(world, object)?.cls !== carry) errors.push(`이 할 일은 ${carry} 물건을 내려놓습니다`);
        putAway(object);
        break;
      case "do":
        need("target", !!target);
        // 손 조작 동작(켜기·끄기·열기·닫기)은 [가전] id도 대상으로 받는다(평면도에 없는 가전)
        if (target && !live(target) && !floor.objects.has(target) && !(handTo && devices.some((x) => x.id === target))) errors.push(`do target은 보이는 World State 물건 id나 평면도 id여야 합니다: ${target}`);
        if (target && live(target) && this.ctx.task.target && live(target)!.cls !== this.ctx.task.target) errors.push(`이 할 일은 ${this.ctx.task.target} 물건에 합니다`);
        putAway(target);

        break;
      case "device": {
        need("target", !!target);
        need("tool", !!a.tool);
        const d = target ? devices.find((x) => x.id === target) : undefined;
        if (target && !d) errors.push(`이 집에 없는 가전입니다: ${target}`);
        if (a.args && Object.hasOwn(a.args, "device_id")) errors.push("args에 device_id를 쓰지 않습니다. 가전은 target 하나로 정합니다");
        const ok = allow.devices;
        if (d && ok && !ok.kinds.includes(d.kind)) errors.push(`이 할 일에는 ${d.kind} 가전을 쓰지 않습니다. 쓸 수 있는 가전: ${ok.kinds.join(", ")}`);
        if (a.tool && ok && !ok.tools.includes(a.tool)) errors.push(`이 할 일에는 ${a.tool} 도구를 쓰지 않습니다. 쓸 수 있는 도구: ${ok.tools.join(", ")}`);
        if (!ok) errors.push("이 할 일에는 가전 단계를 쓰지 않습니다");
        const tool = a.tool ? TOOLS.find((t) => t.name === a.tool) : undefined;
        if (tool && d) {
          const parsed = tool.schema.safeParse({ ...(a.args ?? {}), device_id: d.id });
          if (!parsed.success) errors.push(`${a.tool} 인자: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
        }
        break;
      }
      case "ask": {
        none("target");
        need("question", !!a.question);
        need("choices", !!a.choices);
        if (a.question && !/\?$/.test(a.question.trim())) errors.push("question은 「?」로 끝나야 합니다");
        // 질문은 묻는 말이다: 사람에게 하는 부탁(「주세요」)을 섞지 않는다
        if (a.question && /주세요/.test(a.question)) errors.push("question에는 「주세요」를 쓰지 않습니다(묻는 말만)");
        break;
      }
      case "say":
        none("target");
        need("notice", !!a.notice);
        break;
      case "wait":
        need("until", a.until !== undefined);
        need("notice", !!a.notice);
        if (a.notice && !NOTICES[a.notice]?.wait) errors.push(`wait에 쓰지 않는 notice입니다: ${a.notice}. 쓸 수 있는 것: ${NOTICE_KEYS.filter((k) => NOTICES[k]!.wait).join(", ")}`);
        break;
    }
    let until: Condition | null = null;
    // 손 조작 동작(켜기·끄기·열기·닫기)의 끝 조건은 서버가 만든다: 모델 until은 보지도 쓰지도 않는다
    if (a.until !== undefined && !(a.kind === "do" && handTo)) {
      const c = ConditionSchema.safeParse(a.until);
      if (!c.success) errors.push(`until이 조건 낱말 모양이 아닙니다: ${c.error.issues.slice(0, 3).map((i) => `${i.path.join(".") || "(전체)"}: ${i.message}`).join("; ")}`);
      else {
        until = c.data;
        const bad = checkCondition(until, this.home);
        errors.push(...bad.map((e) => `until: ${e}`));
        if (bad.some((e) => e.startsWith("물건 종류나 id가 아님"))) errors.push("World State 물건 종류에 없는 것(세탁물 등)은 until 없이 두면 사람이 「완료」로 넘깁니다");
        for (const name of objectNames(until)) if (isId(name) && !worldObject(world, name)) errors.push(`until: World State에 없는 물건 id: ${name}`);
      }
      // 기기 결과를 확인하는 조건은 그 가전의 상태 하나이고, 그 도구가 만드는 상태다(다른 가전·종류·시간으로 확인을 건너뛰지 않게)
      if (until && a.kind === "device") {
        const states = a.tool ? TOOL_STATES[a.tool] : undefined;
        if (!states) errors.push(`${a.tool} 결과는 상태 하나로 확인하지 못해 until을 쓰지 않습니다`);
        else if (!("device" in until && "state" in until && until.device === target && states.includes(until.state))) {
          errors.push(`device until은 {"device": target, "state": ${states.join("|")}} 하나입니다`);
        }
      }
    } else if (a.kind === "go" && target && floor.objects.has(target)) until = { phone_near: target };
    else if (a.kind === "say") until = { elapsed_s: SAY_HOLD_S };
    const [lo, hi] = PLAN_LIMITS.timeoutS[a.kind];
    if (a.timeout_s < lo || a.timeout_s > hi) errors.push(`${a.kind} timeout_s는 ${lo}~${hi}초입니다`);
    errors.push(...(a.kind === "device" ? copyProblem("label", a.label) : []), ...copyProblem("question", a.question));
    // 사람 단계 글은 서버가 만든다: 동작 틀에 대상·물건 이름을 넣는다
    let server: { label: string; command: string; caution: string | null } | null = null;
    if (human && a.act && !errors.length) {
      const name = this.nameOf(target);
      // 집고 놓는 물건이 World State 물건이면 item 대신 그 종류 이름을 쓴다(보이는 물건을 다른 이름으로 부르지 않는다)
      const own = a.kind === "pick" || a.kind === "place" ? this.itemOf(object) : null;
      const item = own ?? a.item ?? null;
      const made = name ? STEP_TEXT[`${a.kind}:${a.act}`]?.({ place: name, item }) ?? null : null;
      if (!name) errors.push(`대상 ${target ?? "없음"}에는 부를 이름이 없어 고를 수 없습니다`);
      else if (!made) errors.push(`${a.kind} ${a.act}에는 item(물건 이름)이 있어야 합니다`);
      else if (!errors.length) {
        const kind = devices.find((d) => d.id === target)?.kind;
        server = { ...made, caution: handTo === "on" && kind ? CAUTION_LINE[kind] ?? null : null };
        // 손 조작 동작(켜기·끄기·열기·닫기)의 끝 조건은 서버가 그 가전의 바뀐 상태로 만든다(모델 until은 쓰지 않는다): 전부터 남아 있던 값으로 넘어가지 않는다
        if (handTo && kind) until = this.handUntil(target!, handTo);
      }
    }
    if (errors.length) return errors.join("; ");
    // 단계 이름: 사람 단계는 동작 틀, 알림·기다리기는 열쇠, 질문은 고정 이름, 가전 단계만 모델 이름
    const notice = a.notice ? NOTICES[a.notice]! : null;
    const label = server?.label ?? (a.kind === "say" ? noticeLabel(a.notice!) : a.kind === "wait" ? notice!.wait! : a.kind === "ask" ? STEP_LABEL.askUser : a.label ?? "");
    const step: Omit<AgentStep, "id"> = {
      kind: a.kind, label, target, object, command: server?.command ?? null,
      prompt: a.kind === "ask" ? { text: a.question!.trim(), choices: ASK_CHOICES[a.choices!], ends: [] } : null,
      text: a.kind === "say" ? notice!.say(a.item ?? null) : null,
      device: a.kind === "device" ? { tool: a.tool!, deviceId: target!, args: a.args ?? {} } : null,
      hand: a.kind === "do" && handTo && a.hand_device ? { deviceId: a.hand_device.id, to: a.hand_device.to } : null, caution: server?.caution ?? null,
      until, timeoutMs: a.timeout_s * 1000, onTimeout: a.on_timeout ?? "fail",
    };
    return { step, at: a.kind === "go" && target ? this.placeAt(target) : null };
  }
}

/** World State 요약(read_world, 입력 글과 같은 내용). */


/** 사람이 걷는 평면도: 로봇 이동 가능 방(단차 있는 발코니·욕실 제외) 대신 모든 방. */
export const walkable = (fp: FloorPlan): FloorPlan => ({ ...fp, robot: { ...fp.robot, reachable: fp.rooms.map((r) => r.id) } });

/** submit_plan 인자: 계획 전체(단계 번호는 배열 순서). 모델에게 단계 칸 설명을 보이려고 STEP_ARGS 모양을 쓴다. */
export const SUBMIT_ARGS = z.object({
  steps: z.array(STEP_ARGS.omit({ step: true })).min(1).max(PLAN_LIMITS.hardMaxSteps).describe("계획 전체. 1번 단계부터 순서대로. 단계 수 한도는 할 일마다 다르다"),
});

/** 계획 모드 도구: 계획 전체를 한 번에 내는 submit_plan 하나(입력에 집 상태가 다 있어 읽기·길 도구는 없다). 기기를 바꾸는 도구도 없다. */
export function planTools(draft: PlanDraft): ToolDef[] {
  return [{
    name: SUBMIT_PLAN, title: "계획 내기",
    description: "계획 전체(단계 배열)를 한 번에 냅니다. 검사를 통과하면 그대로 끝나고, 틀리면 첫 틀린 단계와 까닭을 돌려주니 고친 계획 전체를 다시 내세요.",
    schema: SUBMIT_ARGS,
    run: async (_b, args) => {
      const r = draft.submit(args);
      return r.ok ? { ok: true, data: { steps: r.plan.steps.length } } : { ok: false, error: r.error };
    },
  }];
}
