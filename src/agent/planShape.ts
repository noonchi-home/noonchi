// 클로이드 계획 모양 만들기: 에이전트가 정한 단계(src/agent/planner.ts) → PlanView(경로 잇기), 에이전트가 말 요청으로 기기를 바꾼 행동 → 한 단계 PlanView.
// 경로는 평면도(scene.json plan)로 찾고, 로봇 자리를 모르거나 길이 없으면 경로 없이 단계만 낸다. 무슨 단계를 할지는 여기서 정하지 않는다.
import type { AgentAction } from "../contract/events.js";
import type { PlanStep, PlanTarget, PlanView, StepKind, XZ } from "../contract/plan.js";
import type { FloorPlan } from "../layout/floor.js";
import { DEVICE_VERB, STEP_LABEL } from "../act/labels.js";
import { approach, route } from "../layout/route.js";

const STOP_M = 0.55; // 로봇 반지름 0.22m + 여유

const base = (fp: FloorPlan, id: string, nowIso: string) => ({
  id, revision: 1, robot: { position: fp.robot.position, room: fp.robot.room }, updatedAt: nowIso,
});

/** 계획 한 단계(화면 단계 모양). move면 to가 길의 목적지 평면 자리다(목표 물건 자리, 다음 단계가 자리를 아는 물건 집기면 그 물건 자리). */
export interface DraftStep { kind: StepKind; label: string; target?: PlanTarget; to?: XZ }

/** 계획 머리: id·할 일·판단 이유·출처·모의. */
export interface PlanHead { id: string; goal: string; judgment: string; source: PlanView["source"]; dryRun: boolean; nowIso: string }

/**
 * 단계 목록 → PlanView. 단계 id는 <계획 id>:<번호>. 이동 단계마다 앞 이동 끝(처음은 로봇 자리)에서 목적지까지 길을 잇고 목적지 STOP_M 앞에서 멈춘다.
 * 로봇 자리를 모르거나 하나라도 길이 없으면 경로처럼 그리지 않는다(path·legs 빈 목록). 단계를 정하는 것은 에이전트(src/agent/planner.ts)다.
 */
export function assemblePlan(fp: FloorPlan, head: PlanHead, draft: DraftStep[]): PlanView {
  const steps: PlanStep[] = draft.map((d, i) => ({ id: `${head.id}:${i + 1}`, kind: d.kind, label: d.label, ...(d.target ? { target: d.target } : {}), status: "pending" }));
  let path: XZ[] = [];
  let legs: PlanView["legs"] = [];
  let at = fp.robot.position;
  for (const [i, d] of draft.entries()) {
    if (d.kind !== "move") continue;
    const leg = d.to ? route(fp, at, d.to) : null;
    if (!leg) {
      path = [];
      legs = [];
      break;
    }
    const seg = approach(leg, STOP_M);
    path = path.length ? [...path, ...seg.slice(1)] : seg;
    legs.push({ stepId: steps[i]!.id, end: path.length - 1 });
    at = seg.at(-1)!;
  }
  return {
    ...base(fp, head.id, head.nowIso), source: head.source, goal: head.goal, judgment: head.judgment, dryRun: head.dryRun, path, legs, steps, status: "planned",
  };
}

/** 에이전트가 기기를 바꾼 행동 하나 → 이동 없는 한 단계 계획. 기기를 바꾸지 않는 도구거나 기기를 못 찾았으면 null. */
export function devicePlan(fp: FloorPlan, a: AgentAction, nowIso: string): PlanView | null {
  const verb = DEVICE_VERB[a.tool];
  if (!verb || !a.deviceId) return null;
  const id = `agent:${a.at}:${a.deviceId}`;
  const label = STEP_LABEL.device(a.deviceLabel ?? a.deviceId, verb);
  const waiting = a.needsConfirmation === true;
  return {
    ...base(fp, id, nowIso), source: "agent", goal: label, judgment: "", dryRun: false, path: [], legs: [],
    steps: [{ id: `${id}:1`, kind: "device", label, target: { deviceId: a.deviceId }, status: waiting ? "pending" : a.ok ? "done" : "failed" }],
    status: waiting ? "planned" : a.ok ? "done" : "failed",
  };
}
