// 실행 추적의 찾기(Finder): 대상 물건이 안 보여 검사가 막으면 바로 닫지 않고, 마지막으로 본 자리(src/act/tasks.ts lostTarget)로 폰을 든 사람을 보내 다시 본다.
// 사용자에게 묻지 않는다. 명령은 모두 사람에게 하는 「주세요」 명령이고 단추가 없다(비전으로만 넘긴다).
// 차례: 가기(go, 폰 눈과 그 자리 수평 거리가 FIND.nearM 밖일 때만) → 비추기(aim, 「<면> 위를 비춰 주세요」) → 가까이 보기(look, 보기 담당의 같은 물건 건너뛰기 없이)
//   → 찾음(found) 또는 그만둠(over). 가까이 보기가 새 사진으로 보고 VLM도 답했는데 그 종류가 없으면(분명히 없음) 바로 그만두고,
//   확인에 실패했으면(사진 모자람·VLM 답 없음·그 종류를 감지했지만 확정 못 함) settleMs 사진을 기다린 뒤 다시 비춘다(after, 전체 기한 안).
// - 비추기는 가까이 보기와 같은 프레임 고르기가 그 자리를 비추기 뒤 사진으로만 고를 수 있을 때(spotReady) 끝난다.
// - 찾음은 tick마다 본다: 그 자리 FIND.matchM 안에 그 종류의 있는 물건이 막은 검사의 신선도(freshMs, 실행 전은 판단 뒤에 본 것만) 안에 보였고 치운 것·손에 있음이 아니다.
//   여럿이면 그 자리에 가장 가까운 것, 둘이 FIND.splitM 안으로 붙어 가를 수 없으면 아직 못 찾은 것이다. 사진 기다림 중에 찾았지만 낡았으면 새 사진으로 다시 비춘다.
// - 그만둠: 명령 하나가 PEEK.stepMs 안에 안 끝남, 막힌 채 holdMs, 가까이 보기가 분명히 없음, 찾기 시작부터 FIND.totalMs.
//   그 자리는 FIND.retryMs 동안 다시 가지 않는다.
// - 막힘(맞춘 눈·폰 판본·끄기 안내·승인 대기·폰 대화·계획의 질문)과 명령 되풀이는 내용물 보류와 같은 명령 줄 규칙이다(phone-line.ts).
// - 확인 물건의 자리를 찾는 동안은 그 물건에 보기 지킴을 건다(후보 자리는 지킬 물건이 없다).
// - 생각 말풍선에 상태 줄을 올린다(TrackerOptions.thought): 시작하면 「컵이 안 보여서 식탁 쪽을 다시 볼게요」, 찾으면 「컵을 찾았어요」, 그만두면(한도) 「컵을 못 찾았어요」.
// 찾기는 대상에 손을 대는 행동(TaskSpec.touch: 치우기·채우기·따르기)만 한다. 사람이 그 종류 물건(또는 무엇인지 모르는 물건)을 들고 있거나,
//   사람이 보이고 찾을 자리를 손에 든 채 봤으면 시작하지 않는다(손에 든 컵을 찾으러 사람을 걷게 하지 않는다).
// 계획 전 찾기(idle 칸 TrackCore.finding, 명령 id find:<번호>): 계획 전 검사가 no_target·in_sink로 막았고 찾을 자리가 있으면 시작한다.
//   찾는 동안 같은 행동 판단은 기록만 하고 가장 새 것으로 바꿔 두며(start.ts), 찾으면 그 판단으로 다시 계획 전 검사부터 한다. 다른 행동의 계획을 받으면 거둔다.
//   계획 밖 가까이 가서 보기보다 먼저다(찾는 동안은 시작하지 않는다). 「그만」은 거두고 그 자리를 쉰다.
// 실행 전 찾기(Run.find, 계획 명령 줄): 실행 전 검사가 다시 보기 기한(recheckMs)이 지나도 no_target·stale로 막은 계획 대상 하나를 그 마지막 자리에서 찾는다(start.ts tryStart).
//   막은 그 물건을 찾으면 검사가 다시 통과해 첫 단계로 가고, 그 자리에서 다른 id의 같은 종류 물건만 찾으면 계획을 「찾은 뒤 다시 판단」으로 닫는다.
import type { CloserResult, DecisionRecord } from "../../contract/events.js";
import type { PlannedCommand } from "../../contract/phone.js";
import type { ObjClass, WorldObject, WorldView } from "../../contract/world.js";
import { OBJECT_NAME } from "../../world/labels.js";
import { PRECHECK_FRESH_MS } from "../check.js";
import { EXEC_TEXT, FIND_THOUGHT, FIND_TEXT, STEP_TEXT, VISION_TEXT } from "../labels.js";
import { holdsTarget, lostTarget, planIdOf, putAway, taskOf, type LostSpot } from "../tasks.js";
import { CONTENTS_HOLD, PEEK } from "./contents.js";
import { Part, type Run } from "./core.js";
import { eyeNow, idleLine, phoneBlocked, planLine, refreshLine, sendLine, type IdleSlot, type Line } from "./phone-line.js";

type V3 = [number, number, number];

/** 찾기: 가기가 끝나는 폰-자리 수평 거리(m, 그 자리를 전체 사진에 크게 담을 거리), 찾았다고 보는 거리(m), 가를 수 없는 두 물건 사이(m),
 *  같은 자리를 다시 찾기 전 기다림(ms), 찾기 전체 기한(ms, 다시 비추기로 늘지 않는다). */
export const FIND = { nearM: 1.0, matchM: 0.5, splitM: 0.1, retryMs: 60_000, totalMs: 60_000 } as const;
/** 실행 전 검사의 낡음 기준 기본값(src/act/check.ts loadActConfig). */
const STALE_DEFAULT_MS = 3000;

/** 찾기 한 차례. objectId: 확인 물건 자리면 그 id(보기 지킴), 후보 자리면 null. spotId: 명령 대상·가까이 보기 자리 id(확인 물건 id 또는 find_<종류>).
 *  phase: 명령(cmd: go·aim) → 가까이 보기 부탁(look) → 보는 중(looking) → 사진 기다림(after) → 끝(done 찾음·over 그만둠). */
export interface Find {
  objectId: string | null; cls: ObjClass; name: string; label: string; surfaceLabel: string | null; spotId: string; at: V3; freshMs: number;
  /** 이 시각 뒤에 본 것만 신선하다(실행 전 찾기는 판단 시각, 계획 전 찾기는 없음). */
  after: number;
  phase: "cmd" | "look" | "looking" | "after" | "done" | "over";
  part: "go" | "aim" | null; sent: PlannedCommand | null;
  /** 지금 명령을 보낸 때(명령 한도), 비추기를 보낸 때(spotReady since), 찾기를 시작한 때(전체 기한), 막히기 시작한 때(없으면 null),
   *  가까이 보기를 다시 부탁할 때, 사진 기다림을 시작한 때. */
  since: number; aimAt: number; startedAt: number; blockedAt: number | null; lookTryAt: number; afterAt: number;
  /** 마지막 가까이 보기 결과: absent 새 사진으로 보고 VLM도 답했는데 그 종류가 없음(바로 그만둔다), unsure 확인 실패(사진 모자람·VLM 답 없음·
   *  그 종류를 감지했지만 확정 못 함, 사진을 기다린 뒤 다시 비춘다), null 결과를 모름(사진을 기다린 뒤 그만둔다). */
  looked: "absent" | "unsure" | null;
  guarded: boolean; end: AbortController;
}
/** 계획 전 찾기 칸: 명령 줄(find:<번호>), 그 찾기, 시작한 판단·찾는 동안 받은 같은 행동의 가장 새 판단, 막은 검사의 글. */
export interface FindSlot extends IdleSlot { find: Find; first: DecisionRecord; decision: DecisionRecord; text: string }
/** 한 걸음 결과: 이어 감, 찾음(그 물건), 그만둠. */
type Outcome = { kind: "going" } | { kind: "found"; obj: WorldObject } | { kind: "over" };

const dist3 = (a: readonly number[], b: readonly number[]) => Math.hypot(a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!);

/** 찾기. */
export class Finder extends Part {
  /** 계획 전 찾기 번호(명령 id find:<번호>)와 명령마다 오르는 번호(늦게 온 말·화면이 앞 명령을 가리키지 않게). */
  private slotSeq = 0;
  private seq = 0;
  /** 찾아보고 못 찾은 자리(종류·자리·시각): FIND.retryMs 동안 다시 가지 않는다. */
  private rested: { cls: ObjClass; at: V3; when: number }[] = [];

  /** 계획 전 검사가 대상이 안 보여(no_target·in_sink) 막았다: 찾을 자리가 있으면 찾기를 시작하고 true.
   *  이미 찾는 중이거나, 다른 계획이 열려 있거나(질문 중 포함) 만드는 중이거나(그 계획의 폰 줄을 덮지 않는다), 자리가 없으면 false. */
  start(d: DecisionRecord, text: string): boolean {
    const core = this.core;
    const spec = taskOf(d.action);
    const cls = spec?.touch ? spec.target : undefined;
    if (core.stopped || core.finding || !cls || core.open() || core.planning) return false;
    const now = this.clock.now();
    const world = this.o.world();
    const spot = lostTarget({ world, cls, placed: core.steps.placed(), away: core.steps.awayIds(), now, freshMs: PRECHECK_FRESH_MS, resting: (s) => this.resting(s, now) });
    if (!spot || !this.mayFind(world, spot)) return false;
    // 계획 밖 가까이 가서 보기와 함께 돌지 않는다(찾기가 먼저)
    core.contents.dropIdle();
    const q: FindSlot = { id: `find:${++this.slotSeq}`, sent: null, spokeAt: now, visionAt: now, find: this.make(spot, PRECHECK_FRESH_MS, Number.NEGATIVE_INFINITY, now), first: d, decision: d, text };
    core.finding = q;
    core.emit(planIdOf(d.id), "decided", EXEC_TEXT.finding(q.find.name));
    this.o.thought?.(FIND_THOUGHT.start(q.find.name, q.find.surfaceLabel), d.id);
    this.idle();
    return true;
  }

  /** 찾는 동안 받은 같은 행동 판단: 가장 새 것으로 바꿔 두고 true(기록은 start.ts가 남긴다). 찾는 중이 아니거나 다른 행동이면 false. */
  same(d: DecisionRecord): boolean {
    const q = this.core.finding;
    if (!q || q.decision.action !== d.action) return false;
    q.decision = d;
    return true;
  }

  /** 지금 찾는 물건 이름(계획 전 찾기). 없으면 null. */
  name(): string | null {
    return this.core.finding?.find.name ?? null;
  }

  /** 가까이 보는 차례인가(비추기·가까이 보기·사진 기다림, 계획 전·실행 전). 가기는 아니다. */
  looking(): boolean {
    const r = this.core.open();
    return [this.core.finding?.find, r?.find].some((f) => !!f && (f.part === "aim" || f.phase === "look" || f.phase === "looking" || f.phase === "after"));
  }

  /** tick: 계획 전 찾기 한 걸음. 찾으면 가장 새 같은 행동 판단으로 다시 판단 받기부터 하고, 그만두면 막은 검사의 글로 닫는다. */
  idle(): void {
    const core = this.core;
    const q = core.finding;
    if (!q || core.stopped) return;
    const out = this.step(idleLine(core, q), q.find, this.clock.now(), false);
    if (out.kind === "going") return;
    core.finding = null;
    if (out.kind === "over") {
      this.o.thought?.(FIND_THOUGHT.lost(q.find.name), q.first.id);
      return core.emit(planIdOf(q.first.id), "failed", q.text);
    }
    this.o.thought?.(FIND_THOUGHT.found(q.find.name), q.first.id);
    core.foundFor = q.decision.id;
    core.start.onDecision(q.decision);
  }

  /** 계획 전 찾기를 거둔다(다른 계획을 받음·멈춤). text가 있으면 시작한 판단 줄을 그 글로 닫는다. */
  drop(text?: string): void {
    const core = this.core;
    const q = core.finding;
    if (!q) return;
    core.finding = null;
    this.close(idleLine(core, q), q.find, "done");
    if (text) core.emit(planIdOf(q.first.id), "failed", text);
  }

  /** 계획 전 찾기의 「그만」: 거두고 그 자리를 FIND.retryMs 동안 쉰다. */
  stopIdle(): void {
    const core = this.core;
    const q = core.finding;
    if (!q) return;
    core.finding = null;
    this.over(idleLine(core, q), q.find);
    core.emit(planIdOf(q.first.id), "failed", EXEC_TEXT.stopped);
  }

  /** 실행 전 검사가 계획 대상 objectId를 없음·낡음으로 막았다: 그 마지막 자리에서 찾기를 한 걸음 진행한다.
   *  hold 붙잡는 중, over 그만둠(검사 글로 닫는다), other 그 자리에서 다른 id의 같은 종류 물건만 찾음, none 찾을 자리 없음(지금처럼 다시 보기 기한). */
  keep(r: Run, objectId: string): "hold" | "over" | "other" | "none" {
    const now = this.clock.now();
    const line = planLine(this.core, r);
    let f = r.find;
    if (f && f.objectId !== objectId) {
      this.close(line, f, "done");
      f = r.find = null;
    }
    if (f?.phase === "over") return "over";
    if (!f) {
      const spec = taskOf(r.decision.action);
      const cls = spec?.touch ? spec.target : undefined;
      const world = this.o.world();
      const found = cls ? lostTarget({
        world: this.o.world(), cls, placed: this.core.steps.placed(), away: this.core.steps.awayIds(), now, freshMs: this.staleMs(), seenAfter: r.decision.atMs, objectId,
        resting: (s) => this.resting(s, now),
      }) : null;
      const spot = found && this.mayFind(world, found) ? found : null;
      if (!spot) return "none";
      f = r.find = this.make(spot, this.staleMs(), r.decision.atMs, now);
      this.o.thought?.(FIND_THOUGHT.start(f.name, f.surfaceLabel), r.decision.id);
    }
    const out = this.step(line, f, now, !!r.asking);
    if (out.kind === "over") {
      this.o.thought?.(FIND_THOUGHT.lost(f.name), r.decision.id);
      return "over";
    }
    if (out.kind === "found") this.o.thought?.(FIND_THOUGHT.found(f.name), r.decision.id);
    if (out.kind === "found" && out.obj.id !== objectId) return "other";
    return "hold";
  }

  /** 실행 전 찾기를 푼다(검사 통과·다른 까닭으로 막힘·계획 닫힘): 보기 지킴을 풀고 가까이 보기를 끊는다. clear면 떠 있는 찾기 명령도 지운다. */
  release(r: Run, clear = false): void {
    const f = r.find;
    if (!f) return;
    r.find = null;
    if (clear) this.withdraw(planLine(this.core, r), f);
    this.unguard(f);
    f.end.abort();
  }

  /** 지금 명령 줄이 실행 전 찾기 명령이면 지운다(풀린 첫 명령을 미룰 때). */
  clearFind(r: Run): void {
    if (r.sent?.step.includes(":find:")) this.core.steps.clear(r);
  }

  private make(spot: LostSpot, freshMs: number, after: number, now: number): Find {
    const name = OBJECT_NAME[spot.cls] ?? spot.cls;
    // 면 이름은 계획 단계와 같은 평면도 이름(「식탁」), 모르면 World State 면 이름
    const place = (spot.surface ? this.core.nameOf(spot.surface) : null) ?? spot.surface_label;
    const f: Find = {
      objectId: spot.objectId, cls: spot.cls, name, label: place ?? name, surfaceLabel: place, spotId: spot.objectId ?? `find_${spot.cls}`, at: [...spot.position],
      freshMs, after, phase: "cmd", part: null, sent: null, since: now, aimAt: now, startedAt: now, blockedAt: null, lookTryAt: now, afterAt: now, looked: null, guarded: false, end: new AbortController(),
    };
    if (f.objectId) {
      f.guarded = true;
      this.o.guardObject?.(f.objectId, true);
    }
    return f;
  }

  /** 한 걸음(계획 전·실행 전 같은 길). asking: 계획에 승인·다시 묻기 질문이 떠 있다(막음). */
  private step(line: Line, f: Find, now: number, asking: boolean): Outcome {
    if (now - f.startedAt > FIND.totalMs) return this.over(line, f);
    const hit = this.hit(this.o.world(), f, now);
    if (hit?.fresh) {
      this.close(line, f, "done");
      return { kind: "found", obj: hit.obj };
    }
    if (f.phase === "after") {
      // 찾았지만 낡았다(가까이 보기 사진이 몇 초 옛것): 새 사진으로 다시 비춘다(전체 기한 안에서만)
      if (hit) {
        f.phase = "cmd";
        return this.command(line, f, now, asking);
      }
      // 분명히 없으면 바로 그만둔다. 확인에 실패했으면 사진을 settleMs 기다린 뒤 다시 비춘다(전체 기한 안). 결과를 모르면 사진을 기다린 뒤 그만둔다
      if (f.looked === "absent") return this.over(line, f);
      if (now - f.afterAt <= CONTENTS_HOLD.settleMs) return { kind: "going" };
      if (f.looked === "unsure") {
        f.phase = "cmd";
        return this.command(line, f, now, asking);
      }
      return this.over(line, f);
    }
    if (f.phase === "look") return this.look(line, f, now);
    if (f.phase === "looking") return { kind: "going" };
    return this.command(line, f, now, asking);
  }

  /** 가기·비추기 명령 차례. */
  private command(line: Line, f: Find, now: number, asking: boolean): Outcome {
    const core = this.core;
    const eye = eyeNow(core, now);
    if (!eye || phoneBlocked(core, now, asking)) {
      if (f.sent) this.withdraw(line, f);
      f.blockedAt ??= now;
      return now - f.blockedAt > CONTENTS_HOLD.holdMs ? this.over(line, f) : { kind: "going" };
    }
    f.blockedAt = null;
    const d = Math.hypot(eye.position[0] - f.at[0], eye.position[1] - f.at[2]);
    if (!f.sent) return this.send(line, f, d > FIND.nearM ? "go" : "aim", d, now);
    if (f.part === "go" && d <= FIND.nearM) return this.send(line, f, "aim", d, now);
    if (now - f.since > PEEK.stepMs) return this.over(line, f);
    if (f.part === "aim" && this.o.spotReady?.(f.at, f.aimAt)) {
      // 그 자리를 비추기 뒤 사진으로 가까이 볼 수 있다: 명령을 거두고(보기 지킴은 둔다) 가까이 본다
      this.withdraw(line, f);
      f.phase = "look";
      f.lookTryAt = now;
      return this.look(line, f, now);
    }
    f.sent = refreshLine(core, line, f.sent, this.vision(f, d), now);
    return { kind: "going" };
  }

  /** 가까이 보기 부탁(보기 담당의 같은 물건 건너뛰기 없이). 바쁘면 lookWaitMs 뒤 다시 부탁한다. 보기 담당이 없으면 바로 사진 기다림. */
  private look(line: Line, f: Find, now: number): Outcome {
    if (now < f.lookTryAt) return { kind: "going" };
    const after = (r?: CloserResult | null) => {
      if (f.phase !== "looking" && f.phase !== "look") return;
      f.phase = "after";
      f.afterAt = this.clock.now();
      f.looked = r === undefined ? null : r?.ok && r.vlm === "ok" && !r.found.some((x) => x.cls === f.cls) ? "absent" : "unsure";
    };
    if (!this.o.lookContents) {
      after();
      return { kind: "going" };
    }
    f.phase = "looking";
    const took = this.o.lookContents({
      planId: line.planId, objectId: f.spotId, spot: { id: f.spotId, label: f.label, position: [...f.at] }, signal: f.end.signal, force: true, done: after,
    });
    if (!took && f.phase === "looking") {
      f.phase = "look";
      f.lookTryAt = now + CONTENTS_HOLD.lookWaitMs;
    }
    return { kind: "going" };
  }

  /** 가기·비추기 명령 하나를 그 명령 줄로 보낸다(새 번호, 소리로 읽기). */
  private send(line: Line, f: Find, part: "go" | "aim", d: number, now: number): Outcome {
    const text = part === "go"
      ? (f.surfaceLabel ? STEP_TEXT["go:가기"]!({ place: f.surfaceLabel, item: null })!.command : FIND_TEXT.goSpot(f.name))
      : (f.surfaceLabel ? FIND_TEXT.aim(f.surfaceLabel) : FIND_TEXT.aimSpot(f.name));
    // 계획 밖 칸은 그 칸 id 뒤, 계획 명령 줄은 계획 id 뒤 :find:<자리 id>
    const head = line.planId ? `${line.id}:find:${f.spotId}` : line.id;
    const sent: PlannedCommand = {
      type: "command", id: line.id, step: `${head}:${part}:${++this.seq}`, text, vision: this.vision(f, d), choices: [],
      target: { id: f.spotId, label: f.label, position: [...f.at] }, speak: true, kind: part === "go" ? "go" : "do", ...(part === "go" ? { near_m: FIND.nearM } : {}),
    };
    Object.assign(f, { part, sent, since: now });
    if (part === "aim") f.aimAt = now;
    sendLine(line, sent, now);
    return { kind: "going" };
  }

  /** 비전 상태 한 줄: 그 자리까지 거리. */
  private vision(f: Find, d: number): string {
    return VISION_TEXT.distance(f.label, d);
  }

  /** 그 자리에서 찾은 물건: 그 자리 FIND.matchM 안의 그 종류 있는 물건(치운 것·손에 있음 빼고). 신선도(freshMs) 안에 본 것이 있으면 그 가운데 가장 가까운 것(fresh),
   *  없으면 비추기 뒤 사진에서 봤지만 낡은 것 가운데 가장 가까운 것(다시 비춘다). 비추기 전 기록만 남은 물건(찾는 그 옛 자리)은 찾은 것이 아니다.
   *  가장 가까운 둘이 FIND.splitM 안으로 붙어 있으면 가를 수 없어 null. */
  private hit(world: WorldView, f: Find, now: number): { obj: WorldObject; fresh: boolean } | null {
    const placed = this.core.steps.placed();
    const near = world.objects
      .filter((o) => o.cls === f.cls && o.status === "present" && o.position && !putAway(o, placed) && o.facts.place?.value !== "in_hand" && dist3(o.position, f.at) <= FIND.matchM)
      .sort((a, b) => dist3(a.position!, f.at) - dist3(b.position!, f.at));
    const fresh = near.filter((o) => o.last_seen_ms > f.after && now - o.last_seen_ms <= f.freshMs);
    const pool = fresh.length ? fresh : near.filter((o) => o.last_seen_ms > f.after && o.last_seen_ms >= f.aimAt);
    if (!pool.length) return null;
    if (pool.length > 1 && dist3(pool[0]!.position!, pool[1]!.position!) <= FIND.splitM) return null;
    return { obj: pool[0]!, fresh: fresh.length > 0 };
  }

  /** 그만둔다: 거두고 그 자리를 FIND.retryMs 동안 쉰다. */
  private over(line: Line, f: Find): Outcome {
    this.close(line, f, "over");
    this.rested.push({ cls: f.cls, at: [...f.at], when: this.clock.now() });
    return { kind: "over" };
  }

  /** 끝낸다(찾음·거둠·그만둠): 명령을 거두고 보기 지킴을 풀고 가까이 보기를 끊는다. */
  private close(line: Line, f: Find, phase: "done" | "over"): void {
    this.withdraw(line, f);
    this.unguard(f);
    f.end.abort();
    f.phase = phase;
  }

  /** 떠 있는 찾기 명령을 거둔다(그 줄에 떠 있을 때만 지운다). */
  private withdraw(line: Line, f: Find): void {
    if (f.sent && line.shown()?.step === f.sent.step) line.clear();
    f.sent = null;
    f.part = null;
  }

  private unguard(f: Find): void {
    if (!f.guarded || !f.objectId) return;
    f.guarded = false;
    this.o.guardObject?.(f.objectId, false);
  }

  /** 찾으러 가도 되는가: 사람이 그 종류 물건(또는 무엇인지 모르는 물건)을 들고 있지 않고, 사람이 보이는데 그 자리를 손에 든 채 본 것이 아니다. */
  private mayFind(world: WorldView, spot: LostSpot): boolean {
    if (holdsTarget(world, spot.cls)) return false;
    return !(world.person.visible && spot.in_hand);
  }

  /** 쉬는 자리인가: 같은 종류를 FIND.retryMs 안에 FIND.matchM 안에서 찾아보고 못 찾았다. */
  private resting(s: { cls: ObjClass; position: V3 }, now: number): boolean {
    this.rested = this.rested.filter((x) => now - x.when < FIND.retryMs);
    return this.rested.some((x) => x.cls === s.cls && dist3(x.at, s.position) <= FIND.matchM);
  }

  /** 실행 전 검사의 낡음 기준(STALE_MS). */
  private staleMs(): number {
    return this.o.staleMs ?? STALE_DEFAULT_MS;
  }
}
