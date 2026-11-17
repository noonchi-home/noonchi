// 실행 추적의 쓰는 중 지킴(UseWatch): 사람이 손대는 행동(TaskSpec.touch)의 대상 종류를 쓰는 것을 보면(src/act/tasks.ts usingNow: 마시는 중·들고 있음·쓰는 중)
// 그 사람이 화면에서 사라질 때까지(World State 사람 안 보임, person_gone) 그 종류를 붙잡고 관찰만 한다. PAM 판단은 그대로 받는다.
// - 붙잡은 동안 그 종류 쪽으로 사람을 보내지 않는다: 찾기(find.ts)·계획 밖 가까이 가서 보기·보류 중 가까이 가서 보기(contents.ts)는 시작하지 않고,
//   도는 중이면 tick마다 보고 명령·보기 지킴·가까이 보기를 거둔다. 자동 접근 조건은 mayApproach 하나다(손대는 행동의 대상이고 쓰는 중이 아님).
// - 그 종류가 대상인 계획은 첫 명령을 미룬다(start.ts tryStart, 「사람이 쓰는 중이라 기다려요」). 미룬 지 holdMs가 지나면 닫는다(보류 한도와 같다).
// - 처음 붙잡을 때 생각 말풍선에 상태 줄을 올린다(「사람이 마시는 중이라 지켜볼게요」).
// - 사람이 사라지면 모두 푼다. 다시 나타나면(since_ms가 바뀜) 새로 보고, 또 쓰면 다시 붙잡는다. 사라지기 전에 찍힌 사진의 늦은 답은 근거로 치지 않는다(usingNow).
import { USE_THOUGHT } from "../labels.js";
import { TASK_NAMES, touchTarget, usingNow, type UseWhy } from "../tasks.js";
import { OBJECT_NAME, STATE_TEXT } from "../../world/labels.js";
import { CONTENTS_HOLD } from "./contents.js";
import { EXEC_TEXT } from "../labels.js";
import { Part, type Run } from "./core.js";

/** 상태 줄 글. */
function thoughtOf(why: UseWhy, cls: string): string {
  const name = OBJECT_NAME[cls] ?? cls;
  if (why.kind === "act") return USE_THOUGHT.act(STATE_TEXT[why.act] ?? why.act);
  return why.kind === "holding" ? USE_THOUGHT.holding(name) : USE_THOUGHT.using(name);
}

/** 쓰는 중 지킴. */
export class UseWatch extends Part {
  /** 붙잡은 종류와 그 까닭. */
  private readonly held = new Map<string, UseWhy>();
  /** 지금 보이는 사람이 나타난 때(World State since_ms). 바뀌면 다른 등장이다. */
  private presence: number | null = null;

  /** 지금 World State로 다시 본다: 사람이 안 보이면 모두 풀고, 보이면 손대는 행동 대상 종류마다 쓰는 중인지 보고 붙잡는다(처음 붙잡으면 상태 줄). */
  update(): void {
    const world = this.o.world();
    if (!world.person.visible) {
      this.held.clear();
      this.presence = null;
      return;
    }
    if (world.person.since_ms !== this.presence) {
      this.held.clear();
      this.presence = world.person.since_ms;
    }
    for (const cls of this.classes()) {
      if (this.held.has(cls)) continue;
      const why = usingNow(world, cls);
      if (!why) continue;
      this.held.set(cls, why);
      if (!this.core.stopped) this.o.thought?.(thoughtOf(why, cls), this.core.lastDecision ?? "use");
    }
  }

  /** 사람이 쓰는 중이라 붙잡은 종류인가(지금 World State로 다시 보고 답한다). */
  busy(cls: string | null | undefined): boolean {
    this.update();
    return !!cls && this.held.has(cls);
  }

  /** 자동으로 그 종류 물건 쪽으로 사람을 보내도 되는가(찾기·가까이 가서 보기 공통): 지금 행동 목록의 손대는 행동 대상 종류이고 사람이 쓰는 중이 아니다. */
  mayApproach(cls: string | null | undefined): boolean {
    return !!cls && this.classes().has(cls) && !this.busy(cls);
  }

  /** 계획 대상(손대는 행동)을 사람이 쓰는 중이면 첫 명령을 미룬다: 처음 미룰 때 「사람이 쓰는 중이라 기다려요」를 남기고 떠 있던 찾기·가까이 보기를 거둔다.
   *  미룬 지 holdMs가 지나면 닫는다. 미루거나 닫았으면 true. */
  waits(r: Run): boolean {
    if (!this.busy(touchTarget(r.decision.action))) {
      r.usedAt = null;
      return false;
    }
    const now = this.clock.now();
    if (r.usedAt === null) {
      r.usedAt = now;
      this.core.finder.release(r, true);
      this.core.contents.pause(r);
      this.core.emit(r.plan.view.id, "planned", EXEC_TEXT.inUse);
    }
    if (now - r.usedAt > CONTENTS_HOLD.holdMs) {
      this.core.steps.finish(r, "failed", EXEC_TEXT.inUseLong);
      return true;
    }
    r.since = now;
    return true;
  }

  /** 지금 행동 목록(없으면 모든 행동)의 손대는 행동 대상 종류. */
  private classes(): Set<string> {
    const names = this.o.tasks?.() ?? TASK_NAMES;
    return new Set(names.map(touchTarget).filter((c): c is NonNullable<typeof c> => !!c));
  }
}
