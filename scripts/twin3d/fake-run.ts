// 대시보드 가짜 단계 자료(ui/src/dashboard/fake-run.json)를 만든다. 실행: npx tsx scripts/twin3d/fake-run.ts
// 한양목련 실제 장면·평면도(loadScene·floorPlanFrom)로 컵 치우기 계획(cupPlan, 로봇 [10.6, 8.6])을 짜고, 다섯 순간(0 지켜보기, 1~4 계획 단계)마다
// 서버가 대시보드 /events로 보내는 메시지 묶음(plan·eye·brain decision·brain observe·say)을 적는다. 말은 sayLine에 그 단계 명령을 넣은 글이다.
// 대시보드 폰 칸 그림은 시안 눈 그림(ui/public/debug-eye/, 세로 405×720)이고, 컵 상자는 시안 가로 그림 상자를 잘라 낸 자리만큼 옮긴 것이다.
// 시각을 고정해서 다시 만들어도 같은 파일이 나온다.
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { sayLine } from "../../src/act/say.js";
import { cupStepOf, planIdOf } from "../../src/act/tasks.js";
import type { BoxView, BrainLog, EyeEvent, ServerMessage } from "../../src/contract/events.js";
import type { PlannedCommand } from "../../src/contract/phone.js";
import type { PlanView, XZ } from "../../src/contract/plan.js";
import type { WorldObject, WorldView } from "../../src/contract/world.js";
import { DEFAULT_TWIN_DIR } from "../../src/model/devices.js";
import { resolveHome } from "../../src/model/homes.js";
import { loadScene } from "../../src/model/scene.js";
import { STEP_COMMAND } from "../../src/plan/labels.js";
import { cupPlan } from "../../src/plan/planner.js";
import { floorPlanFrom, roomAt } from "../../src/plan/route.js";

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

/** 가로 그림 컵 상자 → 세로 눈 그림 YOLO 상자 [x, y, w, h](그림 끝에서 자름). */
function cupBox(eye: EyeFrameId, score: number): BoxView[] {
  const b = CUP_BOX[eye];
  if (!b) return [];
  const dx = EYE_CROP_X0[eye];
  const x0 = Math.max(0, b[0] - dx);
  const x1 = Math.min(FRAME.width, b[2] - dx);
  return [{ label: "cup", score, box: [x0, b[1], x1 - x0, b[3] - b[1]] }];
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

function build(): Moment[] {
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
    first_seen_ms: T0, last_seen_ms: T0, last_in_view_ms: T0, facts: {}, devices: [],
  };
  const world: WorldView = {
    at_ms: T0, objects: [cup], person: { visible: false, since_ms: T0, last_seen_ms: null, facts: {} }, devices: [], eye: null, vlm_missing: 0, yolo_missing: 0,
  };

  return MOMENTS.map(({ eye, score }, n) => {
    const now = T0 + n * STEP_MS;
    const open: PlanView | null = n === 0 ? null : {
      ...plan, revision: n, status: "running", updatedAt: iso(now), judgment: "사람이 자리를 비운 뒤에도 컵이 식탁에 남아 있어요.",
      steps: plan.steps.map((s, i) => ({ ...s, status: i < n - 1 ? "done" : i === n - 1 ? "active" : "pending" })),
    };
    const step = open?.steps[n - 1];
    const key = step ? cupStepOf(step) : null;
    const command: PlannedCommand | null = open && step && key
      ? { type: "command", id: open.id, step: step.id, text: STEP_COMMAND[key], vision: null, choices: [{ id: "done", label: "완료" }], target: null, speak: true }
      : null;
    const pose = poses[n]!;
    const eyeEvent: EyeEvent = { position: pose.at, height_m: EYE_HEIGHT_M, yaw_deg: pose.yaw, pitch_deg: -10, tracking: "ok", at: iso(now) };
    const decision: BrainLog = {
      type: "decision", at_ms: n === 0 ? T0 : T0 + STEP_MS, id: n === 0 ? "pam-0" : decisionId, seq: n === 0 ? 1 : 2,
      text_sent: "컵 1개가 식탁 위에 있어요. 사람이 안 보여요.", status: "valid",
      prediction: { observation: OBSERVATION, reasoning: n === 0 ? "자리를 비운 지 얼마 안 됐어요." : "사람이 자리를 비운 뒤에도 컵이 식탁에 남아 있어요.", task_index: n === 0 ? -1 : 0 },
      action: n === 0 ? null : ACTION, memory_version: 1,
      world: { objects: [{ id: cup.id, cls: cup.cls, status: cup.status, surface: cup.surface, surface_label: cup.surface_label, error_m: null, facts: {} }], person_visible: false, vlm_missing: 0, yolo_missing: 0 },
    };
    const boxes = cupBox(eye, score);
    const observe: BrainLog = {
      type: "observe", at_ms: now, frame_id: `fake-${n}`, captured_at_ms: now,
      yolo: boxes.length ? boxes.map((b) => `컵 ${b.score.toFixed(2)}`).join(" · ") : "감지 없음", vlm: null, boxes, frame: FRAME,
    };
    const messages: ServerMessage[] = [
      { type: "plan", plan: open },
      { type: "eye", eye: eyeEvent },
      { type: "brain", event: decision },
      { type: "brain", event: observe },
      { type: "say", text: sayLine({ plan: open, command, world, nowMs: now }) },
    ];
    return { index: n, eye, messages };
  });
}

writeFileSync(OUT, `${JSON.stringify({ moments: build() }, null, 2)}\n`);
console.log(`가짜 단계 ${MOMENTS.length}개를 적었어요: ${OUT}`);
