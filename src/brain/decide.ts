// 판단 호출: Trigger가 허락하면 World State 관찰 텍스트 + 기억 + 행동 목록으로 PAM을 부른다. 요청마다 번호(seq)를 붙인다.
// 동시 상한을 넘으면 부르지 않는다(Trigger.due가 false). 결과는 기록(decision)과 onDecision으로 넘긴다. 늦게 온 답(받은 가장 큰 번호보다 작은 번호)은 상태를 바꾸지 않고, 행동은 실행 추적이 seq로 버린다.
// PAM 연결 끊김·연결됨(link)과 주기 판단 멈춤(폰 사진 없음·사람 없음)·다시 시작(trigger)은 바뀔 때 한 번씩 기록한다.
import type { BrainLog, DecisionWorld, DecisionRecord, ExecState, PamUsage } from "../contract/events.js";
import type { WorldChange, WorldView } from "../contract/world.js";
import { modeOf, planIdOf } from "../act/tasks.js";
import { checkInput, fsmStep, isoWithOffset, type PamMemory } from "./decision.js";
import { PamLinkError, type PamClient } from "./pam/index.js";
import { LINK_TEXT, TRIGGER_TEXT, redactHeard, redactSaid, saidIn } from "../world/labels.js";
import { textFromWorld } from "../world/index.js";
import type { Trigger, TriggerPause } from "../world/index.js";

/** 관찰 텍스트에 넣을 변화를 이만큼 둔다(텍스트 창은 그 안의 최근 60초). */
const RECENT_KEEP_MS = 600_000;
/** 행동이 시작되지 않은 화살표를 다시 켤 수 있게 두는 시간(ms, 미리 세운 목표 fireWaitMs와 같다). */
export const PENDING_EDGE_MS = 15_000;


/** 판단 기록에 붙이는 World State 요약: 사라지지 않은 물건의 상태·면(id·이름)·위치 오차·사실, 사람이 보이는가, 분석 없음 수. */
export function decisionWorld(w: WorldView): DecisionWorld {
  return {
    objects: w.objects.filter((o) => o.status !== "gone").map((o) => ({
      id: o.id, cls: o.cls, status: o.status, surface: o.surface, surface_label: o.surface_label, error_m: o.error_m,
      facts: Object.fromEntries(Object.entries(o.facts).flatMap(([k, f]) => (f ? [[k, { value: f.value, certainty: f.certainty }]] : []))),
      ...(o.closer_rev ? { closer_rev: { ...o.closer_rev } as Record<string, number> } : {}),
    })),
    person_visible: w.person.visible, vlm_missing: w.vlm_missing, yolo_missing: w.yolo_missing,
  };
}

export interface DeciderOptions {
  pam: PamClient;
  /** 집 상태 보기(거울). */
  world: { view(now: number): WorldView };
  trigger: Trigger;
  /** PAM에 보내는 행동 목록. heard: 이번 관찰 텍스트에 사람이 한 말이 있다(지금 모드와 함께 목록을 정한다, src/act/mode.ts pamTasks). */
  tasks: (heard: boolean) => string[];
  /** 판단 기록 assist: 이 판단(고른 행동, 대기면 null) 뒤의 지금 모드(src/act/mode.ts modeNow). 없으면 고른 행동의 종류(modeOf). */
  mode?: (action: string | null) => "noonchi" | "coach";
  memory: () => { memory: PamMemory; kind: "list" | "fsm"; version: number };
  emit: (log: BrainLog) => void;
  onDecision?: (d: DecisionRecord) => void;
  /** 관찰 텍스트·마지막 관찰 시각의 시간대(분). */
  offsetMinutes: number;
  clock?: { now(): number };
  /** 참이면 부르지 않는다: 실행 추적이 행동 중 기다리기·기기 단계를 보는 동안(src/act/track/tracker.ts waiting). */
  hold?: () => boolean;
  /** 참이면 기록에 남는 판단 줄에도 들은 말을 그대로 둔다(KEEP_HEARD_TEXT, 기본 꺼짐). 없거나 거짓이면 「들은 말 있음」만 남긴다. */
  keepHeard?: () => boolean;
}

export class Decider {
  private recent: WorldChange[] = [];
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
   *  그 화살표의 어느 판단이든 실행이 시작되면(실행 기록 running·done), 다른 화살표가 오면, 처음 낸 때부터 PENDING_EDGE_MS가 지나면 푼다. */
  private pending: { from: string; next: number; plans: Set<string>; at: number } | null = null;
  /** 실행이 시작돼 푼 화살표와 그때까지 보낸 마지막 PAM 요청 번호. 그 번호 이하 요청의 같은 화살표 답(늦게 온 반복 답)은 통째로 버린다:
   *  pending도 되살리지 않고 행동도 실행 추적에 넘기지 않는다(판단 기록 late, 실행 기록 「앞선 판단」). 순서는 시각이 아니라 번호로 본다
   *  (Codex 26d2482·6802be0: 시각 비교는 같은 밀리초에서 놓치고, 계획이 끝나고 15초 뒤 온 늦은 답이 같은 일을 다시 시작할 수 있었다). */
  private released: { from: string; next: number; seq: number } | null = null;
  /** 답을 받은 가장 큰 요청 번호(유효·실패 모두). 이보다 작은 번호의 답(동시에 나간 요청이 거꾸로 옴)은 직전 상태·기다리는 화살표·들은 말을 바꾸지 않는다
   *  (실행 추적도 그 답을 늦은 답으로 버린다, src/act/track/start.ts. Codex 1b07d3e2 P2: 앞선 관찰의 답이 다음 요청의 직전 상태를 되돌렸다). */
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
    this.recent = [...this.recent, ...changes].filter((c) => c.at_ms >= now - RECENT_KEEP_MS);
    this.o.trigger.onChanges(changes);
  }

  /** 마지막 유효 판단의 사람 상태(PAM 답 state, 미리 세울 목표가 읽는다). 판단 전이면 null. */
  fsmState(): string | null {
    return this.lastState;
  }

  /** 습관 FSM: 마지막으로 PAM에 보낸 기억(판본)과 마지막 판단의 사람 상태(미리 세울 목표가 읽는다, src/act/track/goal.ts).
   *  판단 전이면 null. 기억을 새로 읽지 않는다(읽으면 그날 판본을 고정해 반성 판본이 그날부터 쓰이지 못한다). */
  habit(): { memory: PamMemory; kind: "list" | "fsm"; version: number; state: string | null } | null {
    return this.lastMem ? { ...this.lastMem, state: this.lastState } : null;
  }

  /** 실행 기록(서버가 실행 추적 emit에서 넘긴다): 기다리던 화살표의 행동이 시작되면(running·done) 푼다. */
  onExecution(planId: string, state: ExecState): void {
    const p = this.pending;
    if (!p?.plans.has(planId) || (state !== "running" && state !== "done")) return;
    // 그때까지 보낸 마지막 요청 번호: 그 번호 이하 요청의 같은 화살표 답은 늦은 답이다
    this.released = { from: p.from, next: p.next, seq: this.seq };
    this.pending = null;
  }

  /** 지금까지 보낸 마지막 PAM 요청 번호(말 부탁 afterSeq, src/act/track/start.ts request). 보내기 전이면 0. */
  sentSeq(): number {
    return this.seq;
  }

  /** 실행 추적이 만든 말 부탁 판단(source speech)을 판단 기록으로만 남긴다. PAM을 부르지 않았고 실행 추적에는 이미 넘어갔다.
   *  그 부탁까지 들은 말은 다음 관찰 텍스트에 다시 넣지 않는다(행동을 고른 PAM 판단과 같다. Codex 1b07d3e2 P2: 「그만」 뒤 PAM이 남은 부탁으로 같은 계획을 다시 시작했다). */
  logSpeech(r: DecisionRecord): void {
    this.recent = this.recent.filter((c) => c.kind !== "heard" || c.at_ms > r.atMs);
    this.emitDecision(r);
  }

  /** 다음 판단 타이머에 기다림 없이 PAM을 부르게 한다(미리 세운 목표의 사람이 떠남, src/act/track/goal.ts). 동시 상한·쉼(hold)은 그대로다. */
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
    const base = { id: `pam-${seq}`, seq, atMs: now, textSent, finalTime, memoryVersion: mem.version, world: decisionWorld(view), tasks };
    // 직전 사람 상태: 행동이 아직 시작되지 않은 화살표가 있으면 그 출발 상태(PENDING_EDGE_MS 안), 아니면 마지막 판단의 상태
    if (this.pending && now - this.pending.at > PENDING_EDGE_MS) this.pending = null;
    const last = this.pending?.from ?? this.lastState;
    let usage: PamUsage | undefined;
    const job: Promise<void> = Promise.resolve()
      .then(() => {
        checkInput({ text: textSent, finalTime, memory: mem.memory, memoryKind: mem.kind, tasks });
        return this.o.pam.predict({ final_time: finalTime, observation_text: textSent, memory_kind: mem.kind, memory: mem.memory, tasks, last_state: last },
          { signal: this.cancel.signal, onUsage: (u) => { usage = u; } });
      })
      .then(
        (p) => {
          this.setLink(true);
          const newest = base.seq > this.answered;
          this.answered = Math.max(this.answered, base.seq);
          const action = p.task_index === -1 ? null : tasks[p.task_index] ?? null;
          // PAM의 생각 글은 계획 이유·판단 기록·대시보드에 남는다: 들은 말을 그대로 옮겼으면 뺀다
          const said = this.o.keepHeard?.() ? [] : saidIn(textSent);
          const prediction = said.length ? { ...p, observation: redactSaid(p.observation, said), reasoning: redactSaid(p.reasoning, said) } : p;
          // PAM 답의 상태·화살표를 그대로 싣는다(거꾸로 찾지 않는다)
          const step = mem.kind === "fsm" && "states" in mem.memory ? fsmStep(mem.memory, p) : null;
          if (step) {
            const stale = this.released !== null && step.from === this.released.from && step.next_index === this.released.next && base.seq <= this.released.seq;
            // 늦은 답 전체를 버린다: 상태·pending을 바꾸지 않고 행동 없이 기록만(실행 추적은 late를 「앞선 판단」으로 남긴다)
            if (stale) return this.finish({ ...base, status: "valid", prediction, action: null, fsm: step, late: true, ...(usage ? { usage } : {}) });
          }
          // 더 뒤에 보낸 요청의 답을 이미 받았다: 앞선 관찰의 답이라 상태·기다리는 화살표·들은 말은 그대로 두고 기록만 넘긴다(실행 추적은 번호로 늦은 답이라 본다)
          if (!newest) return this.finish({ ...base, status: "valid", prediction, action, fsm: step, ...(usage ? { usage } : {}) });
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
        },
        (e: unknown) => {
          this.answered = Math.max(this.answered, base.seq);
          if (e instanceof PamLinkError) this.setLink(false);
          this.finish({ ...base, status: "failed", prediction: null, action: null, fsm: null, error: (e as Error).message, ...(usage ? { usage } : {}) });
        },
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

  private finish(r: DecisionRecord): void {
    if (this.stopped) return;
    this.emitDecision(r);
    this.o.onDecision?.(r);
  }

  private emitDecision(r: DecisionRecord): void {
    if (this.stopped) return;
    this.o.emit({
      type: "decision", at_ms: this.clock.now(), id: r.id, seq: r.seq, text_sent: this.o.keepHeard?.() ? r.textSent : redactHeard(r.textSent), status: r.status, prediction: r.prediction, action: r.action, fsm: r.fsm ?? null,
      // 이 판단 뒤의 지금 모드(서버가 정하는 한 곳, src/act/mode.ts)
      assist: this.o.mode ? this.o.mode(r.action) : modeOf(r.action),
      ...(r.error ? { error: r.error } : {}), ...(r.usage ? { usage: r.usage } : {}), memory_version: r.memoryVersion, world: r.world,
      ...(r.source ? { source: r.source } : {}), ...(r.via ? { via: r.via } : {}), ...(r.late ? { late: r.late } : {}),
    });
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
