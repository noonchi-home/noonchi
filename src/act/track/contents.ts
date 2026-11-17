// 실행 추적의 내용물 보류(ContentsHold): 실행 전 검사가 행동 조건의 내용물을 몰라(unknown_contents) 막은 계획은 실패로 닫지 않고 붙잡는다.
// 사용자에게 묻지 않는다: 비전으로 모르면 폰(로봇의 몸)을 든 사람에게 가까이 가서 위에서 비춰 달라고 하고 위에서 본 사진으로 정한다.
// 차례: 잘라 보기(look, 불투명 컵·자리를 모르는 컵이면 건너뜀, 보기 담당이 바쁘면 lookWaitMs 뒤 건너뜀) → 사진이 이어질 settleMs(settle)
//   → 가까이 가서 보기(peek) → 위에서 보기(seeing) → 사진을 기다림(after) → 그만둠(over, 검사 실패로 닫힘).
// 가까이 가서 보기(peek): 지금 명령 줄에 사람 단계 명령 하나. 단추가 없고 비전으로만 넘긴다(「그만」은 계획을 그만둔다).
//   - 폰 눈과 컵 바닥 가운데의 수평 거리가 PEEK.nearM 밖이면 「컵 가까이 가 주세요」(go, near_m), 안이면 「컵 안이 보이게 위에서 비춰 주세요」(do, view above).
//   - 위에서 비추기를 보낼 때 그 컵에 보기 지킴을 걸고(guardObject, 위에서는 YOLO가 컵을 못 잡아 사라짐으로 셀 수 있음) 그 차례가 끝나면 푼다.
//   - 관찰 흐름이 위에서 비추기를 보낸 뒤 컵 안을 내려다본 VLM 프레임 쌍을 찾으면(topReady) 명령을 거두고 그 쌍으로 위에서 보기를 부탁한다(lookContents top).
//   - 막히면(위치를 맞추기 전·판본이 맞는 폰 없음·끄기 안내·승인 대기·폰 대화·승인이나 다시 묻기 질문·컵이 사라졌거나 자리를 모름·손에 있음·
//     자동 접근 조건이 아님: src/act/track/use.ts mayApproach, 손대는 행동의 대상이 아니거나 사람이 쓰는 중)
//     명령을 보내지 않고 떠 있으면 거둔다. 풀리면 새 번호의 단계 id로 다시 보낸다. 막힌 채 holdMs가 지나면 그만둔다.
//   - 컵이 옮겨지면(트윈 자리가 PEEK.movedM 넘게 바뀜·옮김 표시) 명령을 거두고 처음부터 한다. 명령마다 stepMs 안에 끝나지 않으면 그만둔다.
// 위에서 본 뒤(after) settleMs에도 모르면 그만둔다. 그 컵·세대는 retryMs 동안 다시 가까이 가지 않는다. 확인됐지만 낡았으면 holdMs 동안 다시 보이기를 기다린다.
// 그사이 확인되면 실행 전 검사가 통과해 tryStart가 release하고 첫 단계로 간다(첫 명령이 그 명령 줄을 덮는다). 확인된 반대 값이면 검사가 contents_mismatch로 막는다.
// 컵의 내용물 세대가 바뀌면(마시기 사건·확인) 잘라 보기부터 다시 한다. 앞 차례(look·looking·settle)는 붙잡은 때부터 holdMs가 지나면 차례와 상관없이
// (가까이 보기가 늦거나 멈춰도) 신호를 끊고 그만둔다. 보류하는 동안 컵을 다시 보지 못해 낡아도(stale) 보류를 이어 간다(src/act/track/start.ts tryStart).
// 계획 밖 가까이 가서 보기(idle, tick): 계획이 없어 PAM이 모르는 내용물로 대기만 하지 않게 같은 차례(peek → seeing → after)를 계획 밖 칸
//   TrackCore.idlePeek(명령 id peek:<번호>)로 돈다. 시작하는 때(모두): 열린·만드는 계획(코치 포함)·끄기 안내·승인 대기·폰 대화가 없고, 위치를 맞췄고,
//   사람이 보이고, 행동 목록에 손대는 내용물 행동(touch·want: 채우기·따르기)이 있고, 그 컵이 자동 접근 조건(mayApproach: 사람이 쓰는 중이 아님)을 지나고
//   보이고 자리를 알고 치운 것·손에 든 것이 아니고 볼 면을 모르며, 불투명이 확인됐거나
//   B가 그 세대에 잘라 본 지 settleMs가 지났고, 그 컵·세대를 retryMs 안에 보지 않았다. 도는 동안 막는 것(계획·대화·끄기 안내·승인 대기·위치·폰)이 생기면 거둔다
//   (계획 명령이 그 자리를 덮었으면 지우기를 보내지 않는다). 사람이 그 컵을 쓰기 시작해도 tick마다 보고 거둔다. 새 계획을 받으면 그 계획이 명령·보기 지킴을 쓰기 전에 거둔다(src/act/track/start.ts).
//   가까이 가기 중에는 사람이 보여야 하고, 위에서 비추기·위에서 보기·사진 기다림 동안은 안 보여도 잇는다. 「그만」은 어느 차례에서든 받는다.
//   끝나면 칸을 비운다(모르면 보기 기록만 남는다).
import type { CloserResult } from "../../contract/events.js";
import type { PlannedCommand } from "../../contract/phone.js";
import type { Facet, WorldObject, WorldView } from "../../contract/world.js";
import type { LookSpot } from "../../observe/index.js";
import { OBJECT_NAME, STATE_TEXT } from "../../world/labels.js";
import { PEEK_TEXT, VISION_TEXT } from "../labels.js";
import { opaqueBody, putAway, sureValue, taskOf, type TaskSpec } from "../tasks.js";
import { Part, type Run } from "./core.js";
import { EYE_MS, eyeNow, idleLine, phoneBlocked, planLine, refreshLine, sendLine, type Line } from "./phone-line.js";

/** 보기 담당이 받기를 기다리는 시간, 가까이 본 뒤·위에서 본 뒤 사진을 기다리는 시간, 보류 한도(앞 차례·막힘·위에서 본 뒤 다시 보기·첫 명령 미룸, ms). */
export const CONTENTS_HOLD = { lookWaitMs: 3000, settleMs: 4000, holdMs: 30_000 } as const;
/** 가까이 가서 보기: 가까이 가기가 끝나는 폰-컵 수평 거리(m, 식탁 가에 선 사람이 팔을 뻗어 폰을 컵 위에 둘 수 있는 거리), 명령마다 한도(ms),
 *  같은 컵·세대를 다시 가까이 가기 전 기다림(ms), 옮겨짐으로 보는 자리 바뀜(m), 맞춘 눈이 이만큼(ms) 안 오면 지금 위치를 모른다(폰 자세는 초당 10번). */
export const PEEK = { nearM: 0.5, stepMs: 30_000, retryMs: 60_000, movedM: 0.1, eyeMs: EYE_MS } as const;
/** 보류의 가까이 보기 부탁(보기 담당 src/act/look.ts contents). done은 끝날 때 한 번(못 봐도, 가까이 보기 결과, 끊겼으면 null). signal은 보류가 풀리면 끊긴다.
 *  top이 있으면 잘라 보기 대신 위에서 보기(그 뒤 찍힌 컵 안을 내려다본 사진 쌍, src/observe/pipeline.ts topLook)다. planId가 빈 글이면 계획 밖이다.
 *  force면 찾기의 다시 보기다(src/act/track/find.ts): 같은 물건을 objectGapMs 안에 봤어도 다시 본다. */
/** since: 찾기의 비추기 시각(그 뒤 사진만 가까이 본다, 1장이면 된다). */
export interface ContentsLook { planId: string; objectId: string; spot: LookSpot; signal: AbortSignal; done(result?: CloserResult | null): void; top?: { sinceMs: number }; force?: true; since?: number }
type V3 = [number, number, number];
/** 가까이 가서 보기 한 차례: 지금 명령(go·above, 거뒀으면 null)과 보낸 때, 시작 때 컵 자리, 위에서 비추기를 보낸 때(위에서 보기 sinceMs), 보기 지킴을 걸었는가. */
export interface Peek { part: "go" | "above" | null; sent: PlannedCommand | null; since: number; at: V3; aboveAt: number; guarded: boolean }
/** 보류 상태: 그 컵과 세대, 차례(over: 그만둠, 같은 컵·세대면 다시 붙잡지 않는다), 처음 붙잡은 때, 잘라 본 때, 끊는 신호, 가까이 가서 보기,
 *  명령 없이 기다리기 시작한 때(막힘 한도), 위에서 보기를 시작한 때·부탁을 받았는가, 위에서 본 때, 가까이 가서 보라는 명령을 보낸 적 있는가. */
export interface Hold {
  objectId: string; gen: number; phase: "look" | "looking" | "settle" | "peek" | "seeing" | "after" | "over"; at: number; lookedAt: number; end: AbortController;
  peek: Peek | null; waitFrom: number; seeingAt: number; lookAsked: boolean; afterAt: number; tried: boolean;
  /** 검사가 다른 까닭(들고 있음 등)으로 막아 멈춘 때(pause). 다시 이어지면 null. */
  pausedAt: number | null;
}
/** 계획 밖 가까이 가서 보기 칸: 명령 id(peek:<번호>), 그 보류 상태, 떠 있는 명령, 읽은 때·비전 줄을 보낸 때. */
export interface IdlePeek { id: string; hold: Hold; sent: PlannedCommand | null; spokeAt: number; visionAt: number }

const dist3 = (a: readonly number[], b: readonly number[]) => Math.hypot(a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!);
/** 가까이 가서 보기 명령의 단계 id(그 명령 id 뒤, 컵·세대·차례·번호). */
const peekStep = (id: string, objectId: string, gen: number, part: "go" | "above", seq: number) => `${id}:peek:${objectId}:${gen}:${part}:${seq}`;
/** 컵 바닥 가운데(잰 것이 없으면 자리). */
const centerOf = (o: WorldObject): V3 => o.size_m?.center ?? o.position!;
const newHold = (objectId: string, gen: number, at: number, phase: Hold["phase"]): Hold => ({
  objectId, gen, phase, at, lookedAt: at, end: new AbortController(), peek: null, waitFrom: at, seeingAt: 0, lookAsked: false, afterAt: 0, tried: false, pausedAt: null,
});

/** 내용물 보류. */
export class ContentsHold extends Part {
  /** 가까이 가서 보라는 명령마다 오르는 번호(늦게 온 말·화면이 앞 명령을 가리키지 않게). */
  private seq = 0;
  /** 계획 밖 가까이 가서 보기마다 오르는 번호(명령 id peek:<번호>). */
  private idleSeq = 0;
  /** 가까이 가서 본 컵: 그때 세대와 그만둔 시각(retryMs 동안 같은 세대면 다시 가까이 가지 않는다). */
  private readonly peeked = new Map<string, { gen: number; at: number }>();
  /** 판단 전 보기 B가 잘라 본 컵: 그때 세대와 시각. */
  private readonly lookedB = new Map<string, { gen: number; at: number }>();

  /** 실행 전 검사가 내용물을 몰라(unknown_contents) 또는 보류 중 컵이 낡아(stale) 막았다: 보류를 한 걸음 진행한다.
   *  아직 붙잡고 있으면 true, 그만두면 false(검사 실패로 닫힌다). */
  keep(r: Run, objectId: string, reason: "unknown_contents" | "stale" = "unknown_contents"): boolean {
    const now = this.clock.now();
    const world = this.o.world();
    const o = world.objects.find((x) => x.id === objectId);
    const gen = o?.contents_gen ?? 0;
    const line = planLine(this.core, r);
    let h = r.hold;
    if (h?.phase === "over" && h.objectId === objectId && h.gen === gen) return false;
    // 확인으로 오른 세대(위에서 본 값·사진이 확인함): 처음부터 세지 않는다. 위에서 보는 중이면 그대로, 낡아 막혔으면 다시 보이기를 기다린다(after)
    if (h && h.phase !== "over" && h.objectId === objectId && h.gen !== gen && o && sureValue(o, "contents") !== null
      && (h.phase === "seeing" || h.phase === "after" || reason === "stale")) {
      h.gen = gen;
      if (h.phase !== "seeing" && h.phase !== "after") {
        this.withdraw(line, h);
        Object.assign(h, { phase: "after", afterAt: now });
      }
    }
    if (!h || h.objectId !== objectId || h.gen !== gen) {
      if (h) this.stopHold(line, h);
      // 같은 컵이면 처음 붙잡은 때를 둔다(사건이 이어져도 holdMs 안에서 끝난다)
      h = r.hold = newHold(objectId, gen, h?.objectId === objectId ? h.at : now, "look");
      h.lookedAt = now;
      r.heldIds.add(objectId);
    }
    h.pausedAt = null;
    if ((h.phase === "look" || h.phase === "looking" || h.phase === "settle") && now - h.at > CONTENTS_HOLD.holdMs) return this.over(line, h);
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
      if (h.phase === "look" && (skip || now - h.at >= CONTENTS_HOLD.lookWaitMs)) {
        h.lookedAt = now;
        h.phase = o && opaqueBody(o) ? "peek" : "settle";
      }
    }
    if (h.phase === "settle" && now - h.lookedAt >= CONTENTS_HOLD.settleMs) h.phase = "peek";
    if (h.phase === "after") {
      // 확인됐지만 낡았으면 사람이 폰을 내려 컵이 다시 보이기를 holdMs 기다린다. 모르면 settleMs 뒤 그만둔다
      const wait = reason === "stale" ? CONTENTS_HOLD.holdMs : CONTENTS_HOLD.settleMs;
      return now - h.afterAt <= wait ? true : this.over(line, h);
    }
    return this.advance(line, h, o, now, !!r.asking);
  }

  /** peek·seeing 차례 한 걸음(계획·계획 밖 같은 길). asking: 계획에 승인·다시 묻기 질문이 떠 있다(막음). 그만두면 false. */
  private advance(line: Line, h: Hold, o: WorldObject | undefined, now: number, asking: boolean): boolean {
    if (h.phase === "peek") return this.peekStep(line, h, o, now, asking);
    if (h.phase === "seeing") {
      if (now - h.seeingAt > PEEK.stepMs) return this.over(line, h);
      if (!h.lookAsked && o?.position) this.lookTop(line, h, o);
    }
    return true;
  }

  /** peek 차례 한 걸음(tick마다). */
  private peekStep(line: Line, h: Hold, o: WorldObject | undefined, now: number, asking: boolean): boolean {
    const recent = this.peeked.get(h.objectId);
    if (!h.tried && recent && recent.gen === h.gen && now - recent.at < PEEK.retryMs) return this.over(line, h);
    const core = this.core;
    const world = this.o.world();
    // 컵이 옮겨졌다(자리 바뀜): 거두고 처음부터. 옮김 표시가 남아 있으면 새 대상이 정해질 때까지 막힘으로 둔다(같은 옛 컵으로 다시 보내지 않는다)
    if (h.peek && o?.position && !o.followed_by && dist3(o.position, h.peek.at) > PEEK.movedM) {
      this.withdraw(line, h);
      h.peek = null;
      h.waitFrom = now;
    }
    const eye = eyeNow(core, now);
    const blocked = !o || o.status === "gone" || !o.position || !!o.followed_by || phoneBlocked(core, now, asking)
      || o.facts.place?.value === "in_hand" || !core.use.mayApproach({ cls: o.cls, id: o.id });
    if (blocked) {
      if (h.peek?.sent) {
        this.withdraw(line, h);
        h.waitFrom = now;
      }
      return now - h.waitFrom > CONTENTS_HOLD.holdMs ? this.over(line, h) : true;
    }
    const pk = (h.peek ??= { part: null, sent: null, since: now, at: o.position!, aboveAt: 0, guarded: false });
    const c = centerOf(o);
    const d = Math.hypot(eye!.position[0] - c[0], eye!.position[1] - c[2]);
    if (!pk.sent) return this.send(line, h, o, d <= PEEK.nearM ? "above" : "go", d, now);
    if (pk.part === "go" && d <= PEEK.nearM) return this.send(line, h, o, "above", d, now);
    if (now - pk.since > PEEK.stepMs) return this.over(line, h);
    if (pk.part === "above" && this.o.topReady?.(o.id, pk.aboveAt)) {
      // 위에서 본 사진 쌍이 모였다: 명령을 거두고(보기 지킴은 위에서 보기가 끝날 때 푼다) 위에서 보기를 부탁한다
      this.withdraw(line, h, false);
      Object.assign(h, { phase: "seeing", seeingAt: now, lookAsked: false });
      this.lookTop(line, h, o);
      return true;
    }
    // 비전 줄이 바뀌면 visionMs에 한 번까지 보내고, repeatMs마다 소리로 다시 읽는다
    pk.sent = refreshLine(core, line, pk.sent, this.vision(pk.part!, o, d), now);
    return true;
  }

  /** 가까이 가서 보라는 명령 하나를 그 명령 줄로 보낸다(새 번호, 소리로 읽기). 위에서 비추기면 보기 지킴을 건다. */
  private send(line: Line, h: Hold, o: WorldObject, part: "go" | "above", d: number, now: number): boolean {
    const pk = h.peek!;
    const name = OBJECT_NAME[o.cls] ?? o.cls;
    const sent: PlannedCommand = {
      type: "command", id: line.id, step: peekStep(line.id, o.id, h.gen, part, ++this.seq), text: PEEK_TEXT[part](name), vision: this.vision(part, o, d), choices: [],
      target: { id: o.id, label: name, position: centerOf(o) }, speak: true, kind: part === "go" ? "go" : "do", ...(part === "go" ? { near_m: PEEK.nearM } : { view: "above" as const }),
    };
    Object.assign(pk, { part, sent, since: now });
    if (part === "above") {
      pk.aboveAt = now;
      if (!pk.guarded) {
        pk.guarded = true;
        this.o.guardObject?.(o.id, true);
      }
    }
    h.tried = true;
    sendLine(line, sent, now);
    return true;
  }

  /** 비전 상태 한 줄: go는 컵까지 거리, above는 컵 안의 지금 값. */
  private vision(part: "go" | "above", o: WorldObject, d: number): string {
    const name = OBJECT_NAME[o.cls] ?? o.cls;
    if (part === "go") return VISION_TEXT.distance(name, d);
    const v = o.facts.contents?.value;
    return v ? `${name} · ${STATE_TEXT[v] ?? v}` : name;
  }

  /** 위에서 보기 부탁(받으면 lookAsked). 끝나면(done) after로 가고 보기 지킴을 푼다. 보기 담당이 없으면 바로 after. */
  private lookTop(line: Line, h: Hold, o: WorldObject): void {
    const finish = () => {
      if (h.phase !== "seeing") return;
      Object.assign(h, { phase: "after", afterAt: this.clock.now() });
      this.unguard(h);
    };
    if (!this.o.lookContents) return finish();
    const took = this.o.lookContents({
      planId: line.planId, objectId: o.id, spot: { id: o.id, label: OBJECT_NAME[o.cls] ?? o.cls, position: centerOf(o) }, signal: h.end.signal,
      top: { sinceMs: h.peek?.aboveAt ?? h.seeingAt }, done: finish,
    });
    if (took) h.lookAsked = true;
  }

  /** 떠 있는 가까이 가서 보라는 명령을 거둔다(그 줄에 떠 있을 때만 지운다). unguard면 보기 지킴도 푼다. */
  private withdraw(line: Line, h: Hold, unguard = true): void {
    const pk = h.peek;
    if (pk?.sent && line.shown()?.step === pk.sent.step) line.clear();
    if (pk) {
      pk.sent = null;
      pk.part = null;
    }
    if (unguard) this.unguard(h);
  }

  private unguard(h: Hold): void {
    const pk = h.peek;
    if (!pk?.guarded) return;
    pk.guarded = false;
    this.o.guardObject?.(h.objectId, false);
  }

  /** 그만둔다: 명령을 거두고 보기 지킴을 풀고 부탁을 끊는다. 가까이 가서 보라고 한 적이 있으면 그 컵·세대를 retryMs 동안 다시 가지 않는다. 늘 false. */
  private over(line: Line, h: Hold): boolean {
    this.stopHold(line, h);
    if (h.tried) this.peeked.set(h.objectId, { gen: h.gen, at: this.clock.now() });
    h.phase = "over";
    return false;
  }

  /** 명령을 거두고 보기 지킴을 풀고 부탁을 끊는다. */
  private stopHold(line: Line, h: Hold): void {
    this.withdraw(line, h);
    h.end.abort();
  }

  /** 보류 중 검사가 다른 까닭(들고 있음·없음·치움)으로 막았다: 명령·보기 지킴을 거두고 멈춘 때부터 holdMs를 센다. 아직이면 true, 지나면 그만두고 false. */
  pause(r: Run): boolean {
    const h = r.hold;
    if (!h || h.phase === "over") return false;
    const now = this.clock.now();
    const line = planLine(this.core, r);
    if (h.pausedAt === null) {
      h.pausedAt = now;
      this.withdraw(line, h);
    }
    return now - h.pausedAt > CONTENTS_HOLD.holdMs ? this.over(line, h) : true;
  }

  /** 가까이 보는 차례인가(계획의 보류·계획 밖 칸): 잘라 보기, 위에서 비추기, 위에서 보기, 위에서 본 뒤 사진 기다림. 가까이 가기·멈춘 보류(pause)는 아니다. */
  looking(): boolean {
    const r = this.core.open();
    return [r?.hold, this.core.idlePeek?.hold].some((h) => !!h && h.pausedAt === null && (h.phase === "look" || h.phase === "looking" || h.phase === "seeing" || h.phase === "after"
      || (h.phase === "peek" && h.peek?.part === "above")));
  }

  /** 붙잡고 있는가(그만두지 않은 보류). */
  holding(r: Run): boolean {
    return !!r.hold && r.hold.phase !== "over";
  }

  /** 보류를 푼다(검사 통과·계획 닫힘): 보기 지킴을 풀고 가까이 보기를 끊는다. 떠 있는 명령은 다음 명령이 덮거나 닫을 때 지운다. */
  release(r: Run): void {
    const h = r.hold;
    if (h) {
      this.unguard(h);
      h.end.abort();
    }
    r.hold = null;
  }

  /** 지금 명령 줄이 가까이 가서 보라는 명령이면 지운다(보류에서 풀린 첫 명령을 미룰 때). */
  clearPeek(r: Run): void {
    if (r.sent?.step.includes(":peek:")) this.core.steps.clear(r);
  }

  /** 판단 전 보기 B가 그 컵을 잘라 봤다(결과와 상관없이, 자원 사정으로 못 본 것은 빼고). */
  lookedIdle(objectId: string): void {
    const o = this.o.world().objects.find((x) => x.id === objectId);
    this.lookedB.set(objectId, { gen: o?.contents_gen ?? 0, at: this.clock.now() });
  }

  /** 계획 밖 가까이 가서 보기를 이어 가지 않을 때: 멈춤·열린 계획·만드는 계획·계획 전 찾기 중·위치 맞추기 전·폰 없음·끄기 안내·승인 대기·폰 대화 중. */
  private idleBlocked(): boolean {
    const core = this.core;
    return core.stopped || !!core.open() || !!core.planning || !!core.finding || !!core.docking || phoneBlocked(core, this.clock.now(), false);
  }

  /** 행동 목록의 손대는 내용물 행동(touch·want와 대상 종류가 있는 행동: 채우기·따르기. 그대로 두기는 손대지 않아 아니다). */
  private wanting(): TaskSpec[] {
    return (this.o.tasks?.() ?? []).map((n) => taskOf(n)).filter((t): t is TaskSpec => !!t?.want && !!t.target && !!t.touch);
  }

  /** 계획 밖으로 가까이 가서 볼 컵: 내용물 행동의 대상 종류이고, 보이고 자리를 알며, 치운 것·손에 든 것이 아니고, 볼 면을 모르고,
   *  그 세대를 retryMs 안에 보지 않았고, 불투명이 확인됐거나 B가 이 세대에 잘라 본 지 settleMs가 지났다. 여럿이면 가장 최근에 본 것. */
  private idleTarget(world: WorldView, now: number): WorldObject | null {
    const wants = this.wanting();
    const placed = this.core.steps.placed();
    const hit = world.objects.filter((o) => {
      const facets = wants.filter((t) => t.target === o.cls).flatMap((t) => Object.keys(t.want!) as Facet[]);
      if (!facets.length || o.status !== "present" || !o.position || putAway(o, placed) || o.facts.place?.value === "in_hand" || !this.core.use.mayApproach({ cls: o.cls, id: o.id })) return false;
      const gen = o.contents_gen ?? 0;
      if (!facets.some((f) => sureValue(o, f) === null)) return false;
      const recent = this.peeked.get(o.id);
      if (recent && recent.gen === gen && now - recent.at < PEEK.retryMs) return false;
      const b = this.lookedB.get(o.id);
      return opaqueBody(o) || (!!b && b.gen === gen && now - b.at >= CONTENTS_HOLD.settleMs);
    });
    return hit.sort((a, b) => b.last_seen_ms - a.last_seen_ms)[0] ?? null;
  }

  /** tick: 계획 밖 가까이 가서 보기. 떠 있으면 컵이 사라지거나 세대가 바뀌거나 확인되거나 막히면 거두고, 아니면 한 걸음 진행한다.
   *  위에서 본 뒤 settleMs에도 모르면 그만둔다(그 컵·세대는 retryMs 동안 다시 가지 않는다). 비어 있으면 볼 컵이 있을 때 시작한다. */
  idle(): void {
    const core = this.core;
    if (core.stopped) return;
    const now = this.clock.now();
    const world = this.o.world();
    const blocked = this.idleBlocked();
    const q = core.idlePeek;
    if (q) {
      const h = q.hold;
      const o = world.objects.find((x) => x.id === h.objectId);
      const lapsed = !o || o.status === "gone" || (o.contents_gen ?? 0) !== h.gen || sureValue(o, "contents") !== null;
      // 사람이 안 보여도 되는 것은 위에서 비추기·위에서 보기·사진 기다림뿐이다(폰이 컵을 내려다봐 사람이 안 찍힌다). 가까이 가기 중에는 사람이 보여야 한다
      const away = !world.person.visible && h.phase === "peek" && h.peek?.part !== "above";
      // 사람이 그 컵을 쓰기 시작하면(use.ts) 어느 차례든 거둔다
      if (lapsed || blocked || away || !core.use.mayApproach({ cls: o!.cls, id: o!.id })) return this.dropIdle();
      const line = idleLine(this.core, q);
      const going = h.phase === "after" ? now - h.afterAt <= CONTENTS_HOLD.settleMs || this.over(line, h) : this.advance(line, h, o, now, false);
      if (!going) core.idlePeek = null;
      return;
    }
    if (blocked || !world.person.visible || !this.wanting().length) return;
    const o = this.idleTarget(world, now);
    if (!o) return;
    const hold = newHold(o.id, o.contents_gen ?? 0, now, "peek");
    const fresh: IdlePeek = { id: `peek:${++this.idleSeq}`, hold, sent: null, spokeAt: now, visionAt: now };
    core.idlePeek = fresh;
    if (!this.advance(idleLine(this.core, fresh), hold, o, now, false)) core.idlePeek = null;
  }

  /** 계획 밖 가까이 가서 보기를 거둔다(떠 있으면 지우기, 계획 명령이 덮었으면 보내지 않음, 보기 지킴 풂, 부탁 끊음). */
  dropIdle(): void {
    const q = this.core.idlePeek;
    this.core.idlePeek = null;
    if (q) this.stopHold(idleLine(this.core, q), q.hold);
  }

  /** 계획 밖 가까이 가서 보기의 「그만」: 거두고 그 컵은 retryMs 동안 다시 보내지 않는다. */
  stopIdle(): void {
    const q = this.core.idlePeek;
    this.core.idlePeek = null;
    if (q) {
      q.hold.tried = true;
      this.over(idleLine(this.core, q), q.hold);
    }
  }
}
