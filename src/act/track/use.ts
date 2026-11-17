// 실행 추적의 쓰는 중 지킴(UseWatch): 사람이 손대는 행동(TaskSpec.touch)의 대상을 쓰는 것을 보면(src/act/tasks.ts usingNow: 마시는 중·들고 있음·쓰는 중)
// 쓴 사람이 떠날 때까지 그것을 붙잡고 관찰만 한다. PAM 판단은 그대로 받는다.
// - 무엇을 쓰는지 알면(World State 물건 id) 그 물건만, 모르면(무엇을 들었는지 모름·확인 전 물건·후보 자리) 그 종류 전체를 붙잡는다.
//   붙잡은 물건이 옮김 표시(followed_by)로 새 물건에 이어지면 그 새 물건도 붙잡은 것으로 본다.
// - 붙잡은 동안 그쪽으로 사람을 보내지 않는다: 찾기(find.ts)·계획 밖 가까이 가서 보기·보류 중 가까이 가서 보기(contents.ts)는 시작하지 않고,
//   도는 중이면 tick마다 보고 명령·보기 지킴·가까이 보기를 거둔다. 자동 접근 조건은 mayApproach 하나다(손대는 행동의 대상이고 쓰는 중이 아님).
// - 그 대상을 쓰는 계획은 첫 명령을 미룬다(start.ts tryStart, 「사람이 쓰는 중이라 기다려요」). 미룬 지 holdMs가 지나면 닫는다(보류 한도와 같다).
//   풀린 뒤 첫 명령은 내용물 보류·찾기에서 풀린 계획처럼 폰 대화·승인 대기가 없을 때만 보낸다(Run.useHeld).
// - 처음 붙잡을 때 생각 말풍선에 상태 줄을 올린다(「사람이 마시는 중이라 지켜볼게요」).
// - 쓴 사람이 떠남: 사람이 안 보이면(person_gone) 모두 푼다. World State는 사람을 한 묶음으로 세어 누가 떠났는지 모르므로, 사람이 보이는 동안에는
//   보인 사람 수가 붙잡은 뒤 가장 많던 수보다 USE_LEAVE_MS 넘게 적으면 쓴 사람이 떠난 것으로 그 붙잡음을 푼다. 그 뒤로는 푼 때 뒤에 찍힌 사진의 근거로만
//   다시 붙잡는다(남은 사람이 쓰면 다시 붙잡는다). 다시 나타나면(since_ms가 바뀜) 새로 보고, 사라지기 전 사진의 늦은 답은 근거로 치지 않는다(usingNow).
import { EXEC_TEXT, USE_THOUGHT } from "../labels.js";
import { planTargetId, TASK_NAMES, touchTarget, usingNow, type UseWhy } from "../tasks.js";
import { OBJECT_NAME, STATE_TEXT } from "../../world/labels.js";
import type { WorldView } from "../../contract/world.js";
import { CONTENTS_HOLD } from "./contents.js";
import { Part, type Run } from "./core.js";

/** 보인 사람 수가 붙잡은 뒤 가장 많던 수보다 이만큼(ms) 넘게 적으면 쓴 사람이 떠난 것으로 본다(World State 사람 사라짐 4초와 같다). */
export const USE_LEAVE_MS = 4000;
/** 옮김 표시(followed_by)를 따라가는 횟수 한도. */
const FOLLOW_MAX = 5;

/** 지킬지 물을 대상: 종류와, 알면 World State 물건 id(후보 자리처럼 모르면 null). */
export interface UseTarget { cls: string | null | undefined; id?: string | null }

/** 붙잡은 것 하나: 종류, 물건 id(종류 전체면 null), 까닭, 붙잡은 뒤 가장 많이 보인 사람 수, 그보다 적게 보이기 시작한 때. */
interface Hold { cls: string; id: string | null; why: UseWhy; people: number; fewerAt: number | null }

/** 상태 줄 글. */
function thoughtOf(why: UseWhy, cls: string): string {
  const name = OBJECT_NAME[cls] ?? cls;
  if (why.kind === "act") return USE_THOUGHT.act(STATE_TEXT[why.act] ?? why.act);
  return why.kind === "holding" ? USE_THOUGHT.holding(name) : USE_THOUGHT.using(name);
}

/** 쓰는 중 지킴. */
export class UseWatch extends Part {
  /** 붙잡은 것(열쇠: id:<물건 id> 또는 cls:<종류>). */
  private readonly held = new Map<string, Hold>();
  /** 지금 보이는 사람이 나타난 때(World State since_ms). 바뀌면 다른 등장이다. */
  private presence: number | null = null;
  /** 종류마다 이 촬영 시각 뒤의 근거로만 다시 붙잡는다(쓴 사람이 떠나 푼 때). */
  private readonly after = new Map<string, number>();

  /** 지금 World State로 다시 본다: 사람이 안 보이면 모두 풀고, 쓴 사람이 떠났으면 그 붙잡음을 풀고, 손대는 행동 대상 종류마다 쓰는 것을 붙잡는다(처음 붙잡으면 상태 줄). */
  update(): void {
    const world = this.o.world();
    const p = world.person;
    if (!p.visible || p.since_ms !== this.presence) {
      this.held.clear();
      this.after.clear();
      this.presence = p.visible ? p.since_ms : null;
      if (!p.visible) return;
    }
    const now = this.clock.now();
    for (const [key, h] of this.held) {
      if (p.count >= h.people) {
        h.people = p.count;
        h.fewerAt = null;
        continue;
      }
      h.fewerAt ??= now;
      if (now - h.fewerAt <= USE_LEAVE_MS) continue;
      this.held.delete(key);
      this.after.set(h.cls, p.last_seen_ms ?? world.frame_ms ?? Number.NEGATIVE_INFINITY);
    }
    for (const cls of this.classes()) {
      const use = usingNow(world, cls, this.after.get(cls));
      if (!use) continue;
      const had = [...this.held.values()].some((h) => h.cls === cls);
      let added = false;
      for (const id of use.ids ?? [null]) {
        const key = id ? `id:${id}` : `cls:${cls}`;
        if (this.held.has(key)) continue;
        this.held.set(key, { cls, id, why: use.why, people: p.count, fewerAt: null });
        added = true;
      }
      if (added && !had && !this.core.stopped) this.o.thought?.(thoughtOf(use.why, cls), this.core.lastDecision ?? "use");
    }
  }

  /** 사람이 쓰는 중이라 붙잡은 것인가(지금 World State로 다시 보고 답한다): 그 종류 전체를 붙잡았거나, 그 물건(또는 옮김 표시로 그 물건에 이어진 물건)을
   *  붙잡았거나, 물건을 모르는 대상(후보 자리)인데 그 종류 물건을 하나라도 붙잡았다. */
  busy(t: UseTarget): boolean {
    this.update();
    if (!t.cls) return false;
    if (this.held.has(`cls:${t.cls}`)) return true;
    const ids = [...this.held.values()].filter((h) => h.cls === t.cls && h.id).map((h) => h.id!);
    if (!t.id) return ids.length > 0;
    const world = this.o.world();
    return ids.some((id) => id === t.id || followsTo(world, id, t.id!));
  }

  /** 자동으로 그쪽으로 사람을 보내도 되는가(찾기·가까이 가서 보기 공통): 지금 행동 목록의 손대는 행동 대상 종류이고 사람이 쓰는 중이 아니다. */
  mayApproach(t: UseTarget): boolean {
    return !!t.cls && this.classes().has(t.cls) && !this.busy(t);
  }

  /** 계획 대상(손대는 행동)을 사람이 쓰는 중이면 첫 명령을 미룬다: 처음 미룰 때 「사람이 쓰는 중이라 기다려요」를 남기고 떠 있던 찾기·가까이 보기를 거둔다.
   *  미룬 적이 있으면 표시해 둔다(풀린 뒤 첫 명령을 폰 대화·승인 대기 동안 미룬다). 미룬 지 holdMs가 지나면 닫는다. 미루거나 닫았으면 true. */
  waits(r: Run): boolean {
    const target = planTargetId(r.plan.view);
    if (!this.busy({ cls: touchTarget(r.decision.action), id: target ? r.alias.get(target) ?? target : null })) {
      r.usedAt = null;
      return false;
    }
    const now = this.clock.now();
    r.useHeld = true;
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

/** 물건 from이 옮김 표시(followed_by)를 따라 물건 to에 이어지는가. */
function followsTo(world: WorldView, from: string, to: string): boolean {
  let id: string | null = from;
  for (let i = 0; i < FOLLOW_MAX && id; i++) {
    id = world.objects.find((o) => o.id === id)?.followed_by ?? null;
    if (id === to) return true;
  }
  return false;
}
