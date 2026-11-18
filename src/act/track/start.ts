// 실행 추적의 판단 받기·계획 시작(Starter): 판단 하나마다 한 번만 정하고(늦은 답·실패·대기·같은 행동·잠시 뒤는 기록만), 계획 전 검사를 통과하면
// 에이전트 계획 모드를 한 번 부른다. 받은 계획은 실행 전 검사·승인·끄기 안내·폰 판본을 거쳐 첫 단계를 시작한다(tryStart).
// 계획 없는 행동(그대로 두기)의 기록과 같은 행동 다시 계획 간격도 여기서 센다.
import { CONTENTS_HOLD } from "./contents.js";
import type { DecisionRecord } from "../../contract/events.js";
import { needsPhone, objectNames, type AgentStep, type PlanResult } from "../../agent/index.js";
import { APPROVAL_TEXT, EXEC_TEXT } from "../labels.js";
import { quietLabels } from "../lessons.js";
import { TASK_NAMES, carriesTarget, planIdOf, planObjectsOf, taskOf } from "../tasks.js";
import { CHANGE_TEXT, saidIn } from "../../world/labels.js";
import { decisionWorld, isoWithOffset } from "../../brain/index.js";
import type { SpeechRequest } from "./tracker.js";
import { emergencyOf } from "../mode.js";
import { Part, clsOf, type Job, type Run } from "./core.js";

/** 판단 받기·계획 시작. */
export class Starter extends Part {
  private readonly jobs = new Set<Promise<void>>();
  private readonly planAt = new Map<string, number>();
  private gen = 0;
  private lastSeq = 0;
  /** 마지막 말 부탁을 받은 때까지 보낸 PAM 요청 번호(afterSeq). 말 부탁의 대상을 찾는 중이거나 계획을 만드는 중이거나 열려 있는 동안 이 번호 이하 PAM 판단은 쓰지 않는다. */
  private lastSpeechSeq = 0;
  private speechN = 0;
  /** 말 부탁을 판단 기록 꼴(id say-<번호>, source speech, seq 0, 들은 말 한 줄)로 만들어 판단 받기 길(onDecision)에 넣는다. */
  request(r: SpeechRequest): void {
    const core = this.core;
    if (core.stopped) return;
    const tasks = [...TASK_NAMES];
    const d: DecisionRecord = {
      id: `say-${++this.speechN}`, seq: 0, atMs: r.atMs, textSent: CHANGE_TEXT.heard(r.heard), finalTime: isoWithOffset(r.atMs, this.o.offsetMinutes ?? 540),
      status: "valid", prediction: { observation: EXEC_TEXT.spoken, reasoning: EXEC_TEXT.spoken, task_index: tasks.indexOf(r.task) }, action: r.task,
      memoryVersion: 0, tasks, world: decisionWorld(this.o.world()), source: "speech", afterSeq: r.afterSeq, ...(r.via ? { via: r.via } : {}),
    };
    this.o.onSpeech?.(d);
    this.onDecision(d);
  }

  onDecision(d: DecisionRecord): void {
    const core = this.core;
    if (core.stopped) return;
    // 판단이 버린 늦은 답(풀린 화살표를 다시 낸 답): 기록만
    if (d.late) return this.note(d, EXEC_TEXT.late);
    // 말 부탁은 PAM 판단 번호와 섞지 않는다: seq 검사를 건너뛰고 받은 때까지 보낸 PAM 요청 번호만 둔다(순서는 밀리초가 아니라 번호로 본다)
    if (d.source === "speech") this.lastSpeechSeq = d.afterSeq ?? 0;
    else {
      if (d.seq < this.lastSeq) return this.note(d, EXEC_TEXT.late);
      // 받은 가장 새 판단 번호: 기록만 한 판단(같은 행동 등)보다 먼저 보낸 판단이 늦게 와도 쓰지 않는다
      this.lastSeq = d.seq;
      // 말 부탁을 받은 때부터(그 대상을 계획 전에 찾는 중이거나 계획을 만드는 중이어도) 그 전에 보낸 요청의 PAM 판단은 쓰지 않는다
      const speech = core.planning?.decision.source === "speech" || core.open()?.decision.source === "speech"
        || core.finding?.first.source === "speech" || core.finding?.decision.source === "speech";
      if (speech && d.seq <= this.lastSpeechSeq) return this.note(d, EXEC_TEXT.late);
    }
    core.lastDecision = d.id;
    // 기다리기·기기 단계 전에 보낸 판단이 그 뒤에 오면 낡은 관찰이라 쓰지 않는다(다시 부르는 판단이 새 관찰로 정한다)
    if (d.atMs < core.quietFrom && core.open()?.decision.action !== d.action) return this.note(d, EXEC_TEXT.late);
    if (d.status !== "valid") return this.note(d, EXEC_TEXT.decisionFailed);
    if (!d.action) return this.note(d, EXEC_TEXT.wait);
    // 미리 세운 목표와 같은 행동인데 사람이 떠난 뒤의 판단이 아니면 목표가 맡는다(사람이 떠나면 판단을 다시 부른다, goal.ts)
    if (core.goal.holds(d)) return this.note(d, EXEC_TEXT.goalWait);
    // 계획이 끝난 뒤 사용자 위치 확인·충전 자리로 가는 동안은 새 일을 미룬다(충전 자리에서 시작한다, dock.ts).
    // 비상이면 busy가 거두고, 사람이 말로 한 부탁(들은 말이 든 판단)은 복귀를 멈추고 바로 받는다(그 들은 말은 다시 판단에 가지 않는다)
    if (core.dock.busy()) {
      if (!saidIn(d.textSent).length) return this.note(d, EXEC_TEXT.docking);
      core.dock.drop();
    }
    const open = core.open();
    if (open?.decision.action === d.action || core.planning?.decision.action === d.action) return this.note(d, EXEC_TEXT.same);
    // 손대는 단계(집기·내려놓기·들고 가기) 중에는 다른 행동 판단으로 계획을 바꾸지 않는다(계획이 끝난 뒤 다시 판단). 비상과 사람이 말로 한 부탁만 바꾼다
    // (2026-11-18 wide-mug q3: 집기 중 폰 든 사람이 보여 「컵에 콜라 따라 주기」가 컵 치우기를 갈아 치웠다)
    if (this.handsOn(d)) return this.note(d, EXEC_TEXT.handling);
    // 그 행동 대상을 찾는 중이면 기록만 하고 가장 새 판단으로 바꿔 둔다(찾으면 그 판단으로 다시 본다, find.ts)
    if (core.finder.same(d)) return this.note(d, EXEC_TEXT.findingSame(core.finder.name()!));
    // 행동 중 기다리기·기기 단계에는 다른 판단으로 바꾸지 않는다(그동안 판단도 멈춘다, waiting)
    if (open && core.waiting()) return this.note(d, EXEC_TEXT.busy);
    if (this.closerNewer(d)) return this.note(d, EXEC_TEXT.closerNewer);
    const pre = this.o.precheck?.(d) ?? { ok: true };
    if (!pre.ok) {
      // 대상이 안 보이면 마지막으로 본 자리로 찾으러 간다(찾을 자리가 없으면 지금처럼 닫는다)
      if ((pre.reason === "no_target" || pre.reason === "in_sink") && core.finder.start(d, pre.text)) return this.takeover(d);
      core.emit(planIdOf(d.id), "decided");
      core.emit(planIdOf(d.id), "failed", pre.text);
      return;
    }
    const now = this.clock.now();
    const last = this.planAt.get(d.action);
    if (last !== undefined && now - last < this.cfg.planGapMs) return this.note(d, EXEC_TEXT.held);
    this.planAt.set(d.action, now);
    // 다른 행동의 계획이 맡으면 미리 세운 목표를 버리고 지금 길로(goal.ts). 막힌 판단은 맡지 않으니 그대로 둔다
    this.takeover(d);
    // 계획을 만드는 중이던 다른 행동은 끊고 버린다(답이 와도 쓰지 않는다)
    this.dropPlanning(EXEC_TEXT.superseded);
    const job: Job = { decision: d, gen: ++this.gen, abort: new AbortController(), at: now };
    core.planning = job;
    core.emit(planIdOf(d.id), "decided");
    let out: PlanResult | Promise<PlanResult>;
    try {
      const plan = () => this.o.planner(d, job.abort.signal);
      // 사람이 떠난 목표와 같은 행동이면 미리 만든 계획을 이 판단으로 다시 검사해 쓴다(계획 모드를 다시 부르지 않는다, goal.ts take)
      const ready = core.goal.take(d, job.abort.signal, plan);
      if (ready) job.prepared = { goal: ready.goal, seenSince: ready.seenSince, leftAt: ready.leftAt };
      out = ready ? ready.out : plan();
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
  private closerNewer(d: DecisionRecord, held?: ReadonlySet<string>): boolean {
    const spec = taskOf(d.action);
    const facets = spec?.look ?? [];
    if (!spec?.target || !facets.length) return false;
    const then = new Map(d.world.objects.map((o) => [o.id, o]));
    return this.o.world().objects.some((o) => o.cls === spec.target && o.status !== "gone" && facets.some((f) => {
      if (f === "contents" && held?.has(o.id)) return false;
      const before = then.get(o.id);
      return (o.closer_rev?.[f] ?? 0) !== (before?.closer_rev?.[f] ?? 0) && before?.facts[f]?.value !== o.facts[f]?.value;
    }));
  }

  /** 진행 중 계획이 손대는 단계(집기·내려놓기·들고 가기)라 이 판단으로 바꾸지 않는가: 다른 행동이고, 사람이 말로 한 부탁(들은 말이 든 판단)도 비상도 아니다. */
  private handsOn(d: DecisionRecord): boolean {
    const core = this.core;
    const open = core.open();
    return !!open && open.decision.action !== d.action && core.touching(open) && !saidIn(d.textSent).length
      && !emergencyOf({ world: this.o.world(), offNotices: core.safety.offTrack().notices });
  }

  /** 「가까이 본 뒤 다시 판단」으로 닫은 계획은 같은 행동 다시 계획 간격(planGapMs)에 넣지 않는다: 다음 판단이 새 사실로 바로 다시 고른다.
   *  그 판단이 적은 시각일 때만 지운다. */
  private ungap(d: DecisionRecord, at: number): void {
    if (d.action && this.planAt.get(d.action) === at) this.planAt.delete(d.action);
  }

  /** 다른 행동의 판단이 일을 맡았다(계획을 만들기 시작하거나 대상을 찾으러 감): 미리 세운 목표를 버린다. 같은 행동이면 목표가 이어 간다. */
  private takeover(d: DecisionRecord): void {
    const goal = this.core.goal.current();
    if (goal && goal.action !== d.action) this.core.goal.drop("replaced");
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
    if (!r.ok) {
      // 계획 검사(PlanDraft)가 버린 까닭(첫 틀린 단계와 이유)을 실행 기록과 서버 로그에 남기고, 같은 행동 다시 계획 간격 없이 다음 판단에서 바로 다시 짠다
      // (2026-11-18 wide-glass q3: 까닭 없이 버리고 「방금 계획한 일이라 잠시 뒤 다시 봄」으로 12초를 기다렸다)
      this.ungap(d, job.at);
      this.o.log?.(`[실행 추적] ${planIdOf(d.id)} 계획 버림(${d.action}): ${r.error}`);
      return core.emit(planIdOf(d.id), "failed", EXEC_TEXT.badPlan, r.error);
    }
    // 만드는 사이 진행 중 계획이 기다리기·기기 단계에 들어갔으면 바꾸지 않는다(그 판단은 그 단계 전 관찰이다)
    if (core.waiting() || d.atMs < core.quietFrom) return core.emit(planIdOf(d.id), "failed", EXEC_TEXT.busy);
    if (this.closerNewer(d)) {
      this.ungap(d, job.at);
      return core.emit(planIdOf(d.id), "failed", EXEC_TEXT.closerNewer);
    }
    // 만드는 사이 진행 중 계획이 손대는 단계에 들어갔으면 바꾸지 않는다(판단 받을 때와 같은 지킴, Codex 79f25b8). 다음 판단에서 다시 짠다
    if (this.handsOn(d)) {
      this.ungap(d, job.at);
      return core.emit(planIdOf(d.id), "failed", EXEC_TEXT.handling);
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
      quiet: taskOf(r.plan.task)?.coach ? quietLabels(this.o.lessons?.get(r.plan.task) ?? null) : new Set(), quietOn: false, outcomes: [], hold: null, window: null, heldIds: new Set(), busyAt: null, usedAt: null,
      // 미리 만든 계획은 쓰는 중이라 미룬 계획처럼 첫 명령을 폰 대화·승인 대기 동안 미룬다(사람 요청이 먼저)
      useHeld: !!job.prepared, goal: job.prepared?.goal ?? null, seenSince: job.prepared?.seenSince ?? null, leftAt: job.prepared?.leftAt ?? null, verify: null,
      // 계획 전 찾기에서 찾은 뒤 만든 계획이면 찾기로 붙잡았던 계획처럼 첫 명령을 폰 대화·승인 대기 동안 미룬다
      find: null, findHeld: core.foundFor === d.id,
    };
    if (core.foundFor === d.id) core.foundFor = null;
    // 계획 밖 가까이 가서 보기·계획 전 찾기는 이 계획이 명령·보기 지킴을 쓰기 전에 거둔다(같은 컵의 지킴을 나중에 풀지 않게)
    core.contents.dropIdle();
    core.finder.drop(EXEC_TEXT.superseded);
    core.run = run;
    this.o.plans.onDecision(r.plan.view, this.clock.now());
    core.step(run, "planned");
    this.tryStart(run, false);
  }

  /** 첫 단계를 시작해 본다(계획을 받을 때·검사를 다시 볼 때·승인 답 뒤). 첫 명령 전에 가까이 보기가 볼 면을 바꿨으면 시작하지 않고
   *  「가까이 본 뒤 다시 판단」으로 닫는다(다음 판단이 새 사실로 다시 고른다). 첫 명령을 보낸 뒤에는 보지 않는다. */
  tryStart(r: Run, last: boolean): void {
    const { safety, steps } = this.core;
    // 이번 보류에서 본 컵의 내용물은 「가까이 본 뒤 다시 판단」에서 뺀다(행동 조건은 아래 검사가 다시 본다)
    if (this.closerNewer(r.decision, r.heldIds)) {
      this.ungap(r.decision, r.gapAt);
      return steps.finish(r, "failed", EXEC_TEXT.closerNewer, "cancelled");
    }
    // 미리 세운 목표 실행은 첫 명령 전에 안전(쓰러짐 의심·끄기 안내)을 다시 보고, 비상이면 시작하지 않는다
    // (받아 쓰던 미리 만들기를 기다리는 동안은 목표를 떼어 목표의 안전 버림이 보지 않는다, Codex 59447ec P1)
    if (r.goal !== null && emergencyOf({ world: this.o.world(), offNotices: safety.offTrack().notices })) return steps.finish(r, "failed", EXEC_TEXT.goalSafety, "cancelled");
    // 사람이 계획 대상을 쓰는 중이면 사람이 사라질 때까지 첫 명령·찾기·가까이 보기를 미룬다(holdMs 넘으면 닫음, src/act/track/use.ts)
    if (this.core.use.waits(r)) return;
    const c = this.o.check(r.decision, r.plan.view, this.startSince(r));
    if (!c.ok) {
      // 찾는 중에 대상이 안 보임이 아닌 까닭으로 막히면 찾기를 거둔다(그 까닭은 아래가 본다)
      if (r.find && c.reason !== "no_target" && c.reason !== "stale") this.core.finder.release(r, true);
      // 보류 중 검사가 다른 까닭(들고 있음·없음·치움)으로 막으면 그 까닭과 상관없이 먼저 명령·보기 지킴을 거두고 holdMs 한도를 센다.
      // 기다리는 동안은 다시 보기 기한(recheckMs)을 세지 않는다(잠깐 들었다 내려놓아도 이어 간다)
      if (c.reason !== "unknown_contents" && c.reason !== "stale" && this.core.contents.holding(r)) {
        if (!this.core.contents.pause(r)) return steps.finish(r, "failed", c.text);
        r.since = this.clock.now();
        return;
      }
      // 검사를 막은 대상 물건의 손에 있음이 들고 감 보호(World State carried)에서만 왔으면 보호가 풀릴 때까지 다시 보기 기한을 세지 않는다(풀린 때부터 recheckMs)
      if (c.reason === "in_hand" && c.carried) {
        r.since = this.clock.now();
        return;
      }
      // 내용물을 몰라 막혔으면 보류가 붙잡는 동안 다시 보기 기한을 세지 않는다(src/act/track/contents.ts). 보류 중 컵이 낡아도 보류를 이어 간다
      const held = r.hold;
      if ((c.reason === "unknown_contents" && c.object && this.core.contents.keep(r, c.object))
        || (c.reason === "stale" && held && this.core.contents.holding(r) && this.core.contents.keep(r, held.objectId, "stale"))) {
        r.since = this.clock.now();
        return;
      }
      // 계획 대상이 다시 보기 기한(recheckMs)이 지나도 안 보이면(없음·낡음, 내용물 보류가 아님) 닫지 않고 그 대상의 마지막 자리에서 찾는다.
      // 찾는 동안은 다시 보기 기한을 세지 않는다
      if ((c.reason === "no_target" || c.reason === "stale") && c.object && !r.hold && (last || r.find)) {
        const k = this.core.finder.keep(r, c.object);
        if (k === "hold") {
          r.findHeld = true;
          r.since = this.clock.now();
          return;
        }
        if (k === "over") return steps.finish(r, "failed", c.text);
        // 그 자리에서 다른 id의 같은 종류 물건을 찾았다: 계획의 물건 id가 옛것이라 닫고, 다음 판단이 새 id로 바로 다시 계획한다
        if (k === "other") {
          this.ungap(r.decision, r.gapAt);
          return steps.finish(r, "failed", EXEC_TEXT.foundNew, "cancelled");
        }
      }
      if (last) steps.finish(r, "failed", c.text);
      return;
    }
    this.core.contents.release(r);
    this.core.finder.release(r);
    // 보류·찾기·쓰는 중 기다림에서 풀린 계획은 폰 대화·승인 대기가 없을 때만 첫 명령을 보낸다(다른 대화를 덮지 않는다). 미룬 지 holdMs가 지나면 닫는다
    if ((r.heldIds.size > 0 || r.findHeld || r.useHeld) && ((this.o.talking?.() ?? false) || (this.o.approvalsWaiting?.() ?? false))) {
      const now = this.clock.now();
      this.core.contents.clearPeek(r);
      this.core.finder.clearFind(r);
      r.busyAt ??= now;
      if (now - r.busyAt > CONTENTS_HOLD.holdMs) return steps.finish(r, "failed", EXEC_TEXT.phoneBusy);
      r.since = now;
      return;
    }
    r.busyAt = null;
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
    this.verifyFrom(r);
    this.core.steps.activate(r, 0);
  }

  /** 목표 실행의 대상 물건 id(실행 전 검사와 같은 기준: 집는 것이 대상 자신인 행동이면 지금 종류, Codex 59447ec P2). 목표 실행이 아니거나 없으면 null. */
  private goalTarget(r: Run): string | null {
    const spec = taskOf(r.plan.task);
    if (r.leftAt === null || !spec?.target) return null;
    return planObjectsOf(r.plan.view, this.o.world(), spec.target, carriesTarget(spec))[0] ?? null;
  }

  /** 실행 전 검사 기준: 목표 실행이면 떠나기 직전 GOAL_DEFAULTS.leaveSeenMs 앞(seenSince). 첫 단계가 그 대상을 다루면(집기로 시작) 떠난 때(leftAt):
   *  떠나기 전 사진만으로 집기를 시키지 않고 떠난 뒤 사진을 기다리며, 없으면 실행 전 찾기로 간다(Codex 59447ec P2). 목표 실행이 아니면 없음. */
  private startSince(r: Run): number | undefined {
    if (r.seenSince === null) return undefined;
    const id = this.goalTarget(r);
    return id && r.leftAt !== null && touches(r.plan.steps[0], id) ? r.leftAt : r.seenSince;
  }

  /** 떠나기 직전 사진으로 시작한 목표 실행이면(대상을 사람이 떠난 뒤에 아직 못 봄) 그 대상을 다루는 단계 전에 다시 볼 것으로 둔다(held).
   *  첫 단계가 그 대상을 다루면 실행 전 검사가 떠난 뒤 사진을 이미 봤다(startSince). */
  private verifyFrom(r: Run): void {
    const leftAt = r.leftAt;
    const id = this.goalTarget(r);
    if (leftAt === null || !id) return;
    const o = this.o.world().objects.find((x) => x.id === id);
    if (o && o.last_seen_ms < leftAt && !touches(r.plan.steps[0], id)) r.verify = { objectId: id, since: leftAt, at: null };
  }

  /** 다음 단계(next)가 떠난 뒤 다시 보지 못한 목표 대상(verify)을 다루면 그 전에 다시 본다: 떠난 뒤 사진에 그 대상이 있으면(실행 전 검사, 기준 = 떠난 때) 풀고 false.
   *  아직이면 다시 보기 기한(recheckMs) 동안 기다리고, 그 뒤에도 없음·낡음이면 그 마지막 자리를 찾는다(실행 전 찾기와 같은 길, find.ts keep: 「식탁 위를 비춰 주세요」).
   *  찾으면 다시 검사가 통과해 그 단계로 가고, 못 찾으면 검사 글로 닫는다. 다른 까닭으로 막히면 기한 뒤 그 글로 닫는다. 붙잡는 동안 true
   *  (2026-11-18 사용자 결정: 사람이 마지막에 컵을 들고 나갔으면 식탁에 가서 없는 것을 보고 찾기로 넘어간다). */
  held(r: Run, next: number): boolean {
    const v = r.verify;
    const step = r.plan.steps[next];
    if (!v || !step || !touches(step, v.objectId)) return false;
    const now = this.clock.now();
    v.at ??= now;
    const c = this.o.check(r.decision, r.plan.view, v.since);
    if (c.ok) {
      r.verify = null;
      this.core.finder.release(r, true);
      return false;
    }
    if (!r.find && now - v.at < this.cfg.recheckMs) return true;
    if ((c.reason === "no_target" || c.reason === "stale") && c.object) {
      const k = this.core.finder.keep(r, c.object);
      if (k === "hold") return true;
      if (k === "other") {
        this.ungap(r.decision, r.gapAt);
        this.core.steps.finish(r, "failed", EXEC_TEXT.foundNew, "cancelled");
        return true;
      }
    }
    this.core.steps.finish(r, "failed", c.text);
    return true;
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

/** 그 단계가 그 물건을 다루는가(집기·내려놓기·하기의 물건이나 대상). */
const touches = (step: AgentStep | undefined, id: string) => !!step && step.kind !== "go" && (step.object === id || step.target === id);
