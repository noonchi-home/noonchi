// 트윈 위 표시 시험 자료: 실제 한양목련 장면(loadScene, 도면 설비 포함)과 가짜 단계 자료(ui/src/dashboard/fake-run.json, ?debug=steps와 같은 것)의
// 다섯 순간(0 지켜보기, 1~4 계획 단계)의 계획과 맞춘 눈. 단계 상태는 앞 done·지금 active·뒤 pending, 0이면 계획 없음.
// 눈 자리는 0·1 시작 자리, 2 식탁 구간 끝, 3 싱크대 구간 가운데, 4 길 끝이고 yaw는 그 구간 방향이다.
// CUP_PLAN은 지금 장면·평면도로 짠 컵 치우기 계획(cupPlan, 로봇 [10.6, 8.6])이다. 가짜 단계 자료가 지금 것인지 견준다.
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { EyeEvent, ServerMessage } from "../../../src/contract/events.ts";
import type { PlanView, XZ } from "../../../src/contract/plan.ts";
import { resolveHome } from "../../../src/model/homes.ts";
import { loadScene } from "../../../src/model/scene.ts";
import { floorPlanFrom } from "../../../src/plan/floor.ts";
import { cupPlan } from "../../../src/plan/planner.ts";
import type { Check } from "../../src/checks/checks";
import run from "../../src/dashboard/fake-run.json";
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
export const CUP_PLAN = cupPlan(fp, "cup", "2026-11-09T00:00:00.000Z")!;

const objects = SCENE.objects as { id: string; type: string }[];
export const TABLE = objects.find((o) => o.type === "dining_table")!.id;
export const SINK = objects.find((o) => o.type === "sink_counter")!.id;

const messagesAt = (n: number) => run.moments[n]!.messages as ServerMessage[];

/** n번째 순간(0 지켜보기, 1~4 계획 단계)의 계획과 맞춘 눈(가짜 단계 자료). */
export function moment(n: number): { plan: PlanView | null; eye: EyeEvent } {
  let plan: PlanView | null = null;
  let eye: EyeEvent | null = null;
  for (const m of messagesAt(n)) {
    if (m.type === "plan") plan = m.plan;
    if (m.type === "eye") eye = m.eye;
  }
  if (!eye) throw new Error(`순간 ${n}에 눈이 없어요`);
  return { plan, eye };
}

/** 가짜 단계 자료의 컵 치우기 계획(경로·구간·단계 대상). */
export const PLAN: PlanView = moment(1).plan!;

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
