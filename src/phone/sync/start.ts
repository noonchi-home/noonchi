// 시작 위치: 설정에서 집마다 한 번 고른 자리·방향(runtime/homes/<집>/phone-start.json). 폰은 AR을 켜고 그 자리에 서서
// 그 방향을 본 뒤 「여기서 시작」을 누르거나 말한다. 그 순간 자세 하나로 변환을 바로 정한다(어림, src/phone/sync/aligner.ts).
//
// 방향은 평면 규칙(0 = +x, 90 = +y)이다. 폰이 보는 방향은 카메라 -Z의 수평 성분이고, 바닥을 거의 내려다보면(수평 성분이
// 0.35보다 작으면) 폰 윗쪽(+Y)의 수평 성분을 쓴다(세로로 든 폰의 위가 앞).

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { z } from "zod";
import { forwardOf, rotate3, type Plan2, type Vec3 } from "../../shared/geometry.js";
import type { Quat } from "../../contract/observe.js";
import { inBounds, insidePolygon, type Bounds } from "../../layout/home-plan.js";
import { rotateVec, wrapAngle, type Rigid } from "./rigid.js";

export interface StartPose {
  position: Plan2;
  /** 서서 볼 방향(평면 각, 0~360). */
  yawDeg: number;
  /** 서는 자리 이름(폰 위 줄에 보인다). */
  label: string;
  /** 보는 쪽 물건 이름. 없으면 빈 글. */
  facingLabel: string;
}

export class StartPoseError extends Error {}

/** 자리·보는 쪽 이름 길이 한도. */
export const MAX_LABEL = 40;

const num = z.number().refine(Number.isFinite);
const BodySchema = z.object({
  position: z.tuple([num, num]),
  yaw_deg: num,
  label: z.string().optional(),
  facing_label: z.string().optional(),
});

export type Describe = (position: Plan2, yawDeg: number) => { label: string; facingLabel: string };

const norm360 = (d: number) => {
  const v = ((d % 360) + 360) % 360;
  return Math.round(v * 10) / 10 === 360 ? 0 : Math.round(v * 10) / 10;
};

/** 요청 본문 {position, yaw_deg, label?, facing_label?} → 시작 위치. 이름이 비면 describe로 채운다. 틀리면 StartPoseError(한국어).
 *  rooms가 있으면 그중 한 방 바닥 안이어야 한다(벽·바깥은 받지 않는다). */
export function parseStartPose(raw: unknown, bounds: Bounds | null, describe: Describe, rooms: readonly { polygon?: number[][] }[] = []): StartPose {
  const parsed = BodySchema.safeParse(raw);
  if (!parsed.success) {
    const missingYaw = parsed.error.issues.some((i) => i.path[0] === "yaw_deg");
    throw new StartPoseError(missingYaw ? "방향(yaw_deg)은 숫자여야 합니다" : "시작 위치는 [x, y] 숫자 두 개여야 합니다");
  }
  const { position, yaw_deg: yaw, label, facing_label: facing } = parsed.data;
  const p: Plan2 = [position[0], position[1]];
  if (!inBounds(p, bounds)) throw new StartPoseError(`시작 위치 (${p[0]}, ${p[1]})가 집 범위 밖입니다`);
  const polys = rooms.flatMap((r) => (Array.isArray(r.polygon) && r.polygon.length >= 3 ? [r.polygon] : []));
  if (polys.length && !polys.some((poly) => insidePolygon(p, poly))) throw new StartPoseError("방 바닥을 눌러 주세요. 벽이나 집 밖은 시작 위치가 될 수 없어요");
  const yawDeg = norm360(yaw);
  const auto = describe(p, yawDeg);
  const name = (label ?? "").trim() || auto.label;
  const toward = (facing ?? "").trim() || auto.facingLabel;
  if (name.length > MAX_LABEL || toward.length > MAX_LABEL) throw new StartPoseError(`이름은 ${MAX_LABEL}자까지입니다`);
  return { position: p, yawDeg, label: name, facingLabel: toward };
}

/** 이름 채우기에 쓰는 트윈 물건(배치 물건)과 방. */
export interface DescribeObject { id: string; name: string; type: string; category?: string; mount?: string; plan: { position: number[] } }

const NEAR_M = 1.5;
const FACING_DEG = 15;
const FACING_MAX_M = 8;
const NAMED = new Set(["furniture", "appliances", "fixtures"]);

/** 자리 이름: 1.5m 안 가장 가까운 물건 「<이름> 앞」, 없으면 「<방> 시작 위치」. 보는 쪽: 방향 15° 안 8m 안 가장 가까운 물건. */
export function describeStart(objects: readonly DescribeObject[], rooms: readonly { label?: string; polygon?: number[][] }[], position: Plan2, yawDeg: number): { label: string; facingLabel: string } {
  const things = objects.filter((o) => NAMED.has(o.category ?? "") && o.mount !== "opening" && Array.isArray(o.plan?.position));
  const at = (o: DescribeObject): Plan2 => [o.plan.position[0]!, o.plan.position[1]!];
  const dist = (o: DescribeObject) => Math.hypot(at(o)[0] - position[0], at(o)[1] - position[1]);
  const near = things.filter((o) => dist(o) <= NEAR_M).sort((a, b) => dist(a) - dist(b))[0];
  const room = rooms.find((r) => Array.isArray(r.polygon) && r.polygon.length >= 3 && insidePolygon(position, r.polygon))?.label?.trim();
  const label = near ? `${near.name} 앞` : room ? `${room} 시작 위치` : "시작 위치";
  const yaw = (yawDeg * Math.PI) / 180;
  const ahead = things.filter((o) => {
    const d = dist(o);
    if (d < 0.5 || d > FACING_MAX_M || o === near) return false;
    const off = Math.abs(wrapAngle(Math.atan2(at(o)[1] - position[1], at(o)[0] - position[0]) - yaw));
    return off <= (FACING_DEG * Math.PI) / 180;
  }).sort((a, b) => dist(a) - dist(b))[0];
  return { label: label.slice(0, MAX_LABEL), facingLabel: (ahead?.name ?? "").slice(0, MAX_LABEL) };
}

/** 폰이 수평으로 보는 방향(AR 평면 각, rad). */
export function phoneHeading(orientation: Quat): number {
  const f = forwardOf(orientation);
  if (Math.hypot(f[0], f[2]) >= 0.35) return Math.atan2(f[2], f[0]);
  const up = rotate3(orientation, [0, 1, 0]);
  return Math.atan2(up[2], up[0]);
}

/** 시작 자리에 서서 그 방향을 본 폰 자세 → 변환(AR → 평면). */
export function startRigid(start: StartPose, position: Vec3, orientation: Quat): Rigid {
  const theta = wrapAngle((start.yawDeg * Math.PI) / 180 - phoneHeading(orientation));
  const [rx, ry] = rotateVec(theta, [position[0], position[2]]);
  return { theta, tx: start.position[0] - rx, ty: start.position[1] - ry };
}

export function startPosePath(runtimeDir: string, homeId: string): string {
  return join(runtimeDir, "homes", homeId, "phone-start.json");
}

/** 파일이 없으면 null, 깨졌으면 StartPoseError. */
export function readStartPose(path: string): StartPose | null {
  if (!existsSync(path)) return null;
  try {
    const data = JSON.parse(readFileSync(path, "utf8").replace(/^﻿/, "")) as { version?: unknown; start?: Partial<StartPose> };
    if (data.version !== 1 || !data.start) throw new StartPoseError("version 1이 아닙니다");
    const s = data.start;
    return parseStartPose({ position: s.position, yaw_deg: s.yawDeg, label: s.label, facing_label: s.facingLabel }, null, () => ({ label: "시작 위치", facingLabel: "" }));
  } catch (e) {
    throw new StartPoseError(`${path}을 읽지 못했습니다: ${(e as Error).message}`);
  }
}

/** 설정 REST가 쓰는 저장소. 바뀌면 onChange로 실행 중인 폰 세션에 알린다(지우면 null). */
export class StartStore {
  private start: StartPose | null;

  constructor(
    readonly path: string,
    private readonly bounds: Bounds | null,
    private readonly describe: Describe,
    private readonly onChange: (start: StartPose | null) => void,
    initial: StartPose | null = null,
    private readonly rooms: readonly { polygon?: number[][] }[] = [],
  ) {
    this.start = initial;
  }

  get(): StartPose | null {
    return this.start ? { ...this.start, position: [...this.start.position] as Plan2 } : null;
  }

  save(raw: unknown): StartPose {
    const start = parseStartPose(raw, this.bounds, this.describe, this.rooms);
    mkdirSync(dirname(this.path), { recursive: true });
    writeFileSync(this.path, `${JSON.stringify({ version: 1, start }, null, 2)}\n`);
    this.start = start;
    this.onChange(this.get());
    return this.get()!;
  }

  /** 저장하지 않고 검사하고 이름만 채워 본다(설정 화면이 자리·방향을 바꿀 때). */
  preview(raw: unknown): StartPose {
    return parseStartPose(raw, this.bounds, this.describe, this.rooms);
  }

  clear(): void {
    rmSync(this.path, { force: true });
    this.start = null;
    this.onChange(null);
  }
}
