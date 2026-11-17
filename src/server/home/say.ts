// 집 실행 묶음의 말풍선 카드 잇기(src/act/say.ts sayLine): 계획 방송·실제 폰 명령·World State 바뀜·판단 타이머 뒤에 다시 보고, 글이 바뀔 때만 대시보드로 보낸다.
// 끝난 지 20초·가까이 보기 6초·외부 연락 결과 20초·반성 20초는 계획 updatedAt(PlanHub, Date.now)과 같은 시계로 잰다.
import { SAY_DONE_MS, sayOf } from "../../act/index.js";
import type { BrainLog } from "../../contract/events.js";
import type { HomeCore } from "./core.js";

/** 말풍선 카드 글을 다시 보는 speak를 단다. 그 전에는 speak가 아무것도 하지 않는다. */
export function startSay(core: HomeCore): void {
  const { plans } = core;
  // 끝난 지 20초·가까이 보기 6초·외부 연락 결과 20초는 계획 updatedAt(PlanHub, Date.now)과 같은 시계로 잰다
  core.speak = () => {
    const { tracker } = core;
    const leftAt = tracker?.leftAt() ?? null;
    const toldAt = tracker?.toldAt() ?? null;
    const { text, safety } = sayOf({ plan: plans.current(), command: core.command, world: core.view(), nowMs: Date.now(), look: core.lookSay, left: leftAt === null ? null : { atMs: leftAt },
      told: toldAt === null ? null : { atMs: toldAt }, quiet: tracker?.quietStep() ?? null, reflected: core.reflected, offWait: tracker?.offWaiting() ?? null,
      offTold: tracker?.offTold() ?? null, service: core.serviceSaid });
    if (text === core.said && safety === core.saidSafety) return;
    core.said = text;
    core.saidSafety = safety;
    core.app?.broadcast({ type: "say", text, ...(safety ? { safety: true as const } : {}) });
  };
}

/** 관찰 흐름이 꺼져 판단 타이머가 없으면 말풍선 글만 본다(끝난 지 20초가 지나면 지켜보기로). */
export function sayTimer(core: HomeCore): void {
  if (core.decideTimer) return;
  core.decideTimer = setInterval(core.speak, 1000);
  core.decideTimer.unref?.();
}

/** 반성 사건(src/server/start.ts가 넘긴다): 말풍선 카드가 20초 동안 배운 습관을 말한다. */
export function onReflection(core: HomeCore, event: Extract<BrainLog, { type: "reflection" }>): void {
  if (!event.ok) return;
  core.reflected = { atMs: event.at_ms, learned: event.learned?.length ?? 0, active: event.active?.length ?? 0 };
  core.speak();
  setTimeout(() => core.speak(), SAY_DONE_MS + 50).unref?.();
}
