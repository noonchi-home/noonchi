// 켠 위험 가전 추적과 끄기 안내(SafetyTracker). 추적 상태(지금 계획이 켠 가전 hot, 떠 있는 끄기 안내 reminder, 줄 offQueue, 가전마다 켜기 회차 cycles,
// 풀린 가전 released)는 이 클래스의 # 비공개 칸이라 다른 부분이 지울 수 없다. 작동 끝남은 cycleEnded 하나만 판정하고, 추적은 releaseIfOff 하나만 푼다
// (닫힐 때 handOver는 hot을 끄기 안내 줄로 옮기고, nextReminder는 줄에서 꺼내 띄운다). 「완료」·말·만료·끄기 단계 넘김은 풀지 않는다(tests/act-track-release.test.ts).
// hot은 지금 계획(TrackCore.run)이 켠 가전이다: 켜라는 명령(turnedOn)·다시 걸기로만 들어가고, 계획이 닫히면 handOver가 비운다.
import type { PlannedCommand } from "../../contract/phone.js";
import type { OffTrack } from "../../contract/plan.js";
import type { WorldView } from "../../contract/world.js";
import { DEVICE_STATES } from "../../world/vocab.js";
import { TOOL_STATES, selfStopWait, type AgentStep } from "../../agent/index.js";
import { CAUTION_TEXT, CLOSER_TEXT } from "../labels.js";
import { offStep } from "../off-step.js";
import { STEP_DONE } from "../prompts.js";
import { OPEN, Part, type Run } from "./core.js";

/** 켜기 회차: 회차 번호(가전마다 1부터), 회차 시작 시각(켜라고 한 시각, 다시 걸면 그 켜짐의 촬영 시각), 이 회차에 보낸 첫 부탁 시각. */
export interface Cycle { cycle: number; onAt: number; askedAt: number | null }
/** 작동 한 번 끝남 판정(cycleEnded): switch(아는 켜짐 → 꺼짐) 또는 confirmed(부탁 뒤 가까이 본 명시 꺼짐), 근거 촬영 시각, 회차 번호. */
export interface CycleEnd { via: "switch" | "confirmed"; evidenceAt: number; cycle: number }

/** 끄기 안내 하나: 그 가전, 실제 폰 명령의 계획·단계 id와 글. ask면 보이게 해 달라는 부탁(답 단추 없음). */
export interface OffNote { planId: string; step: string; deviceId: string; text: string; ask: boolean }

/** 깊은 읽기 전용: 받은 쪽이 안쪽 칸·배열까지 바꿀 수 없다. */
type DeepReadonly<T> = T extends object ? { readonly [K in keyof T]: DeepReadonly<T[K]> } : T;

type DeviceView = WorldView["devices"][number];
type HistoryLine = DeviceView["history"][number];
/** 작동 한 번의 켜짐·꺼짐 값: 전원 켜짐 → 꺼짐, 작동 중 → 멈춤. */
const CYCLE_VALUES: readonly { attr: string; on: unknown; off: unknown }[] = [
  { attr: DEVICE_STATES.on.attr, on: DEVICE_STATES.on.value, off: DEVICE_STATES.off.value },
  { attr: DEVICE_STATES.running.attr, on: DEVICE_STATES.running.value, off: DEVICE_STATES.stopped.value },
];
/** 이력 줄의 근거 시각: 카메라면 근거 사진 촬영 시각(seen_ms), 허브·실제 가전 신호면 도착 시각. */
const evidenceTime = (h: HistoryLine) => h.seen_ms ?? h.at_ms;
/** 지금 상태가 켜짐(켜짐·작동 중)을 말하는가. */
const onNow = (d: DeviceView) => d.state.includes("on") || d.state.includes("running");
/** 지금 상태가 이미 꺼짐(꺼짐·멈춤, 켜짐 아님)인가. 신호가 없거나 가전을 모르면 아니다. */
const offNow = (d: DeviceView | undefined) => !!d && d.status !== null && !onNow(d) && (d.state.includes("off") || d.state.includes("stopped"));
/** after 뒤(until까지) 그 가전이 켜졌다는 근거 시각(촬영 시각) 가운데 가장 이른 것(last면 가장 늦은 것). 이력의 켜짐 줄(허브·실제 가전 신호·카메라 명시·추정)과
 *  카메라 마지막 관측(sight_last, 허브가 꺼짐을 말해 이력 줄이 없을 때도 남는다)의 켜짐을 본다. 없으면 null. */
function onSeenAfter(d: DeviceView | undefined, after: number, until = Number.POSITIVE_INFINITY, last = false): number | null {
  if (!d) return null;
  const lines = d.history.filter((h) => CYCLE_VALUES.some((k) => h.attr === k.attr && h.to === k.on)).map(evidenceTime);
  const seen = CYCLE_VALUES.flatMap((k) => {
    const s = d.sight_last?.[k.attr];
    return s && s.value === k.on ? [s.seen_ms] : [];
  });
  const times = [...lines, ...seen].filter((x) => x > after && x <= until);
  return times.length ? (last ? Math.max(...times) : Math.min(...times)) : null;
}

/** 켠 위험 가전 추적·끄기 안내. 추적 상태는 # 칸이다. */
export class SafetyTracker extends Part {
  /** 지금 계획이 켜고 아직 작동 한 번 끝남을 확인하지 못한 가전(안전 추적). releaseIfOff만 빼고, 닫힐 때 handOver가 끄기 안내 줄로 옮긴다. */
  readonly #hot = new Set<string>();
  /** 켠 채 닫힌 계획의 끄기 안내: 실제 폰에 떠 있는 것(reminder, 띄운 시각)과 그 뒤에 띄울 것(offQueue). 가전마다 하나. */
  #reminder: { sent: PlannedCommand; at: number; note: OffNote } | null = null;
  readonly #offQueue: OffNote[] = [];
  /** 줄에서 기다리는 끄기 안내를 마지막으로 소리로 알린 시각(실행 추적 시계, 다시 알릴 때를 센다)과 그 가전(다음 차례를 센다), 그 가전 이름·Date.now 시각(말풍선 카드). */
  #offToldAt: number | null = null;
  #offToldId: string | null = null;
  #offToldWall: { device: string; atMs: number } | null = null;
  /** 가전마다 지금 켜기 회차(계획이 닫혀도 남는다). */
  readonly #cycles = new Map<string, Cycle>();
  /** 추적이 풀린 가전: 그 계획, 풀린 근거 촬영 시각, 판정 길, 푼 시각(다시 걸기 rearmIfOn이 본다). */
  readonly #released = new Map<string, { planId: string; evidenceAt: number; via: CycleEnd["via"]; at: number }>();

  /** 손으로 켜는 위험 가전에 켜라는 명령을 보낸다(켜기 전 질문 승인): 새 켜기 회차를 열고 그 가전을 hot에 넣는다(끄는 단계가 끝날 때까지 켠 것으로 본다). */
  turnedOn(r: Run, id: string, now: number): void {
    const cycle: Cycle = { cycle: (this.#cycles.get(id)?.cycle ?? 0) + 1, onAt: now, askedAt: null };
    this.#cycles.set(id, cycle);
    r.onAt.set(id, { ...cycle });
    this.#hot.add(id);
    r.ends.delete(id);
    this.#released.delete(id);
  }

  offShown(): boolean { return this.#reminder !== null; }

  /** 떠 있는 끄기 안내(명령과 그 안내)의 깊은 읽기 전용 복사본. 없으면 null. 실제 폰 명령 줄·답·말이 읽는다(받은 쪽이 바꿔도 추적 상태는 그대로다). */
  shownOff(): DeepReadonly<{ sent: PlannedCommand; note: OffNote }> | null {
    const off = this.#reminder;
    return off && structuredClone({ sent: off.sent, note: off.note });
  }

  /** 끄기 안내가 떠 있거나 줄에서 기다리는 첫 가전(떠 있는 것이 먼저). 없으면 undefined. */
  pendingDevice(): string | undefined {
    return this.#reminder?.note.deviceId ?? this.#offQueue[0]?.deviceId;
  }

  /** 다음 끄기 안내를 띄운다. 다른 계획이 실제 폰 명령 줄을 쓰는 중(진행 중·승인 질문 중)이면 띄우지 않고 그 계획이 끝난 뒤 띄운다.
   *  rotate: 떠 있는 안내를 줄 끝으로 돌리고 다음 가전 안내를 띄운다(줄에 다른 안내가 있을 때만). 꺼내기 전에 작동이 끝난 가전은 releaseIfOff가 줄에서 뺀다.
   *  남은 것이 없으면 미뤄 둔 새 계획을 시작해 본다. */
  nextReminder(rotate = false): void {
    if (this.core.stopped || this.lineBusy()) return;
    const r = this.core.run;
    const off = this.#reminder;
    if (off && rotate && this.#offQueue.length) {
      this.#offQueue.push(off.note);
      this.#reminder = null;
      this.core.answers.send({ type: "command_clear", id: off.sent.id });
    }
    if (this.#reminder) return;
    while (this.#offQueue.length && this.releaseIfOff(this.#offQueue[0]!.deviceId));
    const note = this.#offQueue.shift();
    const now = this.clock.now();
    if (note) {
      const sent: PlannedCommand = {
        type: "command", id: note.planId, step: note.step, text: note.text, vision: null,
        choices: note.ask ? [] : [{ id: STEP_DONE.id, label: STEP_DONE.label }], target: null, speak: true,
      };
      this.#reminder = { sent, at: now, note };
      this.#offToldAt = null;
      const cycle = this.#cycles.get(note.deviceId);
      if (note.ask && cycle && cycle.askedAt === null) cycle.askedAt = now;
      this.core.answers.send(sent);
      return;
    }
    if (r?.state === "planned" && !r.asking) {
      r.since = now;
      this.core.start.tryStart(r, false);
    }
  }

  /** 켠 위험 가전 추적 보기(tick·World State 변화마다, 실행 추적이 쉬는 동안에도): 지금 계획 hot·끄기 안내에 남은 가전마다 releaseIfOff,
   *  풀린 가전마다 rearmIfOn. 떠 있는 끄기 안내는 offHoldMs마다 같은 글을 다시 소리로 보내고, 줄에 다른 가전 안내가 기다리면 차례를 돌린다. */
  reminderTick(): void {
    if (this.core.stopped) return;
    const tracked = new Set([...this.#hot, ...(this.#reminder ? [this.#reminder.note.deviceId] : []), ...this.#offQueue.map((n) => n.deviceId)]);
    for (const id of tracked) this.releaseIfOff(id);
    for (const id of [...this.#released.keys()]) this.rearmIfOn(id);
    const now = this.clock.now();
    const r = this.core.run;
    if (r) for (const [id, end] of r.ends) if (now - end.at > this.cfg.rearmMs && !this.offStepOpen(r, id)) r.ends.delete(id);
    // 폰이 필요한 다른 계획이 도는 동안 줄에서 기다리는 안내: offHoldMs마다 소리로만 다시 알리고, 여러 가전이 기다리면 마지막으로 알린 가전 다음 차례로 돌아가며 알린다
    if (!this.#reminder && this.#offQueue.length && this.#offToldAt !== null && now - this.#offToldAt > this.cfg.offHoldMs) {
      const ids = this.#offQueue.map((n) => n.deviceId);
      this.tellWaiting(ids[(ids.indexOf(this.#offToldId ?? "") + 1) % ids.length]!);
    }
    const off = this.#reminder;
    if (!off || now - off.at <= this.cfg.offHoldMs) return;
    if (this.#offQueue.length) return this.nextReminder(true);
    off.at = now;
    this.core.answers.send({ ...off.sent, speak: true });
  }

  /** 작동 한 번 끝남 판정(하나뿐, 그 가전의 지금 켜기 회차에 대해). 아니면 null. 근거 시각은 촬영 시각(카메라 seen_ms, 허브·실제 가전 신호는 도착 시각)이고
   *  근거는 명시만 쓴다(카메라 추정 꺼짐은 쓰지 않는다. 허브·실제 가전 신호 줄은 명시로 본다).
   *  switch: 회차 onAt 뒤에 촬영된 근거로 아는 켜짐 값(on·running)에서 꺼짐으로 바뀌었고(앞 값이 모름·null이면 아님), 그 바뀜이 명시이거나
   *  그 뒤(켜짐 없이) 같은 꺼짐 값의 명시 근거 줄이 있다. 그 뒤 다시 켜짐 줄이 오면 그 바뀜은 지난 것이다.
   *  confirmed: 이 회차에 보낸 부탁(askedAt) 뒤이고 회차 onAt 뒤에 촬영된, 가까이 본(close) 명시 꺼짐 관측(sight_last)이 있다(켜짐을 놓쳤을 때의 복구).
   *  지금 상태(허브·실제 가전 신호)가 켜짐이거나 그 근거보다 새 카메라 명시 값이 켜짐이면 null. */
  private cycleEnded(deviceId: string): CycleEnd | null {
    const c = this.#cycles.get(deviceId);
    const d = this.o.world().devices.find((x) => x.id === deviceId);
    if (!c || !d || d.status === null || onNow(d)) return null;
    for (const k of CYCLE_VALUES) {
      let switched: number | null = null;
      let pending = false;
      for (const h of d.history) {
        if (h.attr !== k.attr || evidenceTime(h) <= c.onAt) continue;
        if (h.to === k.on) {
          switched = null;
          pending = false;
        } else if (h.to === k.off && h.from === k.on) {
          pending = h.explicit === false;
          switched = pending ? null : evidenceTime(h);
        } else if (h.to === k.off && h.from === k.off && pending && h.explicit !== false) {
          pending = false;
          switched = evidenceTime(h);
        }
      }
      const seen = d.sight_last?.[k.attr];
      const confirmed = c.askedAt !== null && seen && seen.value === k.off && seen.explicit && seen.close && seen.seen_ms > c.askedAt && seen.seen_ms > c.onAt ? seen.seen_ms : null;
      const end: CycleEnd | null = switched !== null ? { via: "switch", evidenceAt: switched, cycle: c.cycle } : confirmed !== null ? { via: "confirmed", evidenceAt: confirmed, cycle: c.cycle } : null;
      if (!end) continue;
      if (seen && seen.value === k.on && seen.explicit && seen.seen_ms >= end.evidenceAt) return null;
      return end;
    }
    return null;
  }

  /** 그 가전의 켜기 단계가 아직 끝나지 않았는가: 열린 계획의 지금 단계가 그 가전을 켜는 손 조작 do(켜기 전 질문 중 포함)다. */
  private onStepOpen(deviceId: string): boolean {
    const r = this.core.run;
    const step = r && OPEN.has(r.state) ? this.core.stepOf(r) : undefined;
    return step?.kind === "do" && step.hand?.to === "on" && step.hand.deviceId === deviceId;
  }

  /** 추적을 푸는 하나뿐인 자리. 그 가전의 켜기 단계가 끝났고(onStepOpen 아님) cycleEnded가 null이 아니면 hot·떠 있는 끄기 안내·줄의 끄기 안내에서
   *  그 가전을 지우고 released에 그 계획과 근거를 남긴 뒤 true. 아니면 false. 떠 있던 안내를 지웠으면 다음 안내를 띄운다. */
  releaseIfOff(deviceId: string): boolean {
    const r = this.core.run;
    const off = this.#reminder;
    const shown = off?.note.deviceId === deviceId ? off : null;
    const queued = this.#offQueue.find((n) => n.deviceId === deviceId);
    const inHot = this.#hot.has(deviceId);
    if (!inHot && !shown && !queued) return false;
    if (this.onStepOpen(deviceId)) return false;
    const end = this.cycleEnded(deviceId);
    if (!end) return false;
    const planId = inHot ? r!.plan.view.id : (shown?.note ?? queued)!.planId;
    this.#hot.delete(deviceId);
    for (let i = this.#offQueue.length - 1; i >= 0; i--) if (this.#offQueue[i]!.deviceId === deviceId) this.#offQueue.splice(i, 1);
    const now = this.clock.now();
    this.#released.set(deviceId, { planId, evidenceAt: end.evidenceAt, via: end.via, at: now });
    if (r?.onAt.has(deviceId)) r.ends.set(deviceId, { cycle: end.cycle, seenAt: end.evidenceAt, how: end.via, at: now });
    if (shown) {
      this.#reminder = null;
      this.core.answers.send({ type: "command_clear", id: shown.sent.id });
      this.nextReminder();
    }
    return true;
  }

  /** 다시 걸기: 풀린 가전의 새 켜짐(근거 촬영 시각이 풀린 근거의 촬영 시각 evidenceAt 뒤이고 그 뒤 rearmMs 안)을 보면 추적을 다시 건다.
   *  켜짐 근거는 이력 줄과 카메라 마지막 관측(sight_last), 명시·추정 모두 받는다(onSeenAfter). 회차를 올리고(onAt은 그 켜짐 촬영 시각, 옛 부탁은 버림) 같은 계획이 열려 있으면 hot에 다시 넣고,
   *  닫혔으면 끄기 안내 줄에 넣는다(다른 계획이 도는 중이면 그 계획이 끝난 뒤 뜬다). 푼 뒤 rearmMs가 지나면 더 보지 않는다. */
  private rearmIfOn(deviceId: string): boolean {
    const rel = this.#released.get(deviceId);
    if (!rel) return false;
    if (this.clock.now() - rel.at > this.cfg.rearmMs) {
      this.#released.delete(deviceId);
      return false;
    }
    const d = this.o.world().devices.find((x) => x.id === deviceId);
    const on = onSeenAfter(d, rel.evidenceAt, rel.evidenceAt + this.cfg.rearmMs);
    if (on === null) return false;
    this.#released.delete(deviceId);
    const cycle: Cycle = { cycle: (this.#cycles.get(deviceId)?.cycle ?? 0) + 1, onAt: on, askedAt: null };
    this.#cycles.set(deviceId, cycle);
    const r = this.core.run;
    if (r && OPEN.has(r.state) && r.plan.view.id === rel.planId) {
      r.onAt.set(deviceId, { ...cycle });
      this.#hot.add(deviceId);
      r.ends.delete(deviceId);
      return true;
    }
    this.queueOff(rel.planId, deviceId, false);
    this.nextReminder();
    // 다른 계획이 명령 줄을 쓰는 중이라 안내가 줄에서 기다리면 소리로만 바로 알린다
    if (this.lineBusy()) this.tellWaiting(deviceId);
    return true;
  }

  /** 폰이 필요한 계획이 실제 폰 명령 줄을 쓰는 중인가(진행 중·확인 중·승인 질문 중). 그동안 끄기 안내는 줄에서 기다린다. */
  private lineBusy(): boolean {
    const r = this.core.run;
    return !!r && r.phone && (r.state === "running" || r.state === "verifying" || (r.state === "planned" && r.asking !== null));
  }

  /** 줄에서 기다리는 끄기 안내를 붙은 폰에 소리로만 알리고(명령 줄은 그대로) 그 시각을 남긴다. */
  private tellWaiting(deviceId: string): void {
    const name = this.core.handLabel(deviceId);
    this.o.sayAloud?.(CAUTION_TEXT.rearmed(name));
    this.#offToldAt = this.clock.now();
    this.#offToldId = deviceId;
    this.#offToldWall = { device: name, atMs: Date.now() };
  }

  /** 끄기 안내를 줄에 넣는다(가전마다 하나: 그 가전 안내가 이미 떠 있거나 줄에 있으면 넣지 않는다). 명령 id는 그 계획 id, 단계 id는 off:<계획>:<가전>:<지금 회차>.
   *  ask면 보이게 해 달라는 부탁, 부를 이름이 없으면 끄라는 안내. */
  private queueOff(planId: string, deviceId: string, ask: boolean): void {
    if (this.#reminder?.note.deviceId === deviceId || this.#offQueue.some((n) => n.deviceId === deviceId)) return;
    const name = ask ? this.core.nameOf(deviceId) : null;
    const step = offStep(planId, deviceId, this.#cycles.get(deviceId)?.cycle ?? 1);
    this.#offQueue.push({ planId, step, deviceId, text: name ? CLOSER_TEXT(name) : CAUTION_TEXT.off(this.core.handLabel(deviceId)), ask: !!name });
  }

  /** 끄기 안내가 떠 있거나 줄에 남았는가. 참이면 폰이 필요한 계획의 첫 명령(승인 질문 포함)을 보내지 않는다. */
  offPending(): boolean {
    return this.#reminder !== null || this.#offQueue.length > 0;
  }

  /** 닫히는 계획의 hot을 끄기 안내 줄로 옮긴다(푸는 것이 아니다. 이미 작동이 끝난 가전은 releaseIfOff가 푼다). 그 가전 상태가 이미 꺼짐인데
   *  작동 끝남을 확인하지 못했으면 끄라는 안내 대신 보이게 해 달라는 부탁으로 넣는다. 그 뒤 기다리던 안내(다른 계획 것 포함)를 띄운다. */
  handOver(r: Run): void {
    if (this.core.stopped) return;
    for (const id of [...this.#hot]) this.releaseIfOff(id);
    const devices = this.o.world().devices;
    for (const id of this.#hot) this.queueOff(r.plan.view.id, id, offNow(devices.find((d) => d.id === id)));
    this.#hot.clear();
    this.nextReminder();
  }

  /** 보이게 해 달라는 부탁(CLOSER_TEXT(가전 이름), 답 단추 없음)을 보내고 지금 회차의 첫 부탁 시각(askedAt)을 남긴다. 떠 있는 끄기 안내가 그 가전이면
   *  그 안내를, 아니면 그 가전을 끄는 지금 do 단계 명령 줄(그 단계 id)을 바꾼다. 부를 이름이 없거나 바꿀 자리가 없으면 보내지 않는다. 보냈으면 true. */
  askToShow(deviceId: string): boolean {
    const name = this.core.nameOf(deviceId);
    if (!name) return false;
    const text = CLOSER_TEXT(name);
    const now = this.clock.now();
    const off = this.#reminder;
    const r = this.core.run;
    const step = r ? this.core.stepOf(r) : undefined;
    if (off?.note.deviceId === deviceId) {
      off.note = { ...off.note, text, ask: true };
      off.sent = { ...off.sent, text, choices: [], speak: true };
      off.at = now;
      this.core.answers.send(off.sent);
    } else if (r?.state === "running" && !r.asking && step && ((r.sent && step.kind === "do" && step.hand?.to === "off" && step.hand.deviceId === deviceId)
      || selfStopWait(step, this.o.handDevices?.() ?? []) === deviceId)) {
      // 끄기 do는 그 명령 글을, 꺼짐 기다리기(명령이 없는 단계)는 그 단계 id로 새 명령을 띄운다(답 단추 없음)
      Object.assign(r, { spokeAt: now, helped: true, quietOn: false });
      r.sent = r.sent
        ? { ...r.sent, text, choices: [], speak: true }
        : { type: "command", id: r.plan.view.id, step: step.id, text, vision: null, choices: [], target: null, speak: true };
      this.core.answers.send(r.sent);
    } else return false;
    const cycle = this.#cycles.get(deviceId);
    if (cycle && cycle.askedAt === null) cycle.askedAt = now;
    return true;
  }

  /** 실행 중 끄는 단계(끄기 do·꺼짐 기다리기): showAskMs 넘게 안 끝나고 그 가전 상태가 이미 꺼짐인데 작동 끝남을 확인하지 못했으면(켜짐을 놓침) 부탁을 그 단계에 한 번 보낸다. */
  offAsk(r: Run, step: AgentStep, now: number): void {
    const id = this.offTarget(step);
    if (!id || !this.#hot.has(id) || r.asking || (!r.sent && step.kind === "do") || r.offAsked === r.gen || now - r.stepAt < this.cfg.showAskMs) return;
    if (!offNow(this.o.world().devices.find((d) => d.id === id))) return;
    r.offAsked = r.gen;
    this.askToShow(id);
  }

  /** 그 단계가 끄는 가전: 손 조작 끄기 do의 그 가전, 저절로 꺼지는 가전의 꺼짐 기다리기(selfStopWait)의 그 가전. 아니면 null. */
  private offTarget(step: AgentStep | undefined): string | null {
    if (!step) return null;
    return selfStopWait(step, this.o.handDevices?.() ?? []) ?? (step.kind === "do" && step.hand?.to === "off" ? step.hand.deviceId : null);
  }

  /** 가전을 끄는 단계인가(그 명령·부탁은 안전 등급): 끄는 단계(offTarget: 손 끄기 do·꺼짐 기다리기), 또는 끝나는 조건이 가전 꺼짐·멈춤인 단계. */
  turnsOff(step: AgentStep): boolean {
    if (this.offTarget(step) !== null) return true;
    const u = step.until as Record<string, unknown> | null;
    return !!u && typeof u.device === "string" && typeof u.state === "string" && TOOL_STATES.turn_off!.includes(u.state);
  }

  /** 지금 단계가 그 가전을 끄는 단계(끄기 do·꺼짐 기다리기)인가. */
  private offStepOpen(r: Run, deviceId: string): boolean {
    return OPEN.has(r.state) && this.offTarget(this.core.stepOf(r)) === deviceId;
  }

  /** 끄는 단계(끄기 do·꺼짐 기다리기, offTarget)의 판단 하나: 이 계획이 켠 그 가전의 지금 회차가 풀렸으면(실행 추적이 든 풀린 근거 r.ends, 가전 이력에 기대지 않음) 그 근거 뒤 새 켜짐을 직접 본다.
   *  새 켜짐이 없으면(허브·실제 가전 신호가 켜짐이 아니고 근거 뒤 이력·카메라 마지막 관측에 켜짐이 없음) 그 단계는 끝난다.
   *  켜져 있으면 다시 걸기 기간과 상관없이 그 자리에서 새 회차로 hot에 다시 건다. 지금 회차의 풀린 근거가 없는데(기록이 지워짐) 켜짐도 아니면
   *  끝내지 않고 같은 회차로 hot에 다시 넣어 추적(releaseIfOff·부탁 offAsk)이 이어지게 한다. */
  offReleased(r: Run, step: AgentStep): boolean {
    const id = this.offTarget(step);
    const cycle = id ? this.#cycles.get(id) : undefined;
    if (!id || !cycle || !r.onAt.has(id) || this.#hot.has(id)) return false;
    const d = this.o.world().devices.find((x) => x.id === id);
    const rec = r.ends.get(id);
    const end = rec?.cycle === cycle.cycle ? rec : undefined;
    const since = end?.seenAt ?? cycle.onAt;
    const onAgain = (!!d && onNow(d)) || (!!end && onSeenAfter(d, since) !== null);
    if (!end && !onAgain) {
      r.ends.delete(id);
      this.#hot.add(id);
      return false;
    }
    if (onAgain) {
      // 새 회차의 시작: 그 켜짐의 가장 늦은 근거(지금 켜져 있게 한 켜짐), 모르면 지금
      const next: Cycle = { cycle: cycle.cycle + 1, onAt: onSeenAfter(d, since, Number.POSITIVE_INFINITY, true) ?? this.clock.now(), askedAt: null };
      this.#cycles.set(id, next);
      this.#released.delete(id);
      r.ends.delete(id);
      r.onAt.set(id, { ...next });
      this.#hot.add(id);
      return false;
    }
    return true;
  }

  /** 줄에서 기다리는 끄기 안내를 마지막으로 소리로 알린 가전 이름과 시각(Date.now, 대시보드 말풍선 카드). 없으면 null. */
  offTold(): { device: string; atMs: number } | null {
    return this.core.stopped ? null : this.#offToldWall;
  }

  /** 끄기 안내 때문에 새 계획 시작을 미루는 중이면 기다리는 가전 이름(대시보드 말풍선 카드). 아니면 null. */
  offWaiting(): string | null {
    const r = this.core.run;
    if (this.core.stopped || r?.state !== "planned" || r.asking || !r.deferred) return null;
    const id = this.pendingDevice();
    return id ? this.core.handLabel(id) : null;
  }

  /** 끄기 추적 요약(GET /api/plan off, 영상 판정): 지금 계획 hot 가전과 끄기 안내가 떠 있거나 줄에서 기다리는 가전. 멈췄으면 빈 요약. */
  offTrack(): OffTrack {
    if (this.core.stopped) return { hot: [], notices: [] };
    return { hot: [...this.#hot], notices: [...(this.#reminder ? [this.#reminder.note.deviceId] : []), ...this.#offQueue.map((n) => n.deviceId)] };
  }

  /** 켠 위험 가전 추적(시험·안내 자리): 지금 계획의 hot, 가전마다 지금 켜기 회차, 풀린 가전과 그 근거. */
  snapshot(): { hot: string[]; cycles: Record<string, Cycle>; released: Record<string, { planId: string; evidenceAt: number; via: CycleEnd["via"] }> } {
    return {
      hot: [...this.#hot],
      cycles: Object.fromEntries([...this.#cycles].map(([id, c]) => [id, { ...c }])),
      released: Object.fromEntries([...this.#released].map(([id, { planId, evidenceAt, via }]) => [id, { planId, evidenceAt, via }])),
    };
  }
}
