// 벽 대기 맞춤의 기준점 A·B(docs/superpowers/plans/2026-11-04-phone-wall-touch.md).
// 대시보드 3D 트윈에서 고른 벽 지점 두 곳을 집마다 runtime/homes/<집>/phone-touch.json에 둔다.
// 폰은 실제 그 벽 바로 아래 바닥을 조준해 기록하고, 세션(session.ts)이 바닥 기준점과 같은 계산으로 수평만 맞춘다.

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { z } from "zod";
import { MIN_BASELINE_M, type Plan2 } from "./align.js";
import type { AnchorTarget } from "./anchors.js";

export interface TouchPoint {
  id: "A" | "B";
  label: string;
  position: Plan2;
}

export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export class TouchPointsError extends Error {}

/** 눈 마커 높이(m). 벽 대기 맞춤은 높이를 재지 않고 사람 눈높이로 둔다. */
export const DEFAULT_EYE_HEIGHT_M = 1.5;
/** 기준점은 방 다각형 경계 상자에서 이만큼 밖까지 받는다(바깥벽 두께). */
export const BOUNDS_MARGIN_M = 0.3;
/** 기준점 이름 길이 한도. */
export const MAX_LABEL = 40;
const IDS = ["A", "B"] as const;

const num = z.number().refine(Number.isFinite);
const BodySchema = z.object({
  points: z.array(z.object({ label: z.string().optional(), position: z.tuple([num, num]) })),
});

export function eyeHeightOf(raw: string | undefined): number {
  const h = Number(raw);
  return raw !== undefined && raw.trim() !== "" && Number.isFinite(h) && h >= 0.3 && h <= 2.5 ? h : DEFAULT_EYE_HEIGHT_M;
}

/** 방 다각형 전체의 경계 상자 + 여유. 방이 없으면 null(범위 검사 안 함). */
export function homeBounds(rooms: { polygon?: number[][] }[]): Bounds | null {
  const pts = rooms.flatMap((r) => r.polygon ?? []).filter((p) => Number.isFinite(p[0]) && Number.isFinite(p[1]));
  if (pts.length === 0) return null;
  const xs = pts.map((p) => p[0]!), ys = pts.map((p) => p[1]!);
  const m = BOUNDS_MARGIN_M;
  return { minX: Math.min(...xs) - m, minY: Math.min(...ys) - m, maxX: Math.max(...xs) + m, maxY: Math.max(...ys) + m };
}

/** 집 범위 안인지. 범위가 없으면 늘 안. */
export function inBounds([x, y]: Plan2, bounds: Bounds | null): boolean {
  return !bounds || (x >= bounds.minX && x <= bounds.maxX && y >= bounds.minY && y <= bounds.maxY);
}

/** 평면 점이 다각형 안인지(짝홀 규칙). */
export function insidePolygon([x, y]: Plan2, poly: number[][]): boolean {
  let hit = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i]!, [xj, yj] = poly[j]!;
    if ((yi! > y) !== (yj! > y) && x < ((xj! - xi!) * (y - yi!)) / (yj! - yi!) + xi!) hit = !hit;
  }
  return hit;
}

/** 평면 점이 들어 있는 방의 바닥 높이(floor_z). 어느 방에도 없으면 0. */
export function floorLookup(rooms: { polygon?: number[][]; floor_z?: number }[]): (p: Plan2) => number {
  return (p) => {
    const room = rooms.find((r) => r.polygon && insidePolygon(p, r.polygon));
    return typeof room?.floor_z === "number" && Number.isFinite(room.floor_z) ? room.floor_z : 0;
  };
}

/** 요청 본문 {points:[{label?, position}, {…}]} → A·B. 틀리면 TouchPointsError(한국어). */
export function parseTouchPoints(raw: unknown, bounds: Bounds | null = null): TouchPoint[] {
  const list = (raw as { points?: unknown } | null)?.points;
  if (!Array.isArray(list) || list.length !== 2) throw new TouchPointsError("기준점은 두 곳(A·B)이어야 합니다");
  const parsed = BodySchema.safeParse(raw);
  if (!parsed.success) throw new TouchPointsError("기준점 위치는 [x, y] 숫자 두 개여야 합니다");
  const points = parsed.data.points.map((p, i): TouchPoint => {
    const label = (p.label ?? "").trim() || `${IDS[i]} 지점`;
    if (label.length > MAX_LABEL) throw new TouchPointsError(`기준점 이름은 ${MAX_LABEL}자까지입니다`);
    return { id: IDS[i]!, label, position: [p.position[0], p.position[1]] };
  });
  for (const p of points) {
    if (!inBounds(p.position, bounds)) throw new TouchPointsError(`${p.id} 지점 (${p.position[0]}, ${p.position[1]})이 집 범위 밖입니다`);
  }
  const [a, b] = points as [TouchPoint, TouchPoint];
  if (Math.hypot(b.position[0] - a.position[0], b.position[1] - a.position[1]) < MIN_BASELINE_M) {
    throw new TouchPointsError(`A·B가 ${MIN_BASELINE_M}m보다 가깝습니다. 멀리 떨어진 두 벽을 고르세요`);
  }
  return points;
}

export function touchPointsPath(runtimeDir: string, homeId: string): string {
  return join(runtimeDir, "homes", homeId, "phone-touch.json");
}

/** 파일이 없으면 null, 깨졌으면 TouchPointsError. */
export function readTouchPoints(path: string): TouchPoint[] | null {
  if (!existsSync(path)) return null;
  try {
    const data = JSON.parse(readFileSync(path, "utf8").replace(/^﻿/, "")) as { version?: unknown };
    if (data.version !== 1) throw new TouchPointsError("version 1이 아닙니다");
    return parseTouchPoints(data);
  } catch (e) {
    throw new TouchPointsError(`${path}을 읽지 못했습니다: ${(e as Error).message}`);
  }
}

export function touchTargets(points: TouchPoint[]): AnchorTarget[] {
  return points.map((p) => ({ id: p.id, label: p.label, plan: [p.position[0], p.position[1]] }));
}

/** 대시보드 REST가 쓰는 저장소. 바뀌면 onChange로 실행 중인 폰 세션에 알린다(지우면 null). */
export class TouchStore {
  private points: TouchPoint[] | null;

  constructor(
    readonly path: string,
    private readonly bounds: Bounds | null,
    private readonly onChange: (points: TouchPoint[] | null) => void,
    initial: TouchPoint[] | null = null,
  ) {
    this.points = initial;
  }

  get(): TouchPoint[] | null {
    return this.points ? this.points.map((p) => ({ ...p, position: [...p.position] as Plan2 })) : null;
  }

  save(raw: unknown): TouchPoint[] {
    const points = parseTouchPoints(raw, this.bounds);
    mkdirSync(dirname(this.path), { recursive: true });
    writeFileSync(this.path, `${JSON.stringify({ version: 1, points }, null, 2)}\n`);
    this.points = points;
    this.onChange(this.get());
    return this.get()!;
  }

  clear(): void {
    rmSync(this.path, { force: true });
    this.points = null;
    this.onChange(null);
  }
}
