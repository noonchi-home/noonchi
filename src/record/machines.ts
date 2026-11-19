import { GOAL_LOG } from "../act/labels.js";
import type { HistoryDb } from "../brain/index.js";
import type { ManagerState, RobotState, SafetyState } from "../contract/machines.js";
import type { PendingGoal } from "../contract/goal.js";
import type { TopicName } from "../bus/index.js";

/** 목표 전환 한 줄: 바로 앞 상태(같은 목표)와 견줘 무엇이 바뀌었는지(세움·미리 만들기·사람 떠남·씀·버림). */
function goalLine(prev: PendingGoal | null, g: PendingGoal): string {
  if (g.status === "dropped") return g.error ? GOAL_LOG.dropPlan(g.error) : GOAL_LOG.dropped(GOAL_LOG.why[g.reason ?? "stale"]);
  if (g.status === "used") return GOAL_LOG.used;
  if (!prev) return GOAL_LOG.armed(g.action);
  if (g.status === "fired" && prev.status !== "fired") return GOAL_LOG.fired;
  if (g.prep !== prev.prep && g.prep !== "waiting") return g.prep === "failed" && g.error ? GOAL_LOG.failedWhy(g.error) : GOAL_LOG[g.prep];
  return GOAL_LOG.armed(g.action);
}

/** 미리 세운 목표 전환을 기록 DB goal 줄로 남기는 것(영상 판정 시각표 「목표」 줄, 반성 입력이 아니다).
 *  data: 상태·미리 만들기·버린 종류(drop)·물건과, 까닭 글이 있으면 reason(실행 기록 「계획이 맞지 않아 버림」의 reason과 같은 칸). */
export function goalRecorder(db: Pick<HistoryDb, "add">): (g: PendingGoal, atMs: number) => void {
  let last: PendingGoal | null = null;
  return (g, atMs) => {
    const prev = last?.id === g.id ? last : null;
    db.add("goal", atMs, goalLine(prev, g), { subject: g.id, data: { status: g.status, prep: g.prep, drop: g.reason, object: g.object, ...(g.error ? { reason: g.error } : {}) } });
    last = g;
  };
}

const ROBOT = { idle: "지켜봄", observe: "살펴보는 중", move: "이동 중", run: "실행 중", return: "충전 자리로 가는 중", recover: "다시 확인하는 중" } satisfies Record<RobotState["state"], string>;
const SAFETY = { normal: "평소", suspect: "확인 중", emergency: "안전 알림" } satisfies Record<SafetyState["state"], string>;
const OWNER = { safety: "안전 확인", request: "말로 부탁한 일", goal: "목표 실행", idle: "지켜봄" } satisfies Record<ManagerState["owner"], string>;

/** 기계 전이는 받았을 때마다 한 줄이다. 예전 목표 사건은 준비 실패의 까닭과 실행 기록 문구도 보존한다. */
export function machineWrites(db: HistoryDb) {
  const oldGoal = goalRecorder(db);
  return {
    "/brain/goal_changes": (b, stamp) => oldGoal(b.goal as PendingGoal, stamp),
    "/goal/changes": (b) => {
      if (b.state === "idle") db.add("goal", Number(b.since_ms), "대기", { data: b });
      else if (b.state === "done") db.add("goal", Number(b.since_ms), "목표 계획을 마쳤어요.", { subject: String(b.id), data: b });
    },
    "/brain/person_changes": (b) => db.add("person", Number(b.since_ms), String(b.name), { subject: String(b.state), data: b }),
    "/robot/changes": (b) => {
      const step = b.step as { plan_id: string; label: string } | null;
      db.add("robot", Number(b.since_ms), step?.label ?? ROBOT[b.state as RobotState["state"]], { subject: step?.plan_id, data: b });
    },
    "/safety/changes": (b) => db.add("safety", Number(b.since_ms), SAFETY[b.state as SafetyState["state"]], { data: b }),
    "/manager/changes": (b) => db.add("manager", Number(b.since_ms), OWNER[b.owner as ManagerState["owner"]], { data: b }),
  } satisfies Partial<Record<TopicName, (b: Record<string, unknown>, stamp: number) => void>>;
}
