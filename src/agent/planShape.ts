// 클로이드 계획 모양 만들기: 에이전트가 정한 단계(src/agent/planner.ts) → PlanView(경로 잇기), 에이전트가 말 요청으로 기기를 바꾼 행동 → 한 단계 PlanView.
// 경로는 이동 가능 점 격자(src/layout/walk-grid.ts gridRoute)를 따라 x·z 축과 나란하게 잇는다. 걷기 길 자료가 없거나 격자 길을 못 찾으면 방 길(route)로 잇고,
// 로봇 자리를 모르거나 방 길도 없으면 경로 없이 단계만 낸다(계획 검사 src/act/check.ts가 빈 경로를 「갈 수 없음」으로 막는다).
// 무슨 단계를 할지는 여기서 정하지 않는다.
import type { AgentAction } from "../contract/events.js";
import type { PlanStep, PlanTarget, PlanView, StepKind, XZ } from "../contract/plan.js";
import type { FloorPlan } from "../layout/index.js";
import { DEVICE_VERB, STEP_LABEL } from "../act/labels.js";
import { approach, gridRoute, moveStop, route, type WalkWay } from "../layout/browser.js";

const base = (fp: FloorPlan, id: string, nowIso: string) => ({
  id, revision: 1, robot: { position: fp.robot.position, room: fp.robot.room }, updatedAt: nowIso,
});

/** 계획 한 단계(화면 단계 모양). move면 to가 목표 물건 평면 자리다(다음 단계가 자리를 아는 물건 집기면 그 물건 자리). 길의 끝은 moveStop이 정한다. */
export interface DraftStep { kind: StepKind; label: string; target?: PlanTarget; to?: XZ }

/** 계획 머리: id·할 일·판단 이유·출처·모의. */
export interface PlanHead { id: string; goal: string; judgment: string; source: PlanView["source"]; dryRun: boolean; nowIso: string }

/**
 * 단계 목록 → PlanView. 단계 id는 <계획 id>:<번호>. 이동 단계마다 앞 이동 끝(처음은 로봇 자리)에서 목적지까지 격자 길을 잇는다.
 * 목적지는 가구 앞자리, 없으면 그 방 대기 자리, 없으면 물건 자리에서 가장 가까운 격자 점이다. 갈 수 없는 방의 물건이면 그 방 문의 갈 수 있는 쪽 격자 점이다(moveStop).
 * 걷기 길 자료(way)가 없거나 격자 길을 못 찾으면 방 다각형·문으로 잇는 방 길(route, 목적지를 모르면 물건 0.55m 앞에서 멈춤)이다.
 * 로봇 자리를 모르거나 하나라도 방 길이 없으면 경로를 그리지 않는다(path·legs 빈 목록). 단계를 정하는 것은 에이전트(src/agent/planner.ts)다.
 */
export function assemblePlan(fp: FloorPlan, head: PlanHead, draft: DraftStep[], way?: WalkWay): PlanView {
  const steps: PlanStep[] = draft.map((d, i) => ({ id: `${head.id}:${i + 1}`, kind: d.kind, label: d.label, ...(d.target ? { target: d.target } : {}), status: "pending" }));
  let path: XZ[] = [];
  let legs: PlanView["legs"] = [];
  let at = fp.robot.position;
  for (const [i, d] of draft.entries()) {
    if (d.kind !== "move") continue;
    const stop = way && d.to ? moveStop(way, d.target?.objectId, d.target?.room ?? fp.objects.get(d.target?.objectId ?? "")?.room, d.to) : null;
    const grid = way && at && stop ? gridRoute(way.grid, way.geometry, at, stop, { square: true }) : null;
    const room = grid || !d.to ? null : route(fp, at, stop ?? d.to);
    const seg = grid ?? (room && (stop ? room : approach(room)));
    if (!seg) {
      path = [];
      legs = [];
      break;
    }
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
