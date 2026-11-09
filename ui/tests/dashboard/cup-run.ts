// 트윈 위 표시 시험 자료: 실제 한양목련 장면(loadScene, 도면 설비 포함)·평면도(floorPlanFrom)·컵 치우기 계획(cupPlan, 로봇 [10.6, 8.6])으로 만든
// 다섯 순간(0 지켜보기, 1~4 계획 단계)의 계획과 맞춘 눈. 단계 상태는 앞 done·지금 active·뒤 pending, 0이면 계획 없음.
// 눈 자리는 0·1 시작 자리, 2 식탁 구간 끝, 3 싱크대 구간 가운데, 4 길 끝이고 yaw는 그 구간 방향이다.
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { EyeEvent } from "../../../src/contract/events.ts";
import type { PlanView, XZ } from "../../../src/contract/plan.ts";
import { resolveHome } from "../../../src/model/homes.ts";
import { loadScene } from "../../../src/model/scene.ts";
import { floorPlanFrom } from "../../../src/plan/floor.ts";
import { cupPlan } from "../../../src/plan/planner.ts";
import type { Check } from "../../src/checks/checks";
import { homeIndexOf } from "../../src/dashboard/home";
import { MOKRYEON_MAP_CAMERA } from "../../src/twin3d/projection";

export const CAM = MOKRYEON_MAP_CAMERA;
export const IMAGE = { width: CAM.width, height: CAM.height };
export const START: XZ = [10.6, 8.6];

// jsdom 시험에서는 URL이 jsdom 것이라 글로 받은 파일 주소에서 경로를 잇는다
const twin = resolve(dirname(fileURLToPath(import.meta.url)), "../../../twin");
export const SCENE = loadScene(resolveHome(twin, "mokryeon_180b"))!;
export const HOME = homeIndexOf(SCENE, CAM);

const fp = floorPlanFrom(SCENE);
fp.robot = { ...fp.robot, position: START, room: "living" };
export const PLAN = cupPlan(fp, "cup", "2026-11-09T00:00:00.000Z")!;

const objects = SCENE.objects as { id: string; type: string }[];
export const TABLE = objects.find((o) => o.type === "dining_table")!.id;
export const SINK = objects.find((o) => o.type === "sink_counter")!.id;

const len = (a: XZ, b: XZ) => Math.hypot(b[0] - a[0], b[1] - a[1]);
const yawOf = (a: XZ, b: XZ) => (Math.atan2(b[1] - a[1], b[0] - a[0]) * 180) / Math.PI;

/** 꺾은선 길이 t 몫 자리와 그 구간 방향(yaw, 도). */
function alongPath(path: XZ[], t: number): { at: XZ; yaw: number } {
  const total = path.slice(1).reduce((s, p, i) => s + len(path[i]!, p), 0);
  let left = t * total;
  for (let i = 0; i + 1 < path.length; i++) {
    const [a, b] = [path[i]!, path[i + 1]!];
    const d = len(a, b);
    if (left <= d || i + 2 === path.length) {
      const k = d ? Math.min(1, left / d) : 0;
      return { at: [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k], yaw: yawOf(a, b) };
    }
    left -= d;
  }
  return { at: path.at(-1)!, yaw: 0 };
}

const [leg1, leg2] = PLAN.legs;
const tableLeg = PLAN.path.slice(0, leg1!.end + 1);
const sinkLeg = PLAN.path.slice(leg1!.end, leg2!.end + 1);
const POSES = [alongPath(tableLeg, 0), alongPath(tableLeg, 0), alongPath(tableLeg, 1), alongPath(sinkLeg, 0.5), alongPath(sinkLeg, 1)];

const eyeOf = (n: number): EyeEvent => ({
  position: POSES[n]!.at, height_m: 1.1, yaw_deg: POSES[n]!.yaw, pitch_deg: 0, tracking: "ok", at: `2026-11-09T00:00:0${n}.000Z`,
});

/** n번째 순간(0 지켜보기, 1~4 계획 단계)의 계획과 맞춘 눈. */
export function moment(n: number): { plan: PlanView | null; eye: EyeEvent } {
  const plan: PlanView | null = n === 0 ? null : {
    ...PLAN, revision: n, status: "running",
    steps: PLAN.steps.map((s, i) => ({ ...s, status: i < n - 1 ? "done" : i === n - 1 ? "active" : "pending" })),
  };
  return { plan, eye: eyeOf(n) };
}

/** 계획 대상 확인 줄(대시보드 확인 목록이 계획에서 만드는 것과 같음): 식탁, 싱크대. */
export const PLAN_CHECKS: Check[] = [
  { key: `plan:${TABLE}`, order: 1, source: "brain", objectId: TABLE, verb: "확인", at: 0 },
  { key: `plan:${SINK}`, order: 2, source: "brain", objectId: SINK, verb: "확인", at: 0 },
];

/** 물건 자리(three 좌표 [x, 높이, z]): 장면 평면 자리와 윗면 높이 대신 0.8 m. */
export const anchorOf = (id: string): [number, number, number] | null => {
  const o = HOME.objects.get(id);
  return o ? [o.position[0], 0.8, o.position[1]] : null;
};
