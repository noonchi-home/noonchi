// 실행 추적의 미리 세운 목표(GoalWatch, 2026-11-18 사용자 결정 「컵을 마시는 걸 볼 때 다 마시면 치워야겠다는 목표를 세우고, 사용자가 사라지면 관련된 행동을 계획하고 실행」).
// - 세우기: 쓰는 중 지킴(use.ts)이 사람이 쓰는 종류를 붙잡으면 습관 FSM을 한 걸음 앞서 읽어(src/brain/goal.ts goalAhead) 사람이 떠난 뒤 할 일을 목표로 세운다.
//   다른 계획이 열려 있거나 만드는 중이거나, 안전 알림이 있거나, 충전 자리로 돌아가는 중이면 세우지 않는다.
//   한 등장(World State 사람 since_ms)에 한 번만 세운다(버리거나 쓴 뒤 같은 등장에서 다시 세우지 않아 계획 모드를 되풀이해 부르지 않는다).
//   처음 세울 때 메시지 상자에 「<규칙 조건> <행동 말>」 한 줄(클로이드 말, 사실로만: 「컵을 두고 자리를 뜨면 컵을 치울게요」)을 올린다.
// - 미리 만들기(prep): 대상 물건이 면 위에 놓여 있고(손에 있으면 놓을 때까지 기다린다) 계획 모드가 비어 있을 때, 같은 계획 모드(o.planner)를 목표 기록으로 한 번 부른다.
//   입력에 목표 물건을 싣고(계획 검사가 다른 물건 계획을 버린다), 받은 계획의 그 종류 물건이 목표 물건뿐일 때만 준비됨으로 둔다. 실패하면 다시 부르지 않는다.
//   폰·대시보드 명령은 내지 않는다(관찰만). 진짜 판단의 계획이 시작되면 계획 모드(한 번에 하나)가 미리 만들기를 끊는다.
// 상태(status: 세움·떠남·씀·버림)와 미리 만들기(prep)는 따로 바뀐다. 바뀔 때마다 o.onGoal로 낸다(서버가 /brain/goal_changes·/brain/goal과 대시보드로 보낸다).
import type { DecisionRecord } from "../../contract/events.js";
import type { GoalDrop, PendingGoal } from "../../contract/goal.js";
import type { ObjClass, WorldView } from "../../contract/world.js";
import type { AgentPlan, PlanResult } from "../../agent/index.js";
import { decisionWorld, fsmRuleOf, goalAhead, type GoalPick } from "../../brain/index.js";
import { ruleIf } from "../../world/labels.js";
import { GOAL_TEXT } from "../labels.js";
import { emergencyOf } from "../mode.js";
import { followedId, planObjectsOf, putAway, TASK_NAMES, TASK_SAY, targetOf } from "../tasks.js";
import { Part } from "./core.js";

/** 목표를 세워 둘 수 있는 시간(ms, 사용자 답 30분)과, 사람이 떠난 뒤 PAM이 그 행동을 고르기를 기다리는 시간(ms, 사용자 답 15초). */
export const GOAL_DEFAULTS = { armMs: 30 * 60_000, fireWaitMs: 15_000 } as const;

interface Goal {
  view: PendingGoal;
  pick: GoalPick;
  /** 지금 따라가는 대상 물건 id(옮김 표시로 바뀐다). */
  objectId: string;
  /** 세운 때 사람 등장(since_ms). */
  presence: number | null;
  /** 미리 만든 계획과 그때 대상이 놓인 면. */
  plan: AgentPlan | null;
  surface: string | null;
  /** 미리 만드는 중인 계획 모드 호출. */
  job: { abort: AbortController; done: Promise<PlanResult> } | null;
}

export class GoalWatch extends Part {
  private goal: Goal | null = null;
  private n = 0;
  /** 목표를 버리거나 쓴 등장(그 등장에서는 다시 세우지 않는다). */
  private spent: number | null | undefined = undefined;
  private readonly jobs = new Set<Promise<unknown>>();

  current(): PendingGoal | null {
    return this.goal?.view ?? null;
  }

  /** tick·World State 변화마다(쓰는 중 지킴 뒤에) 부른다. */
  update(): void {
    if (this.core.stopped) return;
    if (this.goal) this.watch(this.goal);
    if (!this.goal) this.arm();
    if (this.goal) this.preplan(this.goal);
  }

  private arm(): void {
    const world = this.o.world();
    const p = world.person;
    if (!this.o.habit || !p.visible || p.since_ms === this.spent || this.core.open() || this.core.planning || this.core.dock.busy()) return;
    if (emergencyOf({ world, offNotices: this.core.safety.offTrack().notices })) return;
    const held = this.core.use.holding();
    const habit = held.length ? this.o.habit() : null;
    if (!habit) return;
    const tasks = this.o.tasks?.() ?? TASK_NAMES;
    for (const h of held) {
      const pick = goalAhead({ memory: habit.memory, kind: habit.kind, state: habit.state, tasks, cls: h.cls });
      const objectId = h.id ?? targetOf({ target: h.cls as ObjClass }, world, this.core.steps.placed())?.id ?? null;
      if (!pick || !objectId) continue;
      const id = `goal-${++this.n}`;
      const learned = fsmRuleOf(habit.memory, habit.kind, pick.action)?.learned ?? false;
      const will = TASK_SAY[pick.action]?.will;
      const text = will ? GOAL_TEXT.armed(ruleIf({ trigger: pick.trigger, action: pick.action, learned }), will) : null;
      this.goal = {
        pick, objectId, presence: p.since_ms, plan: null, surface: null, job: null,
        view: {
          id, action: pick.action, state: pick.state, trigger: pick.trigger, object: objectId, cls: h.cls, status: "armed", prep: "waiting", reason: null, text,
          armed_ms: this.clock.now(), ready_ms: null, gone_ms: null, fired_ms: null, plan: null,
        },
      };
      this.publish();
      if (text) this.o.thought?.(text, id);
      return;
    }
  }

  /** 계획 모드에 넘기는 목표 기록(판단 기록 모양, PAM 판단이 아니라 prediction이 없다). 계획 id는 plan:goal-n이고, 쓸 때 PAM 판단 id로 다시 낸다(resubmit). */
  private record(g: Goal, world: WorldView, now: number): DecisionRecord {
    const habit = this.o.habit?.();
    const rule = habit ? fsmRuleOf(habit.memory, habit.kind, g.view.action) : null;
    return {
      id: g.view.id, seq: 0, atMs: now, textSent: "", finalTime: new Date(now).toISOString(), status: "valid", prediction: null, action: g.view.action,
      fsm: { state: g.view.state, trigger: g.view.trigger, learned: rule?.learned ?? false, matched: true }, memoryVersion: habit?.version ?? 0,
      tasks: [...(this.o.tasks?.() ?? TASK_NAMES)], world: decisionWorld(world),
    };
  }

  private preplan(g: Goal): void {
    if (g.view.prep !== "waiting" || g.view.status !== "armed" || this.core.open() || this.core.planning) return;
    const world = this.o.world();
    const o = world.objects.find((x) => x.id === followedId(world, g.objectId));
    // 대상이 면 위에 놓였을 때 만든다: 손에 든 컵 자리로 만든 계획은 가기 단계 자리가 틀린다
    if (!o || o.status !== "present" || !o.surface || o.facts.place?.value === "in_hand" || o.carried === true) return;
    g.objectId = o.id;
    g.surface = o.surface;
    const now = this.clock.now();
    const abort = new AbortController();
    let out: PlanResult | Promise<PlanResult>;
    try {
      out = this.o.planner(this.record(g, world, now), abort.signal, { trigger: g.pick.trigger, on: g.pick.on, object: o.id });
    } catch (e) {
      out = { ok: false, error: (e as Error).message };
    }
    const done: Promise<PlanResult> = Promise.resolve(out).catch((e: unknown) => ({ ok: false as const, error: (e as Error).message }));
    g.job = { abort, done };
    this.set(g, { prep: "planning", object: o.id });
    const p = done.then((r) => {
      if (this.goal !== g || g.job?.done !== done) return;
      g.job = null;
      // 받은 계획의 그 종류 물건이 목표 물건뿐일 때만 둔다(컵이 둘이면 다른 컵 계획을 두지 않는다)
      if (r.ok && this.mine(g, r.plan)) {
        g.plan = r.plan;
        this.set(g, { prep: "ready", ready_ms: this.clock.now(), plan: r.plan.view });
      } else this.set(g, { prep: "failed" });
    }).finally(() => { this.jobs.delete(p); });
    this.jobs.add(p);
  }

  /** 계획이 다루는 그 종류 물건이 모두 목표 물건(옮김 표시로 이어진 것 포함)인가. 하나도 없어도 아니다. */
  private mine(g: Goal, plan: AgentPlan): boolean {
    const world = this.o.world();
    const goal = followedId(world, g.objectId);
    const ids = planObjectsOf(plan.view, world, g.view.cls as ObjClass);
    return ids.length > 0 && ids.every((id) => followedId(world, id) === goal);
  }

  /** 목표가 아직 맞는지 보고, 사람이 떠났으면 fired로 바꾼다. 맞지 않으면 버리고 지금 길(PAM 판단 → 계획 모드)로 돌아간다:
   *  안전 알림(safety) → 지금 행동 목록에 없음(mode, 코치 모드) → 충전 자리 복귀 중(dock) → 다른 계획이 열렸거나 다른 행동 계획을 만드는 중(other) → 세운 지 armMs(expired).
   *  - 사람이 보이는 동안: 다른 등장이면 back, 대상이 이어진 물건 없이 사라지거나 치워지면 moved.
   *  - 사람이 떠남: 대상이 없으면 took(들고 나감). 손에 있음으로 남아 있으면 떠난 때부터 fireWaitMs 기다린 뒤 took. 그대로 있으면 떠난 때를 실어 fired로 바꾸고
   *    판단을 바로 부르게 한다(한 번). 미리 만들기(prep)는 따로 이어진다.
   *  - fired 뒤: 사람이 다시 보이면 back, 대상이 사라지면 took, fireWaitMs 안에 PAM이 그 행동을 고르지 않으면 pam. */
  private watch(g: Goal): void {
    const world = this.o.world();
    const now = this.clock.now();
    const p = world.person;
    const v = g.view;
    if (emergencyOf({ world, offNotices: this.core.safety.offTrack().notices })) return this.drop("safety");
    if (!(this.o.tasks?.() ?? TASK_NAMES).includes(v.action)) return this.drop("mode");
    if (this.core.dock.busy()) return this.drop("dock");
    if (this.core.open() || (this.core.planning && this.core.planning.decision.action !== v.action)) return this.drop("other");
    if (now - v.armed_ms > (this.o.goalArmMs ?? GOAL_DEFAULTS.armMs)) return this.drop("expired");
    const o = world.objects.find((x) => x.id === followedId(world, g.objectId));
    if (v.status === "fired") {
      if (p.visible) return this.drop("back");
      if (!o || o.status === "gone") return this.drop("took");
      if (now - (v.fired_ms ?? now) > GOAL_DEFAULTS.fireWaitMs) return this.drop("pam");
      return;
    }
    if (p.visible) {
      if (p.since_ms !== g.presence) return this.drop("back");
      if (!o || o.status === "gone" || putAway(o, this.core.steps.placed())) return this.drop("moved");
      return;
    }
    if (!o || o.status === "gone") return this.drop("took");
    if (putAway(o, this.core.steps.placed())) return this.drop("moved");
    if (o.facts.place?.value === "in_hand" || o.carried === true) {
      if (p.since_ms !== null && now - p.since_ms > GOAL_DEFAULTS.fireWaitMs) this.drop("took");
      return;
    }
    g.objectId = o.id;
    this.set(g, { status: "fired", object: o.id, gone_ms: p.since_ms, fired_ms: now });
    this.o.nudge?.();
  }

  /** 목표와 같은 행동인데 사람이 떠난 뒤의 판단이 아닌가(아직 쓰는 중이거나, 떠난 것이 집 상태에 반영되기 전에 보낸 판단): 판단 받기는 그 판단으로 계획을 만들지 않고 기록만 한다.
   *  쓰는 동안 만든 계획은 쓰는 중 기다림 한도(30초)를 넘으면 닫히므로 목표가 맡고, 사람이 떠나면 목표가 판단을 다시 부른다. */
  holds(d: DecisionRecord): boolean {
    const v = this.goal?.view;
    return !!v && d.action === v.action && !this.afterLeave(d, v);
  }

  /** 떠난 것이 집 상태에 반영된 뒤 보낸 판단인가: 목표가 떠남을 본 뒤(fired_ms, 집 상태에 「사람 안 보임」이 들어온 때) 불렀고 그 관찰에 사람이 없다.
   *  사람이 떠난 사진의 촬영 시각(gone_ms)으로 가르지 않는다: 그 사진을 찍은 뒤라도 VLM 답이 집 상태에 들어오기 전에 부른 판단은 사람이 보이던 관찰로 답한 것이다. */
  private afterLeave(d: DecisionRecord, v: PendingGoal): boolean {
    return v.status === "fired" && v.fired_ms !== null && d.atMs >= v.fired_ms && !d.world.person_visible;
  }

  /** 판단 받기(start.ts)가 계획 모드를 부르기 전에 묻는다. 사람이 떠난 목표(fired)와 같은 행동이고 떠난 것이 집 상태에 반영된 뒤 보낸 판단(afterLeave)이면:
   *  - 미리 만든 계획이 있으면 대상이 그때 면 그대로일 때 이 판단으로 다시 검사해(o.reuse) 그 결과. 면이 바뀌었으면 moved, 검사를 못 넘으면 stale로 버리고 null.
   *  - 미리 만드는 중이면 그 호출을 받아 쓴다(새로 부르지 않는다): 끝나면 다시 검사하고, 못 넘으면 fallback(계획 모드). 판단 받기 신호가 끊겼으면 다시 검사도
   *    fallback도 하지 않는다(계획 모드는 한 번에 하나라 fallback이 새 사람 요청의 계획을 끊는다).
   *  - 둘 다 없으면(미리 만들기 실패·아직) stale로 버리고 null. null이면 부르는 쪽이 계획 모드를 부른다. 쓰면 목표는 used로 끝난다.
   *  seenSince: 실행 전 검사가 대상을 다시 본 것으로 볼 기준(사람이 떠난 때). */
  take(d: DecisionRecord, signal: AbortSignal, fallback: () => PlanResult | Promise<PlanResult>): { out: PlanResult | Promise<PlanResult>; seenSince: number; goal: string } | null {
    const g = this.goal;
    const reuse = this.o.reuse;
    const v = g?.view;
    if (!g || !v || !reuse || d.action !== v.action || v.gone_ms === null || !this.afterLeave(d, v)) return null;
    const seenSince = v.gone_ms;
    const surface = g.surface;
    const objectId = g.objectId;
    const sameSurface = () => {
      const world = this.o.world();
      return world.objects.find((x) => x.id === followedId(world, objectId))?.surface === surface;
    };
    if (g.plan) {
      if (!sameSurface()) {
        this.drop("moved");
        return null;
      }
      const r = reuse(d, g.plan);
      if (!r.ok) {
        this.drop("stale");
        return null;
      }
      this.end(g, "used");
      return { out: r, seenSince, goal: v.id };
    }
    if (g.job) {
      const job = g.job;
      const stop = () => job.abort.abort();
      if (signal.aborted) stop();
      else signal.addEventListener("abort", stop, { once: true });
      g.job = null;
      this.end(g, "used");
      const cut: PlanResult = { ok: false, error: "새 판단으로 바뀜" };
      const out = job.done.then((r): PlanResult | Promise<PlanResult> => {
        if (signal.aborted) return cut;
        if (r.ok && this.mine(g, r.plan) && sameSurface()) {
          const again = reuse(d, r.plan);
          if (again.ok) return again;
        }
        return signal.aborted ? cut : fallback();
      });
      return { out, seenSince, goal: v.id };
    }
    this.drop("stale");
    return null;
  }

  /** 목표를 버린다(지금 길로 돌아간다). 없으면 아무것도 하지 않는다. */
  drop(reason: GoalDrop): void {
    if (this.goal) this.end(this.goal, "dropped", reason);
  }

  /** 목표를 끝낸다(used·dropped): 마지막 상태를 내고, 그 등장에서는 다시 세우지 않는다. 버리면 미리 만드는 호출을 끊는다. */
  private end(g: Goal, status: "used" | "dropped", reason: GoalDrop | null = null): void {
    if (status === "dropped") g.job?.abort.abort();
    g.job = null;
    this.spent = g.presence;
    this.set(g, { status, reason });
    this.goal = null;
  }

  private set(g: Goal, v: Partial<PendingGoal>): void {
    g.view = { ...g.view, ...v };
    if (this.goal === g) this.publish();
  }

  private publish(): void {
    const g = this.goal;
    if (g && !this.core.stopped) this.o.onGoal?.(g.view);
  }

  /** 미리 만드는 호출이 끝날 때까지 기다린다(시험용). */
  async idle(): Promise<void> {
    while (this.jobs.size) await Promise.all([...this.jobs]);
  }

  /** 멈추면 미리 만드는 호출을 끊고 더 내지 않는다. */
  stop(): void {
    this.goal?.job?.abort.abort();
  }
}
