// 판단 호출: Trigger가 허락하면 World State 관찰 텍스트 + 기억 + 행동 목록으로 PAM을 부른다. 요청마다 번호(seq)를 붙인다.
// 동시 상한을 넘으면 부르지 않는다(Trigger.due가 false). 결과는 기록(decision)과 onDecision으로 넘긴다. 늦게 온 답의 처리는 실행 추적이 seq로 한다.
// PAM 연결 끊김·연결됨(link)과 주기 판단 멈춤(폰 사진 없음·사람 없음)·다시 시작(trigger)은 바뀔 때 한 번씩 기록한다.
import type { BrainLog, DecisionWorld, DecisionRecord } from "../contract/events.js";
import type { WorldChange, WorldView } from "../contract/world.js";
import { taskOf } from "../act/tasks.js";
import { checkInput, fsmRuleOf, isoWithOffset, type PamMemory } from "../brain/decision.js";
import { PamLinkError, type PamClient } from "../brain/pam.js";
import { LINK_TEXT, TRIGGER_TEXT, redactHeard, redactSaid, saidIn } from "./labels.js";
import type { WorldState } from "./state.js";
import { textFromWorld } from "./text.js";
import type { Trigger, TriggerPause } from "./trigger.js";

/** 관찰 텍스트에 넣을 변화를 이만큼 둔다(텍스트 창은 그 안의 최근 60초). */
const RECENT_KEEP_MS = 600_000;


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
  world: WorldState;
  trigger: Trigger;
  tasks: () => string[];
  memory: () => { memory: PamMemory; kind: "list" | "fsm"; version: number };
  emit: (log: BrainLog) => void;
  onDecision?: (d: DecisionRecord) => void;
  /** 관찰 텍스트·마지막 관찰 시각의 시간대(분). */
  offsetMinutes: number;
  clock?: { now(): number };
  /** 참이면 부르지 않는다: 실행 추적이 행동 중 기다리기·기기 단계를 보는 동안(src/act/track.ts waiting). */
  hold?: () => boolean;
  /** 참이면 기록에 남는 판단 줄에도 들은 말을 그대로 둔다(KEEP_HEARD_TEXT, 기본 꺼짐). 없거나 거짓이면 「들은 말 있음」만 남긴다. */
  keepHeard?: () => boolean;
}

export class Decider {
  private recent: WorldChange[] = [];
  private readonly running = new Set<Promise<void>>();
  private seq = 0;
  private stopped = false;
  private link: boolean | null = null;
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
    const tasks = this.o.tasks();
    const mem = this.o.memory();
    const base = { id: `pam-${seq}`, seq, atMs: now, textSent, finalTime, memoryVersion: mem.version, world: decisionWorld(view), tasks };
    const job: Promise<void> = Promise.resolve()
      .then(() => {
        checkInput({ text: textSent, finalTime, memory: mem.memory, memoryKind: mem.kind, tasks });
        return this.o.pam.predict({ final_time: finalTime, observation_text: textSent, memory_kind: mem.kind, memory: mem.memory, tasks });
      })
      .then(
        (p) => {
          this.setLink(true);
          const action = p.task_index === -1 ? null : tasks[p.task_index] ?? null;
          // 행동을 고른 판단이 쓴 들은 말은 다음 관찰 텍스트에 다시 넣지 않는다(그 일을 그만둔 뒤 같은 말로 다시 시작하지 않게)
          if (action !== null) this.recent = this.recent.filter((c) => c.kind !== "heard" || c.at_ms > now);
          // PAM의 생각 글은 계획 이유·판단 기록·대시보드에 남는다: 들은 말을 그대로 옮겼으면 뺀다
          const said = this.o.keepHeard?.() ? [] : saidIn(textSent);
          const prediction = said.length ? { ...p, observation: redactSaid(p.observation, said), reasoning: redactSaid(p.reasoning, said) } : p;
          this.finish({ ...base, status: "valid", prediction, action, fsm: fsmRuleOf(mem.memory, mem.kind, action) });
        },
        (e: unknown) => {
          if (e instanceof PamLinkError) this.setLink(false);
          this.finish({ ...base, status: "failed", prediction: null, action: null, fsm: null, error: (e as Error).message });
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
    this.o.emit({
      type: "decision", at_ms: this.clock.now(), id: r.id, seq: r.seq, text_sent: this.o.keepHeard?.() ? r.textSent : redactHeard(r.textSent), status: r.status, prediction: r.prediction, action: r.action, fsm: r.fsm ?? null,
      // 고른 행동의 종류(표시용): 그 행동이 코치 행동인가
      assist: r.action ? (taskOf(r.action)?.coach ? "coach" : "noonchi") : null,
      ...(r.error ? { error: r.error } : {}), memory_version: r.memoryVersion, world: r.world,
    });
    this.o.onDecision?.(r);
  }

  /** 나가 있는 판단이 끝날 때까지 기다린다(시험용). */
  async idle(): Promise<void> {
    while (this.running.size) await Promise.all([...this.running]);
  }

  /** 멈추면 새로 부르지 않고, 늦게 온 답도 기록하지 않는다. */
  stop(): void {
    this.stopped = true;
  }
}
