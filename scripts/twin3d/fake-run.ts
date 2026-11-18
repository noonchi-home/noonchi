// 대시보드 가짜 단계 자료(ui/src/dashboard/fake-run.json)를 만든다. 실행: npx tsx scripts/twin3d/fake-run.ts
// 한양목련 실제 장면·평면도(loadScene·floorPlanFrom)로 컵 치우기 계획(에이전트 컵 계획이 맞춰야 할 모양 tests/helpers/cup-plan.ts, 로봇 [10.6, 8.6])을 짜고, 다섯 순간(0 지켜보기, 1~4 계획 단계)마다
// 서버가 대시보드 /events로 보내는 메시지 묶음(plan·eye·brain decision·생각 메시지 thought·brain observe·seen·say·world·습관 FSM 그림 habit·목표 goal)을 적는다.
// 지켜보기(0)는 사람이 식탁에서 컵으로 마시는 중이고 목표 「컵을 두고 자리를 뜨면 컵 치우기」가 서 있다(목표 줄이 메시지 상자에 있다). 계획 순간(1~4)은 사람이 떠난 뒤다(사람 안 보임, 목표 씀). 생각 메시지는 계획 순간의 컵 치우기 판단 규칙 줄(src/brain/thought.ts decisionLines, 지켜보기 판단은 줄 없음)이다. 판단(decision)은 생각 한 문장(reasoning)과 판단 때 지금 FSM(fsm, src/brain/decision.ts fsmNow: 지켜보기는 처음 상태)을 싣는다. 말은 sayLine에 그 단계 명령을 넣은 글이고, 계획 순간에는 그 앞 계획 순간의 말이 차례로 쌓여 있다.
// 대시보드 폰 칸 그림은 시안 눈 그림(ui/public/debug-eye/, 세로 405×720)이고, 컵 모양(seen 마스크)은 시안 가로 그림 상자를 잘라 낸 자리만큼 옮긴 상자 안에 컵꼴로 채운 것이다.
// 시각을 고정해서 다시 만들어도 같은 파일이 나온다.
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { sayLine } from "../../src/act/say.js";
import { modeNow } from "../../src/act/mode.js";
import { planIdOf } from "../../src/act/tasks.js";
import { assemblePlan, type DraftStep } from "../../src/agent/planShape.js";
import type { FloorPlan } from "../../src/layout/floor.js";
import { CUP_FSM_MEMORY, fsmNow } from "../../src/brain/decision.js";
import { habitView } from "../../src/brain/habit.js";
import type { PendingGoal } from "../../src/contract/goal.js";
import { GOAL_TEXT } from "../../src/act/labels.js";
import { TASK_SAY } from "../../src/act/tasks.js";
import { ruleIf } from "../../src/world/labels.js";
import { decisionLines } from "../../src/brain/thought.js";
import type { Mask } from "../../src/contract/observe.js";
import type { BrainLog, EyeEvent, SeenEvent, ServerMessage } from "../../src/contract/events.js";
import type { PlannedCommand } from "../../src/contract/phone.js";
import type { PlanView, XZ } from "../../src/contract/plan.js";
import type { WorldObject, WorldView } from "../../src/contract/world.js";
import { DEFAULT_TWIN_DIR } from "../../src/layout/twin-files.js";
import { resolveHome } from "../../src/layout/homes.js";
import { loadScene } from "../../src/layout/scene.js";
import { STEP_COMMAND, STEP_LABEL } from "../../src/act/labels.js";
import { cupPlan } from "../../tests/helpers/cup-plan.js";
import { floorPlanFrom, roomAt } from "../../src/layout/route.js";

export type EyeFrameId = "table-far" | "table-near" | "sink" | "sink-cup";
export interface Moment { index: number; eye: EyeFrameId; messages: ServerMessage[] }

const HOME = "mokryeon_180b";
/** 거실 시작 자리(시안 START). */
const START: XZ = [10.6, 8.6];
const T0 = Date.parse("2026-11-09T09:00:00.000Z");
const STEP_MS = 4000;
const FRAME = { width: 405, height: 720 };
const EYE_HEIGHT_M = 1.1;
const OBSERVATION = "식탁 위에 컵이 있고 사람이 자리를 비웠어요.";
const ACTION = "컵 치우기";
const RAMEN = "라면 끓이기 알려 주기";
const OUT = fileURLToPath(new URL("../../ui/src/dashboard/fake-run.json", import.meta.url));

/** 세로 눈 그림을 잘라 낸 가로 그림(1280×720) 자리 x0(시안 assets.ts EYE_CROP_X0). */
const EYE_CROP_X0: Record<EyeFrameId, number> = { "table-far": 428, "table-near": 383, sink: 437, "sink-cup": 524 };
/** 눈 그림마다 컵 상자(가로 그림 픽셀 [왼쪽, 위, 오른쪽, 아래], 시안 scenario.ts BOX.cupFar·cupNear·cupInSink). 싱크대 그림에는 컵이 없다. */
const CUP_BOX: Partial<Record<EyeFrameId, [number, number, number, number]>> = {
  "table-far": [596, 332, 620, 357], "table-near": [543, 238, 628, 346], "sink-cup": [679, 243, 774, 358],
};

/** 순간마다 눈 그림과 컵 신뢰도. */
const MOMENTS: { eye: EyeFrameId; score: number }[] = [
  { eye: "table-far", score: 0.82 }, { eye: "table-far", score: 0.86 }, { eye: "table-near", score: 0.95 },
  { eye: "sink", score: 0 }, { eye: "sink-cup", score: 0.92 },
];

const round = (v: number, d = 3) => Math.round(v * 10 ** d) / 10 ** d;
const iso = (ms: number) => new Date(ms).toISOString();
const yawOf = (a: XZ, b: XZ) => round(((Math.atan2(b[1] - a[1], b[0] - a[0]) * 180) / Math.PI + 360) % 360, 1) % 360;

/** 상자 [x, y, w, h]를 4px 칸으로 나눠 컵꼴(위는 곧고 아래 모서리가 둥근 통)로 채운 마스크. 비트는 줄 순서, 바이트 안에서는 높은 비트부터(src/shared/mask.ts). */
function cupMask(at: [number, number, number, number]): Mask {
  const cols = Math.max(2, Math.round(at[2] / 4)), rows = Math.max(2, Math.round(at[3] / 4));
  const bytes = Buffer.alloc(Math.ceil((cols * rows) / 8));
  const round = Math.min(cols, rows) * 0.35;
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    // 아래 두 모서리만 둥글게 깎는다
    const dx = Math.max(0, round - (c + 0.5), c + 0.5 - (cols - round)), dy = Math.max(0, r + 0.5 - (rows - round));
    if (dx > 0 && dy > 0 && Math.hypot(dx, dy) > round) continue;
    const i = r * cols + c;
    bytes[i >> 3]! |= 0x80 >> (i & 7);
  }
  return { at, cols, rows, bits: bytes.toString("base64") };
}

/** 가로 그림 컵 상자 → 세로 눈 그림의 컵 모양(그림 끝에서 자른 상자 안). */
function cupShapes(eye: EyeFrameId, score: number): SeenEvent["shapes"] {
  const b = CUP_BOX[eye];
  if (!b) return [];
  const dx = EYE_CROP_X0[eye];
  const x0 = Math.max(0, b[0] - dx);
  const x1 = Math.min(FRAME.width, b[2] - dx);
  return [{ label: "cup", score, mask: cupMask([x0, b[1], x1 - x0, b[3] - b[1]]) }];
}

/** 꺾은선 위에서 길이 몫 t(0~1) 자리와 그 구간 방향. */
function along(path: XZ[], t: number): { at: XZ; yaw: number } {
  const lens = path.slice(1).map((p, i) => Math.hypot(p[0] - path[i]![0], p[1] - path[i]![1]));
  let left = lens.reduce((a, b) => a + b, 0) * t;
  for (let i = 0; i < lens.length; i++) {
    const [a, b] = [path[i]!, path[i + 1]!];
    if (left <= lens[i]! || i === lens.length - 1) {
      const k = lens[i]! ? Math.min(1, left / lens[i]!) : 0;
      return { at: [round(a[0] + (b[0] - a[0]) * k), round(a[1] + (b[1] - a[1]) * k)], yaw: yawOf(a, b) };
    }
    left -= lens[i]!;
  }
  throw new Error("경로가 비었어요");
}

/** 코치 행동 중 한 순간(대시보드 ?debug=steps&mode=coach): 라면 끓이기 알려 주기 계획의 2단계(냄비 꺼내기)와 그 판단·규칙 줄·말, 서버 지금 모드 코치. */
function coachMoment(fp: FloorPlan, world: WorldView): Moment {
  const at = T0 + 2 * STEP_MS;
  const byType = (t: string) => [...fp.objects.values()].find((o) => o.type === t)!;
  const cabinet = byType("kitchen_cabinet");
  const cooktop = byType("induction_counter");
  const draft: DraftStep[] = [
    { kind: "move", label: "수납장으로 가기", target: { objectId: cabinet.id, ...(cabinet.room ? { room: cabinet.room } : {}) }, to: cabinet.position },
    { kind: "act", label: "냄비 꺼내기", target: { objectId: cabinet.id } },
    { kind: "move", label: "인덕션으로 가기", target: { objectId: cooktop.id, ...(cooktop.room ? { room: cooktop.room } : {}) }, to: cooktop.position },
    { kind: "act", label: "냄비 올리기", target: { objectId: cooktop.id } },
  ];
  const walk = { ...fp, robot: { ...fp.robot, reachable: fp.rooms.map((r) => r.id) } };
  const planned = assemblePlan(walk, { id: planIdOf("pam-7"), goal: RAMEN, judgment: "사용자가 라면 끓이는 법을 물었어요.", source: "brain", dryRun: true, nowIso: iso(at) }, draft);
  const plan: PlanView = { ...planned, revision: 2, status: "running", steps: planned.steps.map((s, i) => ({ ...s, status: i === 0 ? "done" : i === 1 ? "active" : "pending" })) };
  const decision: Extract<BrainLog, { type: "decision" }> = {
    type: "decision", at_ms: at, id: "pam-7", seq: 7, text_sent: "사람이 말함: 「들은 말 있음」", status: "valid",
    prediction: { observation: "사용자가 요리 방법을 물음", reasoning: "방법을 물어서 단계마다 알려 준다", task_index: 0 },
    action: RAMEN, fsm: fsmNow(CUP_FSM_MEMORY, "fsm", RAMEN), assist: "coach", memory_version: 1,
    world: { objects: [], person_visible: true, vlm_missing: 0, yolo_missing: 0 },
  };
  const command = (step: number, text: string): PlannedCommand => ({ type: "command", id: plan.id, step: plan.steps[step]!.id, text, vision: null, choices: [{ id: "done", label: "완료" }], target: null, speak: true });
  const say = (p: PlanView, c: PlannedCommand | null) => sayLine({ plan: p, command: c, world, nowMs: at });
  const eyeAt = along(plan.path.slice(0, plan.legs[0]!.end + 1), 1);
  return {
    index: 0, eye: "sink",
    messages: [
      { type: "plan", plan },
      { type: "eye", eye: { position: eyeAt.at, height_m: EYE_HEIGHT_M, yaw_deg: eyeAt.yaw, pitch_deg: -10, tracking: "ok", at: iso(at) } },
      { type: "brain", event: decision },
      { type: "thought", messages: decisionLines(decision).map((text, i) => ({ id: `pam-7@${at}:${i}`, text, at_ms: at, decision: "pam-7" })) },
      { type: "seen", at_ms: at, frame_id: "fake-coach", captured_at_ms: at, frame: FRAME, shapes: [] },
      { type: "say", text: say({ ...plan, status: "planned" }, null) },
      { type: "say", text: say(plan, command(0, "수납장으로 가 주세요")) },
      { type: "say", text: say(plan, command(1, "냄비를 꺼내 주세요")) },
      { type: "mode", mode: modeNow({ world, offNotices: [], coaching: true, plan }) },
      { type: "habit", habit: habitView(CUP_FSM_MEMORY, 1) },
    ],
  };
}

function build(): { moments: Moment[]; coach: Moment } {
  const home = resolveHome(DEFAULT_TWIN_DIR, HOME);
  const base = floorPlanFrom(loadScene(home));
  const fp = { ...base, robot: { ...base.robot, position: START, room: roomAt(base, START) } };
  const decisionId = "pam-1";
  const plan = cupPlan(fp, planIdOf(decisionId), iso(T0 + STEP_MS));
  if (!plan || plan.steps.length !== 4 || plan.legs.length !== 2) throw new Error("컵 치우기 계획이 네 단계·두 이동 구간이 아니에요");
  const table = [...fp.objects.values()].find((o) => o.type === "dining_table")!;
  const tableLeg = plan.path.slice(0, plan.legs[0]!.end + 1);
  const sinkLeg = plan.path.slice(plan.legs[0]!.end, plan.legs[1]!.end + 1);
  /** 순간마다 눈 자리: 0·1 시작 자리, 2 식탁 구간 끝, 3 싱크대 구간 가운데, 4 길 끝. 방향은 그 구간 방향. */
  const poses = [along(tableLeg, 0), along(tableLeg, 0), along(tableLeg, 1), along(sinkLeg, 0.5), along(sinkLeg, 1)];

  const cup: WorldObject = {
    id: "cup_1", cls: "cup", position: null, surface: table.id, surface_label: "식탁", room: table.room, error_m: null, status: "present",
    first_seen_ms: T0, last_seen_ms: T0, last_in_view_ms: T0, facts: {}, answered_ms: null, devices: [], closer_hold: false, followed_by: null,
  };
  const world: WorldView = {
    at_ms: T0, objects: [cup], person: { visible: false, since_ms: T0, last_seen_ms: null, count: 0, room: null, room_label: null, position: null, near: [], holding: [], position_ms: null, answered_ms: null, facts: {} }, fixtures: [], devices: [], eye: null, frame_ms: null, vlm_missing: 0, yolo_missing: 0,
  };

  // 사람: 지켜보기는 식탁 곁에 앉아 컵으로 마시는 중, 계획 순간은 그 자리에서 떠나 안 보임(마지막 발 자리)
  const seat: [number, number] = [round(table.position[0] - 0.7), round(table.position[1])];
  const drinking: WorldView = {
    ...world, person: {
      ...world.person, visible: true, since_ms: T0 - 60_000, last_seen_ms: T0, count: 1, position: seat, position_ms: T0, room: table.room, room_label: "거실",
      facts: { activity: { value: "drinking", at_ms: T0, since_ms: T0 - 20_000, certainty: "confirmed" }, posture: { value: "sitting", at_ms: T0, since_ms: T0 - 60_000, certainty: "confirmed" } },
    },
  };
  const left: WorldView = { ...world, person: { ...world.person, position: seat, position_ms: T0, room: table.room, room_label: "거실" } };
  // 습관 FSM 그림(판본 1)과 목표: 컵 치우기 규칙(컵을 두고 자리를 뜸)
  const habit: ServerMessage = { type: "habit", habit: habitView(CUP_FSM_MEMORY, 1) };
  const clearRule = CUP_FSM_MEMORY.states.find((s) => s.id === "left_cup")!.rules[0]!;
  const goalText = GOAL_TEXT.armed(ruleIf({ ...clearRule, learned: false }), TASK_SAY[ACTION]!.will);
  const goal: PendingGoal = {
    id: "goal-1", action: ACTION, state: "left_cup", trigger: clearRule.trigger, object: cup.id, cls: "cup", status: "armed", prep: "ready", reason: null, text: goalText,
    armed_ms: T0 - 10_000, ready_ms: T0 - 6_000, gone_ms: null, fired_ms: null, plan: null,
  };

  const moments = MOMENTS.map(({ eye, score }, n) => {
    const now = T0 + n * STEP_MS;
    const open: PlanView | null = n === 0 ? null : {
      ...plan, revision: n, status: "running", updatedAt: iso(now), judgment: "사람이 자리를 비운 뒤에도 컵이 식탁에 남아 있어요.",
      // 단계 i는 순간 i+1에 시작해(그 단계 명령) 다음 순간에 끝난다(실행 추적 단계 시각)
      steps: plan.steps.map((s, i) => ({
        ...s, status: i < n - 1 ? "done" : i === n - 1 ? "active" : "pending",
        ...(i < n ? { started_ms: T0 + (i + 1) * STEP_MS } : {}), ...(i < n - 1 ? { ended_ms: T0 + (i + 2) * STEP_MS } : {}),
      })),
    };
    const step = open?.steps[n - 1];
    const key = step ? (Object.keys(STEP_COMMAND) as (keyof typeof STEP_COMMAND)[]).find((k) => STEP_LABEL[k] === step.label) ?? null : null;
    const command: PlannedCommand | null = open && step && key
      ? { type: "command", id: open.id, step: step.id, text: STEP_COMMAND[key], vision: null, choices: [{ id: "done", label: "완료" }], target: null, speak: true }
      : null;
    const pose = poses[n]!;
    const eyeEvent: EyeEvent = { position: pose.at, height_m: EYE_HEIGHT_M, yaw_deg: pose.yaw, pitch_deg: -10, tracking: "ok", at: iso(now) };
    const decision: Extract<BrainLog, { type: "decision" }> = {
      type: "decision", at_ms: n === 0 ? T0 : T0 + STEP_MS, id: n === 0 ? "pam-0" : decisionId, seq: n === 0 ? 1 : 2,
      text_sent: "컵 1개가 식탁 위에 있어요. 사람이 안 보여요.", status: "valid",
      prediction: { observation: OBSERVATION, reasoning: n === 0 ? "자리를 비운 지 얼마 안 됐어요." : "사람이 자리를 비운 뒤에도 컵이 식탁에 남아 있어요.", task_index: n === 0 ? -1 : 0 },
      action: n === 0 ? null : ACTION, fsm: fsmNow(CUP_FSM_MEMORY, "fsm", n === 0 ? null : ACTION), assist: modeNow({ world, offNotices: [], coaching: false, action: n === 0 ? null : ACTION }), memory_version: 1,
      world: { objects: [{ id: cup.id, cls: cup.cls, status: cup.status, surface: cup.surface, surface_label: cup.surface_label, error_m: null, facts: {} }], person_visible: false, vlm_missing: 0, yolo_missing: 0 },
    };
    const shapes = cupShapes(eye, score);
    const observe: BrainLog = {
      type: "observe", at_ms: now, frame_id: `fake-${n}`, captured_at_ms: now,
      yolo: shapes.length ? shapes.map((b) => `컵 ${b.score.toFixed(2)}`).join(" · ") : "감지 없음", vlm: null,
    };
    const seen: SeenEvent = { type: "seen", at_ms: now, frame_id: `fake-${n}`, captured_at_ms: now, frame: FRAME, shapes };
    const messages: ServerMessage[] = [
      { type: "plan", plan: open },
      { type: "eye", eye: eyeEvent },
      { type: "brain", event: decision },
      { type: "thought", messages: decisionLines(decision).map((text, i) => ({ id: `${decisionId}@${T0 + STEP_MS}:${i}`, text, at_ms: T0 + STEP_MS, decision: decisionId })) },
      { type: "brain", event: observe },
      seen,
      { type: "say", text: sayLine({ plan: open, command, world, nowMs: now }) },
      // 서버가 정한 지금 행동 모드(src/act/mode.ts): 컵 치우기는 눈치 모드
      { type: "mode", mode: modeNow({ world, offNotices: [], coaching: false, action: decision.action }) },
      { type: "world", world: n === 0 ? drinking : left },
      habit,
      // 지켜보기: 세운 목표와 그 줄(메시지 상자), 계획 순간: 떠난 뒤 판단이 같은 행동을 골라 씀
      ...(n === 0
        ? [{ type: "goal", goal } as ServerMessage, { type: "thought", messages: [{ id: `goal-1@${T0 - 10_000}`, text: goalText, at_ms: T0 - 10_000, decision: "goal-1" }] } as ServerMessage]
        : [{ type: "goal", goal: { ...goal, status: "used", gone_ms: T0, fired_ms: T0 } } as ServerMessage]),
    ];
    return { index: n, eye, messages };
  });
  // 계획 순간의 말은 실제 서버가 보낸 차례대로 쌓인다: 정한 것(「식탁 컵을 치울게요.」) 뒤에 그 앞 계획 순간의 말(대시보드 메시지 상자 줄이 굴러간다)
  const decided: ServerMessage = { type: "say", text: sayLine({ plan: { ...plan, status: "planned" }, command: null, world, nowMs: T0 + STEP_MS }) };
  const said = moments.map((m) => m.messages.find((x) => x.type === "say")!);
  // 계획 순간에는 앞 지켜보기 판단(마시는 중)이 먼저 와 있다: FSM 카드가 마시는 중 → 컵을 두고 자리를 뜸 전이를 안다
  const watched = moments[0]!.messages.find((x) => x.type === "brain" && x.event.type === "decision")!;
  return {
    moments: moments.map((m, n) => (n === 0 ? m : { ...m, messages: [watched, ...m.messages.filter((x) => x.type !== "say"), decided, ...said.slice(1, n + 1)] })),
    coach: coachMoment(fp, world),
  };
}

writeFileSync(OUT, `${JSON.stringify(build(), null, 2)}\n`);
console.log(`가짜 단계 ${MOMENTS.length}개와 코치 순간을 적었어요: ${OUT}`);
