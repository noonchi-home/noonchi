// 실행 추적의 내용물 보류(ContentsHold): 실행 전 검사가 행동 조건의 내용물을 몰라(contents_unknown) 막은 계획은 실패로 닫지 않고 붙잡는다.
// 차례: 가까이 보기(불투명 컵·자리를 모르는 컵이면 건너뜀, 보기 담당이 바쁘면 lookWaitMs 뒤 건너뜀) → 사진이 이어질 settleMs → 말로 묻기(ask).
// 그사이 확인되면 실행 전 검사가 통과해 tryStart가 release하고 첫 단계로 간다. 확인된 반대 값이면 검사가 contents_mismatch로 막아 묻지 않는다.
// 컵의 내용물 세대가 바뀌면(마시기 사건·확인) 가까이 보기부터 다시 한다. 묻지 못한 채 holdMs가 지나면 그만둔다(검사 실패로 닫힘).
// 보류하는 동안 컵을 다시 보지 못해 낡아도(stale) 보류를 이어 간다(src/act/track/start.ts tryStart).
import type { LookSpot } from "../../observe/index.js";
import { OBJECT_NAME } from "../../world/labels.js";
import { opaqueBody } from "../tasks.js";
import { Part, type Run } from "./core.js";

/** 보기 담당이 받기를 기다리는 시간, 가까이 본 뒤 사진을 기다리는 시간, 묻지 못할 때 보류 한도, 답이 없던 컵을 다시 묻기 전 기다리는 시간(ms). */
export const CONTENTS_HOLD = { lookWaitMs: 3000, settleMs: 4000, holdMs: 30_000, retryMs: 60_000 } as const;
/** 보류의 가까이 보기 부탁(보기 담당 src/act/look.ts contents). done은 끝날 때 한 번(못 봐도). signal은 보류가 풀리면 끊긴다. */
export interface ContentsLook { planId: string; objectId: string; spot: LookSpot; signal: AbortSignal; done(): void }
/** 보류 상태: 그 컵과 세대, 차례(over: 묻지 못한 채 holdMs가 지나 그만둠, 같은 컵·세대면 다시 붙잡지 않는다), 처음 붙잡은 때, 가까이 본 때, 끊는 신호. */
export interface Hold { objectId: string; gen: number; phase: "look" | "looking" | "settle" | "ask" | "over"; at: number; lookedAt: number; end: AbortController }

/** 내용물 보류. */
export class ContentsHold extends Part {
  /** 실행 전 검사가 내용물을 몰라 막았다: 보류를 한 걸음 진행한다. 아직 붙잡고 있으면 true, 그만두면 false(검사 실패로 닫힌다). */
  keep(r: Run, objectId: string): boolean {
    const now = this.clock.now();
    const o = this.o.world().objects.find((x) => x.id === objectId);
    const gen = o?.contents_gen ?? 0;
    let h = r.hold;
    if (h?.phase === "over" && h.objectId === objectId && h.gen === gen) return false;
    if (!h || h.objectId !== objectId || h.gen !== gen) {
      h?.end.abort();
      // 같은 컵이면 처음 붙잡은 때를 둔다(사건이 이어져도 holdMs 안에서 끝난다)
      h = r.hold = { objectId, gen, phase: "look", at: h?.objectId === objectId ? h.at : now, lookedAt: now, end: new AbortController() };
    }
    if (h.phase !== "looking" && now - h.at > CONTENTS_HOLD.holdMs) {
      h.end.abort();
      h.phase = "over";
      return false;
    }
    if (h.phase === "look") {
      const skip = !o?.position || opaqueBody(o) || !this.o.lookContents;
      const hold = h;
      if (!skip) {
        // 보기 담당이 받자마자 done을 부를 수 있으니 먼저 looking으로 둔다
        h.phase = "looking";
        const took = this.o.lookContents!({
          planId: r.plan.view.id, objectId, spot: { id: objectId, label: OBJECT_NAME[o!.cls] ?? o!.cls, position: o!.position! }, signal: h.end.signal,
          done: () => { if (r.hold === hold && hold.phase === "looking") Object.assign(hold, { phase: "settle", lookedAt: this.clock.now() }); },
        });
        if (!took) h.phase = "look";
      }
      if (h.phase === "look" && (skip || now - h.at >= CONTENTS_HOLD.lookWaitMs)) Object.assign(h, { phase: o && opaqueBody(o) ? "ask" : "settle", lookedAt: now });
    }
    if (h.phase === "settle" && now - h.lookedAt >= CONTENTS_HOLD.settleMs) h.phase = "ask";
    return true;
  }

  /** 붙잡고 있는가(그만두지 않은 보류). */
  holding(r: Run): boolean {
    return !!r.hold && r.hold.phase !== "over";
  }

  /** 보류를 푼다(검사 통과·계획 닫힘): 가까이 보기를 끊는다. */
  release(r: Run): void {
    r.hold?.end.abort();
    r.hold = null;
  }
}
