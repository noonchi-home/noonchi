// 실행 추적의 사람 단계 명령 줄: 계획의 지금 명령 줄 또는 계획 밖 칸 하나와, 그 줄로 보내는 사람 단계 명령의 같은 규칙.
// 내용물 보류의 가까이 가서 보기(contents.ts)와 안 보이는 대상 찾기(find.ts)가 함께 쓴다.
// - 막힘(phoneBlocked): 맞춘 눈이 지금 것이 아님(다시 맞추는 중이거나 EYE_MS 넘게 안 옴), 판본이 맞는 폰 없음, 끄기 안내, 승인 대기, 폰 대화, 계획의 질문.
// - 보내기(sendLine): 새 명령을 소리로 읽게 띄운다. 되풀이(refreshLine): 비전 줄이 바뀌면 visionMs에 한 번까지 보내고 repeatMs마다 소리로 다시 읽는다.
import type { PlannedCommand } from "../../contract/phone.js";
import type { Run, TrackCore } from "./core.js";

/** 맞춘 눈이 이만큼(ms) 안 오면 지금 위치를 모른다(폰 자세는 초당 10번). */
export const EYE_MS = 2000;

/** 명령 줄 하나(계획의 지금 명령 줄 또는 계획 밖 칸): 명령 id, 떠 있는 명령, 띄우기·지우기, 읽은 때·비전 줄을 보낸 때. planId는 보기 기록에 남길 계획 id(계획 밖이면 빈 글). */
export interface Line {
  id: string; planId: string;
  shown(): PlannedCommand | null;
  show(c: PlannedCommand): void;
  clear(): void;
  spokeAt: number; visionAt: number;
}

/** 계획 밖 칸: 명령 id, 떠 있는 명령, 읽은 때·비전 줄을 보낸 때. */
export interface IdleSlot { id: string; sent: PlannedCommand | null; spokeAt: number; visionAt: number }

/** 계획의 지금 명령 줄. */
export function planLine(core: TrackCore, r: Run): Line {
  return {
    id: r.plan.view.id, planId: r.plan.view.id,
    shown: () => r.sent,
    show: (c) => { r.sent = c; core.answers.send(c); },
    clear: () => core.steps.clear(r),
    get spokeAt() { return r.spokeAt; }, set spokeAt(v) { r.spokeAt = v; },
    get visionAt() { return r.visionAt; }, set visionAt(v) { r.visionAt = v; },
  };
}

/** 계획 밖 칸의 명령 줄: 지울 때 계획 명령이 그 자리를 덮었으면 지우기를 보내지 않는다. */
export function idleLine(core: TrackCore, q: IdleSlot): Line {
  return {
    id: q.id, planId: "",
    shown: () => q.sent,
    show: (c) => { q.sent = c; core.answers.send(c); },
    clear: () => {
      if (!q.sent) return;
      q.sent = null;
      if (!core.shown()) core.answers.send({ type: "command_clear", id: q.id });
    },
    get spokeAt() { return q.spokeAt; }, set spokeAt(v) { q.spokeAt = v; },
    get visionAt() { return q.visionAt; }, set visionAt(v) { q.visionAt = v; },
  };
}

/** 지금 맞춘 눈: 다시 맞추는 중(추정 눈)이 아니고 EYE_MS 안에 받았다. 아니면 null. */
export function eyeNow(core: TrackCore, now: number): { position: [number, number]; at: number } | null {
  const e = core.eye;
  return e && e.at > core.eyeLostAt && now - e.at <= EYE_MS ? e : null;
}

/** 사람 단계 명령을 보내지 않을 때(어느 명령 줄이든 같다). asking: 계획에 승인·다시 묻기 질문이 떠 있다. */
export function phoneBlocked(core: TrackCore, now: number, asking: boolean): boolean {
  return !eyeNow(core, now) || !core.start.phoneOk() || core.safety.offPending() || !!core.safety.shownOff()
    || (core.o.approvalsWaiting?.() ?? false) || (core.o.talking?.() ?? false) || asking;
}

/** 새 명령을 그 줄에 띄운다(소리로 읽기): 읽은 때·비전 줄을 보낸 때를 지금으로 둔다. */
export function sendLine(line: Line, c: PlannedCommand, now: number): void {
  line.spokeAt = now;
  line.visionAt = now;
  line.show(c);
}

/** 떠 있는 명령 되풀이: 비전 줄이 바뀌면 visionMs에 한 번까지 보내고, repeatMs마다 소리로 다시 읽는다. 지금 떠 있는 명령을 돌려준다. */
export function refreshLine(core: TrackCore, line: Line, sent: PlannedCommand, vision: string, now: number): PlannedCommand {
  let c = sent;
  if (vision !== sent.vision && now - line.visionAt >= core.cfg.visionMs) {
    line.visionAt = now;
    c = { ...sent, vision, speak: false };
    line.show(c);
  }
  if (now - line.spokeAt >= core.cfg.repeatMs) {
    line.spokeAt = now;
    core.answers.send({ ...c, speak: true });
  }
  return c;
}
