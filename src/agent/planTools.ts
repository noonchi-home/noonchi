// 에이전트 계획 모드의 도구와 계획 검사(docs/superpowers/plans/2026-11-10-agent-plans.md).
// 에이전트는 submit_plan 한 번으로 계획 전체를 낸다. 낼 때마다 전체를 새로 검사해 틀리면 첫 틀린 단계와 이유를 돌려준다(모델이 고친 전체를 다시 낸다).
// 경로는 모델이 아니라 assemblePlan(src/plan/planner.ts)이 이동 단계마다 잇는다. 기기를 바꾸는 도구는 계획 모드에 없다:
// 기기 단계는 도구 이름·인자만 적어 두고, 실행 추적(src/act/track.ts)이 그 단계가 되면 정책(승인 규칙)을 거쳐 부른다.
import { z } from "zod";
import { copyRules } from "../plan/copy.js";
import type { ActionChoice, ActionPrompt } from "../act/prompts.js";
import { planIdOf, type Placed, type TaskSpec } from "../act/tasks.js";
import type { DeviceView } from "../contract/events.js";
import type { DraftStep, PlanHead } from "../plan/planner.js";
import { assemblePlan } from "../plan/planner.js";
import type { PlanTarget, PlanView, StepKind, XZ } from "../contract/plan.js";
import type { WorldObject, WorldView } from "../contract/world.js";
import type { RoomSpec } from "../hub/types.js";
import type { FloorPlan } from "../plan/floor.js";
import { DEVICE_VERB } from "../plan/labels.js";
import { ConditionSchema, checkCondition, type Condition, type ConditionHome } from "../world/conditions.js";
import type { DecisionRecord } from "../world/decide.js";
import { TOOLS, type ToolDef, type ToolResult } from "./tools.js";

/** 에이전트 단계 종류. go·pick·place는 사람이 하는 일(실제 폰 명령), ask 질문, say 알림, device 가전 조작, wait 기다리기. */
export type AgentStepKind = "go" | "pick" | "place" | "device" | "ask" | "say" | "wait";
export const HUMAN_KINDS: readonly AgentStepKind[] = ["go", "pick", "place"];
/** 에이전트 단계 → 화면 단계 종류(src/contract/plan.ts). */
export const VIEW_KIND: Record<AgentStepKind, StepKind> = { go: "move", pick: "act", place: "act", ask: "ask", say: "ask", device: "device", wait: "wait" };

/** 알림 단계에 끝나는 조건이 없으면 이만큼(초) 뒤에 넘긴다. */
export const SAY_HOLD_S = 4;

/** 계획 한도: 단계 수, 단계 종류마다 시간 한도(초), 답 단추 수. */
export const PLAN_LIMITS = {
  maxSteps: 8,
  timeoutS: { go: [10, 1800], pick: [10, 1800], place: [10, 1800], ask: [10, 1800], say: [SAY_HOLD_S + 1, 600], device: [10, 600], wait: [10, 14_400] } as Record<AgentStepKind, [number, number]>,
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
  /** go·place: 평면도 id, pick: World State 물건 id 또는 평면도 id, device: 가전 id. */
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
}

const choiceSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9_]{0,19}$/).describe("답 id(영문 소문자·숫자·_)"),
  label: z.string().min(1).max(20).describe("답 단추 글"),
  words: z.array(z.string().min(1).max(20)).max(5).optional().describe("말로 답할 때 이 답으로 볼 말"),
  reply: z.string().max(60).optional().describe("말로 답하면 폰이 읽어 줄 짧은 글"),
  ends_plan: z.boolean().optional().describe("true면 이 답을 받으면 계획을 끝낸다"),
});

/** 단계 하나의 인자(submit_plan steps의 한 칸 + 번호). 종류마다 쓰는 칸은 PlanDraft.add가 본다. */
export const STEP_ARGS = z.object({
  step: z.number().int().min(1).describe("몇 번째 단계인지(1부터). 고칠 때는 같은 번호로 다시 보낸다"),
  kind: z.enum(["go", "pick", "place", "device", "ask", "say", "wait"]).describe("go 이동·pick 집기·place 내려놓기(사람이 함), device 가전 조작, ask 질문, say 알림, wait 기다리기"),
  label: z.string().min(1).max(30).describe("화면 단계 이름(예: 식탁으로 가기)"),
  target: z.string().min(1).optional().describe("go·place: 평면도 id, pick: World State 물건 id 또는 평면도 id, device: 가전 id"),
  object: z.string().min(1).optional().describe("pick·place: 든 World State 물건 id"),
  command: z.string().min(1).max(60).optional().describe("go·pick·place: 사람에게 하는 말, 「주세요」로 끝남"),
  question: z.string().min(1).max(60).optional().describe("ask: 질문, 「?」로 끝남"),
  choices: z.array(choiceSchema).optional().describe("ask: 답 2~3개"),
  text: z.string().min(1).max(60).optional().describe("say: 폰이 읽을 알림 한 줄"),
  tool: z.enum(DEVICE_TOOLS).optional().describe("device: 기기를 바꾸는 도구 이름"),
  args: z.record(z.string(), z.unknown()).optional().describe("device: 그 도구 인자(device_id 빼고)"),
  until: z.record(z.string(), z.unknown()).optional().describe("끝나는 조건: World State 조건 JSON(조건 낱말의 키만). wait에는 꼭. place는 자리 사실 또는 트윈 자리(손에 없음, not in_hand)를 any로 묶고, 그 any와 사람이 들고 있지 않음(not person_holding)을 all로 묶는다. 트윈 자리는 위에 놓기면 놓을 면(target) 위, 안에 넣기(싱크대)면 그 면의 싱크볼 안(part basin). 물건 조건은 모두 follow: true"),
  timeout_s: z.number().int().describe("이 단계 시간 한도(초)"),
  on_timeout: z.enum(["ask", "fail"]).optional().describe("시간이 지나면 ask 계속할지 묻기, fail 실패(기본)"),
});
export type StepArgs = z.infer<typeof STEP_ARGS>;

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

  /** 단계 하나를 검사하고 그 번호(step) 자리에 둔다. 이미 있는 번호면 그 단계와 뒤 단계를 지우고 다시 둔다(고쳐 다시 보낼 때).
   *  틀리면 그 번호부터 지우고 까닭을 돌려준다(모델에게 돌려줄 한국어). 그 뒤 번호는 앞 번호가 없어 받지 않는다. */
  add(raw: unknown): { ok: true; step: number } | { ok: false; error: string } {
    if (this.done) return { ok: false, error: "이미 끝낸 계획입니다." };
    const parsed = STEP_ARGS.safeParse(raw);
    if (!parsed.success) return { ok: false, error: parsed.error.issues.map((i) => `${i.path.join(".") || "(전체)"}: ${i.message}`).join("; ") };
    const n = parsed.data.step;
    if (n > PLAN_LIMITS.maxSteps) return { ok: false, error: `단계는 ${PLAN_LIMITS.maxSteps}개까지입니다.` };
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
    if (steps.length > PLAN_LIMITS.maxSteps) return again(`단계는 ${PLAN_LIMITS.maxSteps}개까지입니다.`);
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
    const { decision, task, floor, nowIso } = this.ctx;
    const id = planIdOf(decision.id);
    const steps: AgentStep[] = this.added.map((a, i) => ({ ...a.step, id: `${id}:${i + 1}` }));
    // 내려놓기 물건은 앞 집기의 World State 물건이다(없으면 그것으로 채움). 집기·내려놓기 조건의 물건도 그 물건이다
    for (const [i, s] of steps.entries()) {
      if (s.kind === "pick" && s.object && s.until && objectNames(s.until).some((n) => n !== s.object && n !== this.clsOf(s.object!))) {
        return { ok: false, error: `${i + 1}번 집기 until은 집는 물건(${s.object})만 봅니다` };
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

  /** 화면 단계 대상과 이동 목적지. 다음 단계가 자리를 아는 물건 집기면 그 물건 앞까지 간다. */
  private viewTarget(s: Omit<AgentStep, "id">, next: Omit<AgentStep, "id"> | undefined): { target?: PlanTarget; to?: XZ } {
    const fp = s.target ? this.ctx.floor.objects.get(s.target) : undefined;
    if (s.kind === "go" && fp) {
      const o = next?.kind === "pick" && next.object ? worldObject(this.ctx.world, next.object) : undefined;
      return { target: { objectId: fp.id, ...(fp.room ? { room: fp.room } : {}) }, to: o?.position ? [o.position[0], o.position[2]] : fp.position };
    }
    if (s.kind === "pick" && s.object) {
      const o = worldObject(this.ctx.world, s.object);
      return { target: { objectId: s.object, ...(o?.position ? { position: [o.position[0], o.position[2]] as XZ } : {}) } };
    }
    if ((s.kind === "pick" || s.kind === "place") && s.target) return { target: { objectId: s.target } };
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
    if (human) {
      need("command", a.command !== undefined);
      if (a.command !== undefined && !/주세요$/.test(a.command.trim())) errors.push("command는 사람에게 하는 부탁이라 「주세요」로 끝나야 합니다(예: 컵을 들어 주세요)");
    } else none("command");
    if (a.kind !== "ask") { none("question"); none("choices"); }
    if (a.kind !== "say") none("text");
    if (a.kind !== "device") { none("tool"); none("args"); }
    if (a.kind !== "pick" && a.kind !== "place") none("object");
    let target: string | null = a.target ?? null;
    let object: string | null = a.object ?? null;
    const live = (id: string) => { const o = worldObject(world, id); return o && o.status !== "gone" ? o : undefined; };
    // 실행 추적이 놓기를 끝낸 물건(입력 줄 「이미 치움」)은 다시 집거나 놓지 않는다(실행 전 검사가 막아 계획이 끝나 버린다)
    const putAway = (id: string | null) => { if (id && this.ctx.placed?.has(id)) errors.push(`이미 치운 물건입니다(앞 계획이 놓기를 끝냄): ${id}. 「이미 치움」이 없는 물건을 쓰세요`); };
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
        if (this.ctx.task.target && worldObject(world, object ?? "")?.cls !== this.ctx.task.target) errors.push(`이 할 일은 ${this.ctx.task.target} 물건을 집습니다`);
        putAway(object);
        break;
      case "place":
        need("target", !!target);
        if (target && !floor.objects.has(target)) errors.push(`place target은 평면도 id여야 합니다: ${target}`);
        if (object && !worldObject(world, object)) errors.push(`World State 물건이 아닙니다: ${object}`);
        if (object && this.ctx.task.target && worldObject(world, object)?.cls !== this.ctx.task.target) errors.push(`이 할 일은 ${this.ctx.task.target} 물건을 내려놓습니다`);
        putAway(object);
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
        if (a.question && !/\?$/.test(a.question.trim())) errors.push("question은 「?」로 끝나야 합니다");
        const choices = a.choices ?? [];
        const [lo, hi] = PLAN_LIMITS.choices;
        if (choices.length < lo || choices.length > hi) errors.push(`choices는 ${lo}~${hi}개입니다`);
        if (new Set(choices.map((c) => c.id)).size !== choices.length) errors.push("choices id가 겹칩니다");
        for (const c of choices) errors.push(...copyProblem(`답 ${c.id}`, c.label), ...copyProblem(`답 ${c.id} reply`, c.reply || undefined));
        break;
      }
      case "say":
        none("target");
        need("text", !!a.text);
        // 알림은 지금 상태를 알리는 말이다. 클로이드가 스스로 하겠다는 말(「옮길게요」)이나 부탁(「주세요」)은 받지 않는다
        if (a.text && /(게요|주세요)[.!]?$/.test(a.text.trim())) errors.push("say text는 지금 상태를 알리는 말입니다(예: 세탁이 끝났어요). 「…게요」·「…주세요」로 끝내지 않습니다");
        break;
      case "wait":
        need("until", a.until !== undefined);
        break;
    }
    let until: Condition | null = null;
    if (a.until !== undefined) {
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
    errors.push(...copyProblem("label", a.label), ...copyProblem("command", a.command), ...copyProblem("question", a.question), ...copyProblem("text", a.text));
    if (errors.length) return errors.join("; ");
    const choices: ActionChoice[] = (a.choices ?? []).map((c) => ({ id: c.id, label: c.label, words: c.words ?? [], reply: c.reply ?? "" }));
    const step: Omit<AgentStep, "id"> = {
      kind: a.kind, label: a.label, target, object, command: a.command?.trim() ?? null,
      prompt: a.kind === "ask" ? { text: a.question!.trim(), choices, ends: (a.choices ?? []).filter((c) => c.ends_plan).map((c) => c.id) } : null,
      text: a.text?.trim() ?? null,
      device: a.kind === "device" ? { tool: a.tool!, deviceId: target!, args: a.args ?? {} } : null,
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
  steps: z.array(STEP_ARGS.omit({ step: true })).min(1).max(PLAN_LIMITS.maxSteps).describe("계획 전체. 1번 단계부터 순서대로"),
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
