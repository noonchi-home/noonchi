import type { PlanStep, PlanTarget } from "../../../src/contract/plan";
import type { WorldObject, WorldView } from "../../../src/contract/world";
import { planIdOf, taskOf } from "../../../src/act/tasks";
import { FSM_STATE_TEXT, OBJECT_NAME } from "../../../src/world/labels";
import { CLASSES, FACT_FRESH_MS } from "../../../src/world/vocab";
import { isOpen, type DashData } from "./data";

type NodeId = "focus" | "observation" | "target" | "step" | "destination";
export interface RelationNode { id: NodeId; label: string; role: string }
export interface RelationGraphData {
  nodes: RelationNode[];
  edges: { from: NodeId; to: NodeId }[];
  anchors: { id: NodeId; label: string; target: PlanTarget }[];
}

const STEP_KIND: Record<PlanStep["kind"], string> = {
  move: "이동", act: "작업", device: "가전 조작", ask: "질문", wait: "대기",
};
const objectClasses = new Set(Object.entries(CLASSES).filter(([, entry]) => entry.role === "object").map(([name]) => name));

function recent(time: number, now: number) {
  return time <= now && now - time <= FACT_FRESH_MS;
}

function observed(object: WorldObject | undefined, now: number): object is WorldObject {
  return !!object && object.status === "present" && recent(object.last_seen_ms, now);
}

/** 손에 든 물건은 맞춘 눈을 따른다. 위치를 모르는 물건에 임의의 방이나 가구를 붙이지 않는다. */
function objectTarget(object: WorldObject, world: WorldView | null, now: number): PlanTarget | null {
  const held = object.facts.place?.value === "in_hand" && object.facts.place.certainty === "confirmed";
  if (held) return world?.eye && recent(world.eye.at_ms, now) ? { position: world.eye.position } : null;
  if (object.position) return { objectId: object.id, position: [object.position[0], object.position[2]] };
  return object.surface ? { objectId: object.surface } : null;
}

/** 열린 계획, 서 있는 목표, 최근 판단 순으로 하나를 고른다. 행동 이름은 같은 실행의 증거가 아니다. */
type RelationWorld = WorldView & { surfaces_seen?: readonly { id: string; label: string }[] };

export function relationsOf<T extends Pick<DashData, "plan" | "decision" | "goal">>(data: T, world: RelationWorld | null, nowMs: number, names?: ReadonlyMap<string, string>): RelationGraphData {
  const graph: RelationGraphData = { nodes: [], edges: [], anchors: [] };
  const plan = isOpen(data.plan) ? data.plan : null;
  const goal = data.goal && data.goal.status !== "dropped" && data.goal.status !== "used" &&
    (!plan || data.goal.plan?.id === plan.id) ? data.goal : null;
  const last = data.decision;
  const decision = last?.status === "valid" && !last.late && recent(last.at_ms, nowMs) &&
    (plan ? plan.id === planIdOf(last.id) : !goal) ? last : null;
  if (!plan && !goal && !decision) return graph;

  const action = taskOf(plan?.goal ?? goal?.action ?? decision?.action ?? null);
  graph.nodes.push({
    id: "focus", role: plan ? "계획" : goal ? "목표" : "판단",
    label: action?.name ?? (plan ? "계획 진행" : goal ? "목표 대기" : "지켜봄"),
  });
  function link(node: RelationNode, from: NodeId, to: NodeId) {
    graph.nodes.push(node);
    graph.edges.push({ from, to });
  }

  // 같은 종류가 여럿이면 현재 단계의 id 또는 계획 전체에서 하나로 정해진 id만 쓴다.
  const step = plan?.steps.find(s => s.status === "active");
  const stepIds = new Set(plan?.steps.filter(s => s.kind === "act").map(s => s.target?.objectId));
  const candidates = world?.objects.filter(o => o.cls === action?.target && stepIds.has(o.id)) ?? [];
  const item = goal?.object
    ? world?.objects.find(o => o.id === goal.object)
    : candidates.find(o => o.id === step?.target?.objectId) ?? (candidates.length === 1 ? candidates[0] : undefined);
  const targetClass = goal?.object ? goal.cls : item?.cls;
  const targetName = targetClass && OBJECT_NAME[targetClass];
  if (targetName) {
    link({ id: "target", role: "대상", label: targetName }, "focus", "target");
    if (observed(item, nowMs)) {
      const target = objectTarget(item, world, nowMs);
      if (target) graph.anchors.push({ id: "target", label: targetName, target });
      if (item.surface_label && item.facts.place?.value !== "in_hand") {
        link({ id: "observation", role: "관찰 위치", label: item.surface_label }, "observation", "target");
      }
    }
  }
  if (decision && !graph.nodes.some(node => node.id === "observation")) {
    const state = decision.fsm && FSM_STATE_TEXT[decision.fsm.state];
    const evidence = state ?? (decision.world.person_visible ? "사람 보임" : undefined);
    if (evidence) link({ id: "observation", role: state ? "판단 당시 상태" : "판단 당시 관찰", label: evidence }, "observation", "focus");
  }

  if (!plan || !step) return graph;
  const number = plan.steps.indexOf(step) + 1;
  link({ id: "step", role: "현재 단계", label: `${number}단계 · ${STEP_KIND[step.kind]}` }, "focus", "step");
  const target = step.target;
  if (!target || !(target.objectId || target.deviceId || target.room || target.position)) return graph;
  const object = world?.objects.find(o => o.id === target.objectId);
  const device = world?.devices.find(d => d.id === target.deviceId);
  const surface = world?.surfaces_seen?.find(s => s.id === target.objectId);
  const name = (target.objectId && names?.get(target.objectId)) || (target.deviceId && names?.get(target.deviceId)) ||
    device?.label || (object && OBJECT_NAME[object.cls]) || surface?.label ||
    (target.room && names?.get(target.room)) || (step.kind === "move" ? "이동 지점" : "단계 대상");
  link({ id: "destination", role: step.kind === "move" ? "목적지" : "단계 대상", label: name }, "step", "destination");
  // World State의 물건 id는 종류_번호다. 재접속이나 사라짐 뒤에 집기 계획의 옛 좌표를 다시 쓰지 않는다.
  const idClass = target.objectId?.match(/^(.+)_\d+$/)?.[1];
  const liveObject = object !== undefined || (idClass !== undefined && objectClasses.has(idClass));
  const anchor = liveObject ? (observed(object, nowMs) ? objectTarget(object, world, nowMs) : null) : target;
  if (anchor) graph.anchors.push({ id: "destination", label: name, target: anchor });
  return graph;
}
