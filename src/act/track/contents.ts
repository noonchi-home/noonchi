// 실행 추적의 내용물 보류(ContentsHold): 실행 전 검사가 행동 조건의 내용물을 몰라(unknown_contents) 막은 계획은 실패로 닫지 않고 붙잡는다.
// 사용자에게 묻지 않는다: 비전으로 모르면 폰(로봇의 몸)을 든 사람에게 가까이 가서 위에서 비춰 달라고 하고 위에서 본 사진으로 정한다.
// 차례: 잘라 보기(look, 불투명 컵·자리를 모르는 컵이면 건너뜀, 보기 담당이 바쁘면 lookWaitMs 뒤 건너뜀) → 사진이 이어질 settleMs(settle)
//   → 가까이 가서 보기(peek) → 위에서 보기(seeing) → 사진을 기다림(after) → 그만둠(over, 검사 실패로 닫힘).
// 가까이 가서 보기(peek): 지금 명령 줄(r.sent)에 사람 단계 명령 하나. 단추가 없고 비전으로만 넘긴다(「그만」은 계획을 그만둔다).
//   - 폰 눈과 컵 바닥 가운데의 수평 거리가 PEEK.nearM 밖이면 「컵 가까이 가 주세요」(go, near_m), 안이면 「컵 안이 보이게 위에서 비춰 주세요」(do, view above).
//   - 위에서 비추기를 보낼 때 그 컵에 보기 지킴을 걸고(guardObject, 위에서는 YOLO가 컵을 못 잡아 사라짐으로 셀 수 있음) 그 차례가 끝나면 푼다.
//   - 관찰 흐름이 위에서 비추기를 보낸 뒤 컵 안을 내려다본 VLM 프레임 쌍을 찾으면(topReady) 명령을 거두고 그 쌍으로 위에서 보기를 부탁한다(lookContents top).
//   - 막히면(위치를 맞추기 전·판본이 맞는 폰 없음·끄기 안내·승인 대기·폰 대화·승인이나 다시 묻기 질문·컵이 사라졌거나 자리를 모름·손에 있음·사람이 그 종류를 듦)
//     명령을 보내지 않고 떠 있으면 거둔다. 풀리면 새 번호의 단계 id로 다시 보낸다. 막힌 채 holdMs가 지나면 그만둔다.
//   - 컵이 옮겨지면(트윈 자리가 PEEK.movedM 넘게 바뀜·옮김 표시) 명령을 거두고 처음부터 한다. 명령마다 stepMs 안에 끝나지 않으면 그만둔다.
// 위에서 본 뒤(after) settleMs에도 모르면 그만둔다. 그 컵·세대는 retryMs 동안 다시 가까이 가지 않는다. 확인됐지만 낡았으면 holdMs 동안 다시 보이기를 기다린다.
// 그사이 확인되면 실행 전 검사가 통과해 tryStart가 release하고 첫 단계로 간다(첫 명령이 그 명령 줄을 덮는다). 확인된 반대 값이면 검사가 contents_mismatch로 막는다.
// 컵의 내용물 세대가 바뀌면(마시기 사건·확인) 잘라 보기부터 다시 한다. 앞 차례(look·looking·settle)는 붙잡은 때부터 holdMs가 지나면 차례와 상관없이
// (가까이 보기가 늦거나 멈춰도) 신호를 끊고 그만둔다. 보류하는 동안 컵을 다시 보지 못해 낡아도(stale) 보류를 이어 간다(src/act/track/start.ts tryStart).
import type { PlannedCommand } from "../../contract/phone.js";
import type { WorldObject } from "../../contract/world.js";
import type { LookSpot } from "../../observe/index.js";
import { OBJECT_NAME, STATE_TEXT } from "../../world/labels.js";
import { PEEK_TEXT, VISION_TEXT } from "../labels.js";
import { holdsTarget, opaqueBody } from "../tasks.js";
import { Part, type Run } from "./core.js";

/** 보기 담당이 받기를 기다리는 시간, 가까이 본 뒤·위에서 본 뒤 사진을 기다리는 시간, 보류 한도(앞 차례·막힘·위에서 본 뒤 다시 보기·첫 명령 미룸, ms). */
export const CONTENTS_HOLD = { lookWaitMs: 3000, settleMs: 4000, holdMs: 30_000 } as const;
/** 가까이 가서 보기: 가까이 가기가 끝나는 폰-컵 수평 거리(m, 식탁 가에 선 사람이 팔을 뻗어 폰을 컵 위에 둘 수 있는 거리), 명령마다 한도(ms),
 *  같은 컵·세대를 다시 가까이 가기 전 기다림(ms), 옮겨짐으로 보는 자리 바뀜(m). */
export const PEEK = { nearM: 0.5, stepMs: 30_000, retryMs: 60_000, movedM: 0.1 } as const;
/** 보류의 가까이 보기 부탁(보기 담당 src/act/look.ts contents). done은 끝날 때 한 번(못 봐도). signal은 보류가 풀리면 끊긴다.
 *  top이 있으면 잘라 보기 대신 위에서 보기(그 뒤 찍힌 컵 안을 내려다본 사진 쌍, src/observe/pipeline.ts topLook)다. */
export interface ContentsLook { planId: string; objectId: string; spot: LookSpot; signal: AbortSignal; done(): void; top?: { sinceMs: number } }
type V3 = [number, number, number];
/** 가까이 가서 보기 한 차례: 지금 명령(go·above, 거뒀으면 null)과 보낸 때, 시작 때 컵 자리, 위에서 비추기를 보낸 때(위에서 보기 sinceMs), 보기 지킴을 걸었는가. */
export interface Peek { part: "go" | "above" | null; sent: PlannedCommand | null; since: number; at: V3; aboveAt: number; guarded: boolean }
/** 보류 상태: 그 컵과 세대, 차례(over: 그만둠, 같은 컵·세대면 다시 붙잡지 않는다), 처음 붙잡은 때, 잘라 본 때, 끊는 신호, 가까이 가서 보기,
 *  명령 없이 기다리기 시작한 때(막힘 한도), 위에서 보기를 시작한 때·부탁을 받았는가, 위에서 본 때, 가까이 가서 보라는 명령을 보낸 적 있는가. */
export interface Hold {
  objectId: string; gen: number; phase: "look" | "looking" | "settle" | "peek" | "seeing" | "after" | "over"; at: number; lookedAt: number; end: AbortController;
  peek: Peek | null; waitFrom: number; seeingAt: number; lookAsked: boolean; afterAt: number; tried: boolean;
}

const dist3 = (a: readonly number[], b: readonly number[]) => Math.hypot(a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!);
/** 가까이 가서 보기 명령의 단계 id(그 계획 id 뒤, 컵·세대·차례·번호). */
const peekStep = (id: string, objectId: string, gen: number, part: "go" | "above", seq: number) => `${id}:peek:${objectId}:${gen}:${part}:${seq}`;
/** 컵 바닥 가운데(잰 것이 없으면 자리). */
const centerOf = (o: WorldObject): V3 => o.size_m?.center ?? o.position!;

/** 내용물 보류. */
export class ContentsHold extends Part {
  /** 가까이 가서 보라는 명령마다 오르는 번호(늦게 온 말·화면이 앞 명령을 가리키지 않게). */
  private seq = 0;
  /** 가까이 가서 본 컵: 그때 세대와 그만둔 시각(retryMs 동안 같은 세대면 다시 가까이 가지 않는다). */
  private readonly peeked = new Map<string, { gen: number; at: number }>();

  /** 실행 전 검사가 내용물을 몰라(unknown_contents) 또는 보류 중 컵이 낡아(stale) 막았다: 보류를 한 걸음 진행한다.
   *  아직 붙잡고 있으면 true, 그만두면 false(검사 실패로 닫힌다). */
  keep(r: Run, objectId: string, reason: "unknown_contents" | "stale" = "unknown_contents"): boolean {
    const now = this.clock.now();
    const world = this.o.world();
    const o = world.objects.find((x) => x.id === objectId);
    const gen = o?.contents_gen ?? 0;
    let h = r.hold;
    if (h?.phase === "over" && h.objectId === objectId && h.gen === gen) return false;
    if (!h || h.objectId !== objectId || h.gen !== gen) {
      if (h) this.drop(r, h);
      // 같은 컵이면 처음 붙잡은 때를 둔다(사건이 이어져도 holdMs 안에서 끝난다)
      const at = h?.objectId === objectId ? h.at : now;
      h = r.hold = {
        objectId, gen, phase: "look", at, lookedAt: now, end: new AbortController(), peek: null, waitFrom: at, seeingAt: 0, lookAsked: false, afterAt: 0, tried: false,
      };
      r.held = true;
    }
    if ((h.phase === "look" || h.phase === "looking" || h.phase === "settle") && now - h.at > CONTENTS_HOLD.holdMs) return this.over(r, h);
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
    if (h.phase === "peek") return this.peekStep(r, h, o, now);
    if (h.phase === "seeing") {
      if (now - h.seeingAt > PEEK.stepMs) return this.over(r, h);
      if (!h.lookAsked && o?.position) this.lookTop(r, h, o);
      return true;
    }
    if (h.phase === "after") {
      // 확인됐지만 낡았으면 사람이 폰을 내려 컵이 다시 보이기를 holdMs 기다린다. 모르면 settleMs 뒤 그만둔다
      const wait = reason === "stale" ? CONTENTS_HOLD.holdMs : CONTENTS_HOLD.settleMs;
      return now - h.afterAt <= wait ? true : this.over(r, h);
    }
    return true;
  }

  /** peek 차례 한 걸음(tick마다). */
  private peekStep(r: Run, h: Hold, o: WorldObject | undefined, now: number): boolean {
    const recent = this.peeked.get(h.objectId);
    if (!h.tried && recent && recent.gen === h.gen && now - recent.at < PEEK.retryMs) return this.over(r, h);
    const core = this.core;
    const world = this.o.world();
    // 컵이 옮겨졌다(자리 바뀜·옮김 표시): 거두고 처음부터
    if (h.peek && o?.position && (o.followed_by || dist3(o.position, h.peek.at) > PEEK.movedM)) {
      this.withdraw(r, h);
      h.peek = null;
      h.waitFrom = now;
    }
    const blocked = !o || o.status === "gone" || !o.position || !core.eye || !core.start.phoneOk() || core.safety.offPending() || !!core.safety.shownOff()
      || (this.o.approvalsWaiting?.() ?? false) || (this.o.talking?.() ?? false) || !!r.asking
      || o.facts.place?.value === "in_hand" || holdsTarget(world, o.cls, true);
    if (blocked) {
      if (h.peek?.sent) {
        this.withdraw(r, h);
        h.waitFrom = now;
      }
      return now - h.waitFrom > CONTENTS_HOLD.holdMs ? this.over(r, h) : true;
    }
    const pk = (h.peek ??= { part: null, sent: null, since: now, at: o.position!, aboveAt: 0, guarded: false });
    const c = centerOf(o);
    const d = Math.hypot(core.eye!.position[0] - c[0], core.eye!.position[1] - c[2]);
    if (!pk.sent) return this.send(r, h, o, d <= PEEK.nearM ? "above" : "go", d, now);
    if (pk.part === "go" && d <= PEEK.nearM) return this.send(r, h, o, "above", d, now);
    if (now - pk.since > PEEK.stepMs) return this.over(r, h);
    if (pk.part === "above" && this.o.topReady?.(o.id, pk.aboveAt)) {
      // 위에서 본 사진 쌍이 모였다: 명령을 거두고(보기 지킴은 위에서 보기가 끝날 때 푼다) 위에서 보기를 부탁한다
      this.withdraw(r, h, false);
      Object.assign(h, { phase: "seeing", seeingAt: now, lookAsked: false });
      this.lookTop(r, h, o);
      return true;
    }
    // 비전 줄이 바뀌면 visionMs에 한 번까지 보내고, repeatMs마다 소리로 다시 읽는다
    const vision = this.vision(pk.part!, o, d);
    if (vision !== pk.sent.vision && now - r.visionAt >= this.cfg.visionMs) {
      r.visionAt = now;
      pk.sent = r.sent = { ...pk.sent, vision, speak: false };
      core.answers.send(pk.sent);
    }
    if (now - r.spokeAt >= this.cfg.repeatMs) {
      r.spokeAt = now;
      core.answers.send({ ...pk.sent, speak: true });
    }
    return true;
  }

  /** 가까이 가서 보라는 명령 하나를 지금 명령 줄로 보낸다(새 번호, 소리로 읽기). 위에서 비추기면 보기 지킴을 건다. */
  private send(r: Run, h: Hold, o: WorldObject, part: "go" | "above", d: number, now: number): boolean {
    const pk = h.peek!;
    const name = OBJECT_NAME[o.cls] ?? o.cls;
    const id = r.plan.view.id;
    const sent: PlannedCommand = {
      type: "command", id, step: peekStep(id, o.id, h.gen, part, ++this.seq), text: PEEK_TEXT[part](name), vision: this.vision(part, o, d), choices: [],
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
    Object.assign(r, { sent, spokeAt: now, visionAt: now });
    this.core.answers.send(sent);
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
  private lookTop(r: Run, h: Hold, o: WorldObject): void {
    const hold = h;
    const finish = () => {
      if (r.hold !== hold || hold.phase !== "seeing") return;
      Object.assign(hold, { phase: "after", afterAt: this.clock.now() });
      this.unguard(hold);
    };
    if (!this.o.lookContents) return finish();
    const took = this.o.lookContents({
      planId: r.plan.view.id, objectId: o.id, spot: { id: o.id, label: OBJECT_NAME[o.cls] ?? o.cls, position: centerOf(o) }, signal: h.end.signal,
      top: { sinceMs: h.peek?.aboveAt ?? h.seeingAt }, done: finish,
    });
    if (took) h.lookAsked = true;
  }

  /** 떠 있는 가까이 가서 보라는 명령을 거둔다(지금 명령 줄이 그 명령일 때만 지우기를 보낸다). unguard면 보기 지킴도 푼다. */
  private withdraw(r: Run, h: Hold, unguard = true): void {
    const pk = h.peek;
    if (pk?.sent && r.sent?.step === pk.sent.step) this.core.steps.clear(r);
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
  private over(r: Run, h: Hold): boolean {
    this.withdraw(r, h);
    h.end.abort();
    if (h.tried) this.peeked.set(h.objectId, { gen: h.gen, at: this.clock.now() });
    h.phase = "over";
    return false;
  }

  /** 다른 컵·세대로 바뀐 보류: 명령을 거두고 보기 지킴을 풀고 부탁을 끊는다. */
  private drop(r: Run, h: Hold): void {
    this.withdraw(r, h);
    h.end.abort();
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
}
