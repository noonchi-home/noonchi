import { TRACE_TEXT } from "../../act/labels.js";
import { taskOf } from "../../act/tasks.js";
import type { AttemptKey, EvidenceRef } from "../../contract/assistance.js";
import type { AssistanceAttempt, AssistanceExecution } from "../../contract/assistance-outcome.js";
import type { DeviceState } from "../../contract/devices.js";
import type { PendingGoal } from "../../contract/goal.js";
import type { SafetyState } from "../../contract/machines.js";
import type { PlannedCommand } from "../../contract/phone.js";
import type { PlanStep, PlanView } from "../../contract/plan.js";
import type { TraceEvent, TraceOutput, TraceRefs, TraceTarget } from "../../contract/trace.js";
import type { WorldChange, WorldView } from "../../contract/world.js";
import { kindEntry } from "../../devices/kinds.js";
import { TraceJournal } from "../../record/index.js";
import { FSM_STATE_TEXT, OBJECT_NAME, RULE_IF } from "../../world/labels.js";
import { becameKey, deviceText, type PlaneSurface } from "../../world/index.js";

const goalPrep = { waiting: "goal_armed", planning: "goal_planning", ready: "goal_ready", failed: "failed" } satisfies Record<PendingGoal["prep"], TraceOutput>;
const goalState = { checking: "goal_checking", fired: "goal_fired", used: "goal_used", dropped: "goal_dropped" } as const;
const activityResult = { done: "activity_done", cancelled: "activity_cancelled", failed: "activity_failed" } satisfies Record<AssistanceExecution, TraceOutput>;
const attemptId = (key: AttemptKey) => JSON.stringify([key.boot, key.homeEpoch, key.attemptId]);
/** 크기를 묶은 기억: 오래된 것부터 버린다. */
function remember(map: Map<string, number>, key: string, value: number): void {
  map.set(key, value);
  if (map.size > 240) map.delete(map.keys().next().value!);
}

export class HomeTrace extends TraceJournal {
  private goalMark = "";
  private readonly commands = new Map<string, { id: string; event: TraceEvent }>();
  private readonly settled = new Set<string>();
  private readonly deviceValues = new Map<string, Map<string, unknown>>();
  private readonly contexts = new Map<string, TraceRefs>();
  private readonly goalAnchors = new Map<string, string>();
  private readonly attempts = new Map<string, TraceRefs>();
  private readonly stops = new Map<string, string>();
  private readonly evidence = new WeakMap<WorldChange, { id: string; ref: EvidenceRef }>();
  private readonly frameDepartures = new Map<number, { id: string; ref: EvidenceRef }>();
  /** 목표마다 사람이 떠난 때, 계획마다 첫 명령을 시작한 때: 활동 종료 줄의 첫 명령 시간. */
  private readonly goneAt = new Map<string, number>();
  private readonly firstCommands = new Map<string, number>();
  private safetyMark = "";
  private safetyCause: string | undefined;
  objects?: () => WorldView["objects"];
  surfaces?: () => PlaneSurface[];
  currentSafety?: () => SafetyState;

  goal(g: PendingGoal): void {
    const output = g.status === "armed" ? goalPrep[g.prep] : goalState[g.status];
    const refs = { goal_id: g.id, ...(g.object ? { object_id: g.object } : {}) };
    this.rememberContext(g.id, refs);
    if (g.gone_ms !== null) remember(this.goneAt, g.id, g.gone_ms);
    const mark = g.id + ":" + output;
    if (mark === this.goalMark) return;
    this.goalMark = mark;
    if (g.reason === "safety" && this.currentSafety) this.safety(this.currentSafety());
    const departure = g.departure_rev === undefined ? undefined : this.frameDepartures.get(g.departure_rev);
    const observation = g.status === "fired" ? this.event("person_left", { ...refs, evidence: departure?.ref }, "goal_fired", departure?.id) : undefined;
    const target = { action: g.action, destination: g.meal?.surface, ...(g.status === "dropped" && g.reason ? { goalDrop: g.reason } : {}) };
    if (g.status === "armed" && !this.goalAnchors.has(g.id)) {
      const anchor = this.retain("goal", refs, output, target);
      if (anchor) this.goalAnchors.set(g.id, anchor.id);
    } else {
      this.event("goal", refs, output, g.reason === "safety" ? this.safetyCause : observation?.id, target);
    }
    if (g.status === "dropped") this.dropAnchor(g.id);
  }

  ended({ key, action, startedMs }: AssistanceAttempt, execution: AssistanceExecution, endedMs: number): void {
    const id = attemptId(key);
    const context = this.attempts.get(id);
    if (!context) return;
    this.attempts.delete(id);
    const rows = this.snapshot().rows.reverse();
    const last = rows.find(row => context.plan_id ? row.refs.plan_id === context.plan_id
      : context.decision_id && row.refs.decision_id === context.decision_id);
    const cause = last && ((last.kind === "EXECUTION" && last.refs.step_id && last.state === execution) ||
      (last.kind === "GUARDRAIL" && execution !== "done")) ? last.id : undefined;
    const gone = context.goal_id ? this.goneAt.get(context.goal_id) : undefined;
    const first = context.plan_id ? this.firstCommands.get(context.plan_id) : undefined;
    const firstCommandMs = gone !== undefined && first !== undefined && first >= gone ? first - gone : undefined;
    this.terminal("activity_result", { ...context, attempt: key }, execution, activityResult[execution], startedMs, endedMs, cause,
      { action, ...(firstCommandMs !== undefined ? { firstCommandMs } : {}) });
    if (context.goal_id) this.dropAnchor(context.goal_id);
  }

  private dropAnchor(goal: string): void {
    const anchor = this.goalAnchors.get(goal);
    if (anchor) this.release(anchor);
    this.goalAnchors.delete(goal);
  }

  changes(changes: readonly WorldChange[], rev?: number): void {
    for (const change of changes) {
      if (!change.meaningful) continue;
      const ref = { source: "world_change", subjectId: change.subject, observedMs: change.at_ms, originId: "" };
      let row;
      if (change.kind === "person_gone" || change.kind === "person_room" || change.kind === "person_appeared" || change.kind === "person_state") {
        const output = change.kind === "person_gone" ? "person_not_seen" : change.kind === "person_appeared" ? "person_seen"
          : change.kind === "person_room" ? "person_room_changed" : "changed";
        row = this.event("person_changed", {}, output);
      } else if (["appeared", "gone", "state", "fixture"].includes(change.kind)) {
        row = this.event("object_changed", { object_id: change.subject }, "changed");
      }
      if (row) {
        const source = { id: row.id, ref: { ...ref, originId: row.id } };
        this.evidence.set(change, source);
        if (change.kind === "person_gone" && rev !== undefined) {
          this.frameDepartures.set(rev, source);
          if (this.frameDepartures.size > 240) this.frameDepartures.delete(this.frameDepartures.keys().next().value!);
        }
      }
    }
  }

  observationOf(change: WorldChange): EvidenceRef | undefined {
    return this.evidence.get(change)?.ref;
  }

  device(state: DeviceState, kind: string | undefined, initial = false): void {
    const entry = kindEntry(kind);
    if (!kind || !entry) return;
    const attrs = new Set([...(entry.profile.control?.attrs ?? []), ...entry.profile.sensors]);
    const prior = this.deviceValues.get(state.id) ?? new Map();
    this.deviceValues.set(state.id, prior);
    for (const attr of attrs) {
      const value = state.twin[attr];
      const key = becameKey(attr, value);
      if (!key) continue;
      if (!initial && prior.has(attr) && prior.get(attr) !== value) {
        this.event("device", { object_id: state.id }, "changed", undefined, { device: kind, deviceState: key });
      }
      prior.set(attr, value);
    }
  }

  safety(state: SafetyState): void {
    const mark = state.state !== "normal" ? JSON.stringify([state.state, state.fall, state.hot, state.notices]) : "";
    if (mark === this.safetyMark) return;
    this.safetyMark = mark;
    const entry = this.event("safety", {}, state.fall ? "safety_fall" : state.state === "emergency" ? "safety_device"
      : state.state === "suspect" ? "safety_monitor" : "safety_cleared");
    this.safetyCause = state.state === "emergency" ? entry?.id : undefined;
  }

  override event(event: TraceEvent, refs: TraceRefs, output: TraceOutput, causeId?: string, target?: TraceTarget) {
    if (output === "guard_safety" && this.currentSafety) this.safety(this.currentSafety());
    const row = super.event(event, { ...this.context(refs), ...refs }, output, causeId ?? (output === "guard_safety" ? this.safetyCause : undefined), target);
    if (row && output === "guard_safety" && refs.plan_id) {
      this.stops.set(refs.plan_id, row.id);
      if (this.stops.size > 240) this.stops.delete(this.stops.keys().next().value!);
    }
    return row;
  }

  override link(from: TraceRefs, to: TraceRefs): void {
    const resolved = { ...this.context(to), ...to };
    const id = from.attempt ? attemptId(from.attempt) : undefined;
    const refs = { ...(id ? this.attempts.get(id) : undefined), ...resolved, ...from };
    for (const key of [from.plan_id, from.decision_id, from.goal_id]) if (key) this.rememberContext(key, refs);
    if (id) this.attempts.set(id, refs);
    super.link(from, resolved);
  }

  override start(event: TraceEvent, refs: TraceRefs = {}, atMs?: number, target?: TraceTarget): string {
    return super.start(event, { ...this.context(refs), ...refs }, atMs, target);
  }

  command(cmd: PlannedCommand, step: PlanStep): void {
    if (!cmd.kind || step.status !== "active") return;
    const key = JSON.stringify([cmd.id, cmd.step]);
    if (this.commands.has(key) || this.settled.has(key)) return;
    const event = cmd.kind === "go" ? "move" : cmd.kind === "pick" ? "pick" : cmd.kind === "place" ? "place" : "work";
    const destination = cmd.target?.id ?? step.target?.objectId;
    const context = this.context({ plan_id: cmd.id });
    if (event === "pick" && destination) this.rememberContext(cmd.id, { ...context, object_id: destination });
    const object_id = event === "pick" ? destination : context?.object_id;
    const id = this.start(event, { plan_id: cmd.id, step_id: cmd.step, ...(object_id ? { object_id } : {}) }, step.started_ms, { destination });
    if (step.started_ms !== undefined && !this.firstCommands.has(cmd.id)) remember(this.firstCommands, cmd.id, step.started_ms);
    this.commands.set(key, { id, event });
    if (this.commands.size > 240) this.commands.delete(this.commands.keys().next().value!);
  }

  plan(plan: PlanView): void {
    for (const step of plan.steps) {
      if (step.status === "pending" || step.status === "active") continue;
      const key = JSON.stringify([plan.id, step.id]);
      const current = this.commands.get(key);
      if (!current) continue;
      this.commands.delete(key);
      this.settled.add(key);
      if (this.settled.size > 240) this.settled.delete(this.settled.values().next().value!);
      const state = step.status === "skipped" ? "cancelled" : step.status;
      const output = state === "failed" ? "failed" : state === "cancelled" ? "stopped"
        : current.event === "place" ? "place_done" : current.event === "move" ? "move_done" : "step_done";
      this.finish(current.id, state, output, step.ended_ms, state !== "done" ? this.stops.get(plan.id) : undefined);
    }
    if (plan.status === "cancelled" || plan.status === "failed" || plan.status === "done") this.stops.delete(plan.id);
  }

  private context(refs: TraceRefs): TraceRefs | undefined {
    const key = refs.plan_id ?? refs.decision_id ?? refs.goal_id;
    return key ? this.contexts.get(key) : undefined;
  }

  private rememberContext(key: string, refs: TraceRefs): void {
    this.contexts.set(key, refs);
    if (this.contexts.size > 480) this.contexts.delete(this.contexts.keys().next().value!);
  }

  protected override describe(event: TraceEvent, refs: TraceRefs, target?: TraceTarget, said?: string): { input?: string; output?: string } {
    // FSM 판단: 화살표 출발 상태 → 지금 상태(상태 id의 고정 글만, 모르는 상태는 고정 글 그대로)
    if (event === "pam") {
      const now = target?.personState ? FSM_STATE_TEXT[target.personState] : undefined;
      const from = target?.personFrom ? FSM_STATE_TEXT[target.personFrom] : undefined;
      return { ...(from ? { input: from } : {}), ...(now ? { output: now } : {}) };
    }
    if (event === "device" && target?.device && target.deviceState) {
      return { input: kindEntry(target.device)?.label, output: deviceText(target.device, target.deviceState).label };
    }
    if (event === "device_tool") return { input: kindEntry(target?.device)?.label };
    const objects = this.objects?.() ?? [];
    const object = objects.find(value => value.id === refs.object_id);
    const destination = target?.destination;
    const surfaces = this.surfaces?.() ?? [];
    const surface = destination ? surfaces.find(value => value.id === destination || (value.basin && value.id + "#basin" === destination)) : undefined;
    const place = surface?.label ?? (object?.surface ? surfaces.find(value => value.id === object.surface)?.label : undefined);
    const name = object ? OBJECT_NAME[object.cls] : undefined;
    const number = object && /^\w+_(\d+)$/.exec(object.id)?.[1];
    const input = [name && number ? `${name} ${number}` : name, place].filter(Boolean).join(" · ") || undefined;
    const task = taskOf(target?.action ?? null)?.name;
    const item = name ?? "물건";
    if (event === "action") {
      // 화살표가 고른 일: 입력은 그 화살표의 짧은 조건형(사용자가 정한 글), 배운 화살표면 출력에 표시한다
      const rule = target?.personFrom && target.action ? RULE_IF[target.action] : undefined;
      return { input: rule ?? input, output: task && target?.learned ? `${task} · ${TRACE_TEXT.learned}` : task };
    }
    if (event === "goal" || event === "activity_result") {
      const goal = [task, input].filter(Boolean).join(" · ") || undefined;
      const drop = event === "goal" && target?.goalDrop ? TRACE_TEXT.drop[target.goalDrop](item) : undefined;
      const first = event === "activity_result" && target?.firstCommandMs !== undefined && said
        ? `${said} · ${TRACE_TEXT.firstCommand((target.firstCommandMs / 1000).toFixed(1))}` : undefined;
      return { input: goal, ...(drop ?? first ? { output: drop ?? first } : {}) };
    }
    if (event === "check" && target?.checks?.length && said) {
      return { input, output: [...target.checks.map(check => TRACE_TEXT.check[check](item)), said].join(" · ") };
    }
    return { input };
  }
}
