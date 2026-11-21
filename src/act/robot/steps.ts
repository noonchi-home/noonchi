// 실행 추적의 단계 진행(Steps): 단계를 시작하고(activate·show·runDevice) 끝나는 조건·기기 결과·끄기 단계 판단으로 넘기며(look·advance),
// 시간 한도(timeout)·멈춘 단계 알림(stall)·다시 읽기(repeat)를 보고, 계획을 닫는다(finish). 비전 상태 줄·명령 대상·가까이 볼 곳과 같은 물건 따라가기(ours)도 여기 있다.
// 치운 물건(placed)도 여기 둔다: 놓기 단계를 끝낼 때(advance) 적고, 사라진 뒤 같은 종류가 넣은 곳에 새 id로 다시 잡히면(PUT_HANDOVER_MS 안, 하나뿐일 때) 이어 간다.
// 따르기 창: 그 자리에서 하는 일 단계의 끝 조건이 그 물건 내용물을 보면 그 단계 동안 그 물건(지금 따라가는 id)의 창을 연다(o.state.contentsAction).
// 따라가는 id가 바뀌면 창도 옮기고, 단계가 바뀌거나 계획이 닫히면 닫는다.
import type { PhoneStepKind, PlannedCommand } from "../../contract/phone.js";
import type { CloserResult } from "../../contract/events.js";
import type { Facet, WorldEye, WorldObject, WorldView } from "../../contract/world.js";
import type { LookSpot } from "../../observe/index.js";
import { AGAIN_TEXT, APPROVAL_TEXT, CAUTION_TEXT, EXEC_TEXT, SAY_TEXT, TOP_TEXT, VISION_TEXT } from "../labels.js";
import { roomAt } from "../../layout/index.js";
import { OBJECT_NAME, PLACE_UNKNOWN, STATE_TEXT, onSurface } from "../../world/labels.js";
import { ConditionWatch, TOP_CONFIRM, type Condition, type ConditionContext } from "../../world/index.js";
import { NEAR_M } from "../../world/vocab.js";
import { HUMAN_KINDS, selfStopWait, type AgentStep, type ToolResult } from "../../agent/index.js";
import { clearsAway, followedId, sureValue, taskOf, type Placed } from "../tasks.js";
import { CONTENTS_HOLD } from "./contents.js";
import { doneId } from "../done-step.js";
import { HELP_ACTIONS, helpRecord, type HelpVia } from "../help-record.js";
import { Part, choicesOf, clsOf, type Run } from "../track/core.js";

/** 놓기를 끝낸 물건이 사라진 뒤 새 id로 다시 잡히기를 기다리는 시간(ms). 등장 확인(물건 4초)·사라짐(6초)보다 넉넉히. */
const PUT_HANDOVER_MS = 30_000;
/** 이어 갈 새 물건은 넣은 물건을 마지막으로 본 때보다 이만큼(ms) 앞까지 처음 보인 것이다(새 id가 옛 id보다 조금 먼저 잡히기도 한다). 그보다 먼저 있던 물건은 원래 있던 옆 물건이다. */
const PUT_LOST_SLACK_MS = 2000;

/** 멈춘 집기·놓기 단계. command: 실제 폰에 띄운 지금 명령 글. stuckMs: 단계 시작 뒤 지난 시간. looks: 이 단계에서 센 부름 수(시도).
 *  spots: 계획 물건(지금 따라가는 World State 물건, 자리를 알 때)과 단계 대상 자리(평면도, 물건과 다를 때).
 *  gen: 단계 세대(단계가 바뀌거나 계획이 닫힐 때마다 오른다). signal: 이 단계가 끝나면(다음 단계·완료·실패·그만·새 계획·멈춤) 끊긴다.
 *  settle(counted): 받은 부름(stalled가 true)이 끝나면 부른다. 받을 때 시도로 먼저 세고, settle(false)면(자원 사정: 가까이 보기 no_fresh_frames·vlm_busy) 돌려받아
 *  stallMax에 넣지 않는다. settle(true)는 그대로 센다. 처음 한 번만 듣고, 그 단계 세대가 지났으면(다른 단계·닫힌 계획) 아무것도 하지 않는다.
 *  다음 부름은 셈과 상관없이 받은 부름에서 stallMs 뒤다. */
export interface Stall {
  planId: string; stepId: string; kind: "pick" | "place" | "do"; label: string; command: string; until: Condition;
  stuckMs: number; looks: number; spots: LookSpot[]; gen: number; signal: AbortSignal;
  settle(counted: boolean): void;
}

/** 단계 진행·치운 물건. */
export class Steps extends Part {
  /** 실행마다 지금 World State에 알린 집기·내려놓기 대상 id(focus). */
  private readonly focused = new WeakMap<Run, string>();
  /** 놓기 단계를 끝낸 물건(placed). */
  private readonly put = new Map<string, { target: string; part?: "basin"; atMs: number }>();
  /** 놓기를 끝낸 물건의 종류(새 id로 다시 잡혔을 때 같은 종류만 이어 간다). */
  private readonly putCls = new Map<string, string>();
  /** 놓기를 끝낸 물건의 옛 id와 적은 시각: 계획이 따라간 옛 id와, 놓은 뒤 사라져 새 id로 넘기거나 잊은 id. 다시 집거나 옮기거나 그 뒤 다시 보이면 지운다. */
  private readonly putOld = new Map<string, number>();
  /** 치운 무리(2026-11-18): 놓기를 끝낸 넣은 곳(면, 싱크볼에 넣었으면 part basin)과 그 종류. 그 뒤 그 넣은 곳에 있는 같은 종류 물건은 넣은 기억이 없어도 치운 것이다.
   *  열쇠는 「넣은 곳|종류」. 한 번 넣은 곳은 잊지 않는다(그 자리에 다시 놓인 같은 종류도 치운 것). */
  private readonly putGroup = new Map<string, { target: string; part?: "basin"; cls: string; atMs: number }>();
  /** 치운 무리에서 풀린 물건: 그 넣은 곳을 정한 뒤 손에 있음이 확인됐다(다시 집어 씀). 같은 면에 도로 놓여도 무리로 보지 않는다(풀림이 무리 판정보다 먼저). */
  private readonly reused = new Set<string>();

  /** 찾기에서 뺄 물건(src/act/robot/find.ts): 놓기를 끝낸 물건(placed)과 그 옛 id. 안 보이는 옛 id의 마지막 자리는 치우기 전 자리다. */
  awayIds(): ReadonlySet<string> {
    return new Set([...this.placed().keys(), ...this.putOld.keys()]);
  }

  /** 놓기 단계를 끝낸 물건(이미 치운 것): World State id → 그 계획의 넣은 곳, 끝낸 때 싱크볼 안이었으면 part basin, 끝낸 시각.
   *  그 뒤 손에 있음이 확인되거나(다시 집음, VLM 한 번의 손에 있음은 싱크대 속 컵에도 나와 확인됨만 본다) 트윈 자리가 그 영역을 벗어나거나
   *  (다른 면·면 없음, part basin이면 같은 면이어도 싱크볼 밖: 옮김) 사라지면 지운다. 사라진 뒤 같은 종류가 그 넣은 곳에 새 id로 다시 잡히면 그 물건으로 이어 간다.
   *  돌려줄 때는 지금 싱크볼 안이고 손에 있음이 확인되지 않은 물건과, 치운 무리(넣은 곳 면, 싱크볼에 넣었으면 그 싱크볼 안에 있는 같은 종류 물건)도 더한다(넣은 기억이 없어도 치운 것).
   *  계획을 만들지 않는다. 계획 전·실행 전 검사와 대상 고르기가 이미 치운 것을 아는 근거로만 쓴다. */
  placed(): Placed {
    const objects = this.o.state.view().objects;
    const now = this.clock.now();
    for (const [id, p] of this.put) {
      const o = objects.find((x) => x.id === id);
      const hand = o?.facts.place;
      const picked = hand?.value === "in_hand" && hand.certainty === "confirmed" && hand.at_ms > p.atMs;
      // 트윈 자리를 모르는 채(맞추기 전) 본 것은 옮긴 근거가 아니다
      const out = !!o && (o.surface !== p.target || (p.part !== undefined && o.surface_part !== p.part));
      const moved = !!o && o.last_seen_ms > p.atMs && o.position !== null && out;
      if (picked || moved) {
        this.put.delete(id);
        this.putCls.delete(id);
        this.putOld.delete(id);
      } else if (!o || o.status === "gone") this.carryPut(id, p, objects, now);
    }
    // 놓기 기억에서 빠진 옛 id가 적은 뒤 다시 보이면(다시 집음·다른 자리) 옛 기억을 지운다
    for (const [id, at] of this.putOld) {
      const o = objects.find((x) => x.id === id);
      if (o && o.status !== "gone" && o.last_seen_ms > at) this.putOld.delete(id);
    }
    // 싱크볼 안에 있고 손에 있음이 확인되지 않은 물건도 치운 것이다(치우기 계획 놓기 끝 자리: 싱크대 면의 싱크볼 안이고 손에 없음).
    // 실행 추적이 넣은 기억이 없는 컵(서버를 다시 띄운 뒤 본 컵, 새 id로 잡힌 컵)을 다시 치우지 않게 한다(2026-11-16 23:48)
    const all = new Map(this.put);
    for (const o of objects) {
      if (all.has(o.id) || o.status === "gone" || o.surface === null || o.surface_part !== "basin") continue;
      if (o.facts.place?.value === "in_hand" && o.facts.place.certainty === "confirmed") continue;
      all.set(o.id, { target: o.surface, part: "basin", atMs: o.first_seen_ms });
    }
    // 치운 무리: 끝낸 계획의 넣은 곳에 있는 같은 종류 물건(새 id로 둘 이상 잡혀 어느 것이 넣은 것인지 모를 때, 그 뒤 들어온 것).
    // 그 뒤 손에 있음이 확인된 물건(다시 집어 씀)은 풀리고, 같은 면에 도로 놓여도 무리로 돌아가지 않는다
    for (const g of this.putGroup.values()) {
      for (const o of objects) {
        const hand = o.facts.place;
        if (o.cls === g.cls && hand?.value === "in_hand" && hand.certainty === "confirmed" && hand.at_ms > g.atMs) this.reused.add(o.id);
        if (all.has(o.id) || this.reused.has(o.id) || o.status === "gone" || o.cls !== g.cls || o.surface !== g.target || (g.part && o.surface_part !== g.part)) continue;
        all.set(o.id, { target: g.target, ...(o.surface_part === "basin" ? { part: "basin" as const } : {}), atMs: g.atMs });
      }
    }
    return all;
  }

  /** 놓기를 끝낸 물건이 사라졌다: 같은 종류 물건 하나가 사라진 무렵 뒤 그 넣은 곳(싱크볼이었으면 싱크볼)에 새 id로 다시 잡혔으면 그 물건으로 이어 간다
   *  (놓은 컵이 끝낸 뒤 2초 만에 새 id로 잡혀 치운 기억이 없어졌다, 2026-11-16 23:36). 아직 없거나 둘 이상이면 사라진 때부터 PUT_HANDOVER_MS 동안 기다린다. */
  private carryPut(id: string, p: { target: string; part?: "basin"; atMs: number }, objects: WorldView["objects"], now: number): void {
    const cls = this.putCls.get(id);
    // 사라진 때: 그 물건을 마지막으로 본 때(놓은 뒤 오래 보이다 사라졌으면 그 마지막 확인, World State에 없으면 끝낸 때). 기한과 후보는 이 때를 기준으로 본다
    const lostAt = objects.find((o) => o.id === id)?.last_seen_ms ?? p.atMs;
    // 후보: 같은 종류가 넣은 곳(싱크볼이었으면 싱크볼)에, 사라진 무렵(PUT_LOST_SLACK_MS 앞) 뒤에 처음 보인 것. 원래 있던 옆 컵은 아니다
    const next = objects.filter((o) => o.id !== id && o.status !== "gone" && o.cls === cls && o.surface === p.target
      && (p.part === undefined || o.surface_part === p.part) && o.first_seen_ms >= lostAt - PUT_LOST_SLACK_MS && o.first_seen_ms <= lostAt + PUT_HANDOVER_MS
      && !this.put.has(o.id));
    // 하나뿐일 때만 잇는다(둘 이상이면 어느 것인지 모른다). 사라진 때부터 PUT_HANDOVER_MS가 지나면 잊는다
    const one = next.length === 1 ? next[0]! : null;
    if (one || now - lostAt > PUT_HANDOVER_MS) {
      this.put.delete(id);
      this.putCls.delete(id);
      this.putOld.set(id, now);
    }
    if (one) {
      this.put.set(one.id, p);
      if (cls) this.putCls.set(one.id, cls);
    }
  }

  /** 놓기 단계를 끝낸 물건을 적는다: 지금 그 물건으로 보는 World State id(따라가지 못하면 계획 물건 id)와 그 계획의 넣은 곳.
   *  그때 트윈 자리가 넣은 곳 면의 싱크볼 안이면 part basin도 적는다(그 뒤 싱크볼 밖이면 옮긴 것). */
  private remember(r: Run, object: string, target: string): void {
    const now = this.clock.now();
    const objs = ours(r, object, this.o.state.view()).filter((o) => o.status !== "gone");
    const at = objs.length ? objs.map((o) => ({ id: o.id, basin: o.position !== null && o.surface === target && o.surface_part === "basin" })) : [{ id: r.alias.get(object) ?? object, basin: false }];
    const cls = objs[0]?.cls ?? this.o.state.view().objects.find((o) => o.id === (r.alias.get(object) ?? object))?.cls ?? object.replace(/_\d+$/, "");
    for (const { id, basin } of at) {
      this.put.set(id, { target, ...(basin ? { part: "basin" as const } : {}), atMs: now });
      this.putCls.set(id, cls);
    }
    // 넣은 곳의 같은 종류 무리: 싱크볼에 넣었으면 그 싱크볼 안, 아니면 그 면
    const key = `${target}|${cls}`;
    const basinAll = at.some((x) => x.basin) || this.putGroup.get(key)?.part === "basin";
    this.putGroup.set(key, { target, ...(basinAll ? { part: "basin" as const } : {}), cls, atMs: now });
    // 계획 물건 id와 따라간 id 가운데 지금 그 물건이 아닌 것(옮겨 새 id가 붙기 전 id)
    for (const old of [object, r.alias.get(object) ?? object]) if (!at.some((x) => x.id === old)) this.putOld.set(old, now);
  }

  /** 지금 단계를 끝내고 다음 단계로. 마지막이었으면 계획 완료. 집기를 마치면 그 물건은 사람이 들고 다니고, 놓기를 마치면 그 물건은 넣은 곳에 치운 것이다. */
  advance(r: Run): void {
    // 떠나기 직전 사진으로 시작한 목표 실행: 그 대상을 다루는 단계 전에 떠난 뒤 다시 봤는지 본다(없으면 찾기, start.ts held). 붙잡는 동안 지금 단계에 머문다
    const next = r.plan.steps[r.at + 1];
    if (r.meal && next?.kind === "pick" && !r.verify)
      r.verify = {objectId:next.object ?? next.target ?? r.meal.object, since:r.leftAt!, at:null};
    if (r.verify && this.core.start.held(r, r.at + 1)) return;
    const done = this.core.stepOf(r);
    if (done && HUMAN_KINDS.includes(done.kind)) r.outcomes.push({ label: done.label, alone: !r.helped });
    if (done?.kind === "pick" && done.object) r.carried.add(done.object);
    if (done?.kind === "place" && done.object) {
      r.carried.delete(done.object);
      // 치운 물건으로 남기는 것은 그 행동의 치우는 대상뿐이다(src/act/tasks.ts clearsAway): 따르고 내려놓은 병처럼 다시 쓰는 물건은 남기지 않는다
      if (done.target && clearsAway(taskOf(r.plan.task), clsOf(this.o.state.view(), done.object))) this.remember(r, done.object, done.target);
    }
    if (r.at + 1 >= r.plan.steps.length) return this.finish(r, "done");
    this.activate(r, r.at + 1);
  }

  /** i번째 단계를 지금 단계로: PlanHub 단계 상태(앞 단계 done, 이 단계 active)를 한 번에 바꾸고 단계 종류대로 시작한다. */
  activate(r: Run, i: number): void {
    const prev = r.plan.steps[r.at];
    const step = r.plan.steps[i]!;
    const now = this.clock.now();
    const insideSince = prev?.kind === "go" ? r.stepAt : now;
    r.stepEnd?.abort();
    this.endTop(r);
    Object.assign(r, {
      at: i, stepAt: now, spokeAt: now, visionAt: now, deadline: now + step.timeoutMs, asking: null, watch: step.until ? new ConditionWatch(step.until) : null,
      again: false, device: "idle", gen: r.gen + 1, looks: 0, lookAt: Number.NEGATIVE_INFINITY, stepEnd: new AbortController(),
      strays: 0, strayAt: Number.NEGATIVE_INFINITY, strayNear: null, told: null, helped: false, quietOn: false,
    });
    this.o.plans.setSteps(r.plan.view.id, { ...(prev ? { [prev.id]: "done" as const } : {}), [step.id]: "active" }, now);
    this.window(r, windowOf(step));
    this.focus(r, step);
    if (step.kind === "wait" || step.kind === "device") this.core.quietFrom = now;
    if (step.kind === "wait") return this.clear(r);
    if (step.kind === "device") {
      this.clear(r);
      return this.runDevice(r, step);
    }
    // 손으로 켜는 위험 가전: 명령보다 먼저 안전 문구와 함께 묻는다(승인 뒤에만 켜라는 명령, approvedHand)
    if (this.core.approval.risky(step)) {
      r.watch = null;
      return this.core.approval.ask(r, { why: "hand" }, CAUTION_TEXT.ask(step.caution ?? "", this.core.handLabel(step.hand!.deviceId, step.target)), `${step.id}:hand`);
    }
    // 컵 안 보기: 위에서는 YOLO가 컵을 못 잡아 사라짐으로 셀 수 있어 보기 지킴을 건다(가까이 가서 보기의 위에서 비추기와 같다)
    if (step.look === "top" && step.target) {
      const id = ours(r, step.target, this.o.state.view())[0]?.id ?? r.alias.get(step.target) ?? step.target;
      r.top = { objectId: id, asked: false, doneAt: null, seen: null, end: new AbortController(), guarded: !!this.o.state.guardObject };
      this.o.state.guardObject?.(id, true);
      const seen = this.inside(r, step, insideSince);
      if (seen) {
        this.finishTop(r, step, seen);
        return;
      }
      r.top.since = insideSince;
    }
    this.show(r, step);
  }

  /** 사람 단계·질문·알림을 실제 폰에 띄운다(소리로 읽음). */
  show(r: Run, step: AgentStep): void {
    const world = this.o.state.view();
    const human = HUMAN_KINDS.includes(step.kind);
    const nav=this.walk(r,step,world);
    // 조용한 단계: 지난 수업에서 이어서 혼자 해낸 사람 단계는 글만 띄운다. 손으로 켜는 위험 가전 단계는 늘 읽는다
    r.quietOn = human && r.quiet.has(step.label) && !this.core.approval.risky(step) && !r.helped;
    r.sent = {
      type: "command", id: r.plan.view.id, step: step.id, text: (human ? step.command : step.kind === "ask" ? step.prompt?.text : step.text) ?? step.label,
      vision: human ? this.vision(r, step, world, nav?.vision) : null, choices: choicesOf(r, step).map(({ id, label }) => ({ id, label })),
      ...(nav ? {guide:nav.guide} : {}),
      target: human ? this.target(r, step, world) : null, speak: !r.quietOn,
      ...(human ? { kind: step.kind as PhoneStepKind } : {}), ...(step.look === "top" ? { view: "above" as const } : {}),
    };
    // 알림 글은 판본이 맞는 폰이 없거나 끄기 안내가 명령 줄에 떠 있으면 보내지 않는다(폰 없이 도는 가전 계획, 명령 줄에는 하나만)
    if (step.kind === "say" && (!this.core.start.phoneOk() || this.core.safety.shownOff())) return;
    this.core.robot.commands.show(r.sent);
  }

  /** 기기 단계: 정책을 거쳐 기기 도구를 부른다. 승인 토큰이 오면 실제 폰에 묻는다. */
  private runDevice(r: Run, step: AgentStep): void {
    const devices = this.o.appliances.run;
    if (!devices || !step.device) return this.finish(r, "failed", EXEC_TEXT.deviceFailed);
    const gen = r.gen;
    r.device = "running";
    devices.run(step.device.tool, step.device.deviceId, step.device.args, () => this.core.live(r, gen)).then(
      (res) => {
        const token = res.needsConfirmation?.token;
        if (!this.core.live(r, gen)) {
          if (token) devices.cancel(token);
          return;
        }
        if (token) return this.core.approval.ask(r, { why: "device", token }, APPROVAL_TEXT.ask(step.label), `${step.id}:approve`);
        this.deviceResult(r, gen, res);
      },
      () => this.deviceResult(r, gen, { ok: false }),
    );
  }

  /** 기기 결과: 실패면 실패로 닫는다. 적용을 확인하지 못했으면(신호 없음·미확인) 끝나는 조건이 참이 될 때까지만 기다리고, 조건이 없으면 실패로 닫는다. */
  deviceResult(r: Run, gen: number, res: Pick<ToolResult, "ok" | "error" | "unverified" | "state">): void {
    if (!this.core.live(r, gen)) return;
    if (!res.ok) return this.finish(r, "failed", EXEC_TEXT.deviceFailed);
    const verified = !res.unverified && res.state !== "모름";
    if (!verified && !r.watch) return this.finish(r, "failed", EXEC_TEXT.deviceUnverified);
    r.device = verified ? "done" : "sent";
    this.look(r);
  }

  /** 시간 초과 질문에 「계속」: 시간 한도만 한 번 더 준다. 조건 기준 시각·기기 실행 기록은 그대로라 기기를 다시 보내지 않는다. */
  resume(r: Run): void {
    const step = this.core.stepOf(r)!;
    const now = this.clock.now();
    Object.assign(r, { asking: null, deadline: now + step.timeoutMs });
    if (HUMAN_KINDS.includes(step.kind) || step.kind === "ask" || step.kind === "say") this.show(r, step);
    else this.clear(r);
  }

  /** 지금 단계가 됐으면 다음 단계로 넘기고 true. 아니면 사람 단계의 비전 상태가 바뀌었을 때 보낸다(visionMs에 한 번까지). */
  look(r: Run): boolean {
    const step = this.core.stepOf(r);
    if (!step || r.state !== "running" || step.kind === "ask") return false;
    // 지금 단계를 끝냈지만(「완료」·조건) 다음 단계 대상을 떠난 뒤 다시 보지 못해 붙잡혀 있으면(start.ts held, verify.at) World State 변화·tick마다 다시 넘겨 본다:
    // 컵을 다시 보면 다음 단계로, 다시 보기 기한이 지나면 찾기로 간다. 붙잡힌 동안 지금 단계의 시간·되풀이는 보지 않는다
    // (2026-11-19 영상 모드 고정 자세: 1단계를 「완료」로 넘기면 다시 부르는 곳이 없어 멈췄다)
    if (r.verify?.at != null) {
      this.advance(r);
      return true;
    }
    this.refocus(r, step);
    if(r.asking?.why==="again" && step.kind==="go" && this.o.layout.walking) return false;
    if (r.asking && r.asking.why !== "again") return false;
    // 시간 한도가 지난 뒤 온 관찰·기기 결과로는 넘기지 않는다(시간 초과가 먼저다)
    if (!r.asking && this.clock.now() > r.deadline) {
      this.timeout(r, step);
      return true;
    }
    if (step.kind === "device" && r.device !== "done" && r.device !== "sent") return false;
    if (step.look === "top") return this.topStep(r, step);
    const next = r.plan.steps[r.at + 1];
    if (!r.asking && step.kind === "go" && next?.look === "top" && this.inside(r, next, r.stepAt)) {
      this.advance(r);
      return true;
    }
    // 따라가는 컵이 새 id로 이어졌으면 따르기 창도 옮긴다
    if (step.kind === "do") this.window(r, windowOf(step));
    const world = this.o.state.view();
    // 끄기 do 단계는 그 가전 추적이 풀려도(확인된 꺼짐) 끝난다. 저절로 꺼지는 가전의 꺼짐 기다리기는 그것으로만 넘긴다(끝 조건을 보지 않는다)
    const self = selfStopWait(step, this.o.appliances.handDevices?.() ?? []) !== null;
    const nav=this.walk(r,step,world);
    const completed = (!self && (r.watch ? r.watch.check(this.conditionView(world), this.context(r, world, nav?.within)) : step.kind === "device" && r.device === "done"))
      || this.core.safety.offReleased(r, step);
    const reached = completed && (!nav || nav.arrived);
    if (reached) {
      this.advance(r);
      return true;
    }
    if (!HUMAN_KINDS.includes(step.kind) || !r.sent || r.asking) return false;
    const vision = this.vision(r, step, world, nav?.vision);
    const now = this.clock.now();
    if ((nav && nav.guide?.revision!==r.sent.guide?.revision) || (vision !== r.sent.vision && now - r.visionAt >= this.cfg.visionMs)) {
      r.visionAt = now;
      r.sent = { ...r.sent, ...(nav?{guide:nav.guide,target:this.target(r,step,world)}:{}), vision, speak: false };
      this.core.robot.commands.show(r.sent);
    }
    return false;
  }

  /** 컵 안 보기 단계 한 걸음(tick·World State 변화마다): 단계를 띄운 뒤(stepAt) 그 컵 안을 내려다본 VLM 프레임 쌍이 모이면(topReady) 위에서 보기를 부탁하고,
   *  끝나면(못 봐도) 그 컵 내용물로 가른다. 비었음 → 다음 단계(집기), 남음 → 실제 폰 질문 「남은 음료를 버리고 치울까요?」(leftover),
   *  모름 → 사진이 이어질 settleMs를 기다린 뒤 그만둔다(사용자에게 비었는지 묻지 않는다, 내용물 보류와 같다). 옆 사진으로 내용물을 알아도 늘 위에서 본다.
   *  위에서 보기 담당이 없으면 바로 끝난 것으로 본다. 넘기거나 닫았으면 true. */
  private topStep(r: Run, step: AgentStep): boolean {
    let t = r.top;
    if (!t) return false;
    const now = this.clock.now();
    const world = this.o.state.view();
    const id = followedId(world, t.objectId);
    if (id !== t.objectId) {
      this.endTop(r);
      t = r.top = { objectId: id, asked: false, doneAt: null, seen: null, end: new AbortController(), guarded: !!this.o.state.guardObject };
      this.o.state.guardObject?.(id, true);
      if (step.target) r.alias.set(step.target, id);
    }
    const o = world.objects.find((x) => x.id === id && x.status !== "gone");
    const seen = this.inside(r, step, t.since ?? r.stepAt);
    if (seen) return this.finishTop(r, step, seen);
    const target = o?.size_m?.center ?? o?.position;
    if (!t.asked && target && r.sent && (!r.sent.target || r.sent.target.id !== id || target.some((v, i) => Math.abs(v - r.sent!.target!.position[i]!) > 0.02))) {
      r.sent = { ...r.sent, speak: false, target: { id, label: OBJECT_NAME[o!.cls] ?? o!.cls, position: target } };
      this.core.robot.commands.show(r.sent);
    }
    const since = t.retryAfter ?? r.stepAt;
    const retry = t.retryAfter !== undefined && t.doneAt !== null && now - t.doneAt < CONTENTS_HOLD.settleMs;
    if ((t.doneAt === null || retry) && !t.asked) {
      if (!this.o.observe.lookContents) t.doneAt = now;
      else if (o?.position && this.o.observe.topReady?.(o.id, since)) {
        const job = t;
        const done = (result?: CloserResult | null) => {
          if (r.top !== job) return;
          job.doneAt = this.clock.now();
          if (!result?.ok) return;
          const facts = result.found.find((found) => found.id === job.objectId)?.facts;
          const value = facts?.[0];
          if (facts?.length === 2 && facts[1] === value && (value === "empty" || value === "has_contents")) {
            job.seen = { value, at: result.captured_at_ms };
          } else if (job.retryAfter === undefined && !result.top?.some((f) => f.why === "moved" || f.why === "crowded")) {
            job.retryAfter = result.captured_at_ms + 1;
            job.asked = false;
          }
        };
        const previousDone = t.doneAt;
        t.asked = true;
        t.doneAt = null;
        if (!this.o.observe.lookContents({
          planId: r.plan.view.id, objectId: o.id, spot: { id: o.id, label: OBJECT_NAME[o.cls] ?? o.cls, position: o.size_m?.center ?? o.position }, signal: t.end.signal,
          top: { sinceMs: since }, done,
        })) {
          t.asked = false;
          t.doneAt = previousDone;
        }
      }
    }
    if (t.doneAt === null) return false;
    const v = o && o.id === t.objectId && t.seen && (o.facts.contents?.at_ms ?? 0) >= t.seen.at && sureValue(o, "contents") === t.seen.value ? t.seen.value : null;
    if (v !== null) return this.finishTop(r, step, v);
    if (now - t.doneAt < CONTENTS_HOLD.settleMs) return false;
    this.finish(r, "failed", EXEC_TEXT.topUnknown);
    return true;
  }

  /** 이번 이동 또는 비추기 중 같은 컵의 입구 안을 직접 확인한 두 장. */
  private inside(r: Run, step: AgentStep, since: number): "empty" | "has_contents" | null {
    if (!step.target) return null;
    const world = this.o.state.view();
    const id = followedId(world, r.alias.get(step.target) ?? step.target);
    const cup = world.objects.find((o) => o.id === id && o.status === "present");
    const fact = cup?.facts.contents;
    const pair = fact?.inside_ms;
    if (!cup || cup.carried || cup.facts.place?.value === "in_hand" || !pair || pair[0] < since || this.clock.now() - pair[1] > TOP_CONFIRM.gapMs) return null;
    return fact.certainty === "confirmed" && (fact.value === "empty" || fact.value === "has_contents") ? fact.value : null;
  }

  private finishTop(r: Run, step: AgentStep, value: "empty" | "has_contents"): true {
    this.endTop(r);
    if (value === "empty") this.advance(r);
    else {
      r.helped = true;
      this.core.approval.ask(r, { why: "leftover" }, TOP_TEXT.ask, `${step.id}:leftover`);
    }
    return true;
  }

  /** 컵 안 보기를 거둔다: 보기 지킴을 풀고 위에서 보기 부탁을 끊는다. */
  endTop(r: Run): void {
    const t = r.top;
    if (!t) return;
    r.top = null;
    t.end.abort();
    if (t.guarded) this.o.state.guardObject?.(t.objectId, false);
  }

  /** 남은 음료 질문의 답: 「치워 주세요」면 다음 단계(집기)로 이어 가고, 「그대로 둬요」면 치우지 않고 계획을 끝낸다(취소). 그 컵은 사람이 다시 보일 때까지 치우지 않는다(start.ts kept). */
  leftover(r: Run, choice: string): void {
    if (choice !== "keep" && choice !== "clear") return;
    this.o.cupAnswers?.rememberLeftover?.(choice === "clear");
    r.asking = null;
    if (choice !== "keep") return this.advance(r);
    const step = this.core.stepOf(r);
    const target = step?.target ?? null;
    if (target) {
      const id = ours(r, target, this.o.state.view())[0]?.id ?? r.alias.get(target) ?? target;
      this.core.kept.set(id, this.clock.now());
    }
    this.finish(r, "failed", EXEC_TEXT.kept, "cancelled");
  }

  /** 시간 한도를 넘은 단계: on_timeout이 ask이고 아직 묻지 않았으면 실제 폰에 계속할지 한 번 묻고, 아니면 실패로 닫는다. */
  timeout(r: Run, step: AgentStep): void {
    if (step.onTimeout === "ask" && !r.again) {
      r.again = true;
      r.helped = true;
      return this.core.approval.ask(r, { why: "again" }, AGAIN_TEXT.ask(step.label), `${step.id}:again`);
    }
    this.finish(r, "failed", step.kind === "ask" ? EXEC_TEXT.noAnswer : EXEC_TEXT.timeout);
  }

  /** 끝나는 조건이 있는 집기·놓기 단계가 stallMs 넘게(단계 시작 뒤, 받은 부름 뒤) 안 끝나면 관찰 모드를 부른다. 단계마다 stallMax번까지.
   *  받은 것만 먼저 세고, 그 부름의 settle(false)는 셈을 돌려준다(같은 계획·단계 세대일 때만, 한 번). */
  stall(r: Run, step: AgentStep, now: number): void {
    if (!this.o.observe.stalled || (step.kind !== "pick" && step.kind !== "place" && step.kind !== "do") || !step.until || !r.sent || r.asking || !r.stepEnd) return;
    if (r.looks >= this.cfg.stallMax || now - r.stepAt < this.cfg.stallMs || now - r.lookAt < this.cfg.stallMs) return;
    const gen = r.gen;
    // asking: stalled를 부르는 중(그 안에서 정하면 받은 뒤 셈에 바로 반영), open: 받았고 아직 안 정함, done: 정함(또는 받지 않음)
    let state: "asking" | "open" | "done" = "asking";
    let counted = true;
    const s: Stall = {
      planId: r.plan.view.id, stepId: step.id, kind: step.kind, label: step.label, command: r.sent.text, until: step.until,
      stuckMs: now - r.stepAt, looks: r.looks, spots: this.spots(r, step, this.o.state.view()), gen, signal: r.stepEnd.signal,
      settle: (c) => {
        if (state === "done") return;
        const open = state === "open";
        state = "done";
        counted = c;
        if (open && !c && this.core.run === r && r.gen === gen && r.looks > 0) r.looks--;
      },
    };
    if (!this.o.observe.stalled(s)) {
      state = "done";
      return;
    }
    if (state === "asking") state = "open";
    if (counted) r.looks++;
    r.lookAt = now;
  }

  /** 가까이 볼 곳: 계획 물건(지금 따라가는 World State 물건, 자리를 알 때)과 단계 대상 자리(평면도, 물건과 다를 때). */
  spots(r: Run, step: AgentStep, world: WorldView): LookSpot[] {
    const out: LookSpot[] = [];
    const id = step.object ?? step.target;
    const obj = id ? ours(r, id, world).find((o) => o.status !== "gone" && o.position) : undefined;
    if (obj?.position) out.push({ id: obj.id, label: OBJECT_NAME[obj.cls] ?? obj.cls, position: obj.position });
    const at = step.target ? this.o.layout.locate?.(step.target) : undefined;
    if (step.target && at && step.target !== id && step.target !== obj?.id) out.push({ id: step.target, label: this.core.nameOf(step.target) ?? PLACE_UNKNOWN, position: at.position });
    return out;
  }

  /** repeatMs마다 지금 명령·질문을 다시 읽는다. */
  repeat(r: Run, now: number): void {
    if (!r.sent || now - r.spokeAt < this.cfg.repeatMs) return;
    r.spokeAt = now;
    r.helped = true;
    this.core.robot.commands.show({ ...r.sent, speak: true });
  }

  /** 따르기 창: 그 물건(지금 따라가는 World State id)의 창을 열고, 다른 물건·다른 단계가 되면 앞 창을 닫는다. */
  private window(r: Run, objectId: string | null): void {
    const id = objectId ? ours(r, objectId, this.o.state.view()).find((o) => o.status !== "gone")?.id ?? null : null;
    if (r.window === id) return;
    if (r.window) this.o.state.contentsAction?.(r.window, false);
    r.window = id;
    if (id) this.o.state.contentsAction?.(id, true);
  }

  /** 집기·내려놓기 단계면 그 대상(지금 따라가는 World State id)과 자리(집기는 그 물건 자리, 내려놓기는 목적지)를 World State에 알리고, 아니면 푼다. */
  private focus(r: Run, step: AgentStep | null): void {
    if (!step || (step.kind !== "pick" && step.kind !== "place") || !step.object) {
      // 집기를 마치고 아직 내려놓지 않은 물건이 있으면 그 사이 단계(싱크대로 가기 등)는 든 물건으로 알린다(가로 머그 r4: 가는 중 든 머그가 새 id가 됐다)
      const held = step ? [...r.carried].at(-1) : undefined;
      if (held) {
        const id = ours(r, held, this.o.state.view())[0]?.id ?? r.alias.get(held) ?? held;
        this.focused.set(r, id);
        this.o.state.focusObject?.(id, { step: "carry", spot: null });
        return;
      }
      this.focused.delete(r);
      this.o.state.focusObject?.(null);
      return;
    }
    const world = this.o.state.view();
    const obj = ours(r, step.object, world)[0] ?? null;
    const spot: [number, number] | null = step.kind === "pick"
      ? (obj?.position ? [obj.position[0], obj.position[2]] : null)
      : r.placeAt(step.target);
    const id = obj?.id ?? r.alias.get(step.object) ?? step.object;
    this.focused.set(r, id);
    this.o.state.focusObject?.(id, { step: step.kind, spot: spot ? [spot[0], spot[1]] : null });
  }

  /** 따라가는 id가 바뀌었으면(가까이 보기 뒤 새 id 등) focus를 새 대상으로 고친다. */
  private refocus(r: Run, step: AgentStep): void {
    if ((step.kind !== "pick" && step.kind !== "place") || !step.object || !this.focused.has(r)) return;
    const now = ours(r, step.object, this.o.state.view())[0]?.id;
    if (now && now !== this.focused.get(r)) this.focus(r, step);
  }

  /** 실제 폰 명령을 지운다(기다리기·기기 단계). */
  clear(r: Run): void {
    if (!r.sent) return;
    r.sent = null;
    this.core.robot.commands.clear(r.plan.view.id);
  }

  /** 조건을 볼 World State: 폰 자리는 실행 추적이 받은 맞춘 눈과 World State 눈 중 새것. */
  private conditionView(w: WorldView): WorldView {
    const e = this.core.eye;
    if (!e || (w.eye && w.eye.at_ms >= e.at)) return w;
    const eye: WorldEye = {
      position: e.position, height_m: w.eye?.height_m ?? 0, yaw_deg: w.eye?.yaw_deg ?? 0, pitch_deg: w.eye?.pitch_deg ?? 0,
      room: roomAt(this.o.layout.floor(), e.position), room_label: null, at_ms: e.at,
    };
    return { ...w, eye };
  }

  private walk(r:Run,step:AgentStep,world:WorldView) {
    if(step.kind!=="go" || !this.o.layout.walking) return undefined;
    const {legs,path}=r.plan.view;
    const i=legs.findIndex(leg=>leg.stepId===step.id);
    const hint=i<0?undefined:path.slice(i>0?legs[i-1]!.end:0,legs[i]!.end+1);
    return this.core.walk(JSON.stringify([r.plan.view.id,step.id,r.gen]),this.target(r,step,world),false,hint);
  }

  private context(r: Run, world: WorldView, within?: (m:number)=>boolean): ConditionContext {
    const fp = this.o.layout.floor();
    return {
      nowMs: this.clock.now(), sinceMs: r.stepAt, offsetMinutes: this.o.offsetMinutes,
      guidedNear:(id,m)=>{
        const step=this.core.stepOf(r);
        return step?.target===id ? within?.(m) : undefined;
      },
      locate: (id) => fp.objects.get(id)?.position ?? null,
      roomOf: (id) => {
        const o = fp.objects.get(id);
        return o ? o.room ?? roomAt(fp, o.position) : null;
      },
      follow: (id) => ours(r, id, world).map((o) => o.id),
    };
  }

  /** 비전 상태 한 줄: go는 든 물건 자리와 목표까지 거리, pick·place는 그 물건 자리. 비전으로 못 보는 단계면 null.
   *  do는 대상이 World State 물건이면 그 이름과 끝나는 조건이 보는 면의 지금 값(없으면 그 물건 자리), 평면도 자리면 거기까지 거리. */
  private vision(r: Run, step: AgentStep, world: WorldView, walkVision?:string): string | null {
    if (step.kind === "do") {
      const id = step.target;
      if (!id) return null;
      if (this.o.layout.floor().objects.has(id)) return VISION_TEXT.distance(this.core.nameOf(id), this.distance(id, world));
      const o = ours(r, id, world).find((x) => x.status !== "gone") ?? null;
      const value = step.until ? factFacets(step.until).map((f) => o?.facts[f]?.value).find((v) => v !== undefined) : undefined;
      const cls = clsOf(world, id);
      return `${OBJECT_NAME[cls] ?? cls} · ${value ? STATE_TEXT[value] ?? value : place(o)}`;
    }
    if (step.kind === "go") {
      const carried = this.carried(r);
      const place = step.target ? this.core.nameOf(step.target) : null;
      const far = walkVision ?? VISION_TEXT.distance(place, this.distance(step.target, world));
      return carried ? `${objectLine(r, carried, world)} · ${far}` : far;
    }
    return step.object ? objectLine(r, step.object, world) : null;
  }

  /** 지금 단계 앞의 마지막 집기 물건(그 뒤에 내려놓기가 없을 때). */
  private carried(r: Run): string | null {
    for (let i = r.at - 1; i >= 0; i--) {
      const s = r.plan.steps[i]!;
      if (s.kind === "place") return null;
      if (s.kind === "pick") return s.object;
    }
    return null;
  }

  /** 명령 대상(실제 폰 고리 하나): 집기는 그 물건, do는 그 일을 받는 물건(World State 자리), 그 밖은 목표 자리(평면도). 자리를 모르면 null. */
  private target(r: Run, step: AgentStep, world: WorldView): PlannedCommand["target"] {
    const thing = step.kind === "pick" ? step.object : step.kind === "do" ? step.target : null;
    const obj = thing ? ours(r, thing, world).find((o) => o.status !== "gone") : undefined;
    if (obj?.position) return { id: obj.id, label: OBJECT_NAME[obj.cls] ?? obj.cls, position: step.look === "top" ? obj.size_m?.center ?? obj.position : obj.position };
    const id = step.target;
    const at = id ? this.o.layout.locate?.(id) : undefined;
    return id && at ? { id, label: at.label, position: at.position } : null;
  }

  /** 폰 눈에서 평면도 물건까지 거리(m). 눈이나 목표 자리를 모르면 null. */
  private distance(id: string | null, world: WorldView): number | null {
    const at = id ? this.o.layout.floor().objects.get(id)?.position : undefined;
    const eye = this.conditionView(world).eye?.position;
    return eye && at ? Math.hypot(eye[0] - at[0], eye[1] - at[1]) : null;
  }

  /** close: 계획을 닫을 상태. null이면 닫지 않는다(새 계획이 PlanHub.onDecision으로 취소로 닫는다). */
  finish(r: Run, state: "done" | "failed", text?: string, close: "done" | "failed" | "cancelled" | null = state): void {
    this.core.contents.release(r);
    this.endTop(r);
    this.core.finder.release(r);
    this.window(r, null);
    this.focus(r, null);
    if (r.asking?.why === "device") this.o.appliances.run?.cancel(r.asking.token);
    r.asking = null;
    r.gen++;
    r.stepEnd?.abort();
    this.core.step(r, state, text);
    // 수업 기록: 코치 계획을 끝까지 마친 판만 남긴다
    if (state === "done" && taskOf(r.plan.task)?.coach && r.outcomes.length) this.o.lessons?.record(r.plan.task, r.outcomes, new Date(this.clock.now()).toISOString());
    // 도움 기록: 가져다주는 일을 끝까지 마친 판(어디에 놓았는지·그때 사용자가 하던 일·부탁이 온 길)
    if (state === "done" && close === "done" && HELP_ACTIONS.includes(r.plan.task)) {
      const place = [...r.plan.steps].reverse().find((s) => s.kind === "place" && s.target)?.target ?? null;
      const d = r.decision;
      const via: HelpVia = d.source === "speech" ? (d.via === "answer" ? "call" : "speech") : "habit";
      this.o.events.help?.(helpRecord({ atMs: this.clock.now(), askedMs: d.atMs, offsetMinutes: this.o.offsetMinutes ?? 540, action: r.plan.task, via, place,
        placeLabel: place ? this.o.layout.locate?.(place)?.label ?? null : null, world: this.o.state.view() }));
    }
    if (r.sent) {
      r.sent = null;
      this.core.robot.commands.clear(r.plan.view.id);
    }
    if (close) this.o.plans.close(r.plan.view.id, close, this.clock.now());
    // 폰으로 시킨 계획을 끝까지 마쳤으면 다음 타이머에 실제 폰 명령 줄에 완료 문장을 띄운다(phone-line.ts noticeTick)
    this.core.notice = state === "done" && close === "done" && r.phone ? { id: doneId(r.plan.view.id), text: SAY_TEXT.done(r.plan.view.goal), since: this.clock.now(), sent: false } : this.core.notice;
    // 손으로 켠 위험 가전이 작동 끝남 확인 전에 닫혔다: 가전마다 끄기 안내 줄로 옮기고 차례로 띄운다(확인된 꺼짐으로만 하나씩 지운다)
    this.core.safety.handOver(r);
    r.ends.clear();
    // 계획이 끝나면(새 계획으로 바뀐 것이 아니면) 사용자 위치를 확인하고 충전 자리로 돌아간다(dock.ts)
    this.core.dock.planClosed(r, close);
  }
}

/** 가까이 봐서 찾은 물건을 전체 사진이 못 봐도 지키는 중이거나(World State closer_hold), 지키던 중 같은 종류 새 물건이 다른 자리에 생겼는가(followed_by).
 *  그동안 보인 것이 아니라 「아직 있음」으로 세지 않는다. */
const held = (o: WorldObject) => o.closer_hold === true || !!o.followed_by;

/** 계획 물건으로 보는 지금 World State 물건(하나, 없으면 빈 목록). 지금 id가 사라졌거나(그 자리가 시야 안인데 없음), 사람이 들고 다니다 시야 밖이 됐거나,
 *  가까이 봐서 지키는 중이거나 옮김 표시(followed_by)가 있을 때만 그 뒤에 처음 보인 같은 종류 물건(계획 전부터 있던 것·앞서 이은 것은 뺀다)이 하나일 때 그것으로 이어 간다.
 *  옮김 표시가 가리키는 물건은 처음 보인 시각과 상관없이 후보다. 후보가 여럿이면(옮김 표시가 가리키는 것이 끼어 있어도) 어느 것인지 모르므로 잇지 않는다.
 *  여럿이거나 들지 않은 물건이 시야 밖이면 잇지 않는다(「완료」로 넘긴다). */
function ours(r: Run, id: string, world: WorldView): WorldObject[] {
  const cur = r.alias.get(id) ?? id;
  const own = world.objects.find((o) => o.id === cur);
  if (own && own.status !== "gone" && !held(own) && !(own.status === "out_of_view" && r.carried.has(id))) return [own];
  const cls = clsOf(world, id);
  const others = r.others.get(id) ?? new Set<string>();
  const seen = new Set(r.alias.values());
  const after = own?.last_seen_ms ?? -Infinity;
  const marked = own?.followed_by ?? null;
  // 들고 다니다 시야 밖이 된 물건은 내려놓기 목표 자리 가까이(NEAR_M 안)에서 새로 보인 것만 잇는다(그 자리를 모르면 거리는 보지 않는다)
  const step = r.plan.steps[r.at];
  const near = own?.status === "out_of_view" && step?.kind === "place" ? r.placeAt(step.target) : null;
  const next = world.objects.filter((o) => o.cls === cls && o.id !== cur && o.id !== id && !others.has(o.id) && !seen.has(o.id) && o.status !== "gone"
    && (o.first_seen_ms > after || o.id === marked)
    && (!near || !o.position || Math.hypot(o.position[0] - near[0], o.position[2] - near[1]) <= NEAR_M));
  const pick = next.length === 1 ? next[0] : undefined;
  if (pick) {
    r.alias.set(id, pick.id);
    return [pick];
  }
  return own ? [own] : [];
}

/** 물건 줄: 「컵 · 손에 있음」. 사라지지 않은 같은 물건 중 가장 최근 것. */
function objectLine(r: Run, id: string, world: WorldView): string {
  const cls = clsOf(world, id);
  return `${OBJECT_NAME[cls] ?? cls} · ${place(ours(r, id, world).find((o) => o.status !== "gone") ?? null)}`;
}

/** 따르기 창을 열 물건: 그 자리에서 하는 일 단계이고 끝 조건이 그 물건 내용물을 보면 그 대상(계획 물건 id). 아니면 null. */
const windowOf = (step: AgentStep): string | null => (step.kind === "do" && step.until && factFacets(step.until).includes("contents") ? step.target : null);

/** 조건이 보는 물건 사실의 면(쓴 순서, 겹치지 않게). */
function factFacets(c: Condition, out: Facet[] = []): Facet[] {
  if ("all" in c) c.all.forEach((x) => factFacets(x, out));
  else if ("any" in c) c.any.forEach((x) => factFacets(x, out));
  else if ("seq" in c) c.seq.forEach((x) => factFacets(x, out));
  else if ("not" in c) factFacets(c.not, out);
  else if ("for_s" in c) factFacets(c.cond, out);
  else if ("object" in c) for (const f of Object.keys(c.facts ?? {}) as Facet[]) if (!out.includes(f)) out.push(f);
  return out;
}

/** World State 물건 자리 글: VLM이 본 자리, 없으면 놓인 면, 그것도 없으면 자리 모름. 없으면 안 보임. */
function place(o: WorldObject | null): string {
  if (!o) return VISION_TEXT.unseen;
  const p = o.facts.place?.value;
  if (p) return STATE_TEXT[p] ?? p;
  return o.surface_label ? onSurface(o.surface_label) : PLACE_UNKNOWN;
}
