// 실행 추적: 판단 → 계획 → 실행 중 → 완료 또는 실패. 단계마다 execution 기록을 낸다(plan_id는 plan:<판단 id>).
// 실제 폰은 에이전트의 손이다(src/contract/phone.ts): 계획의 단계마다 사람에게 명령 하나를 보내고(소리로도 읽음), 그 단계가 됐는지를
// 폰 눈 위치(이동: 목표에서 arriveM 안)와 World State(집기: 컵이 손에 있음·사람이 물건을 들고 있음, 내려놓기: 컵이 싱크대 안)로 본 뒤
// 다음 명령을 보낸다. 한 번 볼 때(tick·World State 변화·답) 한 단계만 넘긴다. 마지막 단계가 되면 명령을 지우고 계획을 완료로 닫는다.
// 「완료」(단추·말)는 지금 단계 하나를 넘기고, 말로 「그만」이면 계획을 그만둔다. 한 단계가 repeatMs마다 명령을 다시 읽고
// stepTimeoutMs가 지나면 실패로 닫는다(폰을 닫고 나가도 이렇게 끝난다). 비전 상태는 바뀔 때만, visionMs에 한 번까지 보낸다.
// 물어보기는 같은 자리에 질문과 답 단추를 띄우고 답을 받으면 완료. PlanHub 단계 상태(active·done)가 지금 단계를 따라간다.
// 명령마다 대상 하나(식탁·그 컵·싱크대, 트윈 자리)를 같이 보내 실제 폰이 그것에만 고리를 그린다.
// 실행 전 검사는 통과할 때까지 tick마다 다시 보고, recheckMs가 지나도 안 되면 그 이유로 실패한다.
// 승인(src/agent/approval.ts): 검사를 통과한 PAM 계획이 처음 하는 일이면(승인을 받은 적 없음) 첫 단계 전에 실제 폰에 「…를 할까요?」와
// 답 둘(승인·거절)을 띄우고 답을 기다린다(그동안 계획은 planned). 승인이면 기억하고 첫 단계로, 거절이면 기억하지 않고 취소로 닫는다(다음 판단은 또 묻는다).
// 질문 계획(사용자에게 물어보기)은 묻는 일 자체라 승인을 묻지 않는다.
// 로봇은 한 번에 한 계획만 실행한다: 진행 중인 계획과 행동·대상이 같은 판단은 기록만 하고, 지금 계획보다 먼저 보낸(seq가 작은) 판단은 버린다.
// 대상 컵: 기준점을 맞춘 뒤 컵이 identityM 넘게 움직이면 World State가 새 id를 붙인다(src/world/state.ts). 그래서 계획을 만들 때 고른 컵과
// 그 뒤에 새로 생긴 같은 종류 물건을 모두 그 컵으로 본다(계획 전부터 있던 다른 컵은 빼고). 대상이 그중 하나로 바뀌거나 안 보여도 같은 행동이다.
import type { BrainLog, ExecState } from "../contract/events.js";
import type { PlannedCommand, PlannedCommandMessage } from "../contract/phone.js";
import type { PlanStep, PlanView, XZ } from "../contract/plan.js";
import type { WorldObject, WorldView } from "../contract/world.js";
import type { FloorPlan } from "../plan/floor.js";
import type { PlanHub } from "../plan/hub.js";
import { APPROVAL_TEXT, EXEC_TEXT, STEP_COMMAND, VISION_TEXT } from "../plan/labels.js";
import { PLACE_UNKNOWN, STATE_TEXT, onSurface } from "../world/labels.js";
import type { DecisionRecord } from "../world/decide.js";
import { approvalNeed, taskKey, type ApprovalAnswer, type ApprovalBook } from "../agent/approval.js";
import type { CheckResult } from "./check.js";
import { APPROVE, STEP_DONE, STOP, type ActionChoice } from "./prompts.js";
import { cupStepOf, holdsTarget, matchChoice, planFor, planIdOf, targetOf, taskOf, type CupStep, type TaskSpec } from "./tasks.js";

export interface TrackerOptions {
  plans: PlanHub;
  world: () => WorldView;
  /** 실행 전 검사(src/act/check.ts checkPlan). */
  check: (d: DecisionRecord, plan: PlanView) => CheckResult;
  floor: () => FloorPlan;
  /** 실제 폰으로 보낸다: 명령(command)·지우기(command_clear). 폰 서버가 명령 대상 자리를 AR 자리로 바꾼다. */
  toPhone: (msg: PlannedCommandMessage) => void;
  /** 평면도 물건(식탁·싱크대)의 이름과 트윈 자리 [x, 높이, y](명령 대상 고리). 모르면 undefined. */
  locate?: (id: string) => { label: string; position: [number, number, number] } | undefined;
  emit: (l: BrainLog) => void;
  /** 승인 기억(task:<행동 이름>). 처음 하는 계획은 묻고, 답을 남긴다. */
  approvals: ApprovalBook;
  clock?: { now(): number };
  /** 이동 단계: 폰 눈이 목표 물건(평면도 자리)에서 이 거리(m) 안이면 도착. */
  arriveM?: number;
  /** 한 단계가 이만큼(ms) 안 끝나면 명령을 다시 소리로 읽는다(그 뒤로도 이만큼마다). */
  repeatMs?: number;
  /** 한 단계가 이만큼(ms) 안 끝나면 실패로 닫는다. */
  stepTimeoutMs?: number;
  /** 비전 상태를 이보다 자주(ms) 보내지 않는다. */
  visionMs?: number;
  /** 검사를 다시 보는 시간(ms). */
  recheckMs?: number;
}

/** 기본값: 도착 1.2m(식탁·싱크대 가장자리에 선 사람 손의 폰), 다시 읽기 30초, 단계 실패 2분, 비전 상태 0.5초에 한 번, 검사 3초. */
export const TRACK_DEFAULTS = { arriveM: 1.2, repeatMs: 30_000, stepTimeoutMs: 120_000, visionMs: 500, recheckMs: 3000 } as const;

/** targetId: 계획을 만들 때 World State에서 고른 대상 물건(없으면 null). others: 그때 있던 같은 종류의 다른 물건. at: 지금 단계 번호(실행 전 -1).
 *  sent: 실제 폰에 띄운 지금 명령. asking: 첫 단계 전 승인 질문을 띄우고 답을 기다리는 중. */
interface Run {
  plan: PlanView; decision: DecisionRecord; spec: TaskSpec; targetId: string | null; others: ReadonlySet<string>; state: ExecState; since: number;
  at: number; stepAt: number; spokeAt: number; visionAt: number; sent: PlannedCommand | null; asking: boolean;
}

/** 승인 질문 단계 id. */
const approveStep = (planId: string) => `${planId}:approve`;

const OPEN = new Set<ExecState>(["planned", "running", "verifying"]);

export class ExecutionTracker {
  private run: Run | null = null;
  private lastSeq = 0;
  private stopped = false;
  private eye: XZ | null = null;
  private readonly clock: { now(): number };
  private readonly cfg: { arriveM: number; repeatMs: number; stepTimeoutMs: number; visionMs: number; recheckMs: number };

  constructor(private readonly o: TrackerOptions) {
    this.clock = o.clock ?? { now: () => Date.now() };
    this.cfg = {
      arriveM: o.arriveM ?? TRACK_DEFAULTS.arriveM, repeatMs: o.repeatMs ?? TRACK_DEFAULTS.repeatMs, stepTimeoutMs: o.stepTimeoutMs ?? TRACK_DEFAULTS.stepTimeoutMs,
      visionMs: o.visionMs ?? TRACK_DEFAULTS.visionMs, recheckMs: o.recheckMs ?? TRACK_DEFAULTS.recheckMs,
    };
  }

  current(): { planId: string; state: ExecState } | null {
    return this.run && { planId: this.run.plan.id, state: this.run.state };
  }

  /** 실제 폰에 띄운 지금 명령·질문(답을 기다리는 중). 승인 질문은 질문(ask)이다. 없으면 null. */
  openCommand(): { planId: string; stepId: string; kind: TaskSpec["kind"]; text: string; choices: ActionChoice[] } | null {
    const r = this.shown();
    return r && { planId: r.plan.id, stepId: r.sent.step, kind: r.asking ? "ask" : r.spec.kind, text: r.sent.text, choices: choicesOf(r) };
  }

  onDecision(d: DecisionRecord): void {
    if (this.stopped) return;
    if (d.seq < this.lastSeq) return this.note(d, EXEC_TEXT.late);
    const spec = taskOf(d.action);
    if (d.status !== "valid") return this.note(d, EXEC_TEXT.decisionFailed);
    if (!d.action) return this.note(d, EXEC_TEXT.wait);
    const world = this.o.world();
    const targetId = spec ? targetOf(spec, world)?.id ?? null : null;
    const open = this.run && OPEN.has(this.run.state) ? this.run : null;
    if (open && spec && open.spec.name === spec.name && (targetId === null || isOurs(open, targetId))) return this.note(d, EXEC_TEXT.same);
    this.lastSeq = d.seq;
    const now = this.clock.now();
    const plan = spec && planFor(this.o.floor(), d, world, new Date(now).toISOString());
    // 새 계획이 있으면 PlanHub.onDecision이 지금 계획을 취소로 닫고 supersedes를 단다
    if (open) this.finish("failed", EXEC_TEXT.superseded, plan ? null : "cancelled");
    if (!spec || !plan) {
      this.emit(planIdOf(d.id), "decided");
      this.emit(planIdOf(d.id), "failed", EXEC_TEXT.noPlan);
      return;
    }
    const others = new Set(spec.target ? world.objects.filter((o) => o.cls === spec.target && o.id !== targetId).map((o) => o.id) : []);
    this.run = { plan, decision: d, spec, targetId, others, state: "decided", since: now, at: -1, stepAt: now, spokeAt: now, visionAt: now, sent: null, asking: false };
    this.step("decided");
    this.o.plans.onDecision(plan);
    this.step("planned");
    this.tryStart(false);
  }

  /** 폰 눈(맞춘 자세)의 평면 자리 [x, z]. 맞추기 전 추정 눈은 쓰지 않는다. 이동 단계는 다음 tick에 본다. */
  onEye(position: XZ, estimated = false): void {
    if (estimated || !position.every(Number.isFinite)) return;
    this.eye = [position[0], position[1]];
  }

  /** 답 단추(「완료」·질문 답·승인 답). 지금 명령의 계획·단계·답이 아니면 무시한다. 받았으면 true. */
  onAnswer(planId: string, stepId: string, choice: string): boolean {
    const r = this.shown();
    if (!r || r.plan.id !== planId || r.sent.step !== stepId) return false;
    const picked = choicesOf(r).find((c) => c.id === choice);
    if (!picked) return false;
    if (r.asking) this.approved(r, picked.id as ApprovalAnswer);
    else if (r.spec.kind === "ask") this.finish("done", EXEC_TEXT.answered(picked.label));
    else this.advance(r);
    return true;
  }

  /** 폰에서 들은 말. 「그만」이면 계획을 그만두고, 지금 명령의 답(「완료」「다 했어」, 질문 답)이면 그 답으로 받는다. 받은 답, 아니면 null. */
  onHeard(text: string): ActionChoice | null {
    const r = this.shown();
    if (!r) return null;
    if (matchChoice(text, [STOP])) {
      this.finish("failed", EXEC_TEXT.stopped, "cancelled");
      return STOP;
    }
    const picked = matchChoice(text, choicesOf(r));
    if (picked) this.onAnswer(r.plan.id, r.sent.step, picked.id);
    return picked;
  }

  /** World State가 바뀌었다: 지금 단계가 됐는지 바로 본다. */
  onWorld(): void {
    const r = this.live();
    if (r) this.look(r);
  }

  /** 타이머(250ms)가 부른다: 검사 다시 보기, 지금 단계 보기, 다시 읽기, 시간 초과. */
  tick(): void {
    const r = this.run;
    if (this.stopped || !r) return;
    const now = this.clock.now();
    if (r.state === "planned" && !r.asking) return this.tryStart(now - r.since >= this.cfg.recheckMs);
    const live = this.shown();
    if (!live || this.look(live)) return;
    if (now - live.stepAt > this.cfg.stepTimeoutMs) return this.finish("failed", live.asking || live.spec.kind === "ask" ? EXEC_TEXT.noAnswer : EXEC_TEXT.timeout);
    if (now - live.spokeAt >= this.cfg.repeatMs) {
      live.spokeAt = now;
      this.o.toPhone({ ...live.sent, speak: true });
    }
  }

  /** 멈추면 더 기록하지 않고 폰에도 보내지 않는다. */
  stop(): void {
    this.stopped = true;
  }

  /** 명령을 띄운 채 진행 중인 계획. */
  private live(): (Run & { sent: PlannedCommand }) | null {
    const r = this.shown();
    return r && !r.asking ? r : null;
  }

  /** 실제 폰에 명령·질문을 띄운 계획: 진행 중이거나 승인 답을 기다리는 중. */
  private shown(): (Run & { sent: PlannedCommand }) | null {
    const r = this.run;
    return !this.stopped && r && r.sent && (r.state === "running" || (r.state === "planned" && r.asking)) ? (r as Run & { sent: PlannedCommand }) : null;
  }

  /** 이 행동에 승인을 물을지. 질문 계획은 묻지 않는다. */
  private approval(spec: TaskSpec): ReturnType<typeof approvalNeed> {
    if (spec.kind === "ask") return null;
    return approvalNeed({ key: taskKey(spec.name), risky: false, requested: false, memory: this.o.approvals.memory() });
  }

  private tryStart(last: boolean): void {
    const r = this.run!;
    const c = this.o.check(r.decision, r.plan);
    if (!c.ok) {
      if (last) this.finish("failed", c.text);
      return;
    }
    if (this.approval(r.spec)) return this.ask(r);
    this.begin(r);
  }

  private begin(r: Run): void {
    this.step("running");
    if (r.plan.steps.length === 0) return this.finish("done");
    this.activate(r, 0);
  }

  /** 첫 단계 전 승인 질문: 실제 폰 위에 「…를 할까요?」, 아래 승인·거절. 계획은 planned 그대로. */
  private ask(r: Run): void {
    const now = this.clock.now();
    Object.assign(r, { asking: true, stepAt: now, spokeAt: now });
    r.sent = {
      type: "command", id: r.plan.id, step: approveStep(r.plan.id), text: APPROVAL_TEXT.ask(r.spec.name), vision: null,
      choices: choicesOf(r).map(({ id, label }) => ({ id, label })), target: null, speak: true,
    };
    this.o.toPhone(r.sent);
  }

  /** 승인 답: 승인이면 기억하고 첫 단계로, 거절이면 기억하지 않고 취소로 닫는다. */
  private approved(r: Run, answer: ApprovalAnswer): void {
    this.o.approvals.answer(taskKey(r.spec.name), answer);
    r.asking = false;
    if (answer === "reject") return this.finish("failed", APPROVAL_TEXT.refused, "cancelled");
    this.begin(r);
  }

  /** 지금 단계를 끝내고 다음 단계로. 마지막이었으면 계획 완료. */
  private advance(r: Run): void {
    if (r.at + 1 >= r.plan.steps.length) return this.finish("done");
    this.activate(r, r.at + 1);
  }

  /** i번째 단계를 지금 단계로: PlanHub 단계 상태(앞 단계 done, 이 단계 active)를 한 번에 바꾸고 새 명령을 소리로 읽게 보낸다. */
  private activate(r: Run, i: number): void {
    const prev = r.plan.steps[r.at];
    const step = r.plan.steps[i]!;
    const now = this.clock.now();
    Object.assign(r, { at: i, stepAt: now, spokeAt: now, visionAt: now });
    this.o.plans.setSteps(r.plan.id, { ...(prev ? { [prev.id]: "done" as const } : {}), [step.id]: "active" });
    const key = cupStepOf(step);
    r.sent = {
      type: "command", id: r.plan.id, step: step.id,
      text: r.spec.kind === "ask" ? r.spec.prompt.text : key ? STEP_COMMAND[key] : step.label,
      vision: r.spec.kind === "ask" ? null : this.vision(r, step, key, this.o.world()),
      choices: choicesOf(r).map(({ id, label }) => ({ id, label })), target: this.target(r, step, key, this.o.world()), speak: true,
    };
    this.o.toPhone(r.sent);
  }

  /** 지금 단계가 됐으면 다음 단계로 넘기고 true. 아니면 비전 상태가 바뀌었을 때 보낸다(visionMs에 한 번까지). */
  private look(r: Run & { sent: PlannedCommand }): boolean {
    const step = r.plan.steps[r.at];
    if (!step || r.asking || r.spec.kind === "ask") return false;
    const key = cupStepOf(step);
    const world = this.o.world();
    if (this.reached(r, step, key, world)) {
      this.advance(r);
      return true;
    }
    const vision = this.vision(r, step, key, world);
    const now = this.clock.now();
    if (vision !== r.sent.vision && now - r.visionAt >= this.cfg.visionMs) {
      r.visionAt = now;
      r.sent = { ...r.sent, vision, speak: false };
      this.o.toPhone(r.sent);
    }
    return false;
  }

  /** 단계가 됐는가: 이동은 폰 눈이 목표 가까이, 집기는 컵이 손에 있음(또는 사람이 물건을 들고 있음), 내려놓기는 컵이 싱크대 안. 컵 단계가 아니면 「완료」로만 넘긴다. */
  private reached(r: Run, step: PlanStep, key: CupStep | null, world: WorldView): boolean {
    const at = (place: string) => cupsOf(r, world).some((c) => c.facts.place?.value === place);
    switch (key) {
      case "goTable":
      case "goSink": {
        const d = this.distance(step);
        return d !== null && d <= this.cfg.arriveM;
      }
      case "pickCup": return at("in_hand") || holdsTarget(world, r.spec.target);
      case "placeCup": return at("in_sink");
      default: return false;
    }
  }

  /** 비전 상태 한 줄: 식탁으로는 남은 거리, 집기·내려놓기는 컵 자리, 싱크대로는 컵 자리와 남은 거리. */
  private vision(r: Run, step: PlanStep, key: CupStep | null, world: WorldView): string | null {
    const cup = `${VISION_TEXT.cup} · ${cupPlace(cupsOf(r, world)[0] ?? null)}`;
    switch (key) {
      case "goTable": return VISION_TEXT.distance(VISION_TEXT.table, this.distance(step));
      case "goSink": return `${cup} · ${VISION_TEXT.distance(VISION_TEXT.sink, this.distance(step))}`;
      case "pickCup":
      case "placeCup": return cup;
      default: return null;
    }
  }

  /** 명령 대상(실제 폰 고리 하나): 집기는 그 컵(World State 자리), 그 밖의 단계는 단계 목표 물건(평면도). 질문이거나 자리를 모르면 null. */
  private target(r: Run, step: PlanStep, key: CupStep | null, world: WorldView): PlannedCommand["target"] {
    if (r.spec.kind === "ask") return null;
    const cup = key === "pickCup" ? cupsOf(r, world)[0] : undefined;
    if (cup?.position) return { id: cup.id, label: VISION_TEXT.cup, position: cup.position };
    const id = step.target?.objectId;
    const at = id ? this.o.locate?.(id) : undefined;
    return id && at ? { id, label: at.label, position: at.position } : null;
  }

  /** 폰 눈에서 단계 목표 물건(평면도 자리)까지 거리(m). 눈이나 목표 자리를 모르면 null. */
  private distance(step: PlanStep): number | null {
    const id = step.target?.objectId;
    const at = id ? this.o.floor().objects.get(id)?.position : undefined;
    return this.eye && at ? Math.hypot(this.eye[0] - at[0], this.eye[1] - at[1]) : null;
  }

  /** close: 계획을 닫을 상태. null이면 닫지 않는다(새 판단이 바꾸면 PlanHub.onDecision이 취소로 닫는다). */
  private finish(state: "done" | "failed", text?: string, close: "done" | "failed" | "cancelled" | null = state): void {
    const r = this.run!;
    this.step(state, text);
    if (r.sent) {
      r.sent = null;
      this.o.toPhone({ type: "command_clear", id: r.plan.id });
    }
    if (close) this.o.plans.close(r.plan.id, close);
  }

  private step(state: ExecState, text?: string): void {
    const r = this.run!;
    r.state = state;
    r.since = this.clock.now();
    this.emit(r.plan.id, state, text);
  }

  /** 계획을 만들지 않는 판단(대기·실패·같은 행동·늦은 답)은 그 판단 줄에 기록만 한다. */
  private note(d: DecisionRecord, text: string): void {
    this.emit(planIdOf(d.id), "decided", text);
  }

  private emit(planId: string, state: ExecState, text?: string): void {
    this.o.emit({ type: "execution", at_ms: this.clock.now(), plan_id: planId, state, text: text ?? EXEC_TEXT[state] });
  }
}

/** 계획의 대상 물건 id인가: 처음 고른 물건이거나, 계획 뒤에 새로 생긴 같은 종류 물건(움직여 새 id가 붙은 그 물건). */
const isOurs = (r: Run, id: string) => id === r.targetId || !r.others.has(id);

/** 계획의 대상 물건(사라지지 않은 것), 가장 최근에 본 것부터. 대상이 없는 행동이면 빈 목록. */
function cupsOf(r: Run, world: WorldView): WorldObject[] {
  if (!r.spec.target) return [];
  return world.objects.filter((o) => o.cls === r.spec.target && o.status !== "gone" && isOurs(r, o.id)).sort((a, b) => b.last_seen_ms - a.last_seen_ms);
}

/** 승인 질문은 승인·거절, 단계 명령은 「완료」 하나, 질문은 그 답들. */
const choicesOf = (r: Run): ActionChoice[] => (r.asking ? APPROVE : r.spec.kind === "ask" ? r.spec.prompt.choices : [STEP_DONE]);

/** World State 컵 자리 글: VLM이 본 자리, 없으면 놓인 면, 그것도 없으면 자리 모름. 사라졌거나 없으면 안 보임. */
function cupPlace(cup: WorldObject | null): string {
  if (!cup || cup.status === "gone") return VISION_TEXT.unseen;
  const place = cup.facts.place?.value;
  if (place) return STATE_TEXT[place] ?? place;
  return cup.surface_label ? onSurface(cup.surface_label) : PLACE_UNKNOWN;
}
