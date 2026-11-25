// 에이전트 컵 계획이 맞춰야 할 모양(예전 서버의 cupPlan·askPlan). src에는 규칙으로 계획을 만드는 코드가 없고(tests/same-structure.test.ts),
// 서버는 에이전트 계획 모드(src/agent/planner.ts)가 만든 계획만 쓴다. 이 모양은 시험과 개발 도구(scripts/twin3d/fake-run.ts)만 쓴다.
import type { PlanView, XZ } from "../../src/contract/plan.js";
import type { FloorPlan } from "../../src/layout/floor.js";
import { GOAL, STEP_LABEL } from "../../src/act/labels.js";
import { assemblePlan, type DraftStep } from "../../src/agent/planShape.js";
import type { WalkWay } from "../../src/layout/walk-grid.js";

const byType = (fp: FloorPlan, type: string) => [...fp.objects.values()].find((o) => o.type === type);

/** 집을 물건(World State). 위치는 트윈 좌표 [x, 높이, y], 맞추기 전이면 null. */
export interface PickTarget { id: string; position: [number, number, number] | null }

/** 컵 치우기: 식탁으로 가서 컵을 집고 싱크대로 가서 내려놓는다. 식탁이 없으면 null, 싱크대가 없으면 식탁 두 단계만. 길은 걷기 길 자료(way)의 격자 길이고, 없으면 길 없이 단계만. */
export function cupPlan(fp: FloorPlan, id: string, nowIso: string, target: PickTarget | null = null, way?: WalkWay): PlanView | null {
  const table = byType(fp, "dining_table");
  if (!table) return null;
  const sink = byType(fp, "sink_counter");
  const at: XZ | null = target?.position ? [target.position[0], target.position[2]] : null;
  const draft: DraftStep[] = [
    { kind: "move", label: STEP_LABEL.goTable, target: { objectId: table.id, ...(table.room ? { room: table.room } : {}) }, to: at ?? table.position },
    { kind: "act", label: STEP_LABEL.pickCup, target: target ? { objectId: target.id, ...(at ? { position: at } : {}) } : { objectId: table.id } },
    ...(sink ? [
      { kind: "move" as const, label: STEP_LABEL.goSink, target: { objectId: sink.id, ...(sink.room ? { room: sink.room } : {}) }, to: sink.position },
      { kind: "act" as const, label: STEP_LABEL.placeCup, target: { objectId: sink.id } },
    ] : []),
  ];
  const walk = { ...fp, robot: { ...fp.robot, reachable: fp.rooms.map((r) => r.id) } };
  return assemblePlan(walk, { id, goal: GOAL.clearCup, judgment: "", source: "brain", dryRun: true, nowIso }, draft, way);
}

/** 사용자에게 물어보기: 폰으로 묻는 한 단계, 이동 없음. */
export function askPlan(fp: FloorPlan, id: string, nowIso: string): PlanView {
  return assemblePlan(fp, { id, goal: GOAL.askUser, judgment: "", source: "brain", dryRun: true, nowIso }, [{ kind: "ask", label: STEP_LABEL.askUser }]);
}
