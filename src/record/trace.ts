import type { EvidenceRef } from "../contract/assistance.js";
import type { TraceEvent, TraceKind, TraceMessage, TraceOutput, TracePort, TraceRefs, TraceRow, TraceState, TraceTarget } from "../contract/trace.js";
import { TRACE_KEPT } from "../shared/trace.js";

const LABELS = {
  goal: ["AGENT", "목표 준비", "확인된 습관 · 대상"],
  action: ["AGENT", "행동 선택", "집 상태 · 행동 목록"],
  wait: ["AGENT", "대기 판단", "집 상태 · 행동 목록"],
  replan: ["AGENT", "계획 변경", "실행 중 달라진 조건"],
  pam: ["LLM", "FSM 판단", "집 상태 · 습관"],
  vlm: ["LLM", "VLM 장면 해석", "카메라 프레임"],
  closer_vlm: ["LLM", "VLM 근접 해석", "근접 프레임"],
  observer: ["LLM", "관찰 방법 선택", "미확인 조건"],
  planner: ["LLM", "실행 계획 작성", "선택 행동 · 집 상태"],
  dialog: ["LLM", "요청 해석", "사용자 요청"],
  closer: ["TOOL", "근접 관찰", "대상 물건"],
  top: ["TOOL", "컵 안 확인", "대상 컵"],
  check: ["GUARDRAIL", "실행 전 검사", "대상 물건"],
  device_tool: ["TOOL", "가전 도구", "가전 명령"],
  move: ["EXECUTION", "이동 안내", "목적지"],
  pick: ["EXECUTION", "집기 안내", "대상 물건"],
  place: ["EXECUTION", "배치 안내", "물건 · 놓을 위치"],
  work: ["EXECUTION", "수행 안내", "현재 단계"],
  activity_result: ["EXECUTION", "활동 종료", "도움 시도"],
  person_left: ["OBSERVATION", "사용자 자리 이탈", "사용자 관찰"],
  person_changed: ["OBSERVATION", "사용자 상태 변화", "사용자 관찰"],
  object_changed: ["OBSERVATION", "물건 상태 변화", "대상 관찰"],
  device: ["OBSERVATION", "가전 상태 변화", "가전 확인"],
  safety: ["GUARDRAIL", "안전 상태", "안전 검사"],
  guard: ["GUARDRAIL", "실행 보류", "실행 전 검사"],
  remote_sent: ["TOOL", "리모컨 신호", "리모컨 단추"],
  remote_pressed: ["OBSERVATION", "리모컨 누름", "리모컨 수신"],
} satisfies Record<TraceEvent, readonly [TraceKind, string, string]>;

const OUTPUT = {
  goal_armed: "준비 시작", goal_planning: "미리 계획 작성 중", goal_ready: "미리 만든 계획 준비됨",
  goal_checking: "자리 이탈 확인 중", goal_fired: "자리 이탈 확인", goal_used: "준비한 목표 사용", goal_dropped: "목표 종료",
  model_answer: "응답 받음", scene_people: "사람 관찰", scene_objects: "물건 관찰", scene_people_objects: "사람과 물건 관찰",
  scene_no_target: "사람·물건 미확인", selected: "행동 선택", select_cup: "컵 치우기 선택", waiting: "지켜보기",
  late: "이전 판단 답 보류", replanned: "새 계획으로 이어감", failed: "실패", stopped: "중단",
  found: "대상 확인", unconfirmed: "확인하지 못함", cup_empty: "빈 컵 확인", cup_contents: "컵 내용물 확인", check_passed: "통과",
  step_done: "수행 확인", place_done: "배치 확인", move_done: "도착 확인",
  activity_done: "활동 완료", activity_cancelled: "활동 취소", activity_failed: "활동 실패", safety_fall: "쓰러짐 의심",
  safety_monitor: "가전 꺼짐 확인 중", safety_device: "가전 안전 조치 필요", safety_cleared: "안전 알림 해제",
  guard_busy: "대상 사용 중", guard_safety: "안전 조치 우선", guard_changed: "근거가 달라져 실행 보류",
  guard_target: "대상 미확인", guard_placed: "대상을 이미 치운 것으로 확인", guard_plan: "계획 조건을 충족하지 못함",
  device_ack: "가전 응답 확인", approval_needed: "확인 대기",
  person_seen: "사용자 관찰", person_not_seen: "시야에서 사용자 미확인", person_room_changed: "사용자 방 변화 확인", changed: "상태 변화 확인",
  remote_signal_sent: "신호 보냄", remote_key_pressed: "단추 누름 확인",
} satisfies Record<TraceOutput, string>;

/** refs가 빈 관찰 줄. 부를 때마다 새 활동이 되지 않게 한 지켜보기 활동에 모은다. */
const WATCH: ReadonlySet<TraceEvent> = new Set<TraceEvent>(["vlm", "person_changed", "safety"]);
const WATCH_KEY = "watch";

const id = (value: string | undefined) => value && /^[a-zA-Z0-9#._:-]{1,180}$/.test(value) ? value : undefined;
const stamp = (value: number) => Number.isFinite(value) ? value : null;
const publicEvidence = (evidence?: EvidenceRef): EvidenceRef | undefined =>
  evidence && id(evidence.source) && id(evidence.subjectId) && id(evidence.originId) && Number.isFinite(evidence.observedMs)
    ? { source: evidence.source, subjectId: evidence.subjectId, originId: evidence.originId, observedMs: evidence.observedMs } : undefined;

function publicRefs(refs: TraceRefs): TraceRefs {
  const attempt = refs.attempt;
  return {
    goal_id: id(refs.goal_id), decision_id: id(refs.decision_id), plan_id: id(refs.plan_id),
    step_id: id(refs.step_id), request_id: id(refs.request_id), object_id: id(refs.object_id),
    attempt: attempt && id(attempt.boot) && id(attempt.homeEpoch) && id(attempt.attemptId) && Number.isSafeInteger(attempt.gen)
      ? { boot: attempt.boot, homeEpoch: attempt.homeEpoch, attemptId: attempt.attemptId, gen: attempt.gen } : undefined,
    evidence: publicEvidence(refs.evidence),
  };
}

function keysOf(r: TraceRefs): string[] {
  return [
    r.goal_id && "goal:" + r.goal_id, r.plan_id && "plan:" + r.plan_id,
    r.decision_id && "decision:" + r.decision_id, r.request_id && "request:" + r.request_id,
    r.attempt && "attempt:" + r.attempt.attemptId,
  ].filter((key): key is string => !!key);
}

/** A single home owns the bounded replay and the live stream. It never feeds decisions back into the product. */
export class TraceJournal implements TracePort {
  private seq = 0;
  private activitySeq = 0;
  private closed = false;
  private readonly rows = new Map<string, TraceRow>();
  private readonly keys = new Map<string, string>();
  private readonly outputDetails = new Map<string, string>();
  /** 진행 중 줄의 사건: 닫을 때 받은 target으로 글을 다시 만든다(FSM 판단). */
  private readonly pendingEvents = new Map<string, TraceEvent>();

  constructor(readonly epoch: string, private readonly now: () => number, private readonly publish: (msg: TraceMessage) => void) {}

  snapshot(): TraceMessage {
    return { type: "trace", epoch: this.epoch, rows: [...this.rows.values()] };
  }

  start(event: TraceEvent, refs: TraceRefs = {}, atMs = this.now(), target?: TraceTarget): string {
    return this.add(event, refs, "pending", stamp(atMs), null, undefined, target)?.id ?? "";
  }

  event(event: TraceEvent, refs: TraceRefs, output: TraceOutput, causeId?: string, target?: TraceTarget): TraceRow | undefined {
    return this.add(event, refs, "done", null, output, causeId, target);
  }

  finish(id: string, state: Exclude<TraceState, "pending">, output: TraceOutput, atMs = this.now(), causeId?: string, evidence?: EvidenceRef, target?: TraceTarget): void {
    const row = this.rows.get(id);
    if (this.closed || row?.state !== "pending") return;
    const ended_ms = stamp(atMs);
    const event = this.pendingEvents.get(id);
    this.pendingEvents.delete(id);
    const late = target && event ? this.describe(event, row.refs, target, OUTPUT[output]) : {};
    const detail = late.output ?? this.outputDetails.get(id);
    this.outputDetails.delete(id);
    const ref = publicEvidence(evidence);
    this.save({ ...row, ...(causeId ? { cause_id: causeId } : {}), ...(ref ? { refs: { ...row.refs, evidence: ref } } : {}),
      ...(state === "done" && late.input ? { input: late.input } : {}),
      state, output: state === "done" && detail ? detail : OUTPUT[output], rev: row.rev + 1,
      ended_ms: ended_ms === null || row.started_ms === null ? ended_ms : Math.max(row.started_ms, ended_ms) });
  }

  link(from: TraceRefs, to: TraceRefs): void {
    if (this.closed) return;
    const fromRefs = publicRefs(from);
    const toRefs = publicRefs(to);
    const fromKeys = keysOf(fromRefs);
    const previous = this.find(fromKeys);
    const activity_id = this.activity(keysOf(toRefs));
    for (const [key, activity] of this.keys) if (previous && activity === previous) this.remember(key, activity_id);
    for (const key of fromKeys) this.remember(key, activity_id);
    if (!previous || previous === activity_id) return;
    const root = this.first(activity_id);
    for (const row of this.rows.values()) {
      if (row.activity_id !== previous) continue;
      this.save({ ...row, activity_id, rev: row.rev + 1, cause_id: row.cause_id ?? root?.id,
        refs: { ...row.refs, ...Object.fromEntries(Object.entries(toRefs).filter(([, value]) => value !== undefined)) } });
    }
  }

  close(): void {
    if (this.closed) return;
    for (const row of [...this.rows.values()]) {
      if (row.state === "pending") this.finish(row.id, "cancelled", "stopped");
      if (row.retained) this.release(row.id);
    }
    this.closed = true;
  }

  protected retain(event: TraceEvent, refs: TraceRefs, output: TraceOutput, target?: TraceTarget): TraceRow | undefined {
    return this.add(event, refs, "done", null, output, undefined, target, true);
  }

  protected terminal(event: TraceEvent, refs: TraceRefs, state: Exclude<TraceState, "pending">, output: TraceOutput,
    startedMs: number, endedMs: number, causeId?: string, target?: TraceTarget): void {
    this.add(event, refs, state, stamp(startedMs), output, causeId, target, undefined, stamp(Math.max(startedMs, endedMs)));
  }

  protected release(id: string): void {
    const row = this.rows.get(id);
    if (!row?.retained) return;
    const { retained: _retained, ...rest } = row;
    this.save({ ...rest, rev: row.rev + 1 });
  }

  /** said: 그 줄의 고정 출력 글(아직 모르면 없음). 집마다 대상·자리·FSM 상태 글로 바꾼다(src/server/home/trace.ts). */
  protected describe(_event: TraceEvent, _refs: TraceRefs, _target?: TraceTarget, _said?: string): { input?: string; output?: string } {
    return {};
  }

  private add(event: TraceEvent, keys: TraceRefs, state: TraceState, started_ms: number | null, output: TraceOutput | null,
    cause_id?: string, target?: TraceTarget, retained?: true, ended_ms: number | null = null): TraceRow | undefined {
    if (this.closed) return;
    const refs = publicRefs(keys);
    const refKeys = keysOf(refs);
    const watch = refKeys.length === 0 && WATCH.has(event);
    const activity_id = this.activity(watch ? [WATCH_KEY] : refKeys);
    const [kind, name, fallback] = LABELS[event];
    const description = this.describe(event, refs, target, output ? OUTPUT[output] : undefined);
    // 지켜보기 줄끼리는 원인이 아니다: 앞 관찰 줄에 잇지 않는다.
    const parent = cause_id ?? (refs.evidence?.source === "world_change" ? refs.evidence.originId : undefined)
      ?? (watch ? undefined : this.first(activity_id, refs.request_id)?.id);
    const row = { id: this.epoch + ":" + ++this.seq, activity_id, rev: 1, ...(parent ? { cause_id: parent } : {}), ...(retained ? { retained } : {}),
      refs, kind, name, input: description.input ?? fallback,
      output: output ? description.output ?? OUTPUT[output] : kind === "EXECUTION" ? "시연자 수행 대기" : "결과 대기 중",
      started_ms, ended_ms, state };
    if (description.output && state === "pending") this.outputDetails.set(row.id, description.output);
    if (state === "pending") this.pendingEvents.set(row.id, event);
    this.save(row);
    return row;
  }

  private first(activity: string, request?: string): TraceRow | undefined {
    if (request) {
      for (const row of this.rows.values()) if (row.kind === "TOOL" && row.refs.request_id === request) return row;
    }
    for (const row of this.rows.values()) if (row.activity_id === activity) return row;
  }

  private find(keys: readonly string[]): string | undefined {
    for (const key of keys) {
      const known = this.keys.get(key);
      if (known) return known;
    }
  }

  private activity(keys: readonly string[]): string {
    const found = this.find(keys) ?? this.epoch + ":activity-" + ++this.activitySeq;
    for (const key of keys) if (!this.keys.has(key)) this.remember(key, found);
    return found;
  }

  private remember(key: string, activity: string): void {
    this.keys.set(key, activity);
    if (this.keys.size > TRACE_KEPT * 8) this.keys.delete(this.keys.keys().next().value!);
  }

  private save(row: TraceRow): void {
    const previous = this.rows.get(row.id);
    if (row.state !== "pending" && previous?.state === "pending") this.rows.delete(row.id);
    this.rows.set(row.id, row);
    if (this.rows.size > TRACE_KEPT) {
      const ended = [...this.rows.values()].find(value => value.state !== "pending" && !value.retained);
      const evicted = ended?.id ?? this.rows.keys().next().value!;
      this.rows.delete(evicted);
      this.outputDetails.delete(evicted);
      this.pendingEvents.delete(evicted);
    }
    this.publish({ type: "trace", epoch: this.epoch, rows: [row] });
  }
}
