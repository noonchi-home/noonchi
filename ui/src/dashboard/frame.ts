// 트윈 위 표시 한 순간(순수 함수): 서버가 보낸 계획·맞춘 눈·확인 목록·World State → 트윈 위에 그릴 것(구운 보기 그림 픽셀).
// 시안 shared/frame.ts의 자료 모양(로봇·경로·목적지·표시)과 legRanges를 옮겨 실제 자료로 만든다. 경로(route)는 카메라 맞춤·목적지에 쓰고,
// 그리는 계획 길·번호·이름표(planned)는 계획 표시 자료(plan-marks.ts, 트윈 좌표)를 그림 픽셀로 옮긴 것이다.
// 열린 계획(planned·running)만 쓴다. 클로이드 자리는 맞춘 눈만(추정 눈은 쓰지 않는다).
import type { EyeEvent } from "../../../src/contract/events.ts";
import type { PlanStep, PlanTarget, PlanView, StepStatus, XZ } from "../../../src/contract/plan.ts";
import type { WorldView } from "../../../src/contract/world.ts";
import { planMarks, type Vec3 } from "./plan-marks";
import { dashboardChecks, type Check } from "./checks/checks";
import { conePixelBox, planDirToScreen, planToPixel, screenAngle, type OrthoCamera } from "../twin";
import type { Px } from "./camera";
import { isOpen, stepIndex } from "./data";
import type { HomeIndex } from "./home";
import type { Box } from "./labels";

/** 지도 위 로봇: 평면 자리, 그림 픽셀 자리, 머리 방향(그림 위 각도, 오른쪽 0 시계 +), 지금 방, 3D 원뿔이 그림에서 차지하는 상자(그림 픽셀, 꼭짓점 공 ~ 넓은 끝). */
export interface RobotPose { position: XZ; px: Px; angle: number; room: string | null; body: Box }

/** 지도 위 경로(그리지 않음, 카메라 맞춤·목적지용): 그림 픽셀 점들, 이동 단계마다 [시작, 끝] 점 번호. */
export interface RouteView { points: Px[]; legs: { stepId: string; from: number; to: number }[] }

/** 지도 위 확인한 것 하나(그림 픽셀). */
export interface MapMark { id: string; px: Px }

/** 그리는 계획 길(지나온 길·지금 구간·남은 길)·단계 번호·지금 단계 이름표·사람 이름표(그림 픽셀, plan-marks.ts를 옮긴 것). */
export interface PlannedView {
  route: { done: Px[]; now: Px[]; ahead: Px[] };
  stops: { n: number; px: Px; status: StepStatus; now: boolean }[];
  step: { px: Px; text: string } | null;
  person: { px: Px; text: string } | null;
  /** 미리 세운 목표가 선 동안 치울 물건 위 고리 자리. */
  goal: { px: Px } | null;
}

export interface TwinFrame {
  /** 열린 계획. 계획 전 지켜보기·끝난 계획이면 null. */
  plan: PlanView | null;
  /** 0 지켜보기, n 진행 중(없으면 처음 예정) 계획 단계 번호. */
  index: number;
  step: PlanStep | null;
  robot: RobotPose | null;
  route: RouteView;
  /** 지금 이동 구간 끝(지금 단계가 이동이 아니면 다음 이동 구간 끝), 없으면 null. */
  target: Px | null;
  marks: MapMark[];
  /** 밝힐 방(정렬). 비었으면 어둡게 하지 않는다. */
  rooms: string[];
  planned: PlannedView;
}

const len = (a: XZ, b: XZ) => Math.hypot(b[0] - a[0], b[1] - a[1]);

/** 이동 단계마다 경로 안 [시작, 끝] 점 번호. */
export function legRanges(plan: PlanView): { stepId: string; from: number; to: number }[] {
  return plan.legs.map((l, i) => ({ stepId: l.stepId, from: i === 0 ? 0 : plan.legs[i - 1]!.end, to: l.end }));
}

/** 평면 꺾은선이 지나는 방(step m 간격으로 짚어 본다). */
function roomsAlong(path: XZ[], home: HomeIndex, step = 0.1): string[] {
  const out = new Set<string>();
  const add = (p: XZ) => { const r = home.roomAt(p); if (r) out.add(r); };
  if (path.length === 1) add(path[0]!);
  for (let i = 0; i + 1 < path.length; i++) {
    const [a, b] = [path[i]!, path[i + 1]!];
    const n = Math.max(1, Math.ceil(len(a, b) / step));
    for (let j = 0; j <= n; j++) add([a[0] + ((b[0] - a[0]) * j) / n, a[1] + ((b[1] - a[1]) * j) / n]);
  }
  return [...out];
}

/** k번째(0부터) 단계에 밝힐 방: 그 단계 대상 방과 그 단계 이동 구간이 지나는 방, 정렬. 없는 단계면 []. */
export function litRooms(plan: PlanView, k: number, home: HomeIndex): string[] {
  const step = plan.steps[k];
  if (!step) return [];
  const out = new Set<string>();
  const t = step.target;
  const id = t?.deviceId ?? t?.objectId;
  const room = t?.room ?? (id ? home.roomOf(id) : null) ?? (t?.position ? home.roomAt(t.position) : null);
  if (room) out.add(room);
  const leg = legRanges(plan).find((l) => l.stepId === step.id);
  if (leg) for (const r of roomsAlong(plan.path.slice(leg.from, leg.to + 1), home)) out.add(r);
  return [...out].sort();
}

/** 계획 단계마다 밝힐 방 묶음. 대시보드가 묶음마다 어둡게 한 층을 미리 만든다. */
export const roomSetsOf = (plan: PlanView, home: HomeIndex): string[][] => plan.steps.map((_, k) => litRooms(plan, k, home));

/**
 * 한 순간의 트윈 위 표시. 열린 계획만 쓴다. 클로이드는 맞춘 눈(평면 자리, 방향 [cos yaw, sin yaw]).
 * 경로: 계획 경로 그림 픽셀과 이동 구간(카메라 맞춤용, 그리지 않는다).
 * 목적지: 지금(아니면 다음) 이동 구간 끝. 표시: 확인 목록의 기기·물건마다 anchor(three 좌표 [x, 높이, z]) 자리(모르면 뺀다).
 * 밝힐 방: 열린 계획이면 지금 단계의 litRooms, 아니면 []. 그림 픽셀은 구운 보기 카메라(cam)다.
 */
export function twinFrame(o: {
  plan: PlanView | null;
  eye: EyeEvent | null;
  checks: Check[];
  anchor: (id: string) => [number, number, number] | null;
  home: HomeIndex;
  cam: OrthoCamera;
  /** 지금 World State(사람 이름표·World State 물건 대상 자리). 없으면 사람 이름표가 없다. */
  world?: WorldView | null;
  /** 미리 세운 목표(goal.ts): 선 동안 그 물건 위 고리. */
  goal?: { object: string | null; standing: boolean } | null;
}): TwinFrame {
  const { cam, home } = o;
  const plan = isOpen(o.plan) ? o.plan : null;
  const index = stepIndex(plan);
  const k = index - 1;
  const step = plan?.steps[k] ?? null;
  const eye = o.eye && !o.eye.estimated ? o.eye : null;
  const room = eye ? home.roomAt(eye.position) : null;
  const robot: RobotPose | null = eye
    ? {
      position: eye.position,
      px: planToPixel(cam, eye.position),
      angle: screenAngle(planDirToScreen(cam, [Math.cos((eye.yaw_deg * Math.PI) / 180), Math.sin((eye.yaw_deg * Math.PI) / 180)])),
      room,
      body: conePixelBox(cam, eye),
    }
    : null;

  const path = plan?.path ?? [];
  const legs = plan ? legRanges(plan) : [];
  const order = (id: string) => plan?.steps.findIndex((s) => s.id === id) ?? -1;
  const current = (step && legs.find((l) => l.stepId === step.id)) ?? null;
  const next = current ?? legs.find((l) => order(l.stepId) > k) ?? null;
  const points = path.map((q) => planToPixel(cam, q));

  const marks: MapMark[] = [];
  for (const c of dashboardChecks(o.checks)) {
    const id = c.deviceId ?? c.objectId;
    if (!id || marks.some((m) => m.id === id)) continue;
    // 장면 물건이 아닌 자리(폰 눈·World State 물건)는 그 트윈 자리
    const a = c.pos ?? o.anchor(id);
    if (a) marks.push({ id, px: planToPixel(cam, [a[0], a[2]], a[1]) });
  }

  // 계획 표시 자료(트윈 좌표) → 그림 픽셀. 대상 자리는 장면 물건·가전 anchor, 없으면 World State 물건 자리
  const at = (t: PlanTarget): Vec3 | null => {
    const id = t.deviceId ?? t.objectId;
    const found = id ? o.anchor(id) ?? o.world?.objects.find((x) => x.id === id)?.position : null;
    return found ?? (t.position ? [t.position[0], 0, t.position[1]] : null);
  };
  const pm = planMarks({ plan, robot: eye ? eye.position : null, world: o.world ?? null, at, goal: o.goal ?? null });
  const toPx = (v: Vec3): Px => planToPixel(cam, [v[0], v[2]], v[1]);
  const planned: PlannedView = {
    route: { done: pm.route.done.map(toPx), now: pm.route.now.map(toPx), ahead: pm.route.ahead.map(toPx) },
    stops: pm.stops.map((s) => ({ n: s.n, px: toPx(s.at), status: s.status, now: s.now })),
    step: pm.step ? { px: toPx(pm.step.at), text: pm.step.text } : null,
    person: pm.person ? { px: toPx(pm.person.at), text: pm.person.text } : null,
    goal: pm.goal ? { px: toPx(pm.goal.at) } : null,
  };

  return {
    plan, index, step, robot,
    route: { points, legs },
    target: next ? points[next.to] ?? null : null,
    marks,
    rooms: plan ? litRooms(plan, k, home) : [],
    planned,
  };
}
