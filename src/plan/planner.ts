// 클로이드 계획 만들기: 컵 시나리오(brain) 행동과 에이전트 기기 행동 → PlanView. 행동은 모두 모의다(기기 명령·ThinQ 호출이 없다).
// 경로는 평면도(scene.json plan)로 찾고, 로봇 자리를 모르거나 길이 없으면 경로 없이 단계만 낸다.
import type { AgentAction } from "../contract/events.js";
import type { PlanStep, PlanView, XZ } from "../contract/plan.js";
import type { FloorPlan } from "./floor.js";
import { DEVICE_VERB, GOAL, STEP_LABEL } from "./labels.js";
import { approach, route } from "./route.js";

const STOP_M = 0.55; // 로봇 반지름 0.22m + 여유

const byType = (fp: FloorPlan, type: string) => [...fp.objects.values()].find((o) => o.type === type);

const base = (fp: FloorPlan, id: string, nowIso: string) => ({
  id, revision: 1, robot: { position: fp.robot.position, room: fp.robot.room }, updatedAt: nowIso,
});

/** 집을 물건(World State). 위치는 트윈 좌표 [x, 높이, y], 맞추기 전이면 null. */
export interface PickTarget { id: string; position: [number, number, number] | null }

/**
 * 컵 치우기: 식탁으로 가서 컵을 집고 싱크대로 가서 내려놓는다. 식탁이 없으면 null, 싱크대가 없으면 식탁 두 단계만.
 * 집을 물건을 알면 집기 단계 대상이 그 물건이고, 위치까지 알면 첫 이동은 그 물건 앞까지 간다. 모르면 식탁을 가리킨다.
 */
export function cupPlan(fp: FloorPlan, id: string, nowIso: string, target: PickTarget | null = null): PlanView | null {
  const table = byType(fp, "dining_table");
  if (!table) return null;
  const sink = byType(fp, "sink_counter");
  const at: XZ | null = target?.position ? [target.position[0], target.position[2]] : null;
  const steps: PlanStep[] = [
    { id: `${id}:1`, kind: "move", label: STEP_LABEL.goTable, target: { objectId: table.id, ...(table.room ? { room: table.room } : {}) }, status: "pending" },
    { id: `${id}:2`, kind: "act", label: STEP_LABEL.pickCup, target: target ? { objectId: target.id, ...(at ? { position: at } : {}) } : { objectId: table.id }, status: "pending" },
  ];
  if (sink) {
    steps.push(
      { id: `${id}:3`, kind: "move", label: STEP_LABEL.goSink, target: { objectId: sink.id, ...(sink.room ? { room: sink.room } : {}) }, status: "pending" },
      { id: `${id}:4`, kind: "act", label: STEP_LABEL.placeCup, target: { objectId: sink.id }, status: "pending" },
    );
  }
  // 이동마다 경로를 잇는다. 하나라도 길이 없으면 경로처럼 그리지 않는다
  let path: XZ[] = [];
  let legs: PlanView["legs"] = [];
  const leg1 = route(fp, fp.robot.position, at ?? table.position);
  const toTable = leg1 && approach(leg1, STOP_M);
  const leg2 = toTable && sink ? route(fp, toTable.at(-1)!, sink.position) : null;
  if (toTable && (!sink || leg2)) {
    path = [...toTable, ...(leg2 ? approach(leg2, STOP_M).slice(1) : [])];
    legs = [{ stepId: steps[0]!.id, end: toTable.length - 1 }, ...(sink ? [{ stepId: steps[2]!.id, end: path.length - 1 }] : [])];
  }
  return { ...base(fp, id, nowIso), source: "brain", goal: GOAL.clearCup, judgment: "", dryRun: true, path, legs, steps, status: "planned" };
}

/** 사용자에게 물어보기: 폰으로 묻는 한 단계, 이동 없음. */
export function askPlan(fp: FloorPlan, id: string, nowIso: string): PlanView {
  return {
    ...base(fp, id, nowIso), source: "brain", goal: GOAL.askUser, judgment: "", dryRun: true, path: [], legs: [],
    steps: [{ id: `${id}:1`, kind: "ask", label: STEP_LABEL.askUser, status: "pending" }], status: "planned",
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
