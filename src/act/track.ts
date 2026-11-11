// 실행 추적: 판단 → 계획(에이전트 계획 모드) → 실행 중 → 완료 또는 실패. 단계마다 execution 기록을 낸다(plan_id는 plan:<판단 id>).
// 판단 하나마다 한 번만 정한다: 늦은 답·판단 실패·대기·진행 중(또는 계획을 만드는 중)인 행동과 같은 행동은 기록만 하고, 계획 전 검사(LLM 없음)를
// 통과하면 에이전트를 계획 모드로 한 번 부른다(planner). 같은 행동은 planGapMs 안에 다시 부르지 않는다. 주기 tick은 에이전트를 부르지 않는다.
// 계획은 어떤 것이든 같은 방법으로 돌린다(src/agent/planTools.ts AgentStep):
// - 사람 단계(go·pick·place): 실제 폰(에이전트의 손, src/contract/phone.ts)에 사람에게 하는 명령 하나와 「완료」를 보내고(소리로도 읽음),
//   끝나는 조건(World State 낱말 조건, ConditionWatch)이 참이거나 「완료」면 다음 단계로. repeatMs마다 명령을 다시 읽는다.
//   명령마다 대상 하나(목표 자리·그 물건, 트윈 자리)를 같이 보내 실제 폰이 그것에만 고리를 그린다. 비전 상태는 바뀔 때만, visionMs에 한 번까지.
// - 질문(ask): 같은 자리에 질문과 답 단추. 답을 받으면 다음 단계(마지막이거나 끝내는 답이면 완료). 알림(say): 한 줄을 읽고 조건(기본 몇 초)이 되면 다음.
// - 기기(device): 그 단계가 되면 기기 도구를 정책(승인 규칙)을 거쳐 부른다. 위험 목록이면 실제 폰에 승인 질문, 승인이면 실행, 거절이면 취소로 닫는다.
// - 기다리기(wait): 실제 폰 명령을 지우고 아무것도 보내지 않는다. 조건이 참이면 다음. PAM에 다시 묻지 않는다(대시보드 진행도에만 보인다).
// 한 번 볼 때(tick·World State 변화·답) 한 단계만 넘긴다. 단계마다 시간 한도가 있고, 넘으면 on_timeout대로 한 번 다시 묻거나(계속·그만) 실패로 닫는다.
// 「그만」(말)은 계획을 그만둔다. 실행 전 검사는 통과할 때까지 tick마다 다시 보고, recheckMs가 지나도 안 되면 그 이유로 실패한다.
// 승인(src/agent/approval.ts): 검사를 통과한 계획이 처음 하는 일이면(승인을 받은 적 없음) 첫 단계 전에 실제 폰에 「…를 할까요?」와 답 둘(승인·거절)을 띄운다.
// 승인이면 기억하고 첫 단계로, 거절이면 기억하지 않고 취소로 닫는다. 질문·알림만 있는 계획은 묻지 않는다. 위험 목록 가전 승인은 기억하지 않는다.
// 같은 물건 따라가기: 기준점을 맞춘 뒤 물건이 identityM 넘게 움직이면 World State가 새 id를 붙인다. 계획을 받을 때 그 종류의 다른 물건을 적어 두고,
// 계획 물건과 그 뒤에 새로 생긴 같은 종류 물건을 모두 그 물건으로 본다(조건의 follow, 비전 상태 줄, 고리).
// 폰 근처 조건은 실행 추적이 받은 맞춘 눈(받은 시각)과 World State 눈 중 새것으로 본다.
// 멈춘 단계(관찰 모드 A): 끝나는 조건이 있는 집기·놓기 단계가 stallMs 넘게(단계 시작 뒤, 받은 부름 뒤) 안 끝나면 stalled를 부른다. 단계마다 stallMax번,
// 받은 것만 센다. 받은 부름은 끝날 때 Stall.settle(counted)로 셈을 정하고, 자원 사정(새 사진 모자람·VLM 자리 없음)은 settle(false)로 돌려받는다.
// 알림마다 그 단계 세대와 신호가 있고, 단계가 끝나면(다음 단계·완료·실패·그만·새 계획·멈춤) 신호를 끊는다. 지난 세대의 settle은 아무것도 하지 않는다.
// 같은 물건 따라가기에서 가까이 봐서 지키는 중이거나 옮김 표시(World State followed_by)가 있는 물건은 「아직 있음」으로 세지 않는다.
// 사람 부탁(askCloser)은 지금 그 계획의 그 사람 단계일 때만 같은 계획·단계 id로 명령 글만 바꿔 다시 보낸다(소리로 읽음).
// 판단 뒤 가까이 본 사실(관찰 모드 B는 PAM을 막지 않는다): 그 행동 대상 종류 물건의 볼 면(TaskSpec.look)을 판단 뒤에 가까이 보기가 바꿨고
// (World State closer_rev가 판단 기록의 횟수와 다름) 지금 값이 판단 때 본 값과 다르면, 판단을 받을 때와 계획을 받을 때 실행하지 않고
// 「가까이 본 뒤 다시 판단」만 남긴다. 계획을 받은 뒤 첫 명령 전(승인 답·실행 전 검사를 기다리는 사이)이면 시작하지 않고 그 기록으로 계획을 취소로 닫는다.
// 다음 판단이 새 사실로 다시 고른다. 첫 명령을 보낸 뒤에는 멈추지 않는다: 단계마다 끝나는 조건을 World State로 보고, 멈춘 단계의 가까이 보기(A)가
// 그 면을 바꾸는 것도 이 계획의 관찰이다. 다른 행동이 맞으면 다음 판단이 새 계획으로 바꾼다.
import type { BrainLog, ExecState } from "../contract/events.js";
import type { PhoneStepKind, PlannedCommand, PlannedCommandMessage } from "../contract/phone.js";
import type { PlanView, XZ } from "../contract/plan.js";
import type { WorldEye, WorldObject, WorldView } from "../contract/world.js";
import type { LookSpot } from "../observe/crop.js";
import type { FloorPlan } from "../plan/floor.js";
import type { PlanHub } from "../plan/hub.js";
import { AGAIN_TEXT, APPROVAL_TEXT, EXEC_TEXT, VISION_TEXT, placeShort } from "../plan/labels.js";
import { roomAt } from "../plan/route.js";
import { OBJECT_NAME, PLACE_UNKNOWN, STATE_TEXT, onSurface } from "../world/labels.js";
import { ConditionWatch, type Condition, type ConditionContext } from "../world/conditions.js";
import { NEAR_M } from "../world/vocab.js";
import type { DecisionRecord } from "../world/decide.js";
import { approvalNeed, taskKey, type ApprovalAnswer, type ApprovalBook } from "../agent/approval.js";
import { HUMAN_KINDS, objectNames, type AgentPlan, type AgentStep, type PlanResult } from "../agent/planTools.js";
import type { ToolResult } from "../agent/tools.js";
import type { CheckResult } from "./check.js";
import { AGAIN, APPROVE, STEP_DONE, STOP, type ActionChoice } from "./prompts.js";
import { matchChoice, planIdOf, taskOf } from "./tasks.js";

/** 기기 단계 실행(src/server/home.ts: 기기 도구 + 정책). run이 승인 토큰을 내면 실제 폰에 묻고 confirm·cancel로 답한다.
 *  결과의 unverified(ThinQ가 받았지만 다시 읽은 값이 다름)·state 「모름」(신호 없음)은 적용을 확인하지 못한 것이다. */
export interface DeviceRunner {
  /** live가 거짓이면(계획이 바뀌었거나 닫힘) 가전에 보내지 않는다. 보내기 바로 앞에서 본다. */
  run(tool: string, deviceId: string, args: Record<string, unknown>, live: () => boolean): Promise<ToolResult>;
  confirm(token: string, live: () => boolean): Promise<Pick<ToolResult, "ok" | "error" | "unverified" | "state">>;
  cancel(token: string): void;
}

export interface TrackerOptions {
  plans: PlanHub;
  world: () => WorldView;
  /** 계획 전 검사(src/act/check.ts checkDecision). 에이전트를 부르기 전에 본다. 없으면 통과. */
  precheck?: (d: DecisionRecord) => CheckResult;
  /** 실행 전 검사(src/act/check.ts checkPlan). */
  check: (d: DecisionRecord, plan: PlanView) => CheckResult;
  /** 에이전트 계획 모드(src/agent/planner.ts). 판단 하나에 한 번 부른다. 새 판단·「그만」·멈춤이면 signal을 끊는다. */
  planner: (d: DecisionRecord, signal: AbortSignal) => PlanResult | Promise<PlanResult>;
  floor: () => FloorPlan;
  /** 실제 폰으로 보낸다: 명령(command)·지우기(command_clear). 폰 서버가 명령 대상 자리를 AR 자리로 바꾼다. */
  toPhone: (msg: PlannedCommandMessage) => void;
  /** 평면도 물건의 이름과 트윈 자리 [x, 높이, y](명령 대상 고리). 모르면 undefined. */
  locate?: (id: string) => { label: string; position: [number, number, number] } | undefined;
  emit: (l: BrainLog) => void;
  /** 승인 기억(task:<행동 이름>). 처음 하는 계획은 묻고, 답을 남긴다. */
  approvals: ApprovalBook;
  /** 기기 단계 실행. 없으면 기기 단계는 실패한다. */
  devices?: DeviceRunner;
  clock?: { now(): number };
  /** 하루 때 조건의 시간대(분). */
  offsetMinutes?: number;
  /** 사람 단계·질문이 이만큼(ms) 안 끝나면 다시 소리로 읽는다(그 뒤로도 이만큼마다). */
  repeatMs?: number;
  /** 비전 상태를 이보다 자주(ms) 보내지 않는다. */
  visionMs?: number;
  /** 검사를 다시 보는 시간(ms). */
  recheckMs?: number;
  /** 승인·다시 묻기 질문의 답을 기다리는 시간(ms). */
  askMs?: number;
  /** 같은 행동의 계획을 다시 만들기 전 기다리는 시간(ms). */
  planGapMs?: number;
  /** 멈춘 집기·놓기 단계 알림(관찰 모드 A, src/act/look.ts). 받았으면 true(그때만 센다). 받은 부름은 끝날 때 s.settle(counted)를 부른다. 없으면 부르지 않는다. */
  stalled?: (s: Stall) => boolean;
  /** 집기·놓기 단계가 이만큼(ms) 안 끝나면 stalled를 부른다(단계 시작 뒤, 받은 부름 뒤). */
  stallMs?: number;
  /** 단계마다 stalled를 받아 센 횟수 상한(settle(false)로 돌려받은 부름은 넣지 않는다). */
  stallMax?: number;
}

/** 기본값: 다시 읽기 30초, 비전 상태 0.5초에 한 번, 검사 3초, 승인 답 2분, 같은 행동 다시 계획 15초, 멈춘 단계 8초·단계마다 3번. 단계 시간 한도는 계획 단계마다 있다. */
export const TRACK_DEFAULTS = { repeatMs: 30_000, visionMs: 500, recheckMs: 3000, askMs: 120_000, planGapMs: 15_000, stallMs: 8000, stallMax: 3 } as const;

/** 멈춘 집기·놓기 단계. command: 실제 폰에 띄운 지금 명령 글. stuckMs: 단계 시작 뒤 지난 시간. looks: 이 단계에서 센 부름 수(시도).
 *  spots: 계획 물건(지금 따라가는 World State 물건, 자리를 알 때)과 단계 대상 자리(평면도, 물건과 다를 때).
 *  gen: 단계 세대(단계가 바뀌거나 계획이 닫힐 때마다 오른다). signal: 이 단계가 끝나면(다음 단계·완료·실패·그만·새 계획·멈춤) 끊긴다.
 *  settle(counted): 받은 부름(stalled가 true)이 끝나면 부른다. 받을 때 시도로 먼저 세고, settle(false)면(자원 사정: 가까이 보기 no_fresh_frames·vlm_busy) 돌려받아
 *  stallMax에 넣지 않는다. settle(true)는 그대로 센다. 처음 한 번만 듣고, 그 단계 세대가 지났으면(다른 단계·닫힌 계획) 아무것도 하지 않는다.
 *  다음 부름은 셈과 상관없이 받은 부름에서 stallMs 뒤다. */
export interface Stall {
  planId: string; stepId: string; kind: "pick" | "place"; label: string; command: string; until: Condition;
  stuckMs: number; looks: number; spots: LookSpot[]; gen: number; signal: AbortSignal;
  settle(counted: boolean): void;
}

/** 실제 폰에 띄운 질문: 첫 단계 전 승인, 위험 목록 가전 승인(토큰), 시간 초과로 다시 묻기. */
type Asking = { why: "plan" } | { why: "device"; token: string } | { why: "again" };

/** at: 지금 단계 번호(실행 전 -1). sent: 실제 폰에 띄운 지금 명령. others: 계획 물건 id → 계획을 받을 때 있던 같은 종류의 다른 물건.
 *  alias: 계획 물건 id → 지금 그 물건으로 보는 World State id(옮겨서 새 id가 붙으면 이어 간다). carried: 집기 단계를 마친(사람이 든) 계획 물건.
 *  device: 기기 단계 실행 상태(sent는 보냈지만 적용을 확인하지 못함). gen: 단계가 바뀔 때마다 올라 늦게 온 기기 결과를 버린다.
 *  deadline: 이 단계 시간 한도(계속이면 한 번 늘어난다). again: 이 단계에서 시간 초과로 한 번 다시 물었다.
 *  looks·lookAt: 이 단계에서 받아 센 멈춘 단계 부름 수(돌려받은 것은 뺌)와 마지막으로 받은 시각. stepEnd: 이 단계가 끝나면 끊는 신호(멈춘 단계 알림). */
interface Run {
  plan: AgentPlan; decision: DecisionRecord; state: ExecState; since: number;
  at: number; stepAt: number; spokeAt: number; visionAt: number; sent: PlannedCommand | null;
  asking: Asking | null; askAt: number; watch: ConditionWatch | null; others: Map<string, Set<string>>; alias: Map<string, string>; carried: Set<string>;
  /** 평면도 물건의 평면 자리(따라가기 거리). */
  placeAt: (id: string | null) => XZ | null;
  deadline: number; again: boolean; device: "idle" | "running" | "done" | "sent"; gen: number;
  looks: number; lookAt: number; stepEnd: AbortController | null;
}

interface Job { decision: DecisionRecord; gen: number; abort: AbortController }

const OPEN = new Set<ExecState>(["planned", "running", "verifying"]);
const clsOf = (w: WorldView, id: string) => w.objects.find((o) => o.id === id)?.cls ?? id.replace(/_\d+$/, "");

export class ExecutionTracker {
  private run: Run | null = null;
  private planning: Job | null = null;
  private readonly jobs = new Set<Promise<void>>();
  private readonly planAt = new Map<string, number>();
  private gen = 0;
  private lastSeq = 0;
  /** 마지막으로 기다리기·기기 단계가 시작된 시각. 그 전에 보낸 다른 행동 판단은 쓰지 않는다. */
  private quietFrom = -Infinity;
  private stopped = false;
  private eye: { position: XZ; at: number } | null = null;
  private readonly clock: { now(): number };
  private readonly cfg: { repeatMs: number; visionMs: number; recheckMs: number; askMs: number; planGapMs: number; stallMs: number; stallMax: number };

  constructor(private readonly o: TrackerOptions) {
    this.clock = o.clock ?? { now: () => Date.now() };
    this.cfg = {
      repeatMs: o.repeatMs ?? TRACK_DEFAULTS.repeatMs, visionMs: o.visionMs ?? TRACK_DEFAULTS.visionMs, recheckMs: o.recheckMs ?? TRACK_DEFAULTS.recheckMs,
      askMs: o.askMs ?? TRACK_DEFAULTS.askMs, planGapMs: o.planGapMs ?? TRACK_DEFAULTS.planGapMs,
      stallMs: o.stallMs ?? TRACK_DEFAULTS.stallMs, stallMax: o.stallMax ?? TRACK_DEFAULTS.stallMax,
    };
  }

  current(): { planId: string; state: ExecState } | null {
    return this.run && { planId: this.run.plan.view.id, state: this.run.state };
  }

  /** 실제 폰에 띄운 지금 명령·질문(답을 기다리는 중). 승인·다시 묻기·질문 단계는 질문(ask), 그 밖은 부탁(command). 없으면 null. */
  openCommand(): { planId: string; stepId: string; kind: "command" | "ask"; text: string; choices: ActionChoice[] } | null {
    const r = this.shown();
    if (!r) return null;
    const ask = r.asking !== null || this.stepOf(r)?.kind === "ask";
    return { planId: r.plan.view.id, stepId: r.sent.step, kind: ask ? "ask" : "command", text: r.sent.text, choices: choicesOf(r, this.stepOf(r)) };
  }

  onDecision(d: DecisionRecord): void {
    if (this.stopped) return;
    if (d.seq < this.lastSeq) return this.note(d, EXEC_TEXT.late);
    // 받은 가장 새 판단 번호: 기록만 한 판단(같은 행동 등)보다 먼저 보낸 판단이 늦게 와도 쓰지 않는다
    this.lastSeq = d.seq;
    // 기다리기·기기 단계 전에 보낸 판단이 그 뒤에 오면 낡은 관찰이라 쓰지 않는다(다시 부르는 판단이 새 관찰로 정한다)
    if (d.atMs < this.quietFrom && this.open()?.decision.action !== d.action) return this.note(d, EXEC_TEXT.late);
    if (d.status !== "valid") return this.note(d, EXEC_TEXT.decisionFailed);
    if (!d.action) return this.note(d, EXEC_TEXT.wait);
    const open = this.open();
    if (open?.decision.action === d.action || this.planning?.decision.action === d.action) return this.note(d, EXEC_TEXT.same);
    // 행동 중 기다리기·기기 단계에는 다른 판단으로 바꾸지 않는다(그동안 판단도 멈춘다, waiting)
    if (open && this.waiting()) return this.note(d, EXEC_TEXT.busy);
    if (this.closerNewer(d)) return this.note(d, EXEC_TEXT.closerNewer);
    const pre = this.o.precheck?.(d) ?? { ok: true };
    if (!pre.ok) {
      this.emit(planIdOf(d.id), "decided");
      this.emit(planIdOf(d.id), "failed", pre.text);
      return;
    }
    const now = this.clock.now();
    const last = this.planAt.get(d.action);
    if (last !== undefined && now - last < this.cfg.planGapMs) return this.note(d, EXEC_TEXT.held);
    this.planAt.set(d.action, now);
    // 계획을 만드는 중이던 다른 행동은 끊고 버린다(답이 와도 쓰지 않는다)
    this.dropPlanning(EXEC_TEXT.superseded);
    const job: Job = { decision: d, gen: ++this.gen, abort: new AbortController() };
    this.planning = job;
    this.emit(planIdOf(d.id), "decided");
    let out: PlanResult | Promise<PlanResult>;
    try {
      out = this.o.planner(d, job.abort.signal);
    } catch (e) {
      out = { ok: false, error: (e as Error).message };
    }
    if (!(out instanceof Promise)) return this.planned(job, out);
    const p = out.then((r) => this.planned(job, r), (e: unknown) => this.planned(job, { ok: false, error: (e as Error).message }))
      .finally(() => { this.jobs.delete(p); });
    this.jobs.add(p);
  }

  /** 폰 눈(맞춘 자세)의 평면 자리 [x, z]. 맞추기 전 추정 눈은 쓰지 않는다. 이동 단계는 다음 tick에 본다. */
  onEye(position: XZ, estimated = false): void {
    if (estimated || !position.every(Number.isFinite)) return;
    this.eye = { position: [position[0], position[1]], at: this.clock.now() };
  }

  /** 답 단추(「완료」·질문 답·승인 답·계속·그만). 지금 명령의 계획·단계·답이 아니면 무시한다. 받았으면 true. */
  onAnswer(planId: string, stepId: string, choice: string): boolean {
    const r = this.shown();
    if (!r || r.plan.view.id !== planId || r.sent.step !== stepId) return false;
    const step = this.stepOf(r);
    const picked = choicesOf(r, step).find((c) => c.id === choice);
    if (!picked) return false;
    const a = r.asking;
    // 기한이 지난 답은 받지 않는다(시간 초과가 먼저다)
    const now = this.clock.now();
    if (a && now - r.askAt > this.cfg.askMs) {
      this.finish(r, "failed", EXEC_TEXT.noAnswer);
      return false;
    }
    if (!a && step && now > r.deadline) {
      this.timeout(r, step);
      return false;
    }
    if (a?.why === "plan") this.approvedPlan(r, picked.id as ApprovalAnswer);
    else if (a?.why === "device") this.approvedDevice(r, a.token, picked.id as ApprovalAnswer);
    else if (a?.why === "again") {
      if (picked.id === "continue") this.resume(r);
      else this.finish(r, "failed", EXEC_TEXT.stopped, "cancelled");
    } else if (step?.kind === "ask") {
      if (r.at + 1 >= r.plan.steps.length || step.prompt?.ends.includes(picked.id)) this.finish(r, "done", EXEC_TEXT.answered(picked.label));
      else this.advance(r);
    } else this.advance(r);
    return true;
  }

  /** 폰에서 들은 말. 「그만」이면 계획을 그만두고, 지금 명령의 답(「완료」「다 했어」, 질문 답)이면 그 답으로 받는다. 받은 답, 아니면 null. */
  onHeard(text: string): ActionChoice | null {
    if (this.stopped) return null;
    const open = this.open();
    // 명령이 없는 단계(기다리기·기기)와 만드는 중인 계획에도 「그만」은 받는다
    if ((open || this.planning) && matchChoice(text, [STOP])) {
      this.dropPlanning(EXEC_TEXT.stopped);
      if (open) this.finish(open, "failed", EXEC_TEXT.stopped, "cancelled");
      return STOP;
    }
    if (!open) return null;
    const r = this.shown();
    if (!r) return null;
    const picked = matchChoice(text, choicesOf(r, this.stepOf(r)));
    if (picked) this.onAnswer(r.plan.view.id, r.sent.step, picked.id);
    return picked;
  }

  /** World State가 바뀌었다: 지금 단계가 됐는지 바로 본다. */
  onWorld(): void {
    const r = this.run;
    if (!this.stopped && r?.state === "running") this.look(r);
  }

  /** 관찰 모드의 사람 부탁(ask_person): 지금 그 계획의 그 사람 단계면 같은 계획·단계 id로 명령 글만 바꿔 다시 보낸다(소리로 읽음).
   *  단계 종류·대상·답 단추·비전 상태는 그대로라 실제 폰은 새 단계로 보지 않는다. 그 뒤 다시 읽기·비전 상태도 이 글이다.
   *  사람에게 하는 말(「주세요」로 끝남)만 보낸다. 보냈으면 true. */
  askCloser(planId: string, stepId: string, text: string): boolean {
    const r = this.run;
    const step = r ? this.stepOf(r) : undefined;
    const said = text.trim();
    if (this.stopped || !r || r.state !== "running" || r.asking || !r.sent || !step || !HUMAN_KINDS.includes(step.kind)) return false;
    if (r.plan.view.id !== planId || step.id !== stepId || r.sent.step !== stepId || !/주세요$/.test(said)) return false;
    r.spokeAt = this.clock.now();
    r.sent = { ...r.sent, text: said, speak: true };
    this.o.toPhone(r.sent);
    return true;
  }

  /** 타이머(250ms)가 부른다: 검사 다시 보기, 지금 단계 보기, 멈춘 단계 알림, 다시 읽기, 시간 초과. 에이전트는 부르지 않는다. */
  tick(): void {
    const r = this.run;
    if (this.stopped || !r || !OPEN.has(r.state)) return;
    const now = this.clock.now();
    if (r.state === "planned" && !r.asking) return this.tryStart(r, now - r.since >= this.cfg.recheckMs);
    if (r.asking) {
      if (r.asking.why === "again" && this.look(r)) return;
      if (now - r.askAt > this.cfg.askMs) return this.finish(r, "failed", EXEC_TEXT.noAnswer);
      return this.repeat(r, now);
    }
    if (r.state !== "running" || this.look(r)) return;
    const step = this.stepOf(r);
    if (!step) return;
    if (now > r.deadline) return this.timeout(r, step);
    this.stall(r, step, now);
    if (HUMAN_KINDS.includes(step.kind) || step.kind === "ask") this.repeat(r, now);
  }

  /** 멈추면 더 기록하지 않고 폰에도 보내지 않는다. 만들던 계획과 멈춘 단계 알림은 끊는다. */
  stop(): void {
    this.planning?.abort.abort();
    this.planning = null;
    this.run?.stepEnd?.abort();
    const a = this.run?.asking;
    if (a?.why === "device") this.o.devices?.cancel(a.token);
    this.stopped = true;
  }

  /** 행동 중 기다리기·기기 단계인가: 그동안 판단(PAM)을 멈추고 다른 행동으로 바꾸지 않는다(src/world/decide.ts hold). */
  waiting(): boolean {
    const r = this.run;
    const kind = r && r.state === "running" ? this.stepOf(r)?.kind : undefined;
    return !this.stopped && (kind === "wait" || kind === "device");
  }

  /** 판단 뒤에 가까이 보기가 그 행동 대상 종류 물건의 볼 면을 바꿨는가: 사라지지 않은 그 종류 물건의 볼 면 가까이 보기 횟수(closer_rev)가
   *  판단 때 횟수(판단 기록 World State 요약, 그때 없던 물건이면 0)와 다르고, 지금 값도 판단 때 본 값과 다르다.
   *  횟수는 지금 값의 출처와 따로 남으므로 가까이 보기가 바꾼 값을 그 뒤 전체 사진이 다시 바꿔도 잡는다. */
  private closerNewer(d: DecisionRecord): boolean {
    const spec = taskOf(d.action);
    const facets = spec?.look ?? [];
    if (!spec?.target || !facets.length) return false;
    const then = new Map(d.world.objects.map((o) => [o.id, o]));
    return this.o.world().objects.some((o) => o.cls === spec.target && o.status !== "gone" && facets.some((f) => {
      const before = then.get(o.id);
      return (o.closer_rev?.[f] ?? 0) !== (before?.closer_rev?.[f] ?? 0) && before?.facts[f]?.value !== o.facts[f]?.value;
    }));
  }

  /** 만들던 계획을 끊고 그 판단 줄에 까닭을 남긴다. */
  private dropPlanning(text: string): void {
    const job = this.planning;
    if (!job) return;
    this.planning = null;
    job.abort.abort();
    this.emit(planIdOf(job.decision.id), "failed", text);
  }

  /** 만들던 계획이 끝날 때까지 기다린다(시험용). */
  async idle(): Promise<void> {
    while (this.jobs.size) await Promise.all([...this.jobs]);
  }

  private open(): Run | null {
    return this.run && OPEN.has(this.run.state) ? this.run : null;
  }

  private stepOf(r: Run): AgentStep | undefined {
    return r.plan.steps[r.at];
  }

  /** 실제 폰에 명령·질문을 띄운 계획: 진행 중이거나 승인 답을 기다리는 중. */
  private shown(): (Run & { sent: PlannedCommand }) | null {
    const r = this.run;
    return !this.stopped && r && r.sent && (r.state === "running" || (r.state === "planned" && r.asking)) ? (r as Run & { sent: PlannedCommand }) : null;
  }

  /** 에이전트가 만든 계획을 받는다. 그 사이 다른 판단이 왔으면 버린다. 진행 중인 다른 계획은 새 계획이 바꾼다. */
  private planned(job: Job, r: PlanResult): void {
    if (this.stopped || this.planning !== job) return;
    this.planning = null;
    const d = job.decision;
    if (!r.ok) return this.emit(planIdOf(d.id), "failed", EXEC_TEXT.badPlan);
    // 만드는 사이 진행 중 계획이 기다리기·기기 단계에 들어갔으면 바꾸지 않는다(그 판단은 그 단계 전 관찰이다)
    if (this.waiting() || d.atMs < this.quietFrom) return this.emit(planIdOf(d.id), "failed", EXEC_TEXT.busy);
    if (this.closerNewer(d)) return this.emit(planIdOf(d.id), "failed", EXEC_TEXT.closerNewer);
    const open = this.open();
    // 새 계획이 있으면 PlanHub.onDecision이 지금 계획을 취소로 닫고 supersedes를 단다
    if (open) this.finish(open, "failed", EXEC_TEXT.superseded, null);
    const now = this.clock.now();
    const world = this.o.world();
    const ids = new Set<string>();
    for (const s of r.plan.steps) {
      if (s.object) ids.add(s.object);
      if (s.until) for (const n of objectNames(s.until)) if (world.objects.some((o) => o.id === n)) ids.add(n);
    }
    const others = new Map([...ids].map((id) => [id, new Set(world.objects.filter((o) => o.cls === clsOf(world, id) && o.id !== id).map((o) => o.id))]));
    const run: Run = {
      plan: r.plan, decision: d, state: "decided", since: now, at: -1, stepAt: now, spokeAt: now, visionAt: now, sent: null,
      asking: null, askAt: now, watch: null, others, alias: new Map([...ids].map((id) => [id, id])), carried: new Set(), placeAt: (id) => (id ? this.o.floor().objects.get(id)?.position ?? null : null), deadline: now, again: false, device: "idle", gen: 0,
      looks: 0, lookAt: Number.NEGATIVE_INFINITY, stepEnd: null,
    };
    this.run = run;
    this.o.plans.onDecision(r.plan.view);
    this.step(run, "planned");
    this.tryStart(run, false);
  }

  /** 질문·알림만 있는 계획은 승인을 묻지 않는다. */
  private approval(r: Run): ReturnType<typeof approvalNeed> {
    if (r.plan.steps.every((s) => s.kind === "ask" || s.kind === "say")) return null;
    return approvalNeed({ key: taskKey(r.plan.task), risky: false, requested: false, memory: this.o.approvals.memory() });
  }

  /** 첫 단계를 시작해 본다(계획을 받을 때·검사를 다시 볼 때·승인 답 뒤). 첫 명령 전에 가까이 보기가 볼 면을 바꿨으면 시작하지 않고
   *  「가까이 본 뒤 다시 판단」으로 닫는다(다음 판단이 새 사실로 다시 고른다). 첫 명령을 보낸 뒤에는 보지 않는다. */
  private tryStart(r: Run, last: boolean): void {
    if (this.closerNewer(r.decision)) return this.finish(r, "failed", EXEC_TEXT.closerNewer, "cancelled");
    const c = this.o.check(r.decision, r.plan.view);
    if (!c.ok) {
      if (last) this.finish(r, "failed", c.text);
      return;
    }
    if (this.approval(r)) return this.ask(r, { why: "plan" }, APPROVAL_TEXT.ask(r.plan.task), `${r.plan.view.id}:approve`);
    this.begin(r);
  }

  private begin(r: Run): void {
    this.step(r, "running");
    if (r.plan.steps.length === 0) return this.finish(r, "done");
    this.activate(r, 0);
  }

  /** 실제 폰에 질문(승인·다시 묻기): 위에 질문, 아래 답 단추. */
  private ask(r: Run, asking: Asking, text: string, stepId: string): void {
    const now = this.clock.now();
    Object.assign(r, { asking, askAt: now, spokeAt: now });
    r.sent = {
      type: "command", id: r.plan.view.id, step: stepId, text, vision: null,
      choices: choicesOf(r, this.stepOf(r)).map(({ id, label }) => ({ id, label })), target: null, speak: true,
    };
    this.o.toPhone(r.sent);
  }

  /** 첫 단계 전 승인 답: 승인이면 기억하고, 실행 전 검사를 다시 본 뒤 첫 단계로(답을 기다리는 사이 대상이 바뀌었을 수 있다). 거절이면 기억하지 않고 취소로 닫는다. */
  private approvedPlan(r: Run, answer: ApprovalAnswer): void {
    this.o.approvals.answer(taskKey(r.plan.task), answer);
    if (answer === "reject") return this.finish(r, "failed", APPROVAL_TEXT.refused, "cancelled");
    r.asking = null;
    r.since = this.clock.now();
    this.clear(r);
    this.tryStart(r, false);
  }

  /** 위험 목록 가전 승인 답(기억하지 않음): 승인이면 그 토큰으로 실행, 거절이면 실행하지 않고 취소로 닫는다. */
  private approvedDevice(r: Run, token: string, answer: ApprovalAnswer): void {
    r.asking = null;
    this.clear(r);
    if (answer === "reject") {
      this.o.devices?.cancel(token);
      return this.finish(r, "failed", APPROVAL_TEXT.refused, "cancelled");
    }
    const gen = r.gen;
    r.device = "running";
    // 승인을 기다린 시간은 이 단계 시간 한도에 넣지 않는다
    r.deadline = this.clock.now() + (this.stepOf(r)?.timeoutMs ?? 0);
    this.o.devices!.confirm(token, () => this.live(r, gen)).then((res) => this.deviceResult(r, gen, res), () => this.deviceResult(r, gen, { ok: false }));
  }

  /** 지금 단계를 끝내고 다음 단계로. 마지막이었으면 계획 완료. 집기를 마치면 그 물건은 사람이 들고 다닌다. */
  private advance(r: Run): void {
    const done = this.stepOf(r);
    if (done?.kind === "pick" && done.object) r.carried.add(done.object);
    if (done?.kind === "place" && done.object) r.carried.delete(done.object);
    if (r.at + 1 >= r.plan.steps.length) return this.finish(r, "done");
    this.activate(r, r.at + 1);
  }

  /** i번째 단계를 지금 단계로: PlanHub 단계 상태(앞 단계 done, 이 단계 active)를 한 번에 바꾸고 단계 종류대로 시작한다. */
  private activate(r: Run, i: number): void {
    const prev = r.plan.steps[r.at];
    const step = r.plan.steps[i]!;
    const now = this.clock.now();
    r.stepEnd?.abort();
    Object.assign(r, {
      at: i, stepAt: now, spokeAt: now, visionAt: now, deadline: now + step.timeoutMs, asking: null, watch: step.until ? new ConditionWatch(step.until) : null,
      again: false, device: "idle", gen: r.gen + 1, looks: 0, lookAt: Number.NEGATIVE_INFINITY, stepEnd: new AbortController(),
    });
    this.o.plans.setSteps(r.plan.view.id, { ...(prev ? { [prev.id]: "done" as const } : {}), [step.id]: "active" });
    if (step.kind === "wait" || step.kind === "device") this.quietFrom = now;
    if (step.kind === "wait") return this.clear(r);
    if (step.kind === "device") {
      this.clear(r);
      return this.runDevice(r, step);
    }
    this.show(r, step);
  }

  /** 사람 단계·질문·알림을 실제 폰에 띄운다(소리로 읽음). */
  private show(r: Run, step: AgentStep): void {
    const world = this.o.world();
    const human = HUMAN_KINDS.includes(step.kind);
    r.sent = {
      type: "command", id: r.plan.view.id, step: step.id, text: (human ? step.command : step.kind === "ask" ? step.prompt?.text : step.text) ?? step.label,
      vision: human ? this.vision(r, step, world) : null, choices: choicesOf(r, step).map(({ id, label }) => ({ id, label })),
      target: human ? this.target(r, step, world) : null, speak: true,
      ...(human ? { kind: step.kind as PhoneStepKind } : {}),
    };
    this.o.toPhone(r.sent);
  }

  /** 기기 단계: 정책을 거쳐 기기 도구를 부른다. 승인 토큰이 오면 실제 폰에 묻는다. */
  private runDevice(r: Run, step: AgentStep): void {
    const devices = this.o.devices;
    if (!devices || !step.device) return this.finish(r, "failed", EXEC_TEXT.deviceFailed);
    const gen = r.gen;
    r.device = "running";
    devices.run(step.device.tool, step.device.deviceId, step.device.args, () => this.live(r, gen)).then(
      (res) => {
        const token = res.needsConfirmation?.token;
        if (!this.live(r, gen)) {
          if (token) devices.cancel(token);
          return;
        }
        if (token) return this.ask(r, { why: "device", token }, APPROVAL_TEXT.ask(step.label), `${step.id}:approve`);
        this.deviceResult(r, gen, res);
      },
      () => this.deviceResult(r, gen, { ok: false }),
    );
  }

  /** 기기 결과: 실패면 실패로 닫는다. 적용을 확인하지 못했으면(신호 없음·미확인) 끝나는 조건이 참이 될 때까지만 기다리고, 조건이 없으면 실패로 닫는다. */
  private deviceResult(r: Run, gen: number, res: Pick<ToolResult, "ok" | "error" | "unverified" | "state">): void {
    if (!this.live(r, gen)) return;
    if (!res.ok) return this.finish(r, "failed", EXEC_TEXT.deviceFailed);
    const verified = !res.unverified && res.state !== "모름";
    if (!verified && !r.watch) return this.finish(r, "failed", EXEC_TEXT.deviceUnverified);
    r.device = verified ? "done" : "sent";
    this.look(r);
  }

  /** 시간 초과 질문에 「계속」: 시간 한도만 한 번 더 준다. 조건 기준 시각·기기 실행 기록은 그대로라 기기를 다시 보내지 않는다. */
  private resume(r: Run): void {
    const step = this.stepOf(r)!;
    const now = this.clock.now();
    Object.assign(r, { asking: null, deadline: now + step.timeoutMs });
    if (HUMAN_KINDS.includes(step.kind) || step.kind === "ask" || step.kind === "say") this.show(r, step);
    else this.clear(r);
  }

  /** 그 계획의 그 단계가 아직 진행 중인가(늦게 온 기기 결과를 버린다). */
  private live(r: Run, gen: number): boolean {
    return !this.stopped && this.run === r && r.gen === gen && r.state === "running";
  }

  /** 지금 단계가 됐으면 다음 단계로 넘기고 true. 아니면 사람 단계의 비전 상태가 바뀌었을 때 보낸다(visionMs에 한 번까지). */
  private look(r: Run): boolean {
    const step = this.stepOf(r);
    if (!step || r.state !== "running" || step.kind === "ask") return false;
    if (r.asking && r.asking.why !== "again") return false;
    // 시간 한도가 지난 뒤 온 관찰·기기 결과로는 넘기지 않는다(시간 초과가 먼저다)
    if (!r.asking && this.clock.now() > r.deadline) {
      this.timeout(r, step);
      return true;
    }
    if (step.kind === "device" && r.device !== "done" && r.device !== "sent") return false;
    const world = this.o.world();
    const reached = r.watch ? r.watch.check(this.conditionView(world), this.context(r, world)) : step.kind === "device" && r.device === "done";
    if (reached) {
      this.advance(r);
      return true;
    }
    if (!HUMAN_KINDS.includes(step.kind) || !r.sent || r.asking) return false;
    const vision = this.vision(r, step, world);
    const now = this.clock.now();
    if (vision !== r.sent.vision && now - r.visionAt >= this.cfg.visionMs) {
      r.visionAt = now;
      r.sent = { ...r.sent, vision, speak: false };
      this.o.toPhone(r.sent);
    }
    return false;
  }

  /** 시간 한도를 넘은 단계: on_timeout이 ask이고 아직 묻지 않았으면 실제 폰에 계속할지 한 번 묻고, 아니면 실패로 닫는다. */
  private timeout(r: Run, step: AgentStep): void {
    if (step.onTimeout === "ask" && !r.again) {
      r.again = true;
      return this.ask(r, { why: "again" }, AGAIN_TEXT.ask(step.label), `${step.id}:again`);
    }
    this.finish(r, "failed", step.kind === "ask" ? EXEC_TEXT.noAnswer : EXEC_TEXT.timeout);
  }

  /** 끝나는 조건이 있는 집기·놓기 단계가 stallMs 넘게(단계 시작 뒤, 받은 부름 뒤) 안 끝나면 관찰 모드를 부른다. 단계마다 stallMax번까지.
   *  받은 것만 먼저 세고, 그 부름의 settle(false)는 셈을 돌려준다(같은 계획·단계 세대일 때만, 한 번). */
  private stall(r: Run, step: AgentStep, now: number): void {
    if (!this.o.stalled || (step.kind !== "pick" && step.kind !== "place") || !step.until || !r.sent || r.asking || !r.stepEnd) return;
    if (r.looks >= this.cfg.stallMax || now - r.stepAt < this.cfg.stallMs || now - r.lookAt < this.cfg.stallMs) return;
    const gen = r.gen;
    // asking: stalled를 부르는 중(그 안에서 정하면 받은 뒤 셈에 바로 반영), open: 받았고 아직 안 정함, done: 정함(또는 받지 않음)
    let state: "asking" | "open" | "done" = "asking";
    let counted = true;
    const s: Stall = {
      planId: r.plan.view.id, stepId: step.id, kind: step.kind, label: step.label, command: r.sent.text, until: step.until,
      stuckMs: now - r.stepAt, looks: r.looks, spots: this.spots(r, step, this.o.world()), gen, signal: r.stepEnd.signal,
      settle: (c) => {
        if (state === "done") return;
        const open = state === "open";
        state = "done";
        counted = c;
        if (open && !c && this.run === r && r.gen === gen && r.looks > 0) r.looks--;
      },
    };
    if (!this.o.stalled(s)) {
      state = "done";
      return;
    }
    if (state === "asking") state = "open";
    if (counted) r.looks++;
    r.lookAt = now;
  }

  /** 가까이 볼 곳: 계획 물건(지금 따라가는 World State 물건, 자리를 알 때)과 단계 대상 자리(평면도, 물건과 다를 때). */
  private spots(r: Run, step: AgentStep, world: WorldView): LookSpot[] {
    const out: LookSpot[] = [];
    const id = step.object ?? step.target;
    const obj = id ? ours(r, id, world).find((o) => o.status !== "gone" && o.position) : undefined;
    if (obj?.position) out.push({ id: obj.id, label: OBJECT_NAME[obj.cls] ?? obj.cls, position: obj.position });
    const at = step.target ? this.o.locate?.(step.target) : undefined;
    if (step.target && at && step.target !== id && step.target !== obj?.id) out.push({ id: step.target, label: this.placeName(step.target), position: at.position });
    return out;
  }

  /** repeatMs마다 지금 명령·질문을 다시 읽는다. */
  private repeat(r: Run, now: number): void {
    if (!r.sent || now - r.spokeAt < this.cfg.repeatMs) return;
    r.spokeAt = now;
    this.o.toPhone({ ...r.sent, speak: true });
  }

  /** 실제 폰 명령을 지운다(기다리기·기기 단계). */
  private clear(r: Run): void {
    if (!r.sent) return;
    r.sent = null;
    this.o.toPhone({ type: "command_clear", id: r.plan.view.id });
  }

  /** 조건을 볼 World State: 폰 자리는 실행 추적이 받은 맞춘 눈과 World State 눈 중 새것. */
  private conditionView(w: WorldView): WorldView {
    const e = this.eye;
    if (!e || (w.eye && w.eye.at_ms >= e.at)) return w;
    const eye: WorldEye = {
      position: e.position, height_m: w.eye?.height_m ?? 0, yaw_deg: w.eye?.yaw_deg ?? 0, pitch_deg: w.eye?.pitch_deg ?? 0,
      room: roomAt(this.o.floor(), e.position), room_label: null, at_ms: e.at,
    };
    return { ...w, eye };
  }

  private context(r: Run, world: WorldView): ConditionContext {
    const fp = this.o.floor();
    return {
      nowMs: this.clock.now(), sinceMs: r.stepAt, offsetMinutes: this.o.offsetMinutes,
      locate: (id) => fp.objects.get(id)?.position ?? null,
      roomOf: (id) => {
        const o = fp.objects.get(id);
        return o ? o.room ?? roomAt(fp, o.position) : null;
      },
      follow: (id) => ours(r, id, world).map((o) => o.id),
    };
  }

  /** 비전 상태 한 줄: go는 든 물건 자리와 목표까지 거리, pick·place는 그 물건 자리. 비전으로 못 보는 단계면 null. */
  private vision(r: Run, step: AgentStep, world: WorldView): string | null {
    if (step.kind === "go") {
      const carried = this.carried(r);
      const place = this.placeName(step.target);
      const far = VISION_TEXT.distance(place, this.distance(step.target, world));
      return carried ? `${objectLine(r, carried, world)} · ${far}` : far;
    }
    return step.object ? objectLine(r, step.object, world) : null;
  }

  /** 지금 단계 앞의 마지막 집기 물건(그 뒤에 내려놓기가 없을 때). */
  private carried(r: Run): string | null {
    for (let i = r.at - 1; i >= 0; i--) {
      const s = r.plan.steps[i]!;
      if (s.kind === "place") return null;
      if (s.kind === "pick") return s.object;
    }
    return null;
  }

  private placeName(id: string | null): string {
    if (!id) return PLACE_UNKNOWN;
    const type = this.o.floor().objects.get(id)?.type;
    return (type && placeShort(type)) || this.o.locate?.(id)?.label || id;
  }

  /** 명령 대상(실제 폰 고리 하나): 집기는 그 물건(World State 자리), 그 밖은 목표 자리(평면도). 자리를 모르면 null. */
  private target(r: Run, step: AgentStep, world: WorldView): PlannedCommand["target"] {
    const obj = step.kind === "pick" && step.object ? ours(r, step.object, world).find((o) => o.status !== "gone") : undefined;
    if (obj?.position) return { id: obj.id, label: OBJECT_NAME[obj.cls] ?? obj.cls, position: obj.position };
    const id = step.target;
    const at = id ? this.o.locate?.(id) : undefined;
    return id && at ? { id, label: at.label, position: at.position } : null;
  }

  /** 폰 눈에서 평면도 물건까지 거리(m). 눈이나 목표 자리를 모르면 null. */
  private distance(id: string | null, world: WorldView): number | null {
    const at = id ? this.o.floor().objects.get(id)?.position : undefined;
    const eye = this.conditionView(world).eye?.position;
    return eye && at ? Math.hypot(eye[0] - at[0], eye[1] - at[1]) : null;
  }

  /** close: 계획을 닫을 상태. null이면 닫지 않는다(새 계획이 PlanHub.onDecision으로 취소로 닫는다). */
  private finish(r: Run, state: "done" | "failed", text?: string, close: "done" | "failed" | "cancelled" | null = state): void {
    if (r.asking?.why === "device") this.o.devices?.cancel(r.asking.token);
    r.asking = null;
    r.gen++;
    r.stepEnd?.abort();
    this.step(r, state, text);
    if (r.sent) {
      r.sent = null;
      this.o.toPhone({ type: "command_clear", id: r.plan.view.id });
    }
    if (close) this.o.plans.close(r.plan.view.id, close);
  }

  private step(r: Run, state: ExecState, text?: string): void {
    r.state = state;
    r.since = this.clock.now();
    this.emit(r.plan.view.id, state, text);
  }

  /** 계획을 만들지 않는 판단(대기·실패·같은 행동·늦은 답·잠시 뒤)은 그 판단 줄에 기록만 한다. */
  private note(d: DecisionRecord, text: string): void {
    this.emit(planIdOf(d.id), "decided", text);
  }

  private emit(planId: string, state: ExecState, text?: string): void {
    if (this.stopped) return;
    this.o.emit({ type: "execution", at_ms: this.clock.now(), plan_id: planId, state, text: text ?? EXEC_TEXT[state] });
  }
}

/** 가까이 봐서 찾은 물건을 전체 사진이 못 봐도 지키는 중이거나(World State closer_hold), 지키던 중 같은 종류 새 물건이 다른 자리에 생겼는가(followed_by).
 *  그동안 보인 것이 아니라 「아직 있음」으로 세지 않는다. */
const held = (o: WorldObject) => o.closer_hold === true || !!o.followed_by;

/** 계획 물건으로 보는 지금 World State 물건(하나, 없으면 빈 목록). 지금 id가 사라졌거나(그 자리가 시야 안인데 없음), 사람이 들고 다니다 시야 밖이 됐거나,
 *  가까이 봐서 지키는 중이거나 옮김 표시(followed_by)가 있을 때만 그 뒤에 처음 보인 같은 종류 물건(계획 전부터 있던 것·앞서 이은 것은 뺀다)이 하나일 때 그것으로 이어 간다.
 *  옮김 표시가 가리키는 물건은 처음 보인 시각과 상관없이 후보다. 후보가 여럿이면(옮김 표시가 가리키는 것이 끼어 있어도) 어느 것인지 모르므로 잇지 않는다.
 *  여럿이거나 들지 않은 물건이 시야 밖이면 잇지 않는다(「완료」로 넘긴다). */
function ours(r: Run, id: string, world: WorldView): WorldObject[] {
  const cur = r.alias.get(id) ?? id;
  const own = world.objects.find((o) => o.id === cur);
  if (own && own.status !== "gone" && !held(own) && !(own.status === "out_of_view" && r.carried.has(id))) return [own];
  const cls = clsOf(world, id);
  const others = r.others.get(id) ?? new Set<string>();
  const seen = new Set(r.alias.values());
  const after = own?.last_seen_ms ?? -Infinity;
  const marked = own?.followed_by ?? null;
  // 들고 다니다 시야 밖이 된 물건은 내려놓기 목표 자리 가까이(NEAR_M 안)에서 새로 보인 것만 잇는다(그 자리를 모르면 거리는 보지 않는다)
  const step = r.plan.steps[r.at];
  const near = own?.status === "out_of_view" && step?.kind === "place" ? r.placeAt(step.target) : null;
  const next = world.objects.filter((o) => o.cls === cls && o.id !== cur && o.id !== id && !others.has(o.id) && !seen.has(o.id) && o.status !== "gone"
    && (o.first_seen_ms > after || o.id === marked)
    && (!near || !o.position || Math.hypot(o.position[0] - near[0], o.position[2] - near[1]) <= NEAR_M));
  const pick = next.length === 1 ? next[0] : undefined;
  if (pick) {
    r.alias.set(id, pick.id);
    return [pick];
  }
  return own ? [own] : [];
}

/** 물건 줄: 「컵 · 손에 있음」. 사라지지 않은 같은 물건 중 가장 최근 것. */
function objectLine(r: Run, id: string, world: WorldView): string {
  const cls = clsOf(world, id);
  return `${OBJECT_NAME[cls] ?? cls} · ${place(ours(r, id, world).find((o) => o.status !== "gone") ?? null)}`;
}

/** 승인 질문은 승인·거절, 다시 묻기는 계속·그만, 사람 단계는 「완료」 하나, 질문은 그 답들, 알림·기다리기·기기는 없음. */
function choicesOf(r: Run, step: AgentStep | undefined): ActionChoice[] {
  if (r.asking?.why === "again") return AGAIN;
  if (r.asking) return APPROVE;
  if (!step) return [];
  if (step.kind === "ask") return step.prompt?.choices ?? [];
  return HUMAN_KINDS.includes(step.kind) ? [STEP_DONE] : [];
}

/** World State 물건 자리 글: VLM이 본 자리, 없으면 놓인 면, 그것도 없으면 자리 모름. 없으면 안 보임. */
function place(o: WorldObject | null): string {
  if (!o) return VISION_TEXT.unseen;
  const p = o.facts.place?.value;
  if (p) return STATE_TEXT[p] ?? p;
  return o.surface_label ? onSurface(o.surface_label) : PLACE_UNKNOWN;
}
