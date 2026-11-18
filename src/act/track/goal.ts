// 실행 추적의 미리 세운 목표(GoalWatch, 2026-11-18 사용자 결정 「컵을 마시는 걸 볼 때 다 마시면 치워야겠다는 목표를 세우고, 사용자가 사라지면 관련된 행동을 계획하고 실행」).
// - 세우기: 쓰는 중 지킴(use.ts)이 사람이 쓰는 종류를 붙잡으면 사람 상태 FSM의 지금 상태(World State 하는 일로 정한 것이 먼저, 없으면 마지막 판단 상태)에서
//   나가는 화살표를 읽어(src/brain/goal.ts goalAhead) 사람이 떠난 뒤 할 일을 목표로 세운다. 목표는 배운 화살표에서만 선다(배우기 전 떠날 때는 묻기라 목표가 없다).
//   다른 계획이 열려 있거나 만드는 중이거나, 안전 알림이 있거나, 충전 자리로 돌아가는 중이면 세우지 않는다.
//   한 등장(World State 사람 since_ms)에 한 번만 세운다(버리거나 쓴 뒤 같은 등장에서 다시 세우지 않아 계획 모드를 되풀이해 부르지 않는다).
//   처음 세울 때 메시지 상자에 「<규칙 조건> <행동 말>」 한 줄(클로이드 말, 사실로만: 「컵을 두고 자리를 뜨면 컵을 치울게요」)을 올린다.
// - 미리 만들기(prep): 계획 모드가 비어 있을 때 같은 계획 모드(o.planner)를 목표 기록으로 한 번 부른다. 대상 물건이 면 위에 놓인 World State 물건이면 그 물건으로,
//   아직 손에 있거나 World State 물건이 아니면 사람이 다 쓰고 둘 자리(useSpot: 이번 등장에서 그 종류 후보를 손 밖에서 본 면, 아니면 사람 곁 면)에 둔 대신 물건(<종류>_0)으로 만든다
//   (2026-11-18 d1 세 판: 컵이 확정된 뒤에야 시작해 컵을 내려놓고 1~2초 안에 떠나면 떠나기 전에 계획이 없었다). 둘 자리를 모르면 기다린다.
//   입력에 목표 물건을 싣고(계획 검사가 다른 물건 계획을 버린다), 받은 계획의 그 종류 물건이 그 물건뿐일 때만 준비됨으로 둔다. 실패하면 다시 부르지 않는다.
//   쓸 때(take) 그 면에 있는 목표 컵 id로 묶어(rename) 지금 판단·World State로 다시 검사한다.
//   폰·대시보드 명령은 내지 않는다(관찰만). 진짜 판단의 계획이 시작되면 계획 모드(한 번에 하나)가 미리 만들기를 끊는다.
//   실패하면 그 까닭(계획 모드 오류 글, 다른 물건 계획이면 GOAL_LOG.error.notMine)을 목표 error와 서버 로그에 남긴다.
// - 준비한 계획을 쓰지 못하고 계획 모드로 넘어갈 때(take)도 까닭(다시 검사 오류 글 등)을 목표 error와 서버 로그 「준비한 계획 버림」에 남긴다
//   (2026-11-18 g1 glass: 받아 쓰다 넘어간 계획 모드가 「계획이 맞지 않아 버림」만 남겨 왜 못 썼는지 몰랐다).
// 상태(status: 세움·떠남·씀·버림)와 미리 만들기(prep)는 따로 바뀐다. 바뀔 때마다 o.onGoal로 낸다(서버가 /brain/goal_changes·/brain/goal과 대시보드로 보낸다).
import type { DecisionRecord } from "../../contract/events.js";
import type { GoalDrop, PendingGoal } from "../../contract/goal.js";
import type { ObjClass, WorldObject, WorldView } from "../../contract/world.js";
import { surfacePlace, type PlaneSurface } from "../../world/index.js";
import type { AgentPlan, PlanResult } from "../../agent/index.js";
import { decisionWorld, edgeLearned, goalAhead, seedTrigger, stateOfWorld, type GoalPick } from "../../brain/index.js";
import { ruleIf } from "../../world/labels.js";
import { GOAL_LOG, GOAL_TEXT } from "../labels.js";
import { emergencyOf } from "../mode.js";
import { carriesTarget, followedId, planObjectsOf, putAway, TASK_NAMES, TASK_SAY, targetOf, taskOf } from "../tasks.js";
import { Part } from "./core.js";

/** 목표를 세워 둘 수 있는 시간(ms, 사용자 답 30분)과, 사람이 떠난 뒤 PAM이 그 행동을 고르기를 기다리는 시간(ms, 사용자 답 15초),
 *  사람 곁 면으로 볼 거리(m, 사람 자리에서 면 가장자리까지: 면 가운데 거리 − 반지름),
 *  떠나기 직전 이 시간(ms) 안에 본 컵이면 떠난 뒤 사진을 기다리지 않고 바로 시작한다(사용자 결정 2026-11-18, 떠난 뒤 다시 봤는지는 집기 전에 본다). */
export const GOAL_DEFAULTS = { armMs: 30 * 60_000, fireWaitMs: 15_000, spotM: 1.5, leaveSeenMs: 2500 } as const;

/** 미리 만들 때 쓰는 대신 물건: 사람이 다 쓰고 둘 자리(면) 위의 그 종류 물건. id는 <종류>_0(World State 번호는 1부터라 겹치지 않는다). */
function standIn(cls: string, spot: { surface: string; label: string; position: [number, number, number]; place: string }, room: string | null, now: number): WorldObject {
  return {
    id: `${cls}_0`, cls: cls as ObjClass, position: spot.position, surface: spot.surface, surface_label: spot.label, room, error_m: null, status: "present",
    first_seen_ms: now, last_seen_ms: now, last_in_view_ms: now, facts: { place: { value: spot.place, at_ms: now, since_ms: now, certainty: "confirmed" } },
    answered_ms: null, devices: [], closer_hold: false, followed_by: null,
  };
}

interface Goal {
  view: PendingGoal;
  pick: GoalPick;
  /** 지금 따라가는 대상 물건 id(옮김 표시로 바뀐다). 모르면 null: 사람이 쓰는 컵이 아직 World State 물건이 아닐 때(VLM이 손에 든 컵을 물건으로 잘 안 답한다, 2026-11-18 g1)
   *  세우고, 그 종류 컵이 보이면(가장 최근에 본 치우지 않은 것) 그 컵으로 정한다. */
  objectId: string | null;
  /** 세운 때 사람 등장(since_ms). */
  presence: number | null;
  /** 미리 만든 계획, 그 계획의 목표 물건 id(대신 물건이면 <종류>_0)와 그 물건이 놓인 면. */
  plan: AgentPlan | null;
  planObject: string | null;
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
    // 지금 상태: World State 하는 일로 정한 것이 먼저(판단 전에도 목표가 4초쯤 선다), 없으면 마지막 판단의 상태
    const state = ("states" in habit.memory ? stateOfWorld(habit.memory, world) : null) ?? habit.state;
    for (const h of held) {
      const pick = goalAhead({ memory: habit.memory, kind: habit.kind, state, tasks, cls: h.cls });
      const objectId = h.id ?? targetOf({ target: h.cls as ObjClass }, world, this.core.steps.placed())?.id ?? null;
      if (!pick) continue;
      const id = `goal-${++this.n}`;
      // 묻기 자리를 바꾼 배운 컵 치우기(seed와 같은 트리거)도 사용자가 정한 짧은 꼴
      const learned = edgeLearned(pick.state, { on: pick.on, action: pick.action }) && !seedTrigger(pick.state, pick.on, pick.when);
      const will = TASK_SAY[pick.action]?.will;
      const text = will ? GOAL_TEXT.armed(ruleIf({ trigger: pick.when ? `${pick.on} ${pick.when}` : pick.on, action: pick.action, learned }), will) : null;
      this.goal = {
        pick, objectId, presence: p.since_ms, plan: null, planObject: null, surface: null, job: null,
        view: {
          id, action: pick.action, state: pick.state, trigger: pick.on, object: objectId, cls: h.cls, status: "armed", prep: "waiting", reason: null, text,
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
    return {
      id: g.view.id, seq: 0, atMs: now, textSent: "", finalTime: new Date(now).toISOString(), status: "valid", prediction: null, action: g.view.action,
      fsm: {
        state: g.view.state, from: g.view.state, next_index: g.pick.index, to: g.pick.to, on: g.pick.on, when: g.pick.when, action: g.view.action,
        learned: edgeLearned(g.pick.state, { on: g.pick.on, action: g.pick.action }),
      },
      memoryVersion: habit?.version ?? 0,
      tasks: [...(this.o.tasks?.() ?? TASK_NAMES)], world: decisionWorld(world),
    };
  }

  private preplan(g: Goal): void {
    if (g.view.prep !== "waiting" || g.view.status !== "armed" || this.core.open() || this.core.planning) return;
    const world = this.o.world();
    const now = this.clock.now();
    const o = this.objectOf(g, world);
    // 대상이 면 위에 놓인 물건이면 그 물건으로, 아니면(손에 있음·아직 World State 물건이 아님) 사람이 다 쓰고 둘 자리의 대신 물건으로 만든다.
    // 손에 든 컵 자리로 만든 계획은 가기 단계 자리가 틀린다
    const placed = o && o.status === "present" && o.surface && o.facts.place?.value !== "in_hand" && o.carried !== true ? o : null;
    const spot = placed ? null : this.useSpot(g, world);
    if (!placed && !spot) return;
    const stand = spot ? standIn(g.view.cls, spot, world.person.room, now) : null;
    if (placed) g.objectId = placed.id;
    g.planObject = placed?.id ?? stand!.id;
    g.surface = placed?.surface ?? spot!.surface;
    const abort = new AbortController();
    let out: PlanResult | Promise<PlanResult>;
    try {
      out = this.o.planner(this.record(g, world, now), abort.signal, { trigger: g.pick.on, on: g.pick.when ?? g.pick.on, object: g.planObject, ...(stand ? { stand } : {}) });
    } catch (e) {
      out = { ok: false, error: (e as Error).message };
    }
    const done: Promise<PlanResult> = Promise.resolve(out).catch((e: unknown) => ({ ok: false as const, error: (e as Error).message }));
    g.job = { abort, done };
    this.set(g, { prep: "planning", object: placed?.id ?? g.view.object });
    const p = done.then((r) => {
      if (this.goal !== g || g.job?.done !== done) return;
      g.job = null;
      // 받은 계획의 그 종류 물건이 목표 물건뿐일 때만 둔다(컵이 둘이면 다른 컵 계획을 두지 않는다)
      if (r.ok && this.mine(g, r.plan)) {
        g.plan = r.plan;
        this.set(g, { prep: "ready", ready_ms: this.clock.now(), plan: r.plan.view });
      } else {
        const error = r.ok ? GOAL_LOG.error.notMine : r.error;
        this.o.log?.(GOAL_LOG.log.failed(g.view.id, g.view.action, error));
        this.set(g, { prep: "failed", error });
      }
    }).finally(() => { this.jobs.delete(p); });
    this.jobs.add(p);
  }

  /** 목표 물건: 정했으면 그 물건(옮김 표시를 따라감). 그 물건이 사라졌으면 그 면(미리 만든 면, 아니면 그 물건이 있던 면)의 같은 종류 물건
   *  (2026-11-18 mug d1: 한 머그를 cup_2·cup_1로 잡고 cup_2가 사라졌다). 모르면 미리 만든 면의 그 종류 물건, 없으면 그 종류 가운데 가장 최근에 본 치우지 않은 물건
   *  (src/act/tasks.ts targetOf). 없으면 undefined(정한 물건이 사라지고 그 면에 같은 종류가 없으면 사라진 그 물건). */
  private objectOf(g: Goal, world: WorldView): WorldObject | undefined {
    if (g.objectId) {
      const id = followedId(world, g.objectId);
      const o = world.objects.find((x) => x.id === id);
      if (o && o.status !== "gone") return o;
      return this.onSurface(g, world, g.surface ?? o?.surface ?? null) ?? o;
    }
    return this.onSurface(g, world, g.surface) ?? targetOf({ target: g.view.cls as ObjClass }, world, this.core.steps.placed()) ?? undefined;
  }

  /** 그 면 위 그 종류 물건(사라지지 않았고 치우지 않았고 손에 있지 않음) 가운데 가장 최근에 본 것. */
  private onSurface(g: Goal, world: WorldView, surface: string | null): WorldObject | undefined {
    if (!surface) return undefined;
    const placed = this.core.steps.placed();
    return world.objects
      .filter((x) => x.cls === g.view.cls && x.status !== "gone" && x.surface === surface && !putAway(x, placed) && x.facts.place?.value !== "in_hand")
      .sort((a, b) => b.last_seen_ms - a.last_seen_ms)[0];
  }

  /** 사람이 쓰는 물건을 다 쓰고 둘 자리(면): 이번 등장에서 그 종류 후보를 손 밖에서 본 면(가장 새 것), 아니면 사람 자리(모르면 손에 든 그 종류 후보 자리)에서
   *  면 가장자리까지 GOAL_DEFAULTS.spotM 안의 가장 가까운 면(싱크대 빼고). 모르면 null. */
  private useSpot(g: Goal, world: WorldView): { surface: string; label: string; position: [number, number, number]; place: string } | null {
    const surfaces = this.o.surfaces?.() ?? [];
    const seen = (world.sightings ?? []).filter((s) => s.cls === g.view.cls && s.at_ms >= (g.presence ?? Number.NEGATIVE_INFINITY)).sort((a, b) => b.at_ms - a.at_ms);
    const laid = seen.find((s) => !s.in_hand && s.surface);
    const of = (s: PlaneSurface) => ({ surface: s.id, label: s.label, position: [s.center[0], s.top, s.center[1]] as [number, number, number], place: surfacePlace(s) ?? "on_table" });
    if (laid?.surface) {
      const s = surfaces.find((x) => x.id === laid.surface);
      return s ? of(s) : { surface: laid.surface, label: laid.surface_label ?? laid.surface, position: laid.position, place: "on_table" };
    }
    const held = seen.find((s) => s.in_hand);
    const at = world.person.position ?? (held ? [held.position[0], held.position[2]] as [number, number] : null);
    if (!at) return null;
    const near = surfaces
      .filter((s) => s.kind !== "sink" && !s.basin)
      .map((s) => ({ s, d: Math.hypot(at[0] - s.center[0], at[1] - s.center[1]) - s.radius }))
      .filter((x) => x.d <= GOAL_DEFAULTS.spotM)
      .sort((a, b) => a.d - b.d)[0];
    return near ? of(near.s) : null;
  }

  /** 계획이 다루는 그 종류 물건이 모두 미리 만든 계획의 목표 물건(옮김 표시로 이어진 것 포함)인가. 하나도 없어도 아니다.
   *  그 종류는 실행 전 검사와 같은 기준이다(집는 것이 대상 자신인 행동이면 지금 종류, 지금 컵인 bottle_1도 컵 대상, Codex 59447ec). */
  private mine(g: Goal, plan: AgentPlan): boolean {
    const world = this.o.world();
    if (!g.planObject) return false;
    const goal = followedId(world, g.planObject);
    const ids = planObjectsOf(plan.view, world, g.view.cls as ObjClass, carriesTarget(taskOf(g.view.action)));
    return ids.length > 0 && ids.every((id) => followedId(world, id) === goal);
  }

  /** 목표가 아직 맞는지 보고, 사람이 떠났으면 fired로 바꾼다. 맞지 않으면 버리고 지금 길(PAM 판단 → 계획 모드)로 돌아간다:
   *  안전 알림(safety) → 지금 행동 목록에 없음(mode, 코치 모드) → 충전 자리 복귀 중(dock) → 다른 계획이 열렸거나 다른 행동 계획을 만드는 중(replaced) → 세운 지 armMs(expired).
   *  대상이 사라져도 그 면에 같은 종류 물건이 있으면 그 물건으로 이어 간다(objectOf, 같은 컵을 VLM이 두 id로 잡았다).
   *  - 사람이 보이는 동안: 다른 등장이면 back, 대상이 이어진 물건 없이 사라지거나 치워지면 moved.
   *  - 사람이 떠남: 대상이 없으면 took(들고 나감). 손에 있음으로 남아 있으면 떠난 때부터 fireWaitMs 기다린 뒤 took. 그대로 있으면 떠난 때를 실어 fired로 바꾸고
   *    판단을 바로 부르게 한다(한 번). 미리 만들기(prep)는 따로 이어진다.
   *  - fired 뒤: 사람이 다시 보이면 back, 대상이 사라지고 그 면에 같은 종류 물건이 없으면 took, fireWaitMs 안에 PAM이 그 행동을 고르지 않으면 pam. */
  private watch(g: Goal): void {
    const world = this.o.world();
    const now = this.clock.now();
    const p = world.person;
    const v = g.view;
    if (emergencyOf({ world, offNotices: this.core.safety.offTrack().notices })) return this.drop("safety");
    if (!(this.o.tasks?.() ?? TASK_NAMES).includes(v.action)) return this.drop("mode");
    if (this.core.dock.busy()) return this.drop("dock");
    if (this.core.open() || (this.core.planning && this.core.planning.decision.action !== v.action)) return this.drop("replaced");
    if (now - v.armed_ms > (this.o.goalArmMs ?? GOAL_DEFAULTS.armMs)) return this.drop("expired");
    const o = this.objectOf(g, world);
    // 정한 물건이 사라져 그 면의 같은 종류 물건으로 이어 가면 그 물건을 따라간다
    if (g.objectId && o && o.status !== "gone" && o.id !== followedId(world, g.objectId)) {
      g.objectId = o.id;
      this.set(g, { object: o.id });
    }
    if (v.status === "fired") {
      if (p.visible) return this.drop("back");
      if (!o || o.status === "gone") return this.drop("took");
      if (now - (v.fired_ms ?? now) > GOAL_DEFAULTS.fireWaitMs) return this.drop("pam");
      return;
    }
    if (p.visible) {
      if (p.since_ms !== g.presence) return this.drop("back");
      // 정한 물건만 본다: 아직 모르는 물건(컵이 World State에 없음)은 사라졌다고 하지 않는다
      if (g.objectId && (!o || o.status === "gone" || putAway(o, this.core.steps.placed()))) return this.drop("moved");
      return;
    }
    const waited = p.since_ms !== null && now - p.since_ms > GOAL_DEFAULTS.fireWaitMs;
    // 물건을 모르면 그 종류 컵이 보일 때까지 기다린다(사람 사라짐 뒤 컵 확정, g1 tall 0.7초). fireWaitMs가 지나도 없으면 들고 나간 것이다
    if (!o) return g.objectId || waited ? this.drop("took") : undefined;
    if (o.status === "gone") return this.drop("took");
    if (putAway(o, this.core.steps.placed())) return this.drop("moved");
    if (o.facts.place?.value === "in_hand" || o.carried === true) {
      if (waited) this.drop("took");
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

  /** 떠난 것이 집 상태에 반영된 뒤 보낸 판단인가: 목표가 떠남을 냈고(fired), 그 판단의 관찰에 사람이 없고, 사람이 사라진 때(gone_ms) 뒤에 불렀다.
   *  목표가 컵을 기다리다 떠남을 늦게 내도(fired_ms) 그 앞에 보낸 판단을 받는다(2026-11-18 glass d1: 컵 확정 0.01초 앞에 보낸 판단을 기록만 해 1.6초 늦었다).
   *  사람이 떠난 사진을 찍은 뒤라도 집 상태에 들어오기 전에 부른 판단은 관찰에 사람이 보여 받지 않는다. */
  private afterLeave(d: DecisionRecord, v: PendingGoal): boolean {
    return v.status === "fired" && v.gone_ms !== null && d.atMs >= v.gone_ms && !d.world.person_visible;
  }

  /** 판단 받기(start.ts)가 계획 모드를 부르기 전에 묻는다. 사람이 떠난 목표(fired)와 같은 행동이고 떠난 것이 집 상태에 반영된 뒤 보낸 판단(afterLeave)이면:
   *  - 미리 만든 계획이 있으면 그 면에 있는 목표 물건으로 묶어(계획의 물건 id → 그 물건 id, 대신 물건이면 확정된 컵) 이 판단으로 다시 검사해(o.reuse) 그 결과.
   *    그 면에 목표 물건이 없으면(다른 면에 놓임) moved, 검사를 못 넘으면 stale로 버리고 null.
   *  - 미리 만드는 중이면 그 호출을 받아 쓴다(새로 부르지 않는다): 끝나면 다시 검사하고, 못 넘으면 stale로 버리고 fallback(계획 모드). 판단 받기 신호가 끊겼으면
   *    다시 검사도 fallback도 하지 않고 replaced로 버린다(계획 모드는 한 번에 하나라 fallback이 새 사람 요청의 계획을 끊는다). 끝 상태(used·dropped)는 호출이 끝난 뒤 낸다.
   *  - 둘 다 없으면(미리 만들기 실패·아직) stale로 버리고 null. null이면 부르는 쪽이 계획 모드를 부른다. 쓰면 목표는 used로 끝난다.
   *  준비한 계획을 버리고 계획 모드로 넘어가면 까닭 글(다시 검사·미리 만들기 오류 등)을 목표 error와 서버 로그에 남긴다.
   *  seenSince: 실행 전 검사가 대상을 다시 본 것으로 볼 기준(떠나기 직전 GOAL_DEFAULTS.leaveSeenMs 앞), leftAt: 사람이 떠난 때(집기 전에 그 뒤 다시 봤는지 본다). */
  take(d: DecisionRecord, signal: AbortSignal, fallback: () => PlanResult | Promise<PlanResult>): { out: PlanResult | Promise<PlanResult>; seenSince: number; leftAt: number; goal: string } | null {
    const g = this.goal;
    const reuse = this.o.reuse;
    const v = g?.view;
    if (!g || !v || !reuse || d.action !== v.action || v.gone_ms === null || !this.afterLeave(d, v)) return null;
    const leftAt = v.gone_ms;
    const seenSince = leftAt - GOAL_DEFAULTS.leaveSeenMs;
    const surface = g.surface;
    // 미리 만든 면에 있는 목표 물건 id(없으면 null)와, 계획의 물건 id를 그 id로 바꾸는 표
    const bound = (): string | null => {
      const o = this.objectOf(g, this.o.world());
      return o && o.status !== "gone" && surface !== null && o.surface === surface ? o.id : null;
    };
    const rename = (id: string) => (g.planObject && g.planObject !== id ? { [g.planObject]: id } : undefined);
    if (g.plan) {
      const id = bound();
      if (!id) {
        this.drop("moved", GOAL_LOG.error.surface);
        return null;
      }
      const r = reuse(d, g.plan, rename(id));
      if (!r.ok) {
        this.drop("stale", r.error);
        return null;
      }
      this.end(g, "used");
      return { out: r, seenSince, leftAt, goal: v.id };
    }
    if (g.job) {
      const job = g.job;
      const stop = () => job.abort.abort();
      if (signal.aborted) stop();
      else signal.addEventListener("abort", stop, { once: true });
      g.job = null;
      // 지금 목표에서 떼어 둔다(그 등장에서 다시 세우지 않는다). 끝 상태는 호출 결과를 보고 낸다
      this.leave(g);
      const cut: PlanResult = { ok: false, error: "새 판단으로 바뀜" };
      const out = job.done.then((r): PlanResult | Promise<PlanResult> => {
        if (signal.aborted) {
          this.end(g, "dropped", "replaced");
          return cut;
        }
        let why: string;
        const id = bound();
        if (!r.ok) why = r.error;
        else if (!this.mine(g, r.plan)) why = GOAL_LOG.error.notMine;
        else if (!id) why = GOAL_LOG.error.surface;
        else {
          const again = reuse(d, r.plan, rename(id));
          if (again.ok) {
            // 목표를 뗀 뒤 기다리는 사이 안전 알림(쓰러짐 의심·끄기 안내)이 생겼으면 쓰지 않고 버린다: 실행 추적은 첫 명령 직전에 다시 보고 시작하지 않는다(start.ts tryStart, Codex 59447ec P1)
            const unsafe = emergencyOf({ world: this.o.world(), offNotices: this.core.safety.offTrack().notices });
            this.end(g, unsafe ? "dropped" : "used", unsafe ? "safety" : null);
            return again;
          }
          why = again.error;
        }
        this.end(g, "dropped", "stale", why);
        return signal.aborted ? cut : fallback();
      });
      return { out, seenSince, leftAt, goal: v.id };
    }
    this.drop("stale", v.error ?? GOAL_LOG.error.none);
    return null;
  }

  /** 목표를 버린다(지금 길로 돌아간다). 없으면 아무것도 하지 않는다. error: 준비한 계획을 버리고 계획 모드로 넘어가는 까닭 글(take). */
  drop(reason: GoalDrop, error?: string): void {
    if (this.goal) this.end(this.goal, "dropped", reason, error);
  }

  /** 목표를 끝낸다(used·dropped): 마지막 상태를 내고, 그 등장에서는 다시 세우지 않는다. 버리면 미리 만드는 호출을 끊는다.
   *  까닭 글(error)은 이번 것만 싣고(앞 미리 만들기 실패 글은 지운다) 서버 로그에도 남긴다. */
  private end(g: Goal, status: "used" | "dropped", reason: GoalDrop | null = null, error?: string): void {
    if (status === "dropped") g.job?.abort.abort();
    g.job = null;
    this.leave(g);
    if (error) this.o.log?.(GOAL_LOG.log.dropPlan(g.view.id, g.view.action, error));
    const { error: _was, ...view } = g.view;
    g.view = { ...view, status, reason, ...(error ? { error } : {}) };
    this.emit(g.view);
  }

  /** 지금 목표에서 뗀다: 그 등장에서는 다시 세우지 않는다. 이미 뗐으면 아무것도 하지 않는다. */
  private leave(g: Goal): void {
    if (this.goal !== g) return;
    this.spent = g.presence;
    this.goal = null;
  }

  private set(g: Goal, v: Partial<PendingGoal>): void {
    g.view = { ...g.view, ...v };
    if (this.goal === g) this.emit(g.view);
  }

  private publish(): void {
    if (this.goal) this.emit(this.goal.view);
  }

  private emit(view: PendingGoal): void {
    if (!this.core.stopped) this.o.onGoal?.(view);
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
