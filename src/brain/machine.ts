// 컵 시나리오 상태 기계. 판단 흐름은 코드가 정한다: 언제 자리 비움인지, 언제 더 보여 달라고 할지, 언제 행동해도 되는지.
// 순수하게 동작한다: 판정·시간을 받아 이벤트(대시보드·폰)와 할 일(판단 모델 호출)을 돌려준다. 비동기 호출은 brain.ts가 한다.
//
// 근거 규칙(계획서 2026-11-04-brain-cup.md "고정 규칙")
// - 근거 시각 = 판정 창 마지막 사진의 촬영 시각. staleMs를 넘은 판정·실패한 판정은 모름이다.
// - 자리 비움: 사용을 본 뒤, 컵 보임 + 사람 없음인 새 판정이 awayMs 동안 공백(staleMs 초과) 없이 이어질 때만.
// - 사람이 다시 보이면 어느 단계든 거두고 사용 중으로. 세대 번호를 올려 늦게 온 판단 결과를 버린다.
// - 요청 답은 요청 뒤에 찍힌 사진만, 행동 전 재확인은 판단이 끝난 뒤 찍힌 사진만 받는다.
//
// 감지 모드(presence, 계획서 2026-11-04-brain-live.md): YOLO 존재 판정(observePresence)이 자리 비움 시계·행동 전 재확인·
// 결과 확인을 맡고, VLM 판정(observe)은 사용 시작·컵 안·사람 손 보임만 맡는다. 사람이 없어진 첫 근거 시각(absentSince)보다
// 뒤에 찍힌 VLM 판정이 사람을 보면 취소하고, 그보다 앞선 판정은 지난 일이라 무시한다. 자리 비움 확인과 행동 전 재확인은
// YOLO만으로 하지 않는다: 그 구간 뒤에 찍힌 VLM 판정도 사람 없음·사용 아님이어야 한다(YOLO가 손을 놓치는 장면 대비).
// 행동(acting): 재확인을 통과하면 모의 행동을 내고(actor.ts), 컵이 치워졌는지 새 판정으로 본다. 사람이 오는 것은 정상이라 거두지 않는다.
// "치워짐"은 식탁을 비추는 것이 확인될 때만 저절로 정한다. 식탁을 모르면(맞추기 전·VLM 모드) 사용자가 "치웠어요"를 누른 뒤의
// 컵 없음만 센다(카메라만 돌려도 치워짐이 되지 않게).

import type { ActionOutcome, BrainEvent, BrainStage, BrainState } from "../contract/events.js";
import { planAction, replyText, type ActionPlan } from "./actor.js";
import type { Prediction } from "./decision.js";
import type { Contents, Perception } from "./perception.js";
import type { Presence } from "./presence.js";

export type { ActionOutcome, BrainEvent, BrainStage, BrainState } from "../contract/events.js";

/** contentsAtMs: 내용물을 정한 VLM 판정의 근거 시각(내용물 모름이면 null). 판단 근거 사진을 찾는 데 쓴다. */
export interface DecideIntent { kind: "decide"; generation: number; contents: Contents; endMs: number; contentsAtMs: number | null }

export interface MachineOutput { events: BrainEvent[]; intents: DecideIntent[] }

export interface MachineConfig {
  staleMs: number;
  awayMs: number;
  requestTimeoutMs: number;
  /** 행동 결과: 컵 없음이 이만큼 이어지면 치워짐(ms). */
  clearMs?: number;
  /** 행동 결과를 기다리는 시간(ms). */
  actionTimeoutMs?: number;
  /** 요청 답 사진을 받는 최대 나이(ms). 원본 크기 사진은 올리기·판정이 길어 staleMs보다 넉넉히 둔다. */
  answerStaleMs?: number;
}

export interface MachineOptions {
  decisive?: () => boolean;
  /** 감지 모드: YOLO 존재 판정이 자리 비움·재확인·결과 확인을 맡는다. */
  presence?: boolean;
  /** 재확인 뒤 모의 행동(acting)과 결과 확인까지 간다. 끄면 1단계처럼 실행 제안에서 끝난다. */
  acting?: boolean;
}

/** evidenceAtMs는 근거 사진의 가장 이른 가능 촬영 시각, evidenceLatestMs는 가장 늦은 가능 시각(시계 오차, live.ts).
 *  구간 길이(자리 비움·치워짐)는 시작을 늦은 쪽, 끝을 이른 쪽으로 재서 오차가 시간을 늘리지 않게 한다.
 *  answer: 요청 답 사진 한 장의 판정. 장면 판정 순서와 상관없이 요청 뒤 사진이면 받는다. */
export interface Observed { perception: Perception | null; evidenceAtMs: number; evidenceLatestMs?: number; error?: string; answer?: boolean }

export const REQUEST_TEXT = "컵 안이 보이게 위에서 찍어 주세요";

const CONTENTS_WORD: Record<Contents, string> = { empty: "빈 컵", not_empty: "음료가 남은 컵", unknown: "모름" };
const sec = (ms: number) => `${(ms / 1000).toFixed(1)}초`;
const CANCELLABLE: BrainState[] = ["away_check", "requesting", "deciding", "confirming", "done"];
const STOP_WORD: Partial<Record<BrainState, string>> = { away_check: "자리 비움 확인 멈춤", requesting: "요청 거둠", deciding: "판단 멈춤", confirming: "행동 멈춤", done: "다시 지켜봄" };

interface Acting {
  plan: ActionPlan;
  startedAtMs: number;
  /** 컵 없음이 이어진 첫 근거 시각. */
  goneSince: number | null;
  lastGoneMs: number | null;
  /** 사용자가 "치웠어요"를 누른 시각(식탁을 모를 때 이 뒤의 컵 없음만 센다). */
  userDoneAtMs: number | null;
  /** 재확인 때 비춘 식탁(맞춘 뒤). 다른 식탁을 비춰 컵이 안 보이는 것은 치워짐이 아니다. */
  tableId: string | null;
}

/** 자리 비움 확인에 쓸 내용물과 그 VLM 판정 근거 시각. */
interface AwayContents { contents: Contents; status: Perception["contents_status"]; atMs: number | null }

const usingCup = (p: Perception) => p.person_holding_cup === "yes" || p.drinking === "yes";

export class CupMachine {
  state: BrainState = "watching";
  generation = 0;
  private lastEvidenceMs = Number.NEGATIVE_INFINITY;
  private awaySince: number | null = null;
  private lastAwayEvidence: number | null = null;
  /** 자리 비움 확인 중 마지막 판정이 도착한 시각(근거 시각이 아니라 도착 시각). */
  private lastAwayResultAt: number | null = null;
  private request: { id: string; issuedAtMs: number } | null = null;
  private decidedAtMs: number | null = null;
  private action: string | null = null;
  /** 지금 판단(또는 판단 중)의 근거 내용물. 재확인에서 바뀌면 다시 판단한다. */
  private decisionContents: Contents | null = null;
  /** 지금 판단의 근거 사진 시각. 이보다 뒤에 찍힌 사진만 판단 근거를 뒤집을 수 있다. */
  private decisionEvidenceMs = Number.NEGATIVE_INFINITY;
  /** 지금 판단의 내용물을 정한 판정 근거 시각(모름이면 null). */
  private decisionContentsAtMs: number | null = null;
  /** 감지 모드: 마지막 존재 판정 근거 시각, 사람이 없어진 첫 근거 시각, 마지막 VLM 판정. */
  private lastPresenceMs = Number.NEGATIVE_INFINITY;
  private absentSince: number | null = null;
  private lastVlm: { perception: Perception; atMs: number } | null = null;
  /** 마지막으로 컵 안을 확신한 VLM 판정. 사람이 없는 동안 컵 안은 바뀌지 않으므로 뒤의 "모름"이 지우지 않는다. */
  private lastConfirmed: { perception: Perception; atMs: number } | null = null;
  private acting: Acting | null = null;
  private lastText = "";
  private out: MachineOutput = { events: [], intents: [] };
  private readonly clearMs: number;
  private readonly actionTimeoutMs: number;
  private readonly answerStaleMs: number;
  /** 마지막 컵 안 요청을 낸 시각(요청을 거둔 뒤 오는 답 사진도 이보다 뒤에 찍혔으면 근거로 본다). */
  private lastRequestAtMs = Number.NEGATIVE_INFINITY;

  constructor(private readonly cfg: MachineConfig, private readonly opts: MachineOptions = {}) {
    this.clearMs = cfg.clearMs ?? 2000;
    this.actionTimeoutMs = cfg.actionTimeoutMs ?? 120_000;
    this.answerStaleMs = cfg.answerStaleMs ?? 8000;
  }

  /** 감지 모드에서 기계가 VLM 확인을 기다리는가(자리 비움 확인·재확인). 거르기가 이때 VLM을 간격마다 부른다. */
  needsVlm(nowMs: number): boolean {
    if (!this.opts.presence) return false;
    if (this.state === "away_check") return !this.vlmClearAfter(this.awaySince!, nowMs);
    if (this.state === "confirming") return this.decidedAtMs !== null && !this.vlmClearAfter(this.decidedAtMs, nowMs);
    return false;
  }

  /** since 뒤에 찍히고 아직 오래되지 않은(staleMs 안) 가장 최근 VLM 판정이 사람 없음·사용 아님인가. */
  private vlmClearAfter(since: number, nowMs: number): boolean {
    const v = this.lastVlm;
    return v !== null && v.atMs > since && nowMs - v.atMs <= this.cfg.staleMs && v.perception.person_present === "no" && !usingCup(v.perception);
  }

  /** 기계가 실제로 받아들여 들고 있는 컵 안 근거의 시각들. 실행기는 이 판정의 사진을 지우지 않고 판단 근거로 넘긴다. */
  keepEvidence(): number[] {
    return [this.lastConfirmed?.atMs ?? null, this.decisionContentsAtMs].filter((t): t is number => t !== null);
  }

  /** 지금 떠 있는 컵 안 사진 요청(없으면 null). */
  get pendingRequest(): { id: string; issuedAtMs: number } | null {
    return this.request ? { ...this.request } : null;
  }

  private flush(): MachineOutput {
    const o = this.out;
    this.out = { events: [], intents: [] };
    return o;
  }

  private note(stage: BrainStage, text: string, atMs: number, evidenceAgeMs: number | null): void {
    this.out.events.push({ type: "brain", stage, state: this.state, text, at_ms: atMs, evidence_age_ms: evidenceAgeMs, generation: this.generation });
  }

  /** 같은 글을 연달아 내지 않는다(관찰마다 같은 상태가 반복될 때). */
  private noteOnce(stage: BrainStage, text: string, atMs: number, age: number | null): void {
    if (text === this.lastText) return;
    this.lastText = text;
    this.note(stage, text, atMs, age);
  }

  private closeRequest(atMs: number): void {
    if (!this.request) return;
    this.out.events.push({ type: "request", id: this.request.id, text: REQUEST_TEXT, active: false, at_ms: atMs });
    this.request = null;
  }

  private resetAway(reason: string, atMs: number, age: number | null): void {
    if (this.state !== "away_check") return;
    this.state = "in_use";
    this.awaySince = null;
    this.lastAwayEvidence = null;
    this.lastAwayResultAt = null;
    this.noteOnce("away", `${reason} → 자리 비움 시계 처음부터`, atMs, age);
  }

  /** 사람이 돌아옴: 진행 중인 흐름을 거두고 사용 중으로. 행동 중에는 부르지 않는다. */
  private cancel(why: string, atMs: number, age: number): void {
    const what = STOP_WORD[this.state] ?? "";
    this.generation++;
    this.closeRequest(atMs);
    this.state = "in_use";
    this.awaySince = null;
    this.lastAwayEvidence = null;
    this.lastAwayResultAt = null;
    this.decidedAtMs = null;
    this.note("cancel", `${why} → ${what}`, atMs, age);
    this.lastText = "";
  }

  observe(r: Observed, nowMs: number): MachineOutput {
    if (r.answer) return this.observeAnswer(r, nowMs);
    const age = nowMs - r.evidenceAtMs;
    const presence = this.opts.presence === true;
    if (r.evidenceAtMs <= this.lastEvidenceMs) return this.flush(); // 순서가 뒤바뀐 판정
    if (!r.perception) {
      this.note("error", `판정 실패(${r.error ?? "이유 모름"}) → 모름`, nowMs, age);
      this.lastText = "";
      if (!presence) this.resetAway("판정 실패", nowMs, age);
      else this.lastVlm = null; // 지금은 모름: 앞선 "사람 없음"으로 확인하지 않는다
      return this.flush();
    }
    if (age > this.cfg.staleMs) {
      this.note("stale", `근거가 ${sec(age)} 지나 모름으로 봄`, nowMs, age);
      this.lastText = "";
      if (!presence) this.resetAway("오래된 근거", nowMs, age);
      else this.lastVlm = null;
      return this.flush();
    }
    this.lastEvidenceMs = r.evidenceAtMs;
    const p = r.perception;
    this.lastVlm = { perception: p, atMs: r.evidenceAtMs };
    if (p.contents_status === "confirmed") this.lastConfirmed = { perception: p, atMs: r.evidenceAtMs };

    // 감지 모드에서는 사람이 없어진 뒤에 찍힌 판정만 "돌아옴"이다(그 전 판정은 늦게 도착한 지난 일)
    const fresh = !presence || (this.absentSince !== null && r.evidenceAtMs > this.absentSince);
    if (p.person_present === "yes" && fresh && CANCELLABLE.includes(this.state)) this.cancel("사람이 돌아옴", nowMs, age);

    const using = p.person_holding_cup === "yes" || p.drinking === "yes";
    if (using && (this.state === "watching" || this.state === "in_use")) {
      this.state = "in_use";
      this.noteOnce("use", p.drinking === "yes" ? "컵으로 마시는 중" : "컵을 들고 있음", nowMs, age);
    }

    // 사람 없음 + 컵 보임이어도 '들고 있음·마심'이 예면 서로 맞지 않는 판정이라 자리 비움으로 세지 않는다.
    const contradicts = p.person_holding_cup === "yes" || p.drinking === "yes";
    const alone = p.cup_visible === "yes" && p.person_present === "no" && !contradicts;
    const notAlone = p.cup_visible !== "yes" ? "컵이 안 보임" : p.person_present !== "no" ? "사람 여부 모름" : "판정이 서로 맞지 않음(사람 없음인데 사용 중)";
    switch (this.state) {
      case "in_use":
        if (alone && !presence) {
          this.state = "away_check";
          this.awaySince = r.evidenceLatestMs ?? r.evidenceAtMs;
          this.lastAwayEvidence = r.evidenceAtMs;
          this.lastAwayResultAt = nowMs;
          this.noteOnce("away", `사람 안 보임 · 컵 보임 → 자리 비움 확인 시작(${sec(this.cfg.awayMs)})`, nowMs, age);
        } else if (!using && p.person_present === "yes") {
          this.noteOnce("use", "컵 곁에 사람이 있음", nowMs, age);
        }
        break;
      case "away_check":
        if (presence) {
          // 시계는 YOLO가 돌린다. 자리 비움 시작 뒤 찍힌 판정이 들고 있음·마심이면 서로 맞지 않아 처음부터
          if (contradicts && r.evidenceAtMs > this.awaySince!) this.resetAway("판정이 서로 맞지 않음(사람 없음인데 사용 중)", nowMs, age);
          break;
        }
        if (!alone) {
          this.resetAway(notAlone, nowMs, age);
          break;
        }
        this.awayStep(r.evidenceAtMs, r.evidenceLatestMs ?? r.evidenceAtMs, nowMs, age, { contents: p.contents, status: p.contents_status, atMs: r.evidenceAtMs }, false);
        break;
      case "requesting":
        // 답은 요청 뒤에 찍히고 확신한 내용물만 받는다(옆모습 추정은 결정을 바꾸는 근거로 약하다).
        if (r.evidenceAtMs > this.request!.issuedAtMs && p.contents_status === "confirmed") {
          this.note("answer", `컵 안 확인: ${CONTENTS_WORD[p.contents]}(확신)`, nowMs, age);
          this.closeRequest(nowMs);
          this.toDeciding(p.contents, r.evidenceAtMs, nowMs, age, r.evidenceAtMs);
        }
        break;
      case "deciding":
      case "confirming":
        if (this.contentsFlip(p, r.evidenceAtMs, nowMs, age)) break;
        // 행동 허가는 판단이 끝난 뒤 찍힌 사진으로만 한다(감지 모드는 YOLO가 맡는다)
        if (presence || this.state === "deciding" || this.decidedAtMs === null || r.evidenceAtMs <= this.decidedAtMs) break;
        if (alone) this.act(`근거 ${sec(age)} 전 · 사람 없음 · 컵 그대로`, nowMs, age, null);
        else this.noteOnce("confirm", `재확인 못 함(${notAlone}) → 다음 사진 기다림`, nowMs, age);
        break;
      case "acting":
        if (this.contentsFlip(p, r.evidenceAtMs, nowMs, age)) break;
        // VLM은 식탁을 비추는지 모른다: 식탁 모름과 같이 센다
        if (!presence) this.actingStep(r.evidenceAtMs, r.evidenceLatestMs ?? r.evidenceAtMs, p.cup_visible === "no" ? "unknown" : null, nowMs, age, "VLM");
        break;
      default:
        break;
    }
    return this.flush();
  }

  /** 요청 답 사진 한 장의 판정. 장면 판정과 따로 받는다(사진 업로드가 늦어 더 새 장면 판정이 먼저 끝나도 버리지 않게). */
  private observeAnswer(r: Observed, nowMs: number): MachineOutput {
    const age = nowMs - r.evidenceAtMs;
    const p = r.perception;
    if (r.evidenceAtMs <= this.lastRequestAtMs) return this.flush();
    if (age > this.answerStaleMs) {
      if (this.state === "requesting") this.note("answer", `답 사진이 ${sec(age)} 전 것이라 쓰지 않음 → 다시 찍어 주세요`, nowMs, age);
      return this.flush();
    }
    // 판단·재확인·행동 중에 온 둘째 답 사진: 판단 근거와 다른 컵 안이면 다시 판단한다
    if (this.state === "deciding" || this.state === "confirming" || this.state === "acting") {
      if (p) this.contentsFlip(p, r.evidenceAtMs, nowMs, age);
      return this.flush();
    }
    if (this.state !== "requesting") return this.flush();
    if (p?.contents_status === "confirmed") {
      this.note("answer", `컵 안 확인: ${CONTENTS_WORD[p.contents]}(확신, 답 사진)`, nowMs, age);
      this.closeRequest(nowMs);
      this.toDeciding(p.contents, r.evidenceAtMs, nowMs, age, r.evidenceAtMs);
    } else {
      this.note("answer", p ? "답 사진에서 컵 안을 확신하지 못함 → 다시 찍어 주세요" : `답 사진 판정 실패(${r.error ?? "이유 모름"}) → 다시 찍어 주세요`, nowMs, age);
    }
    return this.flush();
  }

  /** 판단 근거 사진보다 뒤에 찍힌 사진에서 확신한 내용물이 다르면, 언제 도착했든 근거가 뒤집힌 것이다.
   *  세대를 올려 진행 중이거나 끝난 판단을 버리고(행동 중이면 거두고) 새 내용물로 다시 판단한다. 다시 판단했으면 true. */
  private contentsFlip(p: Perception, evidenceAtMs: number, nowMs: number, age: number): boolean {
    if (evidenceAtMs <= this.decisionEvidenceMs || p.contents_status !== "confirmed" || p.contents === this.decisionContents) return false;
    const was = CONTENTS_WORD[this.decisionContents ?? "unknown"];
    if (this.acting) this.finish("withdrawn", `판단 근거와 다른 내용물(${was} → ${CONTENTS_WORD[p.contents]}) → 행동 거둠`, nowMs);
    this.generation++;
    this.decidedAtMs = null;
    this.note("decide", `판단 근거와 다른 내용물이 보임(${was} → ${CONTENTS_WORD[p.contents]}) → 다시 판단`, nowMs, age);
    this.toDeciding(p.contents, evidenceAtMs, nowMs, age, evidenceAtMs);
    return true;
  }

  /** YOLO 존재 판정(감지 모드에서만 쓴다). */
  observePresence(pr: Presence, nowMs: number): MachineOutput {
    if (!this.opts.presence || pr.atMs <= this.lastPresenceMs) return this.flush();
    const age = nowMs - pr.atMs;
    if (age > this.cfg.staleMs) {
      this.resetAway("오래된 YOLO 근거", nowMs, age);
      if (this.acting) this.acting.goneSince = null;
      return this.flush();
    }
    this.lastPresenceMs = pr.atMs;
    if (pr.person === "no") this.absentSince ??= pr.atMs;
    else if (pr.person === "yes") this.absentSince = null;

    if (pr.person === "yes" && CANCELLABLE.includes(this.state)) this.cancel("사람이 돌아옴(YOLO)", nowMs, age);

    // 식탁 모름(맞추기 전)은 막지 않는다. 식탁을 안 비추면 컵이 그대로인지 알 수 없다.
    const alone = pr.cup === "yes" && pr.person === "no" && pr.table !== "no";
    const notAlone = pr.person === "unknown" || pr.cup === "unknown" ? "YOLO 판정 모름(프레임 모자람)"
      : pr.cup !== "yes" ? "컵이 안 보임(YOLO)" : pr.person !== "no" ? "사람이 보임(YOLO)" : "식탁을 안 비춤";
    switch (this.state) {
      case "in_use":
        if (alone) {
          this.state = "away_check";
          this.awaySince = pr.latestMs;
          this.lastAwayEvidence = pr.atMs;
          this.lastAwayResultAt = nowMs;
          this.noteOnce("away", `사람 안 보임 · 컵 보임(YOLO) → 자리 비움 확인 시작(${sec(this.cfg.awayMs)})`, nowMs, age);
        }
        break;
      case "away_check": {
        if (!alone) {
          this.resetAway(notAlone, nowMs, age);
          break;
        }
        // 자리 비움 동안 찍힌 VLM 판정에서 확신한 컵 안만 쓴다(그 전 판정은 사람이 있을 때 본 것)
        const c = this.lastConfirmed && this.lastConfirmed.atMs >= this.awaySince! ? this.lastConfirmed : null;
        this.awayStep(pr.atMs, pr.latestMs, nowMs, age, c
          ? { contents: c.perception.contents, status: "confirmed", atMs: c.atMs }
          : { contents: "unknown", status: "unknown", atMs: null }, true);
        break;
      }
      case "confirming": {
        const decidedAt = this.decidedAtMs;
        if (decidedAt === null || pr.atMs <= decidedAt) break;
        // 창(600ms)에 남은 판단 전 컵 검출로 통과하지 않게 실제 마지막 컵 검출도 판단 뒤여야 한다
        const cupAfter = pr.seen.cup !== null && pr.seen.cup > decidedAt;
        if (!alone || !cupAfter) {
          this.noteOnce("confirm", `재확인 못 함(${alone ? "판단 뒤 컵 검출 없음" : notAlone}) → 다음 판정 기다림`, nowMs, age);
        } else if (!this.vlmClearAfter(decidedAt, nowMs)) {
          this.noteOnce("confirm", "YOLO 재확인 통과 · 판단 뒤 찍힌 새 VLM 판정(사람 없음)을 기다림", nowMs, age);
        } else {
          this.act(`YOLO 근거 ${sec(age)} 전 · 사람 없음 · 컵 그대로 · VLM도 사람 없음`, nowMs, age, pr.table === "yes" ? pr.tableId ?? null : null);
        }
        break;
      }
      case "acting": {
        // 재확인 때 비춘 식탁이 아니면 "아니오", 그 식탁을 모르면 "모름"(사용자 "치웠어요" 뒤만 센다)
        const target = this.acting?.tableId ?? null;
        const table = pr.table !== "yes" ? pr.table : !target ? "unknown" : pr.tableId === target ? "yes" : "no";
        this.actingStep(pr.atMs, pr.latestMs, pr.cup === "no" ? table : null, nowMs, age, "YOLO");
        break;
      }
      default:
        break;
    }
    return this.flush();
  }

  /** 자리 비움 확인 한 걸음: 공백이면 처음부터, awayMs가 차면 확인(감지 모드는 그 뒤 찍힌 VLM 사람 없음도 있어야). */
  private awayStep(evidenceAtMs: number, latestMs: number, nowMs: number, age: number, contents: AwayContents, needVlm: boolean): void {
    if (evidenceAtMs - this.lastAwayEvidence! > this.cfg.staleMs) {
      this.awaySince = latestMs;
      this.noteOnce("away", `판정 사이가 ${sec(evidenceAtMs - this.lastAwayEvidence!)} 비어 자리 비움 시계 처음부터`, nowMs, age);
    }
    this.lastAwayEvidence = evidenceAtMs;
    this.lastAwayResultAt = nowMs;
    if (evidenceAtMs - this.awaySince! < this.cfg.awayMs) return;
    if (needVlm && !this.vlmClearAfter(this.awaySince!, nowMs)) {
      this.noteOnce("away", `YOLO로 ${sec(this.cfg.awayMs)} 자리 비움 · 그 뒤 찍힌 VLM 판정(사람 없음)을 기다림`, nowMs, age);
      return;
    }
    this.awayConfirmed(contents, evidenceAtMs, nowMs, age);
  }

  private awayConfirmed(c: AwayContents, evidenceAtMs: number, nowMs: number, age: number): void {
    this.generation++;
    this.note("away", `자리 비움 확인(${sec(evidenceAtMs - this.awaySince!)})`, nowMs, age);
    this.awaySince = null;
    this.lastAwayEvidence = null;
    this.lastAwayResultAt = null;
    // 확신할 때만 묻지 않는다. 추정은 결정을 바꾸는 사실이므로 보여 달라고 한다.
    if (c.status === "confirmed") {
      this.toDeciding(c.contents, evidenceAtMs, nowMs, age, c.atMs);
      return;
    }
    if (this.opts.decisive && !this.opts.decisive()) {
      this.note("decide", "컵 안을 몰라도 결정이 같음 → 묻지 않고 판단", nowMs, age);
      this.toDeciding("unknown", evidenceAtMs, nowMs, age, null);
      return;
    }
    this.state = "requesting";
    this.request = { id: `req-${this.generation}`, issuedAtMs: nowMs };
    this.lastRequestAtMs = nowMs;
    this.note("request", "컵 안을 모름 · 치울지가 달라짐 · 쓰는 사람 없음 → 사진 요청", nowMs, age);
    this.out.events.push({ type: "request", id: this.request.id, text: REQUEST_TEXT, active: true, at_ms: nowMs });
  }

  private toDeciding(contents: Contents, endMs: number, nowMs: number, age: number, contentsAtMs: number | null): void {
    this.state = "deciding";
    this.decisionContents = contents;
    this.decisionEvidenceMs = endMs;
    this.decisionContentsAtMs = contents === "unknown" ? null : contentsAtMs;
    this.out.intents.push({ kind: "decide", generation: this.generation, contents, endMs, contentsAtMs: contents === "unknown" ? null : contentsAtMs });
    this.note("decide", `판단 모델에 물어봄(내용물: ${CONTENTS_WORD[contents]})`, nowMs, age);
  }

  /** 재확인 통과. acting을 켜면 모의 행동을 내고 결과를 기다린다. tableId: 재확인 때 비춘 식탁(모르면 null). */
  private act(why: string, nowMs: number, age: number, tableId: string | null): void {
    const task = this.action!;
    if (!this.opts.acting) {
      this.state = "done";
      this.note("act", `재확인 통과(${why}) → 실행 제안: ${task}`, nowMs, age);
      return;
    }
    const plan = planAction(task, `act-${this.generation}`);
    this.state = "acting";
    this.acting = { plan, startedAtMs: nowMs, goneSince: null, lastGoneMs: null, userDoneAtMs: null, tableId };
    this.note("act", `재확인 통과(${why}) → 실행 제안: ${task}`, nowMs, age);
    this.note("act", plan.dashboard, nowMs, null);
    this.out.events.push({ type: "action", id: plan.id, task, plan, active: true, at_ms: nowMs });
    if (plan.kind === "unsupported") this.finish("unsupported", plan.dashboard, nowMs);
  }

  private finish(outcome: ActionOutcome, text: string, nowMs: number): void {
    const a = this.acting!;
    this.acting = null;
    this.state = "done";
    this.out.events.push({ type: "action", id: a.plan.id, task: a.plan.task, plan: a.plan, active: false, at_ms: nowMs });
    this.out.events.push({ type: "result", id: a.plan.id, task: a.plan.task, outcome, text, at_ms: nowMs });
    this.note("result", text, nowMs, null);
    this.lastText = "";
  }

  /** 결과 확인 한 걸음. goneTable: 컵이 안 보이면 그때 식탁을 비추는가(yes/no/unknown), 컵이 보이거나 모르면 null.
   *  행동을 낸 뒤 찍힌 판정에서 컵 없음이 clearMs 동안 공백 없이 이어지면 치워짐. 식탁 yes는 그대로 세고,
   *  unknown은 사용자가 "치웠어요"를 누른 뒤 찍힌 것만, no는 세지 않는다. */
  private actingStep(evidenceAtMs: number, latestMs: number, goneTable: Presence["table"] | null, nowMs: number, age: number, source: string): void {
    const a = this.acting;
    if (!a || a.plan.check !== "cup_gone" || evidenceAtMs <= a.startedAtMs) return;
    const gone = goneTable === "yes" || (goneTable === "unknown" && a.userDoneAtMs !== null && evidenceAtMs > a.userDoneAtMs);
    if (!gone) {
      a.goneSince = null;
      a.lastGoneMs = null;
      return;
    }
    if (a.goneSince === null || a.lastGoneMs === null || evidenceAtMs - a.lastGoneMs > this.cfg.staleMs) a.goneSince = latestMs;
    a.lastGoneMs = evidenceAtMs;
    if (evidenceAtMs - a.goneSince >= this.clearMs) this.finish("cleared", `컵이 ${sec(evidenceAtMs - a.goneSince)} 동안 안 보임(${source}, 근거 ${sec(age)} 전) → 치워짐`, nowMs);
  }

  /** 폰 부탁·질문의 답. 지금 행동의 id가 아니면 버린다. */
  actionReply(id: string, choice: string, nowMs: number): MachineOutput {
    const a = this.acting;
    if (!a || a.plan.id !== id) return this.flush();
    const r = replyText(a.plan, choice);
    if (!r) return this.flush();
    if (r.outcome === "pending") {
      a.userDoneAtMs = nowMs;
      this.note("result", r.text, nowMs, null);
    } else {
      this.finish(r.outcome, r.text, nowMs);
    }
    return this.flush();
  }

  /** 판단 모델 결과. 세대가 다르거나 판단 중이 아니면 버린다. */
  decided(generation: number, pred: Prediction, tasks: string[], nowMs: number): MachineOutput {
    if (generation !== this.generation || this.state !== "deciding") return this.flush();
    this.decidedAtMs = nowMs;
    if (pred.task_index === -1) {
      this.state = "done";
      this.note("wait", `판단 모델: 대기 — ${pred.reasoning}`, nowMs, null);
      return this.flush();
    }
    this.action = tasks[pred.task_index] ?? null;
    this.state = "confirming";
    this.note("decide", `판단 모델: ${this.action} — ${pred.reasoning}`, nowMs, null);
    this.note("confirm", "행동 전 재확인: 판단 뒤에 찍힌 새 사진을 기다림", nowMs, null);
    this.lastText = "";
    return this.flush();
  }

  decisionFailed(generation: number, message: string, nowMs: number): MachineOutput {
    if (generation !== this.generation || this.state !== "deciding") return this.flush();
    this.state = "done";
    this.note("error", `판단 모델 실패(${message}) → 대기`, nowMs, null);
    return this.flush();
  }

  /** 시간만 흐를 때: 요청·재확인·행동 결과 시간 초과, 자리 비움 확인 중 판정 끊김. */
  tick(nowMs: number): MachineOutput {
    if (this.state === "requesting" && nowMs - this.request!.issuedAtMs > this.cfg.requestTimeoutMs) {
      this.generation++;
      this.closeRequest(nowMs);
      this.state = "done";
      this.note("wait", `요청에 ${sec(this.cfg.requestTimeoutMs)} 동안 답이 없음 → 대기`, nowMs, null);
    } else if (this.state === "confirming" && this.decidedAtMs !== null && nowMs - this.decidedAtMs > this.cfg.requestTimeoutMs) {
      this.generation++;
      this.state = "done";
      this.note("wait", "재확인할 새 사진이 오지 않음 → 대기", nowMs, null);
    } else if (this.state === "acting" && nowMs - this.acting!.startedAtMs > this.actionTimeoutMs) {
      this.finish("unconfirmed", `${sec(this.actionTimeoutMs)} 안에 결과를 확인하지 못함`, nowMs);
    } else if (this.state === "away_check" && this.lastAwayResultAt !== null && nowMs - this.lastAwayResultAt > this.cfg.staleMs) {
      // 판정이 늦게 오는 것은 정상(근거 1.5~2.6초)이라, 근거 시각이 아니라 마지막 도착 시각으로 끊김을 잰다.
      this.resetAway("새 판정이 끊김", nowMs, this.lastAwayEvidence === null ? null : nowMs - this.lastAwayEvidence);
    }
    return this.flush();
  }
}
