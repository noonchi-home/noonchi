import type { AttemptKey, EvidenceRef } from "./assistance.js";
import type { GoalDrop } from "./goal.js";
import type { DeviceStateKey } from "./world.js";

export type TraceKind = "AGENT" | "OBSERVATION" | "LLM" | "TOOL" | "EXECUTION" | "GUARDRAIL";
export type TraceState = "pending" | "done" | "failed" | "cancelled";

/** IDs of the production messages that led to a public row. Free-form model and user text have no field here. */
export interface TraceRefs {
  goal_id?: string;
  decision_id?: string;
  plan_id?: string;
  step_id?: string;
  request_id?: string;
  object_id?: string;
  attempt?: AttemptKey;
  evidence?: EvidenceRef;
}

/** Private parameters to resolve against the action registry and this home's verified layout. */
export interface TraceTarget {
  action?: string;
  destination?: string;
  device?: string;
  deviceState?: DeviceStateKey;
  /** FSM 판단·행동 선택: 사람 상태 FSM 상태 id(지금 상태와 일어난 화살표의 출발 상태). 화살표가 없으면 personFrom이 없다. */
  personState?: string;
  personFrom?: string;
  /** 행동 선택: 그 화살표를 반성으로 배웠다. */
  learned?: boolean;
  /** 목표 준비: 버린 까닭. */
  goalDrop?: GoalDrop;
  /** 실행 전 검사: 통과한 항목. */
  checks?: TraceCheck[];
  /** 활동 종료: 사람이 떠난 때부터 첫 명령까지(ms). */
  firstCommandMs?: number;
}

/** 실행 전 검사 통과 항목: same 판단 뒤에 같은 대상을 다시 봄 · empty 대상 안이 비었음 · free 아무도 들거나 쓰지 않음. */
export type TraceCheck = "same" | "empty" | "free";

export interface TraceRow {
  id: string;
  activity_id: string;
  rev: number;
  /** Keep the completed preparation row while its goal or execution is active. */
  retained?: true;
  cause_id?: string;
  refs: TraceRefs;
  kind: TraceKind;
  name: string;
  input: string;
  output: string;
  started_ms: number | null;
  ended_ms: number | null;
  state: TraceState;
}

export interface TraceMessage { type: "trace"; epoch: string; rows: TraceRow[] }

export type TraceEvent =
  | "goal" | "action" | "wait" | "replan" | "pam" | "vlm" | "closer_vlm" | "observer" | "planner" | "dialog" | "check"
  | "closer" | "top" | "device_tool" | "move" | "pick" | "place" | "work" | "activity_result"
  | "person_left" | "person_changed" | "object_changed" | "device" | "safety" | "guard"
  | "remote_sent" | "remote_pressed";
export type TraceOutput =
  | "goal_armed" | "goal_planning" | "goal_ready" | "goal_checking" | "goal_fired" | "goal_used" | "goal_dropped" | "check_passed"
  | "model_answer" | "scene_people" | "scene_objects" | "scene_people_objects" | "scene_no_target"
  | "selected" | "select_cup" | "waiting" | "late" | "replanned"
  | "failed" | "stopped" | "found" | "unconfirmed" | "cup_empty" | "cup_contents"
  | "step_done" | "place_done" | "move_done" | "activity_done" | "activity_cancelled" | "activity_failed"
  | "safety_fall" | "safety_monitor" | "safety_device" | "safety_cleared"
  | "guard_busy" | "guard_safety" | "guard_changed" | "guard_target" | "guard_placed" | "guard_plan"
  | "device_ack" | "approval_needed" | "person_seen" | "person_not_seen" | "person_room_changed" | "changed"
  | "remote_signal_sent" | "remote_key_pressed";

/** Production producers choose fixed public vocabulary and retain the real correlation keys. */
export interface TracePort {
  start(event: TraceEvent, refs?: TraceRefs, atMs?: number, target?: TraceTarget): string;
  /** target: 닫을 때 안 사실(FSM 판단은 답을 읽은 뒤 상태를 싣는다). */
  finish(id: string, state: Exclude<TraceState, "pending">, output: TraceOutput, atMs?: number, causeId?: string, evidence?: EvidenceRef, target?: TraceTarget): void;
  event(event: TraceEvent, refs: TraceRefs, output: TraceOutput, causeId?: string, target?: TraceTarget): TraceRow | undefined;
  link(from: TraceRefs, to: TraceRefs): void;
}
