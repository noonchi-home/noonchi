// 검사(결정론) 둘. 통과하지 못하면 실행하지 않고 이유(CHECK_TEXT)를 낸다.
// 계획 전 검사(checkDecision, 에이전트를 부르기 전): 행동 목록에 있는 행동이다, 대상 종류가 있는 행동이면 치우지 않은 대상이 보인다(남은 같은 종류가 모두 싱크대 안이면 그 이유).
// 실행 전 검사(checkPlan, 에이전트가 만든 계획): 아는 행동이고 계획이 있다, 대상 물건이 있고 그 대상이 이미 싱크대 안이 아니다, 판단 뒤에 찍힌 프레임으로 다시 봤고 STALE_MS 안이다,
// 사람이 그 물건을 들고 있거나 쓰는 중이 아니다, 이동 단계가 있으면 경로가 있다, 시험 모드에서는 짝지은 실제 가전 단계를 막는다.
// 대상 물건은 계획 단계 대상 가운데 그 행동의 대상 종류인 첫 물건이다(채워 주기는 첫 act 단계가 병 집기이고 컵은 따르기 단계의 대상이다).
// 집는 것이 대상과 다른 행동(carry, 채워 주기)은 사람이 그 자리에서 다른 것을 들고 있는 일이라, 든 것을 모르는 것만으로는 막지 않는다(그 컵을 들었다고 보일 때만).
// 「치운 것」(src/act/tasks.ts putAway)은 싱크대 안 사실이거나 실행 추적이 놓기 단계를 끝낸 물건(placed)이다.
// 행동 조건(TaskSpec.want, 컵 안): 계획 전 검사는 확인된 반대 값이면 막고 모르면 계획으로 넘긴다(계획 없는 행동은 모르면 막는다).
// 실행 전 검사는 계획의 대상 물건이 확인된 반대 값이면 막고, 모르면 unknown_contents와 그 물건 id를 낸다(실행 추적이 보류해 가까이 보고 묻는다).
// 낡음·들고 있음 뒤에 본다(보류 중 낡음은 실행 추적이 보류를 이어 간다, src/act/track/start.ts).
import type { PlanView } from "../contract/plan.js";
import type { ControlMode } from "../contract/setup.js";
import { sameDrinkware } from "../world/vocab.js";
import type { WorldObject, WorldView } from "../contract/world.js";
import { CHECK_TEXT } from "./labels.js";
import type { DecisionRecord } from "../contract/events.js";
import { holdsTarget, planObjectsOf, putAway, taskOf, wantOf, type Placed } from "./tasks.js";

export type CheckFail = keyof typeof CHECK_TEXT;
/** carried: in_hand가 대상 물건의 들고 감 보호(World State 물건 carried)에서만 왔다. 실행 추적은 이때 보호가 풀릴 때까지 다시 보기 기한을 세지 않는다. */
/** object: unknown_contents면 안을 모르는 대상 물건 id(실행 추적 보류, src/act/track/contents.ts), no_target·stale이면 막은 대상 물건 id(실행 추적이 그 자리로 찾으러 간다,
 *  src/act/track/find.ts). 계획에 그 종류 대상이 없으면 싣지 않는다. */
export type CheckResult = { ok: true } | { ok: false; reason: CheckFail; text: string; carried?: true; object?: string };
export interface CheckInput {
  decision: DecisionRecord;
  /** 이번 판단에 보낸 행동 목록. */
  tasks: string[];
  plan: PlanView | null;
  world: WorldView;
  nowMs: number;
  /** 대상을 마지막으로 본 뒤 이만큼 지나면 낡은 근거(STALE_MS). */
  staleMs: number;
  mode: ControlMode;
  /** 계획의 가전 단계와 그 가전이 실제 가전(ThinQ)과 짝지어졌는가. */
  deviceSteps?: { deviceId: string; paired: boolean }[];
  /** 실행 추적이 놓기 단계를 끝낸 물건(이미 치운 것, src/act/track/steps.ts placed). */
  placed?: Placed;
  /** 미리 만든 계획(src/act/track/goal.ts)이면 사람이 떠난 때. */
  seenSince?: number;
}

const fail = (reason: CheckFail): CheckResult => ({ ok: false, reason, text: CHECK_TEXT[reason] });
/** 막은 대상 물건 id를 실은 실패. */
const failOn = (reason: CheckFail, object: string): CheckResult => ({ ok: false, reason, text: CHECK_TEXT[reason], object });

/** 계획 전 검사: 에이전트를 부를 만한 판단인가(LLM을 부르지 않고 본다). */
/** 계획 전 검사의 대상은 이만큼(ms) 안에 본 것이어야 한다(감지가 끊겨 남은 「보임」으로 모델을 부르지 않는다). */
export const PRECHECK_FRESH_MS = 10_000;

export function checkDecision(i: Pick<CheckInput, "decision" | "tasks" | "world" | "placed"> & { nowMs?: number }): CheckResult {
  const spec = taskOf(i.decision.action);
  if (!spec || !i.tasks.includes(spec.name)) return fail("unknown_task");
  // 지금 보이는 대상만(시야 밖의 낡은 물건으로 모델을 부르지 않는다)
  const fresh = (o: { last_seen_ms: number }) => i.nowMs === undefined || i.nowMs - o.last_seen_ms <= PRECHECK_FRESH_MS;
  if (spec.target && !i.world.objects.some((o) => o.cls === spec.target && o.status === "present" && fresh(o) && !putAway(o, i.placed))) {
    return fail(i.world.objects.some((x) => x.cls === spec.target && x.status !== "gone" && putAway(x, i.placed)) ? "in_sink" : "no_target");
  }
  if (spec.want) {
    // 대상이 정해지기 전이라 지금 보이는 후보 전부를 본다: 맞는 컵이 하나라도 있으면 통과, 모르는 컵이 있으면 계획으로 넘기고(계획 없는 행동은 막음), 다 반대 값이면 막는다
    const ws = i.world.objects.filter((o) => o.cls === spec.target && o.status === "present" && fresh(o) && !putAway(o, i.placed)).map((o) => wantOf(spec, o));
    if (ws.length && !ws.some((w) => w.ok)) {
      const unknown = ws.some((w) => !w.ok && w.why === "unknown");
      if (!unknown) return fail("contents_mismatch");
      if (spec.plan === false) return fail("unknown_contents");
    }
  }
  return { ok: true };
}

export function checkPlan(i: CheckInput): CheckResult {
  const spec = taskOf(i.decision.action);
  if (!spec || !i.tasks.includes(spec.name) || !i.plan) return fail("unknown_task");
  if (spec.target) {
    const target = spec.target;
    // 계획이 다루는 그 종류 물건마다(따르기 단계 대상이 여럿일 수 있다) 있음·치움·낡음·들고 있음을 본다. 계획에 그 종류 대상이 없으면 없음이다
    const ids = planObjectsOf(i.plan, i.world, target);
    const all: WorldObject[] = [];
    for (const id of ids.length ? ids : [null]) {
      const o = i.world.objects.find((x) => x.id === id);
      if (!o || o.status === "gone" || !sameDrinkware(o.cls, target)) {
        // 치움은 막은 그 대상 자신만 본다(다른 컵이 싱크대에 있어도 이 대상은 없음이다)
        if (id !== null && (i.placed?.has(id) || (o && o.cls === target && putAway(o, i.placed)))) return fail("in_sink");
        return id === null ? fail("no_target") : failOn("no_target", id);
      }
      if (putAway(o, i.placed)) return fail("in_sink");
      if (o.last_seen_ms <= i.decision.atMs || i.nowMs - o.last_seen_ms > i.staleMs) return failOn("stale", o.id);
      const inUse = o.facts.use?.value === "in_use";
      const holds = holdsTarget(i.world, target, spec.carry !== undefined);
      if (o.facts.place?.value === "in_hand" || inUse || holds) {
        return o.carried === true && o.facts.place?.value === "in_hand" && !inUse && !holds ? { ok: false, reason: "in_hand", text: CHECK_TEXT.in_hand, carried: true } : fail("in_hand");
      }
      all.push(o);
    }
    if (spec.want) {
      // 하나라도 반대 값이면 막고, 모르면 그 물건을 붙잡는다
      const ws = all.map((x) => ({ x, w: wantOf(spec, x) }));
      if (ws.some(({ w }) => !w.ok && w.why === "mismatch")) return fail("contents_mismatch");
      const unknown = ws.find(({ w }) => !w.ok);
      if (unknown) return { ok: false, reason: "unknown_contents", text: CHECK_TEXT.unknown_contents, object: unknown.x.id };
    }
  }
  // 손 자리를 모르면(맞추기 전) 길 없이 「완료」로 넘긴다. 자리를 아는데 길이 없을 때만 막는다
  if (i.plan.robot.position && i.plan.steps.some((s) => s.kind === "move") && i.plan.path.length === 0) return fail("unreachable");
  if (i.mode === "test" && (i.deviceSteps ?? []).some((d) => d.paired)) return fail("device_mode");
  return { ok: true };
}

/** 실행 설정. 틀린 값이면 시작을 막는다. */
export function loadActConfig(env: Record<string, string | undefined>): { staleMs: number } {
  const raw = env.STALE_MS?.trim();
  if (!raw) return { staleMs: 3000 };
  const v = Number(raw);
  if (!Number.isFinite(v) || v <= 0) throw new Error(`STALE_MS=${raw}: 0보다 큰 숫자여야 합니다`);
  return { staleMs: v };
}
