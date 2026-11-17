// 실행 추적의 판단 받기·계획 시작(Starter): 판단 하나마다 한 번만 정하고(늦은 답·실패·대기·같은 행동·잠시 뒤는 기록만), 계획 전 검사를 통과하면
// 에이전트 계획 모드를 한 번 부른다. 받은 계획은 실행 전 검사·승인·끄기 안내·폰 판본을 거쳐 첫 단계를 시작한다(tryStart).
// 계획 없는 행동(그대로 두기)의 기록과 같은 행동 다시 계획 간격도 여기서 센다.
import type { DecisionRecord } from "../../contract/events.js";
import { needsPhone, objectNames, type PlanResult } from "../../agent/index.js";
import { APPROVAL_TEXT, EXEC_TEXT } from "../labels.js";
import { quietLabels } from "../lessons.js";
import { planIdOf, taskOf } from "../tasks.js";
import { Part, clsOf, type Job, type Run } from "./core.js";

/** 판단 받기·계획 시작. */
export class Starter extends Part {
  private readonly jobs = new Set<Promise<void>>();
  private readonly planAt = new Map<string, number>();
  private gen = 0;
  private lastSeq = 0;
  /** 마지막으로 「그대로 둠」을 기록한 시각: 간격을 세는 실행 추적 시계(leftNoteAt)와 말풍선 카드가 보는 Date.now 시계(leftWallAt). */
  private leftNoteAt = Number.NEGATIVE_INFINITY;
  private leftWallAt: number | null = null;

  /** 마지막으로 「그대로 둠」을 기록한 시각(Date.now 시계, 계획 updatedAt과 같은 시계). 없으면 null. */
  leftAt(): number | null {
    return this.leftWallAt;
  }

  onDecision(d: DecisionRecord): void {
    const core = this.core;
    if (core.stopped) return;
    if (d.seq < this.lastSeq) return this.note(d, EXEC_TEXT.late);
    // 받은 가장 새 판단 번호: 기록만 한 판단(같은 행동 등)보다 먼저 보낸 판단이 늦게 와도 쓰지 않는다
    this.lastSeq = d.seq;
    // 기다리기·기기 단계 전에 보낸 판단이 그 뒤에 오면 낡은 관찰이라 쓰지 않는다(다시 부르는 판단이 새 관찰로 정한다)
    if (d.atMs < core.quietFrom && core.open()?.decision.action !== d.action) return this.note(d, EXEC_TEXT.late);
    if (d.status !== "valid") return this.note(d, EXEC_TEXT.decisionFailed);
    if (!d.action) return this.note(d, EXEC_TEXT.wait);
    const open = core.open();
    if (open?.decision.action === d.action || core.planning?.decision.action === d.action) return this.note(d, EXEC_TEXT.same);
    // 행동 중 기다리기·기기 단계에는 다른 판단으로 바꾸지 않는다(그동안 판단도 멈춘다, waiting)
    if (open && core.waiting()) return this.note(d, EXEC_TEXT.busy);
    if (this.closerNewer(d)) return this.note(d, EXEC_TEXT.closerNewer);
    const pre = this.o.precheck?.(d) ?? { ok: true };
    if (!pre.ok) {
      core.emit(planIdOf(d.id), "decided");
      core.emit(planIdOf(d.id), "failed", pre.text);
      return;
    }
    const now = this.clock.now();
    // 계획을 만들지 않는 행동(컵 그대로 두기): 에이전트를 부르지 않고 그 판단 줄에 기록만 한다. 열린 계획·만들던 계획은 건드리지 않는다
    if (taskOf(d.action)?.plan === false) {
      if (now - this.leftNoteAt < this.cfg.leftGapMs) return;
      this.leftNoteAt = now;
      this.leftWallAt = Date.now();
      core.emit(planIdOf(d.id), "decided");
      return core.emit(planIdOf(d.id), "done", EXEC_TEXT.left);
    }
    const last = this.planAt.get(d.action);
    if (last !== undefined && now - last < this.cfg.planGapMs) return this.note(d, EXEC_TEXT.held);
    this.planAt.set(d.action, now);
    // 계획을 만드는 중이던 다른 행동은 끊고 버린다(답이 와도 쓰지 않는다)
    this.dropPlanning(EXEC_TEXT.superseded);
    const job: Job = { decision: d, gen: ++this.gen, abort: new AbortController(), at: now };
    core.planning = job;
    core.emit(planIdOf(d.id), "decided");
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

  /** 「가까이 본 뒤 다시 판단」으로 닫은 계획은 같은 행동 다시 계획 간격(planGapMs)에 넣지 않는다: 다음 판단이 새 사실로 바로 다시 고른다.
   *  그 판단이 적은 시각일 때만 지운다. */
  private ungap(d: DecisionRecord, at: number): void {
    if (d.action && this.planAt.get(d.action) === at) this.planAt.delete(d.action);
  }

  /** 만들던 계획을 끊고 그 판단 줄에 까닭을 남긴다. */
  dropPlanning(text: string): void {
    const job = this.core.planning;
    if (!job) return;
    this.core.planning = null;
    job.abort.abort();
    this.core.emit(planIdOf(job.decision.id), "failed", text);
  }

  /** 만들던 계획이 끝날 때까지 기다린다(시험용). */
  async idle(): Promise<void> {
    while (this.jobs.size) await Promise.all([...this.jobs]);
  }

  /** 에이전트가 만든 계획을 받는다. 그 사이 다른 판단이 왔으면 버린다. 진행 중인 다른 계획은 새 계획이 바꾼다. */
  private planned(job: Job, r: PlanResult): void {
    const core = this.core;
    if (core.stopped || core.planning !== job) return;
    core.planning = null;
    const d = job.decision;
    if (!r.ok) return core.emit(planIdOf(d.id), "failed", EXEC_TEXT.badPlan);
    // 만드는 사이 진행 중 계획이 기다리기·기기 단계에 들어갔으면 바꾸지 않는다(그 판단은 그 단계 전 관찰이다)
    if (core.waiting() || d.atMs < core.quietFrom) return core.emit(planIdOf(d.id), "failed", EXEC_TEXT.busy);
    if (this.closerNewer(d)) {
      this.ungap(d, job.at);
      return core.emit(planIdOf(d.id), "failed", EXEC_TEXT.closerNewer);
    }
    const open = core.open();
    // 새 계획이 있으면 PlanHub.onDecision이 지금 계획을 취소로 닫고 supersedes를 단다
    if (open) core.steps.finish(open, "failed", EXEC_TEXT.superseded, null);
    const now = this.clock.now();
    const world = this.o.world();
    const ids = new Set<string>();
    for (const s of r.plan.steps) {
      if (s.object) ids.add(s.object);
      // 그 자리에서 하는 일의 대상 물건도 계획 물건이다(옮겨 새 id가 붙으면 이어 간다)
      if (s.kind === "do" && s.target && world.objects.some((o) => o.id === s.target)) ids.add(s.target);
      if (s.until) for (const n of objectNames(s.until)) if (world.objects.some((o) => o.id === n)) ids.add(n);
    }
    const others = new Map([...ids].map((id) => [id, new Set(world.objects.filter((o) => o.cls === clsOf(world, id) && o.id !== id).map((o) => o.id))]));
    const run: Run = {
      plan: r.plan, decision: d, state: "decided", since: now, at: -1, stepAt: now, spokeAt: now, visionAt: now, sent: null,
      asking: null, askAt: now, watch: null, others, alias: new Map([...ids].map((id) => [id, id])), carried: new Set(), placeAt: (id) => (id ? this.o.floor().objects.get(id)?.position ?? null : null), deadline: now, again: false, device: "idle", gen: 0,
      looks: 0, lookAt: Number.NEGATIVE_INFINITY, stepEnd: null, gapAt: job.at, onAt: new Map(), ends: new Map(), offAsked: -1, deferred: false, phoneWait: false, phone: false,
      strays: 0, strayAt: Number.NEGATIVE_INFINITY, strayNear: null, told: null, helped: false,
      quiet: taskOf(r.plan.task)?.coach ? quietLabels(this.o.lessons?.get(r.plan.task) ?? null) : new Set(), quietOn: false, outcomes: [], hold: null,
    };
    core.run = run;
    this.o.plans.onDecision(r.plan.view);
    core.step(run, "planned");
    this.tryStart(run, false);
  }

  /** 첫 단계를 시작해 본다(계획을 받을 때·검사를 다시 볼 때·승인 답 뒤). 첫 명령 전에 가까이 보기가 볼 면을 바꿨으면 시작하지 않고
   *  「가까이 본 뒤 다시 판단」으로 닫는다(다음 판단이 새 사실로 다시 고른다). 첫 명령을 보낸 뒤에는 보지 않는다. */
  tryStart(r: Run, last: boolean): void {
    const { safety, steps } = this.core;
    if (this.closerNewer(r.decision)) {
      this.ungap(r.decision, r.gapAt);
      return steps.finish(r, "failed", EXEC_TEXT.closerNewer, "cancelled");
    }
    const c = this.o.check(r.decision, r.plan.view);
    if (!c.ok) {
      // 검사를 막은 대상 물건의 손에 있음이 들고 감 보호(World State carried)에서만 왔으면 보호가 풀릴 때까지 다시 보기 기한을 세지 않는다(풀린 때부터 recheckMs)
      if (c.reason === "in_hand" && c.carried) {
        r.since = this.clock.now();
        return;
      }
      // 내용물을 몰라 막혔으면 보류가 붙잡는 동안 다시 보기 기한을 세지 않는다(src/act/track/contents.ts). 보류 중 컵이 낡아도 보류를 이어 간다
      const held = r.hold;
      if ((c.reason === "contents_unknown" && c.object && this.core.contents.keep(r, c.object))
        || (c.reason === "stale" && held && this.core.contents.holding(r) && this.core.contents.keep(r, held.objectId))) {
        r.since = this.clock.now();
        return;
      }
      if (last) steps.finish(r, "failed", c.text);
      return;
    }
    this.core.contents.release(r);
    const why = this.core.approval.need(r);
    r.phone = needsPhone(r.plan, why, this.o.handDevices?.() ?? []);
    // 끄기 안내가 남아 있으면 폰이 필요한 계획은 첫 명령(승인 질문 포함)을 미룬다(한 번 기록): 안내가 다 풀리면 nextReminder가 다시 부른다.
    // 폰이 필요 없는 가전 계획은 그대로 시작한다
    if (r.phone && safety.offPending()) {
      const id = safety.pendingDevice()!;
      if (!r.deferred) {
        r.deferred = true;
        this.core.emit(r.plan.view.id, "planned", EXEC_TEXT.deferred(this.core.handLabel(id)));
      }
      if (!safety.shownOff()) safety.nextReminder();
      return;
    }
    // 폰이 필요한 계획은 판본이 맞는 실제 폰이 붙어 있을 때만 시작한다(한 번 기록, 붙으면 tick이 다시 부른다)
    if (!this.phoneOk() && r.phone) {
      if (!r.phoneWait) {
        r.phoneWait = true;
        this.core.emit(r.plan.view.id, "planned", EXEC_TEXT.phoneOld);
      }
      return;
    }
    if (why) return this.core.approval.ask(r, { why: "plan" }, APPROVAL_TEXT.ask(r.plan.task), `${r.plan.view.id}:approve`);
    this.begin(r);
  }

  private begin(r: Run): void {
    this.core.step(r, "running");
    if (r.plan.steps.length === 0) return this.core.steps.finish(r, "done");
    this.core.steps.activate(r, 0);
  }

  /** 판본이 맞는 실제 폰이 붙어 있는가(모르면 붙어 있다고 본다). */
  phoneOk(): boolean {
    return this.o.phoneReady?.() ?? true;
  }

  /** 계획을 만들지 않는 판단(대기·실패·같은 행동·늦은 답·잠시 뒤)은 그 판단 줄에 기록만 한다. */
  private note(d: DecisionRecord, text: string): void {
    this.core.emit(planIdOf(d.id), "decided", text);
  }
}
