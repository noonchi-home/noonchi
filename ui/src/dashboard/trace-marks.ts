// 트레이스 줄 → 트윈 표시(순수 함수). 가장 최근 활동 하나의 줄만 트윈에 그린다(진행 중인 줄이 있는 활동이 먼저다).
// 트레이스 공개 줄에는 좌표가 없고 id만 있어, 자리는 그 id로 계획 구간·장면 anchor·World State 물건에서 찾는다.
// 자리는 장면 물건·가전 anchor, 놓인 면이 있는 World State 물건 자리(손에 든 물건 제외), 계획 구간 끝만 쓴다(plan-marks.ts thingAt). 자리를 모르는 줄은 내지 않는다.
// 글은 트레이스 줄의 정해진 낱말(줄 이름·결과, src/record/trace.ts) 그대로다.
import type { PlanStep, PlanTarget, PlanView } from "../../../src/contract/plan.ts";
import type { TraceRow, TraceState } from "../../../src/contract/trace.ts";
import type { WorldView } from "../../../src/contract/world.ts";
import { thingAt, type Vec3 } from "./plan-marks";

/** leg 이동 구간, spot 단계·물건 자리, look 근접 관찰 대상, device 가전 말풍선, goal 목표 대상, guard 실행 보류 경고. */
export type TraceMarkKind = "leg" | "spot" | "look" | "device" | "goal" | "guard";

export interface TraceMark {
  rowId: string;
  kind: TraceMarkKind;
  /** 트윈 좌표 [x, 높이, z]. 이동 구간은 구간 끝 바닥. */
  at: Vec3;
  /** 이동 구간이면 그 계획·단계. */
  legOf?: { planId: string; stepId: string };
  /** 표시가 붙은 대상 id(물건·가전). 이동 구간은 없다. */
  target?: string;
  /** 「줄 이름 · 결과」, 가전 말풍선이면 결과만. */
  text: string;
  state: TraceState;
  /** 정한 색(밤 반성 표시, reflection.ts). 있으면 markTone이 먼저 쓴다. */
  tone?: MarkTone;
}

/** 트레이스 표시 색(21st.dev Status variant). 트윈 이름표·가전 말풍선 칩과 트레이스 칸의 「트윈에 그림」 점이 같은 색을 쓴다. */
export type MarkTone = "brand" | "default" | "success" | "error" | "warning";

/** 실행 보류는 warning, 진행 중 brand, 실패 error, 가전 줄이 끝나면 success, 그 밖에 끝·취소는 기본. */
export function markTone(m: Pick<TraceMark, "kind" | "state" | "tone">): MarkTone {
  if (m.tone) return m.tone;
  if (m.kind === "guard") return "warning";
  if (m.state === "pending") return "brand";
  if (m.state === "failed") return "error";
  return m.kind === "device" && m.state === "done" ? "success" : "default";
}

/** 줄 종류(kind)·이름(name) → 트윈 표시 종류. 없는 줄(행동 선택·대기 판단·PAM 판단·VLM 장면 해석·사용자 상태 변화·안전 상태 등)은 트윈에 그리지 않는다. */
const MARK_OF: Record<string, TraceMarkKind> = {
  "EXECUTION 이동 안내": "leg",
  "EXECUTION 집기 안내": "spot",
  "EXECUTION 배치 안내": "spot",
  "EXECUTION 수행 안내": "spot",
  "OBSERVATION 물건 상태 변화": "spot",
  "TOOL 근접 관찰": "look",
  "TOOL 컵 안 확인": "look",
  "LLM VLM 근접 해석": "look",
  "TOOL 가전 도구": "device",
  "OBSERVATION 가전 상태 변화": "device",
  "AGENT 목표 준비": "goal",
  "OBSERVATION 사용자 자리 이탈": "goal",
  "GUARDRAIL 실행 보류": "guard",
  "GUARDRAIL 실행 전 검사": "spot",
};

/** 줄 차례(id 끝 번호). 번호가 없으면 받은 차례. */
const orderOf = (row: TraceRow, i: number) => Number(/:(\d+)$/.exec(row.id)?.[1] ?? i);

/** 계획의 지금 단계(진행 중, 없으면 첫 대기). */
const currentStep = (plan: PlanView): PlanStep | undefined =>
  plan.steps.find((s) => s.status === "active") ?? plan.steps.find((s) => s.status === "pending");

/**
 * rows 트레이스 줄(대시보드가 받은 것 전체), plans 자리를 찾을 계획(열린 계획·미리 만든 계획·최근 계획),
 * world 지금 World State, anchor 장면 물건·가전 id → 트윈 자리(모르면 null).
 */
export function traceMarks(rows: readonly TraceRow[], plans: readonly (PlanView | null | undefined)[], world: WorldView | null,
  anchor: (id: string) => Vec3 | null): TraceMark[] {
  const planOf = (id: string | undefined) => (id ? plans.find((p): p is PlanView => !!p && p.id === id) : undefined);
  const legEnd = (plan: PlanView, stepId: string): Vec3 | null => {
    const leg = plan.legs.find((l) => l.stepId === stepId);
    const end = leg ? plan.path[leg.end] : undefined;
    return end ? [end[0], 0, end[1]] : null;
  };
  const targetAt = (t: PlanTarget | undefined): { at: Vec3; id: string } | null => {
    const id = t?.deviceId ?? t?.objectId;
    const at = id ? thingAt(id, world, anchor) : null;
    return id && at ? { at, id } : null;
  };
  const objectAt = (id: string | undefined): { at: Vec3; id: string } | null => {
    const at = id ? thingAt(id, world, anchor) : null;
    return id && at ? { at, id } : null;
  };
  /** 근접 해석 줄은 같은 요청(request_id)의 근접 관찰 줄 대상이다. */
  const lookObject = (row: TraceRow) => row.refs.object_id
    ?? rows.find((r) => r.kind === "TOOL" && r.refs.request_id && r.refs.request_id === row.refs.request_id && r.refs.object_id)?.refs.object_id;

  const located = rows.flatMap((row, i): { mark: TraceMark; order: number; key: string }[] => {
    const kind = MARK_OF[`${row.kind} ${row.name}`];
    if (!kind) return [];
    const base = { rowId: row.id, kind, state: row.state, text: kind === "device" ? row.output : `${row.name} · ${row.output}` };
    const plan = planOf(row.refs.plan_id);
    const step = row.refs.step_id ? plan?.steps.find((s) => s.id === row.refs.step_id) : undefined;
    let spot: { at: Vec3; id?: string } | null = null;
    let legOf: TraceMark["legOf"];
    switch (kind) {
      case "leg": {
        const at = plan && row.refs.step_id ? legEnd(plan, row.refs.step_id) : null;
        if (at) { spot = { at }; legOf = { planId: plan!.id, stepId: row.refs.step_id! }; }
        break;
      }
      case "spot":
        spot = (step && targetAt(step.target)) || objectAt(row.refs.object_id);
        break;
      case "look":
        spot = objectAt(lookObject(row));
        break;
      case "device": {
        const at = row.refs.object_id ? anchor(row.refs.object_id) : null;
        if (at) spot = { at, id: row.refs.object_id! };
        break;
      }
      case "goal":
        spot = objectAt(row.refs.object_id);
        break;
      case "guard": {
        spot = objectAt(row.refs.object_id);
        const now = !spot && plan ? currentStep(plan) : undefined;
        if (now) spot = now.kind === "move" ? (legEnd(plan!, now.id) ? { at: legEnd(plan!, now.id)! } : null) : targetAt(now.target);
        break;
      }
    }
    if (!spot) return [];
    const mark: TraceMark = { ...base, at: spot.at, ...(legOf ? { legOf } : {}), ...(spot.id ? { target: spot.id } : {}) };
    const key = legOf ? `leg:${legOf.planId}:${legOf.stepId}` : `${kind}:${spot.id ?? spot.at.join(",")}`;
    return [{ mark, order: orderOf(row, i), key }];
  });
  if (!located.length) return [];

  // 가장 최근 활동: 진행 중인 줄이 있는 활동이 먼저, 그다음 마지막 줄 차례가 늦은 활동
  const score = new Map<string, number>();
  rows.forEach((row, i) => {
    const s = row.state === "pending" ? Infinity : orderOf(row, i);
    score.set(row.activity_id, Math.max(score.get(row.activity_id) ?? -Infinity, s));
  });
  const activityOf = new Map(rows.map((r) => [r.id, r.activity_id]));
  const latest = (a: string) => Math.max(...rows.flatMap((r, i) => (r.activity_id === a ? [orderOf(r, i)] : [])));
  const pick = [...new Set(located.map((l) => activityOf.get(l.mark.rowId)!))]
    .sort((a, b) => score.get(b)! - score.get(a)! || latest(b) - latest(a))[0]!;

  // 같은 대상 표시는 마지막 줄 하나
  const last = new Map<string, { mark: TraceMark; order: number }>();
  for (const l of located) {
    if (activityOf.get(l.mark.rowId) !== pick) continue;
    const prev = last.get(l.key);
    if (!prev || l.order >= prev.order) last.set(l.key, l);
  }
  return [...last.values()].sort((a, b) => a.order - b.order).map((l) => l.mark);
}
