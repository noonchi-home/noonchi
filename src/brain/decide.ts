import type { BusNode } from "../bus/index.js";
// 판단 호출: Trigger가 허락하면 World State 관찰 텍스트 + 기억 + 행동 목록으로 PAM을 부른다. 요청마다 번호(seq)를 붙인다.
// 동시 상한을 넘으면 부르지 않는다(Trigger.due가 false). 결과는 기록(decision)과 onDecision으로 넘긴다. 늦게 온 답(받은 가장 큰 번호보다 작은 번호)은 상태를 바꾸지 않고, 행동은 실행 추적이 seq로 버린다.
// PAM 연결 끊김·연결됨(link)과 주기 판단 멈춤(폰 사진 없음·사람 없음)·다시 시작(trigger)은 바뀔 때 한 번씩 기록한다.
import type { BrainLog, DecisionRecord, ExecState, PamUsage } from "../contract/events.js";
import type { Intervention } from "./history/intervention.js";
import type { WorldChange, WorldView } from "../contract/world.js";
import { modeOf, planIdOf } from "../act/tasks.js";
import { checkInput, fsmStep, isoWithOffset, type PamMemory } from "./decision.js";
import { PamLinkError, type PamClient } from "./pam/index.js";
import { CHANGE_TEXT, HEARD_MAX, LINK_TEXT, TRIGGER_TEXT, redactHeard, redactSaid, saidIn } from "../world/labels.js";
import { headWithin } from "../shared/cut.js";
import { decisionWorld, textFromWorld } from "../world/index.js";
import type { Trigger, TriggerPause } from "../world/index.js";

/** 관찰 텍스트에 넣을 변화를 이만큼 둔다(텍스트 창은 그 안의 최근 60초). */
const RECENT_KEEP_MS = 600_000;
/** 행동이 시작되지 않은 화살표를 다시 켤 수 있게 두는 시간(ms, 미리 세운 목표 fireWaitMs와 같다). */
export const PENDING_EDGE_MS = 15_000;
/** 들은 말 줄(`사람이 말함: 「…」` 한 줄)의 비교 열쇠: 줄 머리와 맨 끝 」 사이 말을 World State 들은 말 줄(src/world/state/world.ts heard)과 같이
 *  「」·여러 칸 빈칸을 빼고 HEARD_MAX자에서 자른 것. 정규화를 먼저 해 말 안의 「…」 인용에서 끊지 않는다(Codex be8a98c0 P3). 들은 말 줄이 아니면 null. */
const HEARD_HEAD = CHANGE_TEXT.heard("");
function heardKey(line: string): string | null {
  const head = headWithin(HEARD_HEAD, HEARD_HEAD.length - 1);
  if (!line.startsWith(head) || !line.endsWith("」") || line.length <= head.length) return null;
  const said = headWithin(line, line.length - 1).substring(head.length);
  return headWithin(said.replace(/[「」]/g, "").replace(/\s+/g, " ").trim(), HEARD_MAX);
}


export { decisionWorld } from "../world/index.js";

/** 모델 응답은 판단 노드의 받은 줄에서만 상태를 바꾼다. 종료가 먼저면 대기를 풀고 버린다. */
function applyAnswer(node: Pick<BusNode, "post"> | undefined, signal: AbortSignal, run: () => void): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  if (!node) { run(); return Promise.resolve(); }
  return new Promise((resolve, reject) => {
    const stop = () => resolve();
    signal.addEventListener("abort", stop, { once: true });
    node.post(() => {
      signal.removeEventListener("abort", stop);
      try { if (!signal.aborted) run(); resolve(); } catch (e) { reject(e); }
    });
  });
}

export interface DeciderOptions {
  node?: () => Pick<BusNode, "spawn" | "post">;
  pam: PamClient;
  /** 집 상태 보기(거울). */
  world: { view(now: number): WorldView; rev?(): number | null };
  trigger: Trigger;
  /** PAM에 보내는 행동 목록. heard: 이번 관찰 텍스트에 사람이 한 말이 있다(지금 모드와 함께 목록을 정한다, src/act/mode.ts pamTasks). */
  tasks: (heard: boolean) => string[];
  /** 판단 기록 assist: 이 판단(고른 행동, 대기면 null) 뒤의 지금 모드(src/act/mode.ts modeNow). 없으면 고른 행동의 종류(modeOf). */
  mode?: (action: string | null) => "noonchi" | "coach";
  memory: () => { memory: PamMemory; kind: "list" | "fsm"; version: number };
  emit: (log: BrainLog) => void;
  onDecision?: (d: DecisionRecord) => void;
  interventionFor?: (decision: DecisionRecord, world: WorldView) => Intervention;
  /** 화살표 없는 유효한 답(행동 없음)이 미리 세운 목표의 트리거면 그 목표 행동(실행 추적 goal.ts triggerOf), 아니면 null.
   *  있으면 판단 기록·onDecision에 그 행동(goal 표시)으로 낸다: 기록과 실행이 같은 행동을 본다(밤 채택 검사 robotSpans, Codex b5da6c36 P2). */
  goalTrigger?: (d: DecisionRecord) => string | null;
  /** 관찰 텍스트·마지막 관찰 시각의 시간대(분). */
  offsetMinutes: number;
  clock?: { now(): number };
  /** 참이면 부르지 않는다: 실행 추적이 행동 중 기다리기·기기 단계를 보는 동안(src/act/track/tracker.ts waiting). */
  hold?: () => boolean;
  /** 참이면 기록에 남는 판단 줄에도 들은 말을 그대로 둔다(KEEP_HEARD_TEXT, 기본 꺼짐). 없거나 거짓이면 「들은 말 있음」만 남긴다. */
  keepHeard?: () => boolean;
  /** PAM이 고른 화살표 행동을 지금 할 수 있는가(습관 화살표는 그 시각 창 안만, src/brain/history/routines.ts routineAllows). 거짓이면 행동 없이 기록한다. 없으면 참. */
  edgeAllowed?: (edge: { on: string | null; action: string | null }, atMs: number) => boolean;
}

export class Decider {
  private recent: WorldChange[] = [];
  /** 말 부탁으로 처리한 말(열쇠)과 부탁 시각: 그보다 앞서 들은 같은 말이 늦게 도착해도(/phone/heard 전달 지연) 관찰 텍스트에 넣지 않는다(Codex 81d209ef P2). */
  private handled: { said: string; atMs: number }[] = [];
  private readonly running = new Set<Promise<void>>();
  /** 멈추면 나가 있는 PAM 요청도 끊는다. */
  private readonly cancel = new AbortController();
  private seq = 0;
  private stopped = false;
  private link: boolean | null = null;
  /** 마지막 유효 판단의 사람 상태(PAM 답 state). 판단 전이면 null(PAM은 처음 상태로 본다). */
  private lastState: string | null = null;
  /** 행동이 붙은 화살표를 낸 판단의 행동이 아직 시작되지 않았다(목표가 맡아 기록만 함·컵 확정 전 계획 전 검사가 막음 등): 그 출발 상태.
   *  풀릴 때까지 다음 요청의 직전 상태는 이 출발 상태라 PAM이 같은 화살표를 다시 낼 수 있다(Codex 8ab2d06 P2: 컵 확정 전 판단을 목표가 버리면 직전 상태가 이미
   *  away라 컵이 확정된 뒤 화살표가 없어 치우기가 시작되지 않았다). 처음 낸 때(at)와 화살표(from·next)는 지키고, 같은 화살표를 다시 낸 판단은
   *  계획 id만 더한다(Codex b28711d P2: 덮어쓰면 처음 계획의 running으로 풀리지 않고 5초마다 늘어 15초 한도가 끝나지 않았다).
   *  그 화살표의 어느 판단이든 실행이 시작되거나(실행 기록 running·done) 계획 전 검사가 분명한 까닭으로 막으면(onRefused), 다른 화살표가 오면,
   *  처음 낸 때부터 PENDING_EDGE_MS가 지나면 푼다. */
  private pending: { from: string; next: number; plans: Set<string>; at: number } | null = null;
  /** 실행이 시작돼 푼 화살표와 그때까지 보낸 마지막 PAM 요청 번호. 그 번호 이하 요청의 같은 화살표 답(늦게 온 반복 답)은 통째로 버린다:
   *  pending도 되살리지 않고 행동도 실행 추적에 넘기지 않는다(판단 기록 late, 실행 기록 「앞선 판단」). 순서는 시각이 아니라 번호로 본다
   *  (Codex 26d2482·6802be0: 시각 비교는 같은 밀리초에서 놓치고, 계획이 끝나고 15초 뒤 온 늦은 답이 같은 일을 다시 시작할 수 있었다). */
  private released: { from: string; next: number; seq: number } | null = null;
  /** 답을 받은 가장 큰 요청 번호(유효·실패 모두). 이보다 작은 번호의 답(동시에 나간 요청이 거꾸로 옴)은 직전 상태·기다리는 화살표·들은 말을 바꾸지 않는다
   *  (실행 추적도 그 답을 늦은 답으로 버린다, src/act/robot/start.ts. Codex 1b07d3e2 P2: 앞선 관찰의 답이 다음 요청의 직전 상태를 되돌렸다). */
  private answered = 0;
  /** 마지막으로 PAM에 보낸 기억(판본). 판단 전이면 null. */
  private lastMem: { memory: PamMemory; kind: "list" | "fsm"; version: number } | null = null;
  private paused: TriggerPause | "acting" | null = null;
  private readonly clock: { now(): number };

  constructor(private readonly o: DeciderOptions) {
    this.clock = o.clock ?? { now: () => Date.now() };
  }

  onChanges(changes: WorldChange[]): void {
    if (this.stopped) return;
    const now = this.clock.now();
    this.handled = this.handled.filter((h) => h.atMs >= now - RECENT_KEEP_MS);
    // 말 부탁으로 이미 처리한 말: 그 부탁보다 앞서 들은 같은 말은 늦게 와도 버린다(부탁 뒤에 다시 한 같은 말은 새 말이다)
    const done = (c: WorldChange) => {
      const said = heardKey(c.text);
      return said !== null && this.handled.some((h) => h.said === said && c.at_ms <= h.atMs);
    };
    const fresh = changes.filter((c) => c.kind !== "heard" || !done(c));
    this.recent = [...this.recent, ...fresh].filter((c) => c.at_ms >= now - RECENT_KEEP_MS);
    this.o.trigger.onChanges(fresh);
  }

  /** 마지막 유효 판단의 사람 상태(PAM 답 state, 미리 세울 목표가 읽는다). 판단 전이면 null. */
  fsmState(): string | null {
    return this.lastState;
  }

  /** 습관 FSM: 마지막으로 PAM에 보낸 기억(판본)과 마지막 판단의 사람 상태(미리 세울 목표가 읽는다, src/goal/watch.ts).
   *  판단 전이면 null. 기억을 새로 읽지 않는다(읽으면 그날 판본을 고정해 반성 판본이 그날부터 쓰이지 못한다). */
  habit(): { memory: PamMemory; kind: "list" | "fsm"; version: number; state: string | null } | null {
    return this.lastMem ? { ...this.lastMem, state: this.lastState } : null;
  }

  /** 실행 기록(서버가 실행 추적 emit에서 넘긴다): 기다리던 화살표의 행동이 시작되면(running·done) 푼다. */
  onExecution(planId: string, state: ExecState): void {
    if (state === "running" || state === "done") this.release(planId);
  }

  /** 실행 추적이 그 판단을 계획 전 검사의 분명한 까닭(이미 치움·확인된 내용물 반대 등, src/act/robot/start.ts)으로 막았다: 행동이 시작된 것처럼 그 화살표를 푼다.
   *  기다리면 15초 동안 주기 판단마다 같은 화살표가 다시 켜져 같은 막음을 되풀이한다(2026-11-19 조정자 결정). 모름(대상이 안 보임)으로 막은 판단은 알리지 않는다. */
  onRefused(planId: string): void {
    this.release(planId);
  }

  /** 기다리던 화살표를 그 판단(계획 id)이 냈으면 푼다. 그때까지 보낸 마지막 요청 번호 이하 요청의 같은 화살표 답은 늦은 답이다. */
  private release(planId: string): void {
    const p = this.pending;
    if (!p?.plans.has(planId)) return;
    this.released = { from: p.from, next: p.next, seq: this.seq };
    this.pending = null;
  }

  /** 지금까지 보낸 마지막 PAM 요청 번호(말 부탁 afterSeq, src/act/robot/start.ts request). 보내기 전이면 0. */
  sentSeq(): number {
    return this.seq;
  }

  /** 실행 추적이 만든 말 부탁 판단(source speech)을 판단 기록으로만 남긴다. PAM을 부르지 않았고 실행 추적에는 이미 넘어갔다.
   *  그 부탁까지 들은 말은 다음 관찰 텍스트에 다시 넣지 않는다(행동을 고른 PAM 판단과 같다. Codex 1b07d3e2 P2: 「그만」 뒤 PAM이 남은 부탁으로 같은 계획을 다시 시작했다). */
  logSpeech(r: DecisionRecord): void {
    this.recent = this.recent.filter((c) => c.kind !== "heard" || c.at_ms > r.atMs);
    const said = heardKey(r.textSent);
    if (said !== null) this.handled.push({ said, atMs: r.atMs });
    this.emitDecision(r);
  }

  /** 다음 판단 타이머에 기다림 없이 PAM을 부르게 한다(미리 세운 목표의 사람이 떠남, src/goal/watch.ts). 나가 있는 판단도 기다리지 않는다(동시 상한 위로 하나, src/world/trigger.ts).
   *  쉼(hold)은 그대로다. 앞서 나간 판단의 답이 늦게 오면 번호로 늦은 답이라 상태를 바꾸지 않는다. */
  nudge(): void {
    if (!this.stopped) this.o.trigger.nudge();
  }

  /** 관찰 흐름이 엔진 프레임마다 부른다(주기 판단은 프레임이 오는 동안만 부른다). */
  onFrame(): void {
    if (!this.stopped) this.o.trigger.onFrame(this.clock.now());
  }

  /** 타이머(250ms)가 부른다. 멈춤·다시 시작이 바뀌면 기록하고, 부를 때면 PAM을 부른다. */
  tick(): void {
    if (this.stopped) return;
    const now = this.clock.now();
    const view = this.o.world.view(now);
    const paused = this.o.hold?.() ? "acting" : this.o.trigger.pause(now, view.person.visible);
    if (paused !== this.paused) {
      this.paused = paused;
      this.o.emit({ type: "trigger", at_ms: now, paused: paused !== null, text: paused ? TRIGGER_TEXT[paused] : TRIGGER_TEXT.resumed });
    }
    if (paused === "acting" || !this.o.trigger.due(now, view.person.visible, this.running.size)) return;
    this.o.trigger.called(now);
    const seq = ++this.seq;
    const textSent = textFromWorld(view, this.recent, { nowMs: now, offsetMinutes: this.o.offsetMinutes });
    const finalTime = isoWithOffset(now, this.o.offsetMinutes);
    const tasks = this.o.tasks(saidIn(textSent).length > 0);
    const mem = this.o.memory();
    this.lastMem = mem;
    const requestRev = this.o.world.rev?.();
    const base = { id: `pam-${seq}`, seq, atMs: now, ...(requestRev != null ? {request_rev:requestRev} : {}), textSent, finalTime, memoryVersion: mem.version, world: decisionWorld(view), tasks };
    // 직전 사람 상태: 행동이 아직 시작되지 않은 화살표가 있으면 그 출발 상태(PENDING_EDGE_MS 안), 아니면 마지막 판단의 상태
    if (this.pending && now - this.pending.at > PENDING_EDGE_MS) this.pending = null;
    const last = this.pending?.from ?? this.lastState;
    let usage: PamUsage | undefined;
    const node = this.o.node?.();
    const query = async (life: AbortSignal) => {
        checkInput({ text: textSent, finalTime, memory: mem.memory, memoryKind: mem.kind, tasks });
        return this.o.pam.predict({ final_time: finalTime, observation_text: textSent, memory_kind: mem.kind, memory: mem.memory, tasks, last_state: last },
          { signal: AbortSignal.any([life, this.cancel.signal]), onUsage: (u) => { usage = u; } });
    };
    const job = Promise.resolve().then(() => node ? node.spawn(query) : query(this.cancel.signal))
      .then(
        (p) => applyAnswer(node, this.cancel.signal, () => {
          this.setLink(true);
          const newest = base.seq > this.answered;
          this.answered = Math.max(this.answered, base.seq);
          const picked = p.task_index === -1 ? null : tasks[p.task_index] ?? null;
          // PAM의 생각 글은 계획 이유·판단 기록·대시보드에 남는다: 들은 말을 그대로 옮겼으면 뺀다
          const said = this.o.keepHeard?.() ? [] : saidIn(textSent);
          const prediction = said.length ? { ...p, observation: redactSaid(p.observation, said), reasoning: redactSaid(p.reasoning, said) } : p;
          // PAM 답의 상태·화살표를 그대로 싣는다(거꾸로 찾지 않는다)
          const step = mem.kind === "fsm" && "states" in mem.memory ? fsmStep(mem.memory, p) : null;
          let action = picked !== null && step && this.o.edgeAllowed && !this.o.edgeAllowed(step, now) ? null : picked;
          if (action && this.deferred({ ...base, status: "valid", prediction, action, fsm: step })) action = null;
          if (step) {
            const stale = this.released !== null && step.from === this.released.from && step.next_index === this.released.next && base.seq <= this.released.seq;
            // 늦은 답 전체를 버린다: 상태·pending을 바꾸지 않고 행동 없이 기록만(실행 추적은 late를 「앞선 판단」으로 남긴다)
            if (stale) return this.finish({ ...base, status: "valid", prediction, action: null, fsm: step, late: true, ...(usage ? { usage } : {}) });
          }
          // 더 뒤에 보낸 요청의 답을 이미 받았다: 앞선 관찰의 답이라 상태·기다리는 화살표·들은 말은 그대로 두고 기록만 넘긴다(실행 추적은 번호로 늦은 답이라 본다)
          if (!newest) return this.finish({ ...base, status: "valid", prediction, action, fsm: step, late:true, ...(usage ? { usage } : {}) });
          if (step) {
            this.lastState = step.state;
            const same = this.pending !== null && step.from === this.pending.from && step.next_index === this.pending.next;
            if (same) this.pending!.plans.add(planIdOf(base.id));
            else if (step.from !== null && step.action !== null && action !== null) this.pending = { from: step.from, next: step.next_index, plans: new Set([planIdOf(base.id)]), at: now };
            else if (step.from !== null) this.pending = null;
          }
          // 행동을 고른 판단이 쓴 들은 말은 다음 관찰 텍스트에 다시 넣지 않는다(그 일을 그만둔 뒤 같은 말로 다시 시작하지 않게)
          if (action !== null) this.recent = this.recent.filter((c) => c.kind !== "heard" || c.at_ms > now);
          this.finish({ ...base, status: "valid", prediction, action, fsm: step, ...(usage ? { usage } : {}) });
        }),
        (e: unknown) => applyAnswer(node, this.cancel.signal, () => {
          this.answered = Math.max(this.answered, base.seq);
          if (e instanceof PamLinkError) this.setLink(false);
          this.finish({ ...base, status: "failed", prediction: null, action: null, fsm: null, error: (e as Error).message, ...(usage ? { usage } : {}) });
        }),
      )
      .finally(() => { this.running.delete(job); });
    this.running.add(job);
  }

  /** 처음부터 닿으면 기록하지 않는다. 그 뒤로는 바뀔 때 한 번씩. */
  private setLink(up: boolean): void {
    if (this.stopped || this.link === up) return;
    const first = this.link === null;
    this.link = up;
    if (first && up) return;
    this.o.emit({ type: "link", at_ms: this.clock.now(), target: "pam", up, text: up ? LINK_TEXT.up : LINK_TEXT.down });
  }

  private deferred(r: DecisionRecord): boolean {
    return r.source !== "speech" && this.o.interventionFor?.(r, this.o.world.view(this.clock.now())) === "defer_proactive";
  }

  private finish(r: DecisionRecord): void {
    if (this.stopped) return;
    const action = r.status === "valid" && !r.late && !r.source ? this.o.goalTrigger?.(r) ?? null : null;
    if (action) {
      const goal = { ...r, action, goal: true as const };
      if (!this.deferred(goal)) r = goal;
    }
    this.emitDecision(r);
    this.o.onDecision?.(r);
  }

  private emitDecision(r: DecisionRecord): void {
    if (this.stopped) return;
    this.o.emit(decisionLog(r, this.clock.now(), this.o.mode?.(r.action) ?? modeOf(r.action), !!this.o.keepHeard?.()));
  }

  /** 나가 있는 판단이 끝날 때까지 기다린다(시험용). */
  async idle(): Promise<void> {
    while (this.running.size) await Promise.all([...this.running]);
  }

  /** 멈추면 새로 부르지 않고, 나가 있는 요청은 끊고, 늦게 온 답도 기록하지 않는다. */
  stop(): void {
    this.stopped = true;
    this.cancel.abort(new Error("판단 호출을 멈춤"));
  }
}

/** 실시간 방송과 기록 노드가 같은 판단 줄을 만든다. */
export function decisionLog(r: DecisionRecord, atMs: number, mode: "coach" | "noonchi" | null, keep: boolean): Extract<BrainLog, { type: "decision" }> {
  return {
    type: "decision", at_ms: atMs, id: r.id, seq: r.seq, text_sent: keep ? r.textSent : redactHeard(r.textSent), status: r.status, prediction: r.prediction, action: r.action, fsm: r.fsm ?? null,
    // 이 판단 뒤의 지금 모드(서버가 정하는 한 곳, src/act/mode.ts)
    assist: mode,
    ...(r.error ? { error: r.error } : {}), ...(r.usage ? { usage: r.usage } : {}), memory_version: r.memoryVersion, world: r.world,
    ...(r.source ? { source: r.source } : {}), ...(r.via ? { via: r.via } : {}), ...(r.late ? { late: r.late } : {}), ...(r.goal ? { goal: r.goal } : {}),
  };
}
