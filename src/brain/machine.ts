// 컵 시나리오 상태 기계. 판단 흐름은 코드가 정한다: 언제 자리 비움인지, 언제 더 보여 달라고 할지, 언제 행동해도 되는지.
// 순수하게 동작한다: 판정·시간을 받아 이벤트(대시보드·폰)와 할 일(판단 모델 호출)을 돌려준다. 비동기 호출은 brain.ts가 한다.
//
// 근거 규칙(계획서 2026-11-04-brain-cup.md "고정 규칙")
// - 근거 시각 = 판정 창 마지막 사진의 촬영 시각. staleMs를 넘은 판정·실패한 판정은 모름이다.
// - 자리 비움: 사용을 본 뒤, 컵 보임 + 사람 없음인 새 판정이 awayMs 동안 공백(staleMs 초과) 없이 이어질 때만.
// - 사람이 다시 보이면 어느 단계든 거두고 사용 중으로. 세대 번호를 올려 늦게 온 판단 결과를 버린다.
// - 요청 답은 요청 뒤에 찍힌 사진만, 행동 전 재확인은 판단이 끝난 뒤 찍힌 사진만 받는다.

import type { Prediction } from "./decision.js";
import type { Contents, Perception } from "./perception.js";

export type BrainState = "watching" | "in_use" | "away_check" | "requesting" | "deciding" | "confirming" | "done";
export type BrainStage = "use" | "away" | "request" | "answer" | "decide" | "confirm" | "act" | "wait" | "cancel" | "stale" | "error";

export type BrainEvent =
  | { type: "brain"; stage: BrainStage; state: BrainState; text: string; at_ms: number; evidence_age_ms: number | null; generation: number }
  | { type: "request"; id: string; text: string; active: boolean; at_ms: number };

export interface DecideIntent { kind: "decide"; generation: number; contents: Contents; endMs: number }

export interface MachineOutput { events: BrainEvent[]; intents: DecideIntent[] }

export interface MachineConfig { staleMs: number; awayMs: number; requestTimeoutMs: number }

export interface Observed { perception: Perception | null; evidenceAtMs: number; error?: string }

export const REQUEST_TEXT = "컵 안이 보이게 위에서 찍어 주세요";

const CONTENTS_WORD: Record<Contents, string> = { empty: "빈 컵", not_empty: "음료가 남은 컵", unknown: "모름" };
const sec = (ms: number) => `${(ms / 1000).toFixed(1)}초`;

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
  private lastText = "";
  private out: MachineOutput = { events: [], intents: [] };

  constructor(private readonly cfg: MachineConfig, private readonly opts: { decisive?: () => boolean } = {}) {}

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

  observe(r: Observed, nowMs: number): MachineOutput {
    const age = nowMs - r.evidenceAtMs;
    if (r.evidenceAtMs <= this.lastEvidenceMs) return this.flush(); // 순서가 뒤바뀐 판정
    if (!r.perception) {
      this.note("error", `판정 실패(${r.error ?? "이유 모름"}) → 모름`, nowMs, age);
      this.lastText = "";
      this.resetAway("판정 실패", nowMs, age);
      return this.flush();
    }
    if (age > this.cfg.staleMs) {
      this.note("stale", `근거가 ${sec(age)} 지나 모름으로 봄`, nowMs, age);
      this.lastText = "";
      this.resetAway("오래된 근거", nowMs, age);
      return this.flush();
    }
    this.lastEvidenceMs = r.evidenceAtMs;
    const p = r.perception;

    if (p.person_present === "yes" && ["away_check", "requesting", "deciding", "confirming", "done"].includes(this.state)) {
      const what = { away_check: "자리 비움 확인 멈춤", requesting: "요청 거둠", deciding: "판단 멈춤", confirming: "행동 멈춤", done: "다시 지켜봄" }[this.state as "away_check"];
      this.generation++;
      this.closeRequest(nowMs);
      this.state = "in_use";
      this.awaySince = null;
      this.lastAwayEvidence = null;
      this.lastAwayResultAt = null;
      this.decidedAtMs = null;
      this.note("cancel", `사람이 돌아옴 → ${what}`, nowMs, age);
      this.lastText = "";
    }

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
        if (alone) {
          this.state = "away_check";
          this.awaySince = r.evidenceAtMs;
          this.lastAwayEvidence = r.evidenceAtMs;
          this.lastAwayResultAt = nowMs;
          this.noteOnce("away", `사람 안 보임 · 컵 보임 → 자리 비움 확인 시작(${sec(this.cfg.awayMs)})`, nowMs, age);
        } else if (!using && p.person_present === "yes") {
          this.noteOnce("use", "컵 곁에 사람이 있음", nowMs, age);
        }
        break;
      case "away_check":
        if (!alone) {
          this.resetAway(notAlone, nowMs, age);
          break;
        }
        if (r.evidenceAtMs - this.lastAwayEvidence! > this.cfg.staleMs) {
          this.awaySince = r.evidenceAtMs;
          this.noteOnce("away", `판정 사이가 ${sec(r.evidenceAtMs - this.lastAwayEvidence!)} 비어 자리 비움 시계 처음부터`, nowMs, age);
        }
        this.lastAwayEvidence = r.evidenceAtMs;
        this.lastAwayResultAt = nowMs;
        if (r.evidenceAtMs - this.awaySince! >= this.cfg.awayMs) this.awayConfirmed(p, r.evidenceAtMs, nowMs, age);
        break;
      case "requesting":
        // 답은 요청 뒤에 찍히고 확신한 내용물만 받는다(옆모습 추정은 결정을 바꾸는 근거로 약하다).
        if (r.evidenceAtMs > this.request!.issuedAtMs && p.contents_status === "confirmed") {
          this.note("answer", `컵 안 확인: ${CONTENTS_WORD[p.contents]}(확신)`, nowMs, age);
          this.closeRequest(nowMs);
          this.toDeciding(p.contents, r.evidenceAtMs, nowMs, age);
        }
        break;
      case "deciding":
      case "confirming":
        // 판단 근거 사진보다 뒤에 찍힌 사진에서 확신한 내용물이 다르면, 언제 도착했든 근거가 뒤집힌 것이다.
        // 세대를 올려 진행 중이거나 끝난 판단을 버리고 새 내용물로 다시 판단한다.
        if (r.evidenceAtMs > this.decisionEvidenceMs && p.contents_status === "confirmed" && p.contents !== this.decisionContents) {
          this.generation++;
          this.decidedAtMs = null;
          this.note("decide", `판단 근거와 다른 내용물이 보임(${CONTENTS_WORD[this.decisionContents ?? "unknown"]} → ${CONTENTS_WORD[p.contents]}) → 다시 판단`, nowMs, age);
          this.toDeciding(p.contents, r.evidenceAtMs, nowMs, age);
          break;
        }
        // 행동 허가는 판단이 끝난 뒤 찍힌 사진으로만 한다
        if (this.state === "deciding" || this.decidedAtMs === null || r.evidenceAtMs <= this.decidedAtMs) break;
        if (alone) {
          this.state = "done";
          this.note("act", `재확인 통과(근거 ${sec(age)} 전 · 사람 없음 · 컵 그대로) → 실행 제안: ${this.action}`, nowMs, age);
        } else {
          this.noteOnce("confirm", `재확인 못 함(${notAlone}) → 다음 사진 기다림`, nowMs, age);
        }
        break;
      default:
        break;
    }
    return this.flush();
  }

  private awayConfirmed(p: Perception, evidenceAtMs: number, nowMs: number, age: number): void {
    this.generation++;
    this.note("away", `자리 비움 확인(${sec(evidenceAtMs - this.awaySince!)})`, nowMs, age);
    this.awaySince = null;
    this.lastAwayEvidence = null;
    this.lastAwayResultAt = null;
    // 확신할 때만 묻지 않는다. 추정은 결정을 바꾸는 사실이므로 보여 달라고 한다.
    if (p.contents_status === "confirmed") {
      this.toDeciding(p.contents, evidenceAtMs, nowMs, age);
      return;
    }
    if (this.opts.decisive && !this.opts.decisive()) {
      this.note("decide", "컵 안을 몰라도 결정이 같음 → 묻지 않고 판단", nowMs, age);
      this.toDeciding("unknown", evidenceAtMs, nowMs, age);
      return;
    }
    this.state = "requesting";
    this.request = { id: `req-${this.generation}`, issuedAtMs: nowMs };
    this.note("request", "컵 안을 모름 · 치울지가 달라짐 · 쓰는 사람 없음 → 사진 요청", nowMs, age);
    this.out.events.push({ type: "request", id: this.request.id, text: REQUEST_TEXT, active: true, at_ms: nowMs });
  }

  private toDeciding(contents: Contents, endMs: number, nowMs: number, age: number): void {
    this.state = "deciding";
    this.decisionContents = contents;
    this.decisionEvidenceMs = endMs;
    this.out.intents.push({ kind: "decide", generation: this.generation, contents, endMs });
    this.note("decide", `판단 모델에 물어봄(내용물: ${CONTENTS_WORD[contents]})`, nowMs, age);
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

  /** 시간만 흐를 때: 요청·재확인 시간 초과, 자리 비움 확인 중 판정 끊김. */
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
    } else if (this.state === "away_check" && this.lastAwayResultAt !== null && nowMs - this.lastAwayResultAt > this.cfg.staleMs) {
      // 판정이 늦게 오는 것은 정상(근거 1.5~2.6초)이라, 근거 시각이 아니라 마지막 도착 시각으로 끊김을 잰다.
      this.resetAway("새 판정이 끊김", nowMs, this.lastAwayEvidence === null ? null : nowMs - this.lastAwayEvidence);
    }
    return this.flush();
  }
}
