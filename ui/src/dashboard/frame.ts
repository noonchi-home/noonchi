// 트윈 위 표시 한 순간(순수 함수): 서버가 보낸 계획·맞춘 눈·확인 목록 → 트윈 위에 그릴 것(구운 보기 그림 픽셀).
// 시안 shared/frame.ts의 자료 모양(로봇·경로·목적지·표시)과 along·legRanges·splitRoute를 옮겨 실제 자료로 만든다.
// 열린 계획(planned·running)만 쓴다. 클로이드 자리는 맞춘 눈만(추정 눈은 쓰지 않는다).
import type { EyeEvent } from "../../../src/contract/events.ts";
import type { PlanStep, PlanView, XZ } from "../../../src/contract/plan.ts";
import { dashboardChecks, type Check } from "../checks/checks";
import { dollPixelBox } from "../twin3d/eye";
import { planDirToScreen, planToPixel, screenAngle, type OrthoCamera } from "../twin3d/projection";
import type { Px } from "./camera";
import { isOpen, stepIndex } from "./data";
import type { HomeIndex } from "./home";
import type { Box } from "./labels";

/** 지도 위 로봇: 평면 자리, 그림 픽셀 자리, 머리 방향(그림 위 각도, 오른쪽 0 시계 +), 지금 방, 3D 인형이 그림에서 차지하는 상자(그림 픽셀). */
export interface RobotPose { position: XZ; px: Px; angle: number; room: string | null; body: Box }

/** 지도 위 경로: 그림 픽셀 점들, 이동 단계마다 [시작, 끝] 점 번호, 지나온 길(로봇 자리까지)과 남은 길. */
export interface RouteView { points: Px[]; legs: { stepId: string; from: number; to: number }[]; done: Px[]; ahead: Px[] }

/** 지도 위 확인한 것 하나(그림 픽셀). */
export interface MapMark { id: string; px: Px }

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
}

const len = (a: XZ, b: XZ) => Math.hypot(b[0] - a[0], b[1] - a[1]);
const same = (a: XZ, b: XZ) => len(a, b) < 1e-9;

/** 꺾은선 위 길이 비례 자리와 그 구간 방향. t는 0~1. */
export function along(path: XZ[], t: number): { at: XZ; dir: XZ } {
  if (path.length < 2) return { at: path[0] ?? [0, 0], dir: [1, 0] };
  const lens = path.slice(1).map((p, i) => len(path[i]!, p));
  let left = Math.min(1, Math.max(0, t)) * lens.reduce((a, b) => a + b, 0);
  for (let i = 0; i < lens.length; i++) {
    const a = path[i]!;
    const b = path[i + 1]!;
    if (left <= lens[i]! || i === lens.length - 1) {
      const k = lens[i] ? Math.min(1, left / lens[i]!) : 0;
      return { at: [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k], dir: [b[0] - a[0], b[1] - a[1]] };
    }
    left -= lens[i]!;
  }
  return { at: path.at(-1)!, dir: [1, 0] };
}

/** 꺾은선 위에서 p에 가장 가까운 자리의 길이 몫(0~1). 길이가 없으면 0. */
export function progressOn(path: XZ[], p: XZ): number {
  const lens = path.slice(1).map((q, i) => len(path[i]!, q));
  const total = lens.reduce((a, b) => a + b, 0);
  if (total <= 0) return 0;
  let best = Infinity;
  let at = 0;
  let walked = 0;
  for (let i = 0; i < lens.length; i++) {
    const [a, b] = [path[i]!, path[i + 1]!];
    const d = lens[i]!;
    const k = d > 0 ? Math.min(1, Math.max(0, ((p[0] - a[0]) * (b[0] - a[0]) + (p[1] - a[1]) * (b[1] - a[1])) / (d * d))) : 0;
    const gap = len(p, [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k]);
    if (gap < best) { best = gap; at = walked + k * d; }
    walked += d;
  }
  return Math.min(1, Math.max(0, at / total));
}

/** 이동 단계마다 경로 안 [시작, 끝] 점 번호. */
export function legRanges(plan: PlanView): { stepId: string; from: number; to: number }[] {
  return plan.legs.map((l, i) => ({ stepId: l.stepId, from: i === 0 ? 0 : plan.legs[i - 1]!.end, to: l.end }));
}

/**
 * 경로를 지나온 길과 남은 길로 나눈다(평면). 이동 중이면 그 구간의 t(길이 몫) 자리에서, 아니면 마지막으로 도착한 점(arrived)에서 나눈다.
 * 나눈 자리가 꺾인 점과 같으면 한 번만 넣는다. 경로가 없으면 둘 다 빈 배열.
 */
export function splitRoute(path: XZ[], arrived: number, moving: { from: number; to: number } | null, t: number): { done: XZ[]; ahead: XZ[] } {
  if (path.length === 0) return { done: [], ahead: [] };
  if (!moving) return { done: path.slice(0, arrived + 1), ahead: path.slice(arrived) };
  const seg = path.slice(moving.from, moving.to + 1);
  const at = along(seg, t).at;
  const total = seg.slice(1).reduce((a, q, n) => a + len(seg[n]!, q), 0);
  let walked = 0;
  let k = 0;
  while (k + 1 < seg.length && walked + len(seg[k]!, seg[k + 1]!) <= t * total) { walked += len(seg[k]!, seg[k + 1]!); k++; }
  const before = path.slice(0, moving.from + k + 1);
  const after = path.slice(moving.from + k + 1);
  return {
    done: same(before.at(-1)!, at) ? before : [...before, at],
    ahead: after.length && same(after[0]!, at) ? after : [at, ...after],
  };
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
 * 경로: 지금 이동 단계면 그 구간을 눈 자리 몫(progressOn)에서 나누고, 아니면 끝난 이동 구간 끝에서 나눈다.
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
      body: dollPixelBox(cam, eye.position, home.rooms.find((r) => r.id === room)?.floor ?? 0),
    }
    : null;

  const path = plan?.path ?? [];
  const legs = plan ? legRanges(plan) : [];
  const order = (id: string) => plan?.steps.findIndex((s) => s.id === id) ?? -1;
  const current = (step && legs.find((l) => l.stepId === step.id)) ?? null;
  const arrived = legs.filter((l) => order(l.stepId) < k).at(-1)?.to ?? 0;
  const t = current && eye ? progressOn(path.slice(current.from, current.to + 1), eye.position) : 0;
  const split = splitRoute(path, arrived, current, t);
  const next = current ?? legs.find((l) => order(l.stepId) > k) ?? null;
  const points = path.map((q) => planToPixel(cam, q));

  const marks: MapMark[] = [];
  for (const c of dashboardChecks(o.checks)) {
    const id = c.deviceId ?? c.objectId;
    if (!id || marks.some((m) => m.id === id)) continue;
    const a = o.anchor(id);
    if (a) marks.push({ id, px: planToPixel(cam, [a[0], a[2]], a[1]) });
  }

  return {
    plan, index, step, robot,
    route: { points, legs, done: split.done.map((q) => planToPixel(cam, q)), ahead: split.ahead.map((q) => planToPixel(cam, q)) },
    target: next ? points[next.to] ?? null : null,
    marks,
    rooms: plan ? litRooms(plan, k, home) : [],
  };
}
