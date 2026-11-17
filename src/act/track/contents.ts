// 실행 추적의 내용물 보류(ContentsHold): 실행 전 검사가 행동 조건의 내용물을 몰라(unknown_contents) 막은 계획은 실패로 닫지 않고 붙잡는다.
// 차례: 가까이 보기(불투명 컵·자리를 모르는 컵이면 건너뜀, 보기 담당이 바쁘면 lookWaitMs 뒤 건너뜀) → 사진이 이어질 settleMs → 말로 묻기(ask).
// 그사이 확인되면 실행 전 검사가 통과해 tryStart가 release하고 첫 단계로 간다. 확인된 반대 값이면 검사가 contents_mismatch로 막아 묻지 않는다.
// 컵의 내용물 세대가 바뀌면(마시기 사건·확인) 가까이 보기부터 다시 한다. 묻지 못한 채 holdMs가 지나면 그만둔다(검사 실패로 닫힘).
// 보류하는 동안 컵을 다시 보지 못해 낡아도(stale) 보류를 이어 간다(src/act/track/start.ts tryStart).
// 말 질문: 위치를 맞췄고, 판본이 맞는 폰이 있고, 끄기 안내·승인 대기·폰 대화가 없고, 컵이 보이고 손에 없고, 그 컵·세대를 묻지 않았고 답 없음 뒤 retryMs가 지났을 때만
// 지금 명령 줄에 「컵 비었어요?」를 단추 없이 소리로 묻는다(Run.asking contents, 등급 question). 단계 id에 컵·세대·물을 때마다 오르는 번호를 실어 늦은 답을 가른다.
// 말 답(onHeard)은 그 컵·세대로 World State에 넣고(answerContents, 세대가 지났으면 넣지 않음) 질문을 지운 뒤 바로 다시 검사한다.
// 답을 넣은 컵·세대는 다시 묻지 않는다. 답이 없거나 그만두면 물어봄으로 세지 않는다(답이 없으면 그 컵은 retryMs 동안 묻지 않는다).
// 계획 밖 질문(판단 전 보기 B 끝, idle): 계획이 없어도 PAM이 모르는 내용물로 대기만 하지 않게 묻는다. 묻는 때(모두): 행동 목록에 내용물 행동(want)이 있고,
// 열린·만드는 계획(코치 포함)·끄기 안내·승인 대기·폰 대화가 없고, 위치를 맞췄고, 사람이 보이고, 그 컵이 보이고 자리를 알고 치운 것·손에 든 것이 아니며 볼 면을 모르고,
// 불투명이 확인됐거나 B가 그 세대에 가까이 본 뒤 settleMs가 지났을 때. 질문 문맥은 TrackCore.idleAsk(명령 id ask:<번호>)이고 답·늦은 답·한 번·답 없음 규칙은 같다.
// 막는 것이 생기거나(계획 시작·대화·끄기 안내…) 컵이 사라지거나 세대가 바뀌거나 확인되면 질문을 지운다(계획 명령이 그 자리를 덮었으면 지우기를 보내지 않는다).
import type { PlannedCommand } from "../../contract/phone.js";
import type { Facet, WorldObject, WorldView } from "../../contract/world.js";
import type { LookSpot } from "../../observe/index.js";
import { OBJECT_NAME } from "../../world/labels.js";
import { contentsStep } from "../ask-step.js";
import { CONTENTS_TEXT, EXEC_TEXT } from "../labels.js";
import type { ActionChoice, ContentsChoice } from "../prompts.js";
import { holdsTarget, opaqueBody, putAway, sureValue, taskOf, type TaskSpec } from "../tasks.js";
import { Part, type Run } from "./core.js";

/** 보기 담당이 받기를 기다리는 시간, 가까이 본 뒤 사진을 기다리는 시간, 묻지 못할 때 보류 한도, 답이 없던 컵을 다시 묻기 전 기다리는 시간(ms). */
export const CONTENTS_HOLD = { lookWaitMs: 3000, settleMs: 4000, holdMs: 30_000, retryMs: 60_000 } as const;
/** 보류의 가까이 보기 부탁(보기 담당 src/act/look.ts contents). done은 끝날 때 한 번(못 봐도). signal은 보류가 풀리면 끊긴다. */
export interface ContentsLook { planId: string; objectId: string; spot: LookSpot; signal: AbortSignal; done(): void }
/** 보류 상태: 그 컵과 세대, 차례(over: 묻지 못한 채 holdMs가 지나 그만둠, 같은 컵·세대면 다시 붙잡지 않는다), 처음 붙잡은 때, 가까이 본 때, 끊는 신호. */
export interface Hold { objectId: string; gen: number; phase: "look" | "looking" | "settle" | "ask" | "over"; at: number; lookedAt: number; end: AbortController }

/** 내용물 보류. */
export class ContentsHold extends Part {
  /** 답을 넣은 컵·세대(「컵|세대」): 다시 묻지 않는다. */
  private readonly asked = new Set<string>();
  /** 답이 없던 컵: 이 시각 전에는 다시 묻지 않는다. */
  private readonly quietUntil = new Map<string, number>();
  /** 물을 때마다 오르는 번호(계획 안 질문·계획 밖 질문이 같이 쓴다). */
  private askSeq = 0;
  /** 판단 전 보기 B가 가까이 본 컵: 그때 세대와 시각. */
  private readonly lookedB = new Map<string, { gen: number; at: number }>();

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
    if (h.phase === "ask") this.ask(r, h);
    return true;
  }

  /** 폰 대화를 쓰는 중인가(에이전트가 들은 말을 처리하는 중이거나 끝난 지 얼마 안 됨). */
  private talking(): boolean {
    return this.o.talking?.() ?? false;
  }

  /** keep의 ask 차례: 물을 수 있으면 지금 명령 줄에 묻는다. 물을 수 없으면 그대로 기다린다(holdMs가 지나면 keep이 그만둔다). */
  private ask(r: Run, h: Hold): void {
    const core = this.core;
    const now = this.clock.now();
    const world = this.o.world();
    const o = world.objects.find((x) => x.id === h.objectId);
    if (!o || o.status !== "present" || !core.eye || !core.start.phoneOk() || core.safety.offPending() || core.safety.shownOff()
      || (this.o.approvalsWaiting?.() ?? false) || this.talking() || r.asking || r.sent || this.asked.has(`${h.objectId}|${h.gen}`)
      || now < (this.quietUntil.get(h.objectId) ?? 0) || o.facts.place?.value === "in_hand" || holdsTarget(world, o.cls, true)) return;
    const name = OBJECT_NAME[o.cls] ?? o.cls;
    Object.assign(r, { asking: { why: "contents", objectId: h.objectId, gen: h.gen }, askAt: now, spokeAt: now });
    r.sent = {
      type: "command", id: r.plan.view.id, step: contentsStep(r.plan.view.id, h.objectId, h.gen, ++this.askSeq), text: CONTENTS_TEXT.ask(name), vision: null, choices: [],
      target: o.position ? { id: o.id, label: name, position: o.position } : null, speak: true,
    };
    core.emit(r.plan.view.id, "planned", EXEC_TEXT.contentsAsked);
    core.answers.send(r.sent);
  }

  /** 말 답: 그 컵·세대로 World State에 넣는다(늦은 세대면 넣지 않음). 질문을 지우고 보류를 푼 뒤 바로 다시 검사한다. */
  answered(r: Run, picked: ActionChoice): void {
    const a = r.asking;
    if (a?.why !== "contents") return;
    if (this.o.answerContents?.(a.objectId, (picked as ContentsChoice).value, a.gen)) this.asked.add(`${a.objectId}|${a.gen}`);
    r.asking = null;
    this.core.steps.clear(r);
    this.release(r);
    r.since = this.clock.now();
    this.core.start.tryStart(r, false);
  }

  /** 떠 있는 질문이 지났는가(컵이 없음·사라짐, 세대가 바뀜, 이제 확인됨): 지났으면 질문을 지우고 true(다시 검사한다). */
  lapsed(r: Run): boolean {
    const a = r.asking;
    if (a?.why !== "contents") return false;
    const o = this.o.world().objects.find((x) => x.id === a.objectId);
    if (o && o.status !== "gone" && (o.contents_gen ?? 0) === a.gen && sureValue(o, "contents") === null) return false;
    r.asking = null;
    this.core.steps.clear(r);
    return true;
  }

  /** 판단 전 보기 B가 그 컵을 가까이 봤다(결과와 상관없이, 자원 사정으로 못 본 것은 빼고). */
  lookedIdle(objectId: string): void {
    const o = this.o.world().objects.find((x) => x.id === objectId);
    this.lookedB.set(objectId, { gen: o?.contents_gen ?? 0, at: this.clock.now() });
  }

  /** 계획 밖 질문을 하지 않을 때: 멈춤·열린 계획·만드는 계획·위치 맞추기 전·폰 없음·끄기 안내·승인 대기·폰 대화 중·사람 안 보임·목록에 내용물 행동 없음. */
  private idleBlocked(world: WorldView): boolean {
    const core = this.core;
    return core.stopped || !!core.open() || !!core.planning || !core.eye || !core.start.phoneOk() || core.safety.offPending() || !!core.safety.shownOff()
      || (this.o.approvalsWaiting?.() ?? false) || this.talking() || !world.person.visible || !this.wanting().length;
  }

  /** 행동 목록의 내용물 행동(want와 대상 종류가 있는 행동). */
  private wanting(): TaskSpec[] {
    return (this.o.tasks?.() ?? []).map((n) => taskOf(n)).filter((t): t is TaskSpec => !!t?.want && !!t.target);
  }

  /** 계획 밖으로 물을 컵: 내용물 행동의 대상 종류이고, 보이고 자리를 알며, 치운 것·손에 든 것이 아니고, 볼 면을 모르고, 이 세대에 답을 넣지 않았고 다시 묻기 대기가 아니며,
   *  불투명이 확인됐거나 B가 이 세대에 가까이 본 지 settleMs가 지났다. 여럿이면 가장 최근에 본 것. */
  private idleTarget(world: WorldView, now: number): WorldObject | null {
    const wants = this.wanting();
    const placed = this.core.steps.placed();
    const hit = world.objects.filter((o) => {
      const facets = wants.filter((t) => t.target === o.cls).flatMap((t) => Object.keys(t.want!) as Facet[]);
      if (!facets.length || o.status !== "present" || !o.position || putAway(o, placed) || o.facts.place?.value === "in_hand" || holdsTarget(world, o.cls, true)) return false;
      const gen = o.contents_gen ?? 0;
      if (!facets.some((f) => sureValue(o, f) === null) || this.asked.has(`${o.id}|${gen}`) || now < (this.quietUntil.get(o.id) ?? 0)) return false;
      const b = this.lookedB.get(o.id);
      return opaqueBody(o) || (!!b && b.gen === gen && now - b.at >= CONTENTS_HOLD.settleMs);
    });
    return hit.sort((a, b) => b.last_seen_ms - a.last_seen_ms)[0] ?? null;
  }

  /** tick: 떠 있는 계획 밖 질문은 지났거나 막히면 지우고, repeatMs마다 다시 읽고, askMs가 지나면 지운다(그 컵은 retryMs 동안 다시 묻지 않음). 없으면 물을 컵이 있을 때 묻는다. */
  idle(): void {
    const core = this.core;
    if (core.stopped) return;
    const now = this.clock.now();
    const world = this.o.world();
    const blocked = this.idleBlocked(world);
    const q = core.idleAsk;
    if (q) {
      const o = world.objects.find((x) => x.id === q.objectId);
      const lapsed = !o || o.status === "gone" || (o.contents_gen ?? 0) !== q.gen || sureValue(o, "contents") !== null;
      // 계획 명령이 그 자리를 덮었으면 지우기를 보내지 않는다
      if (lapsed || blocked) return this.dropIdle(!core.shown());
      if (now - q.askAt > this.cfg.askMs) {
        this.quietUntil.set(q.objectId, now + CONTENTS_HOLD.retryMs);
        return this.dropIdle(true);
      }
      if (now - q.spokeAt >= this.cfg.repeatMs) {
        q.spokeAt = now;
        core.answers.send({ ...q.sent, speak: true });
      }
      return;
    }
    if (blocked) return;
    const o = this.idleTarget(world, now);
    if (!o) return;
    const seq = ++this.askSeq;
    const id = `ask:${seq}`;
    const gen = o.contents_gen ?? 0;
    const name = OBJECT_NAME[o.cls] ?? o.cls;
    const sent: PlannedCommand = {
      type: "command", id, step: contentsStep(id, o.id, gen, seq), text: CONTENTS_TEXT.ask(name), vision: null, choices: [],
      target: { id: o.id, label: name, position: o.position! }, speak: true,
    };
    core.idleAsk = { id, objectId: o.id, gen, sent, askAt: now, spokeAt: now };
    core.answers.send(sent);
  }

  /** 계획 밖 질문의 말 답: 그 컵·세대로 World State에 넣고(늦은 세대면 넣지 않음) 질문을 지운다. */
  idleAnswered(picked: ActionChoice): void {
    const q = this.core.idleAsk;
    if (!q) return;
    if (this.o.answerContents?.(q.objectId, (picked as ContentsChoice).value, q.gen)) this.asked.add(`${q.objectId}|${q.gen}`);
    this.dropIdle(true);
  }

  /** 계획 밖 질문을 지운다. clear면 폰에 지우기를 보낸다. */
  dropIdle(clear: boolean): void {
    const q = this.core.idleAsk;
    this.core.idleAsk = null;
    if (q && clear) this.core.answers.send({ type: "command_clear", id: q.id });
  }

  /** 답 없이 질문 기한이 지났다: 물어봄으로 세지 않고, 그 컵은 retryMs 동안 다시 묻지 않는다. */
  noAnswer(r: Run): void {
    const a = r.asking;
    if (a?.why === "contents") this.quietUntil.set(a.objectId, this.clock.now() + CONTENTS_HOLD.retryMs);
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
