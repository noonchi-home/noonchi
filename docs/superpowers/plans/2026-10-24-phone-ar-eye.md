# 클로이드의 눈: 폰 AR 자세를 3D 트윈에 실시간으로 잇기 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 안드로이드 크롬에서 연 폰 페이지가 WebXR AR로 자기 위치·방향을 재고, 도크와 현관문 바닥 두 점으로 트윈 좌표에 맞춘 뒤, twin-studio 3D 뷰어에 '클로이드의 눈' 마커로 실시간 표시한다.

**Architecture:** twin-home에 폰 전용 작은 서버(`src/phone/`)를 따로 연다. 이 서버는 같은 와이파이의 폰이 붙도록 `0.0.0.0`에 열리며, 폰 페이지(`web/phone/`)와 자세 WebSocket(`/phone/events`)만 제공한다. 기기 제어 API가 있는 본 서버는 지금처럼 `127.0.0.1`에 둔다. 폰이 보낸 AR 자세는 순수 계산(`align.ts`)으로 트윈 평면 좌표의 눈 자세가 되고, 본 서버의 `/events`로 `{type:"eye"}`가 나간다. twin-studio 뷰어는 `?live=`로 이미 `/events`를 듣고 있으므로 `eye` 메시지를 받아 마커를 움직인다.

**Tech Stack:** Node 22 + TypeScript 7, ws 8, zod 4, Vitest 5 (twin-home) · 브라우저 ES 모듈, three.js 0.186.1, `node --test` (twin-studio 뷰어) · WebXR Device API(immersive-ar, hit-test, dom-overlay)

**Spec:** docs 저장소 브랜치 `proposal/dashboard-three-screens`의 `01_Product/구현명세서 SSOT.md` 5.7 촬영 위치, 9.6, 12절(클로이드의 눈·트윈 눈 마커). 이 계획과 함께 9.6을 'AR 자기 위치 추적(도크 기준)'으로 고친다.

## Global Constraints

- 폰: 안드로이드 크롬만 지원한다. 아이폰 Safari는 WebXR AR이 없으므로 지원 불가 메시지를 보인다.
- WebXR은 보안 출처에서만 켜진다. 개발 중에는 폰 크롬 `chrome://flags`의 **Insecure origins treated as secure**에 `http://<PC IP>:8210`을 넣는다.
- 기기 제어 API(`/api/*`)는 계속 `127.0.0.1`에만 연다. 폰 서버에는 폰 페이지와 `/phone/events`만 둔다.
- 폰 서버 WebSocket은 페이지를 준 호스트와 같은 출처만 받는다.
- 눈 자세는 화면 표시 전용이다. 판단(정책·에이전트)에 넣지 않는다.
- 새 npm 의존성을 넣지 않는다(ws·zod는 이미 있음). 뷰어는 빌드 없이 ES 모듈 그대로다.
- 좌표: 평면 (x, y), 높이 h, yaw 0 = +x·90 = +y, pitch는 아래가 음수(SSOT 5.1). three.js는 (x, h, y).
- 기준점 두 곳은 scene.json의 `dock` (3.9, 5.51)과 `door_main` (2.4, 3.55)이다. 두 점이 0.5m보다 가까우면 거절한다.
- 주석·화면 문구는 한국어, 기존 파일 말투를 따른다.

## File Structure

twin-home
- Create `src/phone/align.ts`: AR 자세 → 트윈 평면 눈 자세 계산(순수 함수).
- Create `src/phone/anchors.ts`: scene.json에서 기준점 평면 위치 읽기.
- Create `src/phone/session.ts`: 폰 메시지 검사·기준점 기록·맞춤 상태(네트워크 무관).
- Create `src/phone/server.ts`: 폰 페이지 정적 제공 + `/phone/events` WebSocket.
- Create `src/server/static.ts`: `app.ts`의 `serveFile`·`TYPES`를 옮겨 두 서버가 함께 쓴다.
- Modify `src/server/app.ts`: `static.ts`를 쓰도록 정리.
- Modify `src/server/start.ts`, `src/server/main.ts`: `PHONE_PORT`가 있으면 폰 서버를 띄우고 주소를 알린다.
- Create `web/phone/index.html`, `web/phone/phone.css`, `web/phone/phone.js`: 폰 AR 페이지.
- Create tests `tests/phone-align.test.ts`, `tests/phone-session.test.ts`, `tests/phone-server.test.ts`.
- Modify `docs/plan.md`, `docs/reference.md`, `README.md`: 계약·실행 방법.

twin-studio
- Create `apartment/viewer/eye.mjs`: 눈 자세 → three 위치·방향(순수 함수).
- Modify `apartment/viewer/live.mjs`: `eye` 메시지를 `viewer.setEye`로 넘긴다.
- Modify `apartment/viewer/main.mjs`: 눈 마커를 만들고 `aptViewer.setEye`를 연다.
- Create `apartment/viewer/test/eye.test.mjs`, Modify `apartment/viewer/test/live.test.mjs`.
- Modify `apartment/README.md`: 눈 마커 설명.

---

### Task 1: AR 자세 → 트윈 좌표 계산 (`align.ts`)

**Files:**
- Create: `twin-home/src/phone/align.ts`
- Test: `twin-home/tests/phone-align.test.ts`

**Interfaces:**
- Produces: `Vec3`, `Quat`(x, y, z, w), `Plan2`, `FloorPoint { ar: Vec3; plan: Plan2 }`, `Alignment { theta; tx; ty; floorY; mismatchM }`, `EyePose { position: Plan2; height_m; yaw_deg; pitch_deg }`, `MIN_BASELINE_M = 0.5`, `forwardOf(q): Vec3`, `solveAlignment(a, b): Alignment`(가까우면 throw), `toTwin(position, orientation, al): EyePose`

- [ ] **Step 1: Write the failing test**

```ts
// tests/phone-align.test.ts
import { describe, expect, it } from "vitest";
import { forwardOf, MIN_BASELINE_M, solveAlignment, toTwin, type Plan2, type Quat, type Vec3 } from "../src/phone/align.js";

const DOCK: Plan2 = [3.9, 5.51];
const DOOR: Plan2 = [2.4, 3.55];
const yawQ = (deg: number): Quat => { const h = (deg * Math.PI) / 360; return [0, Math.sin(h), 0, Math.cos(h)]; };
const pitchQ = (deg: number): Quat => { const h = (deg * Math.PI) / 360; return [Math.sin(h), 0, 0, Math.cos(h)]; };

/** 평면 점 → AR 점. 평면 = rot(theta)·AR + t 인 공간을 구현과 따로 거꾸로 계산한다. */
function arOf(plan: Plan2, theta: number, t: Plan2, floorY: number): Vec3 {
  const x = plan[0] - t[0], y = plan[1] - t[1];
  const c = Math.cos(-theta), s = Math.sin(-theta);
  return [x * c - y * s, floorY, x * s + y * c];
}

describe("forwardOf", () => {
  it("돌리지 않은 폰은 -Z를 보고, Y축 90° 회전이면 -X를 본다", () => {
    expect(forwardOf([0, 0, 0, 1])).toEqual([0, 0, -1]);
    const f = forwardOf(yawQ(90));
    expect(f[0]).toBeCloseTo(-1);
    expect(f[1]).toBeCloseTo(0);
    expect(f[2]).toBeCloseTo(0);
  });
});

describe("solveAlignment + toTwin", () => {
  it("AR과 평면이 같으면 그대로 옮긴다", () => {
    const al = solveAlignment({ ar: [DOCK[0], 0, DOCK[1]], plan: DOCK }, { ar: [DOOR[0], 0, DOOR[1]], plan: DOOR });
    expect(al.theta).toBeCloseTo(0);
    expect(toTwin([1, 1.5, 2], [0, 0, 0, 1], al)).toEqual({ position: [1, 2], height_m: 1.5, yaw_deg: 270, pitch_deg: 0 });
  });

  it("30° 돌아가고 옮겨진 AR 공간을 되찾는다", () => {
    const theta = Math.PI / 6, floorY = -1.4;
    const al = solveAlignment(
      { ar: arOf(DOCK, theta, DOCK, floorY), plan: DOCK },
      { ar: arOf(DOOR, theta, DOCK, floorY), plan: DOOR },
    );
    expect(al.theta).toBeCloseTo(theta);
    expect(al.tx).toBeCloseTo(3.9);
    expect(al.ty).toBeCloseTo(5.51);
    expect(al.floorY).toBeCloseTo(floorY);
    expect(al.mismatchM).toBeCloseTo(0);
    const eye = toTwin([0.5, 0, -1], [0, 0, 0, 1], al);
    expect(eye.position[0]).toBeCloseTo(4.833, 2);
    expect(eye.position[1]).toBeCloseTo(4.894, 2);
    expect(eye.height_m).toBeCloseTo(1.4);
    expect(eye.yaw_deg).toBeCloseTo(300, 0);
  });

  it("고개를 숙이면 pitch가 음수다", () => {
    const al = solveAlignment({ ar: [DOCK[0], 0, DOCK[1]], plan: DOCK }, { ar: [DOOR[0], 0, DOOR[1]], plan: DOOR });
    expect(toTwin([0, 1.2, 0], pitchQ(-30), al).pitch_deg).toBeCloseTo(-30, 1);
  });

  it("실제 거리와 트윈 거리가 다르면 그 차이를 알려준다", () => {
    const far: Vec3 = [DOCK[0] + (DOOR[0] - DOCK[0]) * 1.1, 0, DOCK[1] + (DOOR[1] - DOCK[1]) * 1.1];
    const al = solveAlignment({ ar: [DOCK[0], 0, DOCK[1]], plan: DOCK }, { ar: far, plan: DOOR });
    expect(al.mismatchM).toBeCloseTo(Math.hypot(1.5, 1.96) * 0.1, 3);
  });

  it("기준점이 너무 가까우면 거절한다", () => {
    expect(() => solveAlignment({ ar: [0, 0, 0], plan: DOCK }, { ar: [0.1, 0, 0], plan: DOOR })).toThrow(String(MIN_BASELINE_M));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run (in `twin-home/`): `npx vitest run tests/phone-align.test.ts`
Expected: FAIL, `Cannot find module '../src/phone/align.js'`

- [ ] **Step 3: Write minimal implementation**

```ts
// src/phone/align.ts
// 폰 AR(WebXR local 공간) 자세를 트윈 평면 좌표의 눈 자세로 바꾼다. 순수 함수만 둔다.
//
// WebXR 공간은 오른손, +Y 위, 미터다. 트윈 three 좌표도 (평면 x, 높이, 평면 y)라 축 모양이 같으므로
// AR (x, z)를 평면 (x, y)로 읽고 수평 회전 하나와 이동만 구하면 된다. 크기는 둘 다 미터라 맞출 필요가 없다.
// 회전 각은 평면 규칙(yaw 0 = +x, 90 = +y)을 따른다.

export type Vec3 = [number, number, number];
export type Quat = [number, number, number, number]; // x, y, z, w
export type Plan2 = [number, number];

export interface FloorPoint { ar: Vec3; plan: Plan2 }
export interface Alignment { theta: number; tx: number; ty: number; floorY: number; mismatchM: number }
export interface EyePose { position: Plan2; height_m: number; yaw_deg: number; pitch_deg: number }

/** 두 기준점이 이보다 가까우면 방향이 불안정하다. */
export const MIN_BASELINE_M = 0.5;

const round = (v: number, digits: number) => Math.round(v * 10 ** digits) / 10 ** digits;
const deg = (rad: number) => (rad * 180) / Math.PI;

export function rotate2(theta: number, [x, y]: Plan2): Plan2 {
  const c = Math.cos(theta), s = Math.sin(theta);
  return [x * c - y * s, x * s + y * c];
}

/** 쿼터니언으로 벡터를 돌린다: v' = v + 2w(u×v) + 2u×(u×v). */
export function rotate3([qx, qy, qz, qw]: Quat, [vx, vy, vz]: Vec3): Vec3 {
  const cx = qy * vz - qz * vy, cy = qz * vx - qx * vz, cz = qx * vy - qy * vx;
  const ccx = qy * cz - qz * cy, ccy = qz * cx - qx * cz, ccz = qx * cy - qy * cx;
  return [vx + 2 * (qw * cx + ccx), vy + 2 * (qw * cy + ccy), vz + 2 * (qw * cz + ccz)];
}

/** 카메라가 보는 방향. WebXR 시점은 자기 -Z를 본다. */
export function forwardOf(q: Quat): Vec3 {
  return rotate3(q, [0, 0, -1]);
}

/** 바닥 기준점 두 곳(AR 점 ↔ 평면 점)으로 수평 회전·이동·바닥 높이를 구한다. */
export function solveAlignment(a: FloorPoint, b: FloorPoint): Alignment {
  const da: Plan2 = [b.ar[0] - a.ar[0], b.ar[2] - a.ar[2]];
  const dt: Plan2 = [b.plan[0] - a.plan[0], b.plan[1] - a.plan[1]];
  const lenA = Math.hypot(...da), lenT = Math.hypot(...dt);
  if (lenA < MIN_BASELINE_M || lenT < MIN_BASELINE_M) throw new Error(`두 기준점이 ${MIN_BASELINE_M}m보다 가깝습니다`);
  const theta = Math.atan2(dt[1], dt[0]) - Math.atan2(da[1], da[0]);
  const [rx, ry] = rotate2(theta, [a.ar[0], a.ar[2]]);
  return { theta, tx: a.plan[0] - rx, ty: a.plan[1] - ry, floorY: (a.ar[1] + b.ar[1]) / 2, mismatchM: Math.abs(lenT - lenA) };
}

export function toTwin(position: Vec3, orientation: Quat, al: Alignment): EyePose {
  const [px, py] = rotate2(al.theta, [position[0], position[2]]);
  const f = forwardOf(orientation);
  const [fx, fy] = rotate2(al.theta, [f[0], f[2]]);
  const yaw = round((deg(Math.atan2(fy, fx)) + 360) % 360, 1) % 360;
  return {
    position: [round(px + al.tx, 3), round(py + al.ty, 3)],
    height_m: round(position[1] - al.floorY, 3),
    yaw_deg: yaw,
    pitch_deg: round(deg(Math.atan2(f[1], Math.hypot(f[0], f[2]))), 1),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/phone-align.test.ts`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add src/phone/align.ts tests/phone-align.test.ts
git commit -m "feat(phone): AR 자세를 트윈 평면 좌표로 바꾸는 계산"
```

---

### Task 2: 기준점 읽기와 폰 세션 상태 (`anchors.ts`, `session.ts`)

**Files:**
- Create: `twin-home/src/phone/anchors.ts`, `twin-home/src/phone/session.ts`
- Test: `twin-home/tests/phone-session.test.ts`

**Interfaces:**
- Consumes: Task 1 `solveAlignment`, `toTwin`, `Alignment`, `EyePose`, `Vec3`, `Plan2`
- Produces:
  - `AnchorTarget { id: string; label: string; plan: Plan2 }`, `DEFAULT_ANCHORS`, `loadAnchorTargets(scenePath, wanted?): AnchorTarget[]`(없으면 throw)
  - 폰 → 서버 메시지: `{type:"pose", position: Vec3, orientation: Quat, tracking?: "ok"|"limited"}` · `{type:"anchor", id, point: Vec3}` · `{type:"reset"}`
  - `PhoneStatus { type:"status"; anchors: {id; label; recorded}[]; aligned: boolean; mismatch_m: number | null; error?: string }`
  - `EyeEvent = EyePose & { tracking: "ok"|"limited"; at: string }`
  - `class PhoneSession(targets: AnchorTarget[], now?)` · `status(error?)` · `handle(raw: unknown): { reply?: PhoneStatus; eye?: EyeEvent }`

- [ ] **Step 1: Write the failing test**

```ts
// tests/phone-session.test.ts
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadAnchorTargets, type AnchorTarget } from "../src/phone/anchors.js";
import { PhoneSession } from "../src/phone/session.js";

const TARGETS: AnchorTarget[] = [
  { id: "dock", label: "도크", plan: [3.9, 5.51] },
  { id: "door_main", label: "현관문 문턱 가운데", plan: [2.4, 3.55] },
];
const dirs: string[] = [];
afterEach(() => { while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true }); });

function sceneFile(objects: unknown[]): string {
  const dir = mkdtempSync(join(tmpdir(), "phone-"));
  dirs.push(dir);
  const file = join(dir, "scene.json");
  writeFileSync(file, JSON.stringify({ objects }));
  return file;
}

const aligned = () => {
  const s = new PhoneSession(TARGETS, () => new Date("2026-10-24T10:00:00Z"));
  s.handle({ type: "anchor", id: "dock", point: [3.9, 0, 5.51] });
  s.handle({ type: "anchor", id: "door_main", point: [2.4, 0, 3.55] });
  return s;
};

describe("loadAnchorTargets", () => {
  it("scene.json 객체의 평면 위치를 읽는다", () => {
    const file = sceneFile([{ id: "dock", plan: { position: [3.9, 5.51] } }, { id: "door_main", plan: { position: [2.4, 3.55] } }]);
    expect(loadAnchorTargets(file)).toEqual([
      { id: "dock", label: "도크", plan: [3.9, 5.51] },
      { id: "door_main", label: "현관문 문턱 가운데", plan: [2.4, 3.55] },
    ]);
  });

  it("기준점 객체가 없으면 알린다", () => {
    expect(() => loadAnchorTargets(sceneFile([{ id: "dock", plan: { position: [3.9, 5.51] } }]))).toThrow("door_main");
  });
});

describe("PhoneSession", () => {
  it("맞추기 전 자세는 내보내지 않는다", () => {
    const s = new PhoneSession(TARGETS);
    expect(s.handle({ type: "pose", position: [0, 1, 0], orientation: [0, 0, 0, 1] })).toEqual({});
    expect(s.status()).toMatchObject({ aligned: false, mismatch_m: null });
  });

  it("기준점 두 곳 뒤에는 자세를 눈 자세로 바꾼다", () => {
    const s = aligned();
    expect(s.status()).toMatchObject({ aligned: true, mismatch_m: 0, anchors: [{ recorded: true }, { recorded: true }] });
    expect(s.handle({ type: "pose", position: [3.9, 1.4, 5], orientation: [0, 0, 0, 1], tracking: "limited" })).toEqual({
      eye: { position: [3.9, 5], height_m: 1.4, yaw_deg: 270, pitch_deg: 0, tracking: "limited", at: "2026-10-24T10:00:00.000Z" },
    });
  });

  it("잘못된 메시지·모르는 기준점·가까운 기준점은 이유를 돌려준다", () => {
    const s = new PhoneSession(TARGETS);
    expect(s.handle({ type: "pose", position: [0, 1] }).reply?.error).toBe("알 수 없는 메시지입니다");
    expect(s.handle({ type: "anchor", id: "sofa", point: [0, 0, 0] }).reply?.error).toContain("sofa");
    s.handle({ type: "anchor", id: "dock", point: [0, 0, 0] });
    const r = s.handle({ type: "anchor", id: "door_main", point: [0.1, 0, 0] });
    expect(r.reply).toMatchObject({ aligned: false });
    expect(r.reply?.error).toContain("가깝습니다");
  });

  it("reset은 기록을 지운다", () => {
    const s = aligned();
    expect(s.handle({ type: "reset" }).reply).toMatchObject({ aligned: false, anchors: [{ recorded: false }, { recorded: false }] });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/phone-session.test.ts`
Expected: FAIL, `Cannot find module '../src/phone/anchors.js'`

- [ ] **Step 3: Write minimal implementation**

```ts
// src/phone/anchors.ts
// 폰 AR을 트윈에 맞출 바닥 기준점 두 곳(SSOT 9.6). twin-studio scene.json 객체의 평면 위치를 쓴다.

import { readFileSync } from "node:fs";
import type { Plan2 } from "./align.js";

export interface AnchorTarget { id: string; label: string; plan: Plan2 }

/** 도크에서 시작하고 현관문 문턱 가운데로 방향을 맞춘다(두 점 사이 약 2.5m). */
export const DEFAULT_ANCHORS: readonly { id: string; label: string }[] = [
  { id: "dock", label: "도크" },
  { id: "door_main", label: "현관문 문턱 가운데" },
];

export function loadAnchorTargets(scenePath: string, wanted = DEFAULT_ANCHORS): AnchorTarget[] {
  const scene = JSON.parse(readFileSync(scenePath, "utf8")) as { objects?: { id: string; plan?: { position?: unknown[] } }[] };
  return wanted.map(({ id, label }) => {
    const p = scene.objects?.find((o) => o.id === id)?.plan?.position;
    if (!Array.isArray(p) || typeof p[0] !== "number" || typeof p[1] !== "number") {
      throw new Error(`scene.json에 기준점 ${id}의 평면 위치가 없습니다: ${scenePath}`);
    }
    return { id, label, plan: [p[0], p[1]] };
  });
}
```

```ts
// src/phone/session.ts
// 폰 한 대의 AR 세션 상태. 기준점 두 곳을 받으면 트윈에 맞추고, 그 뒤 자세를 눈 자세로 바꾼다.
// 네트워크와 무관하므로 server.ts가 WebSocket 메시지를 그대로 넘긴다.

import { z } from "zod";
import { solveAlignment, toTwin, type Alignment, type EyePose, type Vec3 } from "./align.js";
import type { AnchorTarget } from "./anchors.js";

const num = z.number().refine(Number.isFinite);
const Vec3Schema = z.tuple([num, num, num]);
const MessageSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("pose"),
    position: Vec3Schema,
    orientation: z.tuple([num, num, num, num]),
    tracking: z.enum(["ok", "limited"]).default("ok"),
  }),
  z.object({ type: z.literal("anchor"), id: z.string(), point: Vec3Schema }),
  z.object({ type: z.literal("reset") }),
]);

export interface PhoneStatus {
  type: "status";
  anchors: { id: string; label: string; recorded: boolean }[];
  aligned: boolean;
  mismatch_m: number | null;
  error?: string;
}

export type EyeEvent = EyePose & { tracking: "ok" | "limited"; at: string };

export class PhoneSession {
  private readonly points = new Map<string, Vec3>();
  private alignment: Alignment | null = null;

  constructor(private readonly targets: AnchorTarget[], private readonly now: () => Date = () => new Date()) {
    if (targets.length !== 2) throw new Error("기준점은 두 곳이어야 합니다");
  }

  status(error?: string): PhoneStatus {
    return {
      type: "status",
      anchors: this.targets.map((t) => ({ id: t.id, label: t.label, recorded: this.points.has(t.id) })),
      aligned: this.alignment !== null,
      mismatch_m: this.alignment ? Math.round(this.alignment.mismatchM * 100) / 100 : null,
      ...(error ? { error } : {}),
    };
  }

  handle(raw: unknown): { reply?: PhoneStatus; eye?: EyeEvent } {
    const parsed = MessageSchema.safeParse(raw);
    if (!parsed.success) return { reply: this.status("알 수 없는 메시지입니다") };
    const msg = parsed.data;
    if (msg.type === "reset") {
      this.points.clear();
      this.alignment = null;
      return { reply: this.status() };
    }
    if (msg.type === "anchor") {
      if (!this.targets.some((t) => t.id === msg.id)) return { reply: this.status(`모르는 기준점입니다: ${msg.id}`) };
      this.points.set(msg.id, msg.point);
      this.alignment = null;
      if (this.points.size < this.targets.length) return { reply: this.status() };
      const [a, b] = this.targets.map((t) => ({ ar: this.points.get(t.id)!, plan: t.plan }));
      try {
        this.alignment = solveAlignment(a!, b!);
      } catch (e) {
        return { reply: this.status((e as Error).message) };
      }
      return { reply: this.status() };
    }
    if (!this.alignment) return {};
    return { eye: { ...toTwin(msg.position, msg.orientation, this.alignment), tracking: msg.tracking, at: this.now().toISOString() } };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/phone-session.test.ts tests/phone-align.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/phone/anchors.ts src/phone/session.ts tests/phone-session.test.ts
git commit -m "feat(phone): 기준점 읽기와 폰 AR 세션 상태"
```

---

### Task 3: 폰 서버와 시작 연결 (`server.ts`, `static.ts`, `start.ts`)

**Files:**
- Create: `twin-home/src/server/static.ts`, `twin-home/src/phone/server.ts`
- Modify: `twin-home/src/server/app.ts` (`TYPES`·`serveFile` 제거 후 import), `twin-home/src/server/start.ts`, `twin-home/src/server/main.ts`
- Test: `twin-home/tests/phone-server.test.ts`

**Interfaces:**
- Consumes: Task 2 `PhoneSession`, `EyeEvent`, `AnchorTarget`, `loadAnchorTargets`; 기존 `listenRetry(server, port, host, { log })`, `createApp(...).broadcast(msg)`
- Produces:
  - `serveFile(res, root, rel, head): boolean` (`src/server/static.ts`)
  - `sameHost(origin?, host?): boolean`, `lanUrls(port, host): string[]`
  - `createPhoneServer({ targets, onEye, webDir?, log? }): PhoneServer { server; listen(port, host) → { port, urls }; close() }`
  - 본 서버 `/events` 새 메시지: `{ type: "eye", eye: EyeEvent }`
  - `RunningServer.phoneUrls: string[]`, 환경 변수 `PHONE_PORT`(예: 8210), `PHONE_HOST`(기본 `0.0.0.0`)

- [ ] **Step 1: Write the failing test**

```ts
// tests/phone-server.test.ts
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import type { AnchorTarget } from "../src/phone/anchors.js";
import { createPhoneServer, sameHost } from "../src/phone/server.js";
import { createApp } from "../src/server/app.js";
import { ROOMS, makeHome } from "./helpers/home.js";

type Msg = Record<string, any>;
const TARGETS: AnchorTarget[] = [
  { id: "dock", label: "도크", plan: [3.9, 5.51] },
  { id: "door_main", label: "현관문 문턱 가운데", plan: [2.4, 3.55] },
];
const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => { while (cleanups.length) await cleanups.pop()!(); });

const opened = (ws: WebSocket) => new Promise<void>((res, rej) => { ws.once("open", () => res()); ws.once("error", rej); });
function next(ws: WebSocket, pred: (m: Msg) => boolean): Promise<Msg> {
  return new Promise((res, rej) => {
    const timer = setTimeout(() => rej(new Error("메시지가 오지 않았습니다")), 3000);
    ws.on("message", (d) => {
      const m = JSON.parse(String(d)) as Msg;
      if (pred(m)) { clearTimeout(timer); res(m); }
    });
  });
}

async function setup() {
  const home = makeHome();
  const app = createApp({ hub: home.hub, policy: home.policy, rooms: ROOMS, log: () => {} });
  const { url } = await app.listen(0, "127.0.0.1");
  cleanups.push(() => app.close());
  const webDir = mkdtempSync(join(tmpdir(), "phone-web-"));
  cleanups.push(() => rmSync(webDir, { recursive: true, force: true }));
  writeFileSync(join(webDir, "index.html"), "<title>폰 테스트</title>");
  const phone = createPhoneServer({ targets: TARGETS, webDir, onEye: (eye) => app.broadcast({ type: "eye", eye }), log: () => {} });
  const { port } = await phone.listen(0, "127.0.0.1");
  cleanups.push(() => phone.close());
  return { url, phoneBase: `http://127.0.0.1:${port}` };
}

describe("sameHost", () => {
  it("출처 호스트가 요청 호스트와 같을 때만 받는다", () => {
    expect(sameHost(undefined, "192.168.0.5:8210")).toBe(true);
    expect(sameHost("http://192.168.0.5:8210", "192.168.0.5:8210")).toBe(true);
    expect(sameHost("http://evil.example", "192.168.0.5:8210")).toBe(false);
    expect(sameHost("not a url", "192.168.0.5:8210")).toBe(false);
  });
});

describe("phone server", () => {
  it("기준점 두 곳 뒤의 자세가 본 서버 /events에 eye로 나간다", async () => {
    const { url, phoneBase } = await setup();
    const dash = new WebSocket(`${url.replace(/^http/, "ws")}/events`);
    await opened(dash);
    const phone = new WebSocket(`${phoneBase.replace(/^http/, "ws")}/phone/events`, { origin: phoneBase });
    const first = next(phone, (m) => m.type === "status");
    await opened(phone);
    expect((await first).aligned).toBe(false);
    const done = next(phone, (m) => m.type === "status" && m.aligned);
    phone.send(JSON.stringify({ type: "anchor", id: "dock", point: [3.9, 0, 5.51] }));
    phone.send(JSON.stringify({ type: "anchor", id: "door_main", point: [2.4, 0, 3.55] }));
    expect((await done).mismatch_m).toBe(0);
    const eye = next(dash, (m) => m.type === "eye");
    phone.send(JSON.stringify({ type: "pose", position: [3.9, 1.4, 5], orientation: [0, 0, 0, 1] }));
    expect((await eye).eye).toMatchObject({ position: [3.9, 5], height_m: 1.4, yaw_deg: 270, pitch_deg: 0, tracking: "ok" });
    dash.close();
    phone.close();
  });

  it("다른 출처의 WebSocket은 거절한다", async () => {
    const { phoneBase } = await setup();
    const ws = new WebSocket(`${phoneBase.replace(/^http/, "ws")}/phone/events`, { origin: "http://evil.example" });
    await expect(opened(ws)).rejects.toThrow();
  });

  it("폰 페이지만 주고 기기 API는 없다", async () => {
    const { phoneBase } = await setup();
    const page = await fetch(`${phoneBase}/phone/`);
    expect(page.status).toBe(200);
    expect(await page.text()).toContain("폰 테스트");
    expect((await fetch(`${phoneBase}/api/devices`)).status).toBe(404);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/phone-server.test.ts`
Expected: FAIL, `Cannot find module '../src/phone/server.js'`

- [ ] **Step 3: Move the static file helper out of `app.ts`**

Create `src/server/static.ts` with the `TYPES` table and `serveFile` function cut from `app.ts` (lines with `const TYPES` and `function serveFile`), unchanged except `export`:

```ts
// src/server/static.ts
// 폴더 안의 파일만 내주는 정적 응답(본 서버 web/·/twin/, 폰 서버 web/phone/ 공용).

import { readFileSync, statSync } from "node:fs";
import type { ServerResponse } from "node:http";
import { extname, join, resolve, sep } from "node:path";

export const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png",
  ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".ico": "image/x-icon", ".glb": "model/gltf-binary",
  ".gltf": "model/gltf+json", ".bin": "application/octet-stream", ".wasm": "application/wasm", ".txt": "text/plain; charset=utf-8",
  ".hdr": "application/octet-stream", ".ktx2": "image/ktx2", ".md": "text/markdown; charset=utf-8",
};

export function serveFile(res: ServerResponse, root: string, rel: string, head: boolean): boolean {
  let decoded: string;
  try {
    decoded = decodeURIComponent(rel);
  } catch {
    return false;
  }
  if (decoded.includes("\0")) return false;
  let file = resolve(root, "." + sep + decoded.replace(/^[/\\]+/, ""));
  if (file !== root && !file.startsWith(root.endsWith(sep) ? root : root + sep)) return false;
  try {
    if (statSync(file).isDirectory()) file = join(file, "index.html");
    if (!statSync(file).isFile()) return false;
  } catch {
    return false;
  }
  const body = readFileSync(file);
  res.writeHead(200, { "content-type": TYPES[extname(file).toLowerCase()] ?? "application/octet-stream", "content-length": body.length, "cache-control": "no-cache" });
  res.end(head ? undefined : body);
  return true;
}
```

In `src/server/app.ts`: delete `const TYPES ...` and the inner `function serveFile ...`; add `import { serveFile } from "./static.js";`; change the fs import to `import { existsSync } from "node:fs";` and the path import to `import { resolve } from "node:path";`.

Run: `npx vitest run tests/server.test.ts && npm run typecheck`
Expected: PASS, no type errors (behavior unchanged)

- [ ] **Step 4: Write the phone server**

```ts
// src/phone/server.ts
// 폰 AR 페이지와 자세 WebSocket만 여는 작은 서버(SSOT 9.6). 같은 와이파이의 폰이 붙도록 0.0.0.0에 열 수 있다.
// 기기 제어 API는 여기 없다. 본 서버(127.0.0.1)는 그대로 두고 눈 자세만 onEye로 넘긴다.

import { createServer, type IncomingMessage, type Server } from "node:http";
import { networkInterfaces } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocket, WebSocketServer } from "ws";
import { listenRetry } from "../server/net.js";
import { serveFile } from "../server/static.js";
import type { AnchorTarget } from "./anchors.js";
import { PhoneSession, type EyeEvent } from "./session.js";

const DEFAULT_WEB_DIR = fileURLToPath(new URL("../../web/phone/", import.meta.url));

export interface PhoneServerOptions {
  targets: AnchorTarget[];
  onEye: (eye: EyeEvent) => void;
  webDir?: string;
  log?: (msg: string) => void;
}

export interface PhoneServer {
  readonly server: Server;
  listen(port: number, host: string): Promise<{ port: number; urls: string[] }>;
  close(): Promise<void>;
}

/** 페이지를 준 호스트와 같은 출처만 받는다(다른 사이트가 가짜 자세를 보내지 못하게). */
export function sameHost(origin: string | undefined, host: string | undefined): boolean {
  if (!origin) return true;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

/** 폰에서 열 주소. 0.0.0.0이면 이 PC의 사설 IPv4마다 하나씩. */
export function lanUrls(port: number, host: string): string[] {
  if (host !== "0.0.0.0" && host !== "::") return [`http://${host}:${port}/phone/`];
  return Object.values(networkInterfaces())
    .flat()
    .filter((a) => a && a.family === "IPv4" && !a.internal)
    .map((a) => `http://${a!.address}:${port}/phone/`);
}

export function createPhoneServer(opts: PhoneServerOptions): PhoneServer {
  const webDir = resolve(opts.webDir ?? DEFAULT_WEB_DIR);
  const log = opts.log ?? ((m: string) => console.log(m));
  const session = new PhoneSession(opts.targets);

  const server = createServer((req, res) => {
    const path = new URL(req.url ?? "/", "http://localhost").pathname;
    if (req.method !== "GET" && req.method !== "HEAD") {
      res.writeHead(405);
      res.end();
      return;
    }
    if (path === "/" || path === "/phone") {
      res.writeHead(302, { location: "/phone/" });
      res.end();
      return;
    }
    if (path.startsWith("/phone/") && serveFile(res, webDir, path.slice("/phone/".length), req.method === "HEAD")) return;
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end("없는 경로입니다");
  });

  const wss = new WebSocketServer({
    server,
    path: "/phone/events",
    verifyClient: ({ origin, req }: { origin?: string; req: IncomingMessage }) => sameHost(origin, req.headers.host),
  });
  wss.on("error", () => {}); // listen 실패는 listen()의 reject로 전달된다(app.ts와 같은 이유)

  const reply = (ws: WebSocket, msg: unknown) => {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
  };
  wss.on("connection", (ws) => {
    reply(ws, session.status());
    ws.on("message", (data) => {
      let raw: unknown;
      try {
        raw = JSON.parse(String(data));
      } catch {
        reply(ws, session.status("JSON이 아닙니다"));
        return;
      }
      const out = session.handle(raw);
      if (out.reply) reply(ws, out.reply);
      if (out.eye) opts.onEye(out.eye);
    });
    ws.on("error", () => {});
  });

  return {
    server,
    async listen(port, host) {
      const addr = await listenRetry(server, port, host, { log });
      return { port: addr.port, urls: lanUrls(addr.port, host) };
    },
    async close() {
      for (const ws of wss.clients) ws.terminate();
      await new Promise<void>((r) => wss.close(() => r()));
      server.closeAllConnections();
      await new Promise<void>((r) => server.close(() => r()));
    },
  };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/phone-server.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 6: Start the phone server from `start.ts` and print its address in `main.ts`**

In `src/server/start.ts`:
- Add imports `import { loadAnchorTargets } from "../phone/anchors.js";` and `import { createPhoneServer, type PhoneServer } from "../phone/server.js";`.
- Extend the `env` doc comment: `… PORT(0이면 빈 포트), HOST, PHONE_PORT(있으면 폰 AR 서버), PHONE_HOST(기본 0.0.0.0)를 읽는다.`
- Add to `RunningServer`: `/** PHONE_PORT를 줬을 때 폰에서 열 주소. 없으면 빈 배열. */ phoneUrls: string[];`
- After `const { port, url } = await app.listen(...)` insert:

```ts
    let phone: PhoneServer | undefined;
    let phoneUrls: string[] = [];
    if (env.PHONE_PORT?.trim()) {
      try {
        const targets = loadAnchorTargets(join(twin.dir, "apartment", "scene.json"));
        phone = createPhoneServer({ targets, onEye: (eye) => app.broadcast({ type: "eye", eye }), log });
        const wantedPhone = Number(env.PHONE_PORT);
        const listened = await phone.listen(Number.isInteger(wantedPhone) && wantedPhone >= 0 ? wantedPhone : 8210, env.PHONE_HOST?.trim() || "0.0.0.0");
        phoneUrls = listened.urls;
      } catch (e) {
        await app.close();
        throw e;
      }
    }
```

- Return `phoneUrls` in the result object, and in `close()` call `await phone?.close();` before `await app.close();`.

In `src/server/main.ts`, after the `3D 트윈` line:

```ts
  for (const phoneUrl of srv.phoneUrls) {
    console.log(`  폰 AR     ${phoneUrl}  (폰 크롬 chrome://flags 'Insecure origins treated as secure'에 ${new URL(phoneUrl).origin} 추가)`);
  }
```

Run: `npm run typecheck && npx vitest run`
Expected: no type errors, all tests PASS

- [ ] **Step 7: Commit**

```bash
git add src/server/static.ts src/server/app.ts src/server/start.ts src/server/main.ts src/phone/server.ts tests/phone-server.test.ts
git commit -m "feat(phone): 폰 AR 서버를 따로 열고 눈 자세를 /events로 보낸다"
```

---

### Task 4: 폰 AR 페이지 (`web/phone/`)

**Files:**
- Create: `twin-home/web/phone/index.html`, `twin-home/web/phone/phone.css`, `twin-home/web/phone/phone.js`
- Modify: `twin-home/tests/phone-server.test.ts` (실제 페이지 제공 확인)

**Interfaces:**
- Consumes: Task 2·3의 메시지 형식(`pose`·`anchor`·`reset` 보내기, `status` 받기), WebSocket 경로 `/phone/events`
- Produces: 폰에서 여는 화면 `http://<PC IP>:8210/phone/`

- [ ] **Step 1: Write the failing test** (add to `tests/phone-server.test.ts`)

```ts
describe("phone page", () => {
  it("web/phone의 실제 페이지와 스크립트를 준다", async () => {
    const phone = createPhoneServer({ targets: TARGETS, onEye: () => {}, log: () => {} });
    const { port } = await phone.listen(0, "127.0.0.1");
    cleanups.push(() => phone.close());
    const page = await fetch(`http://127.0.0.1:${port}/phone/`);
    expect(await page.text()).toContain("클로이드의 눈");
    const script = await fetch(`http://127.0.0.1:${port}/phone/phone.js`);
    expect(script.status).toBe(200);
    expect(script.headers.get("content-type")).toContain("javascript");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/phone-server.test.ts -t "phone page"`
Expected: FAIL (404, page missing)

- [ ] **Step 3: Write the page**

```html
<!-- web/phone/index.html -->
<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>클로이드의 눈</title>
<link rel="stylesheet" href="phone.css" />
</head>
<body>
<main id="intro">
  <h1>클로이드의 눈</h1>
  <p id="support">AR 지원을 확인하는 중…</p>
  <ol>
    <li>도크 자리 바닥을 화면 가운데 조준점에 맞추고 <b>도크 지점 기록</b></li>
    <li>현관문 문턱 가운데 바닥을 맞추고 <b>현관문 지점 기록</b></li>
    <li>맞춘 뒤 걸어 다니면 3D 트윈의 눈 마커가 따라 움직여요</li>
  </ol>
  <button id="start" type="button" disabled>AR 시작</button>
</main>
<div id="overlay" hidden>
  <div id="reticle" aria-hidden="true"></div>
  <p id="status" role="status">바닥을 비춰 주세요</p>
  <div id="anchors"></div>
  <div class="row">
    <button id="reset" type="button">다시 맞추기</button>
    <button id="stop" type="button">끝내기</button>
  </div>
</div>
<script type="module" src="phone.js"></script>
</body>
</html>
```

```css
/* web/phone/phone.css */
body { margin: 0; font: 16px/1.5 system-ui, sans-serif; color: #34383e; background: #f7f4ef; }
#intro { padding: 24px 16px; }
#intro h1 { margin: 0 0 8px; font-size: 22px; }
button { font: inherit; padding: 10px 14px; border-radius: 10px; border: 1px solid #d8d2c8; background: #fff; }
#start { width: 100%; background: #b9773f; border-color: #b9773f; color: #fff; }
#start:disabled { opacity: 0.5; }
#overlay { position: fixed; inset: 0; display: flex; flex-direction: column; justify-content: flex-end; gap: 8px; padding: 16px; }
#overlay[hidden] { display: none; }
#reticle { position: fixed; left: 50%; top: 50%; width: 28px; height: 28px; margin: -14px 0 0 -14px; border: 3px solid #b3423a; border-radius: 50%; }
#reticle.hit { border-color: #3f7d4f; }
#status { margin: 0; padding: 8px 12px; border-radius: 10px; background: rgb(255 255 255 / 0.9); }
#anchors, .row { display: flex; gap: 8px; flex-wrap: wrap; }
#anchors button, .row button { flex: 1 1 140px; background: rgb(255 255 255 / 0.92); }
```

```js
// web/phone/phone.js
// 클로이드의 눈(폰): WebXR AR로 폰 자세를 재고, 화면 가운데 조준점이 가리키는 바닥 점을 기준점으로 기록한다.
// 자세는 초당 10번 /phone/events로 보낸다. 트윈 좌표 계산은 서버(src/phone)가 한다.

const $ = (id) => document.getElementById(id);
const SEND_MS = 100;
let ws = null;
let hitPoint = null;
let lastSent = 0;

function connect() {
  ws = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/phone/events`);
  ws.addEventListener("message", (event) => {
    const msg = JSON.parse(event.data);
    if (msg.type === "status") render(msg);
  });
  ws.addEventListener("close", () => setTimeout(connect, 1000));
}

const send = (msg) => {
  if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
};

function render(s) {
  $("anchors").replaceChildren(...s.anchors.map((a) => {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = `${a.recorded ? "✓ " : ""}${a.label} 지점 기록`;
    b.addEventListener("click", () => {
      if (!hitPoint) {
        $("status").textContent = "조준점이 바닥에 닿지 않았어요. 바닥을 천천히 비춰 주세요";
        return;
      }
      send({ type: "anchor", id: a.id, point: hitPoint });
    });
    return b;
  }));
  if (s.error) $("status").textContent = s.error;
  else if (s.aligned) $("status").textContent = `트윈에 맞췄어요 · 실제와 트윈 거리 차이 ${Math.round(s.mismatch_m * 100)}cm`;
  else $("status").textContent = "기준점 두 곳을 기록해 주세요";
}

async function checkSupport() {
  if (!window.isSecureContext) {
    $("support").textContent = `보안 연결이 아니라 AR을 켤 수 없어요. 크롬 chrome://flags 'Insecure origins treated as secure'에 ${location.origin}을 넣고 크롬을 다시 시작하세요.`;
    return;
  }
  if (!navigator.xr || !(await navigator.xr.isSessionSupported("immersive-ar"))) {
    $("support").textContent = "이 브라우저는 WebXR AR을 지원하지 않아요. 안드로이드 크롬이 필요해요.";
    return;
  }
  $("support").textContent = "준비됐어요. 도크 자리 근처에서 시작하세요.";
  $("start").disabled = false;
}

async function start() {
  const session = await navigator.xr.requestSession("immersive-ar", {
    requiredFeatures: ["local", "hit-test", "dom-overlay"],
    domOverlay: { root: $("overlay") },
  });
  $("overlay").hidden = false;
  const gl = document.createElement("canvas").getContext("webgl", { xrCompatible: true });
  session.updateRenderState({ baseLayer: new XRWebGLLayer(session, gl) });
  const space = await session.requestReferenceSpace("local");
  const hitSource = await session.requestHitTestSource({ space: await session.requestReferenceSpace("viewer") });
  session.addEventListener("end", () => { $("overlay").hidden = true; });
  $("stop").onclick = () => session.end();

  const onFrame = (time, frame) => {
    session.requestAnimationFrame(onFrame);
    // 아무것도 그리지 않는다(투명). 카메라 화면 위에 DOM 오버레이만 보인다.
    gl.bindFramebuffer(gl.FRAMEBUFFER, session.renderState.baseLayer.framebuffer);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);

    const hit = frame.getHitTestResults(hitSource)[0]?.getPose(space);
    hitPoint = hit ? [hit.transform.position.x, hit.transform.position.y, hit.transform.position.z] : null;
    $("reticle").classList.toggle("hit", Boolean(hitPoint));

    const pose = frame.getViewerPose(space);
    if (!pose || time - lastSent < SEND_MS) return;
    lastSent = time;
    const { position: p, orientation: o } = pose.transform;
    send({ type: "pose", position: [p.x, p.y, p.z], orientation: [o.x, o.y, o.z, o.w], tracking: pose.emulatedPosition ? "limited" : "ok" });
  };
  session.requestAnimationFrame(onFrame);
}

$("start").addEventListener("click", () => {
  start().catch((error) => { $("support").textContent = `AR을 시작하지 못했어요: ${error.message}`; });
});
$("reset").addEventListener("click", () => send({ type: "reset" }));
connect();
checkSupport();
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/phone-server.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add web/phone tests/phone-server.test.ts
git commit -m "feat(phone): WebXR AR 폰 페이지(조준점 기준점 기록, 자세 전송)"
```

---

### Task 5: 뷰어의 '클로이드의 눈' 마커 (twin-studio)

**Files:**
- Create: `twin-studio/apartment/viewer/eye.mjs`, `twin-studio/apartment/viewer/test/eye.test.mjs`
- Modify: `twin-studio/apartment/viewer/live.mjs:51-135` (`createLiveSync`에 `onEye`), `live.mjs:291-297` (`startLive`가 넘김), `twin-studio/apartment/viewer/main.mjs` (마커·`setEye`), `twin-studio/apartment/viewer/test/live.test.mjs`

**Interfaces:**
- Consumes: Task 3의 `/events` 메시지 `{ type: "eye", eye: { position: [x, y], height_m, yaw_deg, pitch_deg, tracking, at } }`
- Produces: `eyeTransform(eye) → { position: [x, h, y], direction: [dx, dy, dz], limited: boolean } | null`, `createLiveSync({ ..., onEye })`, `window.aptViewer.setEye(eye): boolean`, `window.aptViewer.eye(): eye | null`

- [ ] **Step 1: Write the failing tests**

```js
// apartment/viewer/test/eye.test.mjs
import assert from "node:assert/strict";
import { test } from "node:test";
import { eyeTransform } from "../eye.mjs";

const close = (a, b) => a.forEach((v, i) => assert.ok(Math.abs(v - b[i]) < 1e-9, `${a} ≉ ${b}`));

test("eyeTransform: 평면 (x, y)·높이 → three (x, h, y)", () => {
  const t = eyeTransform({ position: [3.9, 5.51], height_m: 1.4, yaw_deg: 90, pitch_deg: 0, tracking: "ok" });
  assert.deepEqual(t.position, [3.9, 1.4, 5.51]);
  assert.equal(t.limited, false);
});

test("eyeTransform: yaw 90은 +z(평면 +y), pitch -90은 아래, yaw 180은 -x", () => {
  close(eyeTransform({ position: [0, 0], height_m: 1, yaw_deg: 90, pitch_deg: 0 }).direction, [0, 0, 1]);
  close(eyeTransform({ position: [0, 0], height_m: 1, yaw_deg: 0, pitch_deg: -90 }).direction, [0, -1, 0]);
  close(eyeTransform({ position: [0, 0], height_m: 1, yaw_deg: 180, pitch_deg: 0 }).direction, [-1, 0, 0]);
});

test("eyeTransform: 추적이 약하면 limited, 쓸 수 없는 값은 null", () => {
  assert.equal(eyeTransform({ position: [0, 0], height_m: 1, yaw_deg: 0, pitch_deg: 0, tracking: "limited" }).limited, true);
  assert.equal(eyeTransform(null), null);
  assert.equal(eyeTransform({ position: [0], height_m: 1, yaw_deg: 0, pitch_deg: 0 }), null);
  assert.equal(eyeTransform({ position: [0, 0], height_m: "1", yaw_deg: 0, pitch_deg: 0 }), null);
});
```

Add to `apartment/viewer/test/live.test.mjs`:

```js
test("createLiveSync: eye 메시지는 onEye로만 넘기고 상태는 건드리지 않는다", () => {
  const seen = [];
  const viewer = { getAttrs: () => undefined, getState: () => ({}), setState: () => { throw new Error("부르면 안 됨"); } };
  const sync = createLiveSync({ viewer, send: async () => ({ status: 200, json: {} }), onEye: (eye) => seen.push(eye) });
  const eye = { position: [3.9, 5], height_m: 1.4, yaw_deg: 270, pitch_deg: 0, tracking: "ok" };
  sync.handleMessage({ type: "eye", eye });
  assert.deepEqual(seen, [eye]);
  assert.equal(sync.stats().applied, 0);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run (in `twin-studio/`): `node --test apartment/viewer/test/eye.test.mjs apartment/viewer/test/live.test.mjs`
Expected: FAIL (`Cannot find module '../eye.mjs'`, and the new live test fails because `onEye` is never called)

- [ ] **Step 3: Write `eye.mjs` and wire `live.mjs`**

```js
// apartment/viewer/eye.mjs
// 클로이드의 눈 마커(SSOT 12절): twin-home이 보낸 눈 자세(평면 좌표)를 three.js 위치·보는 방향으로 바꾼다.
// 평면 (x, y)·높이 h → three (x, h, y). yaw 0 = +x, 90 = +y(three +z). pitch는 아래가 음수.
// DOM·three 없이 node --test로 검사한다.

const finite = (v) => typeof v === "number" && Number.isFinite(v);

/** 쓸 수 없는 값이면 null. direction은 길이 1. */
export function eyeTransform(eye) {
  if (!eye || !Array.isArray(eye.position) || eye.position.length < 2) return null;
  const [x, y] = eye.position;
  const { height_m: h, yaw_deg: yaw, pitch_deg: pitch } = eye;
  if (![x, y, h, yaw, pitch].every(finite)) return null;
  const a = (yaw * Math.PI) / 180;
  const b = (pitch * Math.PI) / 180;
  return {
    position: [x, h, y],
    direction: [Math.cos(a) * Math.cos(b), Math.sin(b), Math.sin(a) * Math.cos(b)],
    limited: eye.tracking === "limited",
  };
}
```

In `live.mjs`:
- Header comment: add a line `// - {type:"eye"}: 폰 AR(클로이드의 눈) 자세. viewer.setEye로 넘겨 눈 마커를 움직인다.`
- Change the signature to `export function createLiveSync({ viewer, send, onNotice = () => {}, onStats = () => {}, onEye = () => {} })` and update its doc comment with `onEye(eye): 폰 AR 눈 자세(표시 전용).`
- In `handleMessage`, before the `state` branch:

```js
    if (msg.type === "eye") {
      onEye(msg.eye);
      return;
    }
```

- In `startLive`, add `onEye: (eye) => viewer.setEye?.(eye),` to the `createLiveSync({...})` call.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test apartment/viewer/test/eye.test.mjs apartment/viewer/test/live.test.mjs`
Expected: PASS

- [ ] **Step 5: Draw the marker in `main.mjs`**

Add `import { eyeTransform } from "./eye.mjs";` after the `startLive` import. Above `// 자동 검사용(브라우저 콘솔·테스트 도구)` insert:

```js
// --- 클로이드의 눈: twin-home이 보낸 폰 AR 자세(표시 전용) -----------------------------------------
// 꼭짓점이 눈 위치이고 넓은 쪽이 보는 방향인 원뿔. 벽에 가려지지 않게 깊이 검사를 끈다.
const EYE_OK = 0xb9773f;
const EYE_LIMITED = 0x9a9a9a;
const eyeMaterial = new THREE.MeshBasicMaterial({ color: EYE_OK, transparent: true, opacity: 0.6, depthTest: false });
const eyeMarker = new THREE.Group();
eyeMarker.name = "cloid_eye";
{
  const cone = new THREE.ConeGeometry(0.22, 0.6, 24, 1, true);
  cone.rotateZ(Math.PI / 2); // 꼭짓점을 -X로
  cone.translate(0.3, 0, 0); // 꼭짓점이 원점, 넓은 쪽이 +X
  eyeMarker.add(new THREE.Mesh(cone, eyeMaterial), new THREE.Mesh(new THREE.SphereGeometry(0.07, 16, 12), eyeMaterial));
}
eyeMarker.renderOrder = 10;
eyeMarker.visible = false;
scene.add(eyeMarker);
let eyeState = null;
const X_AXIS = new THREE.Vector3(1, 0, 0);

function setEye(eye) {
  const t = eyeTransform(eye);
  if (!t) return false;
  eyeState = { ...eye };
  eyeMarker.position.set(...t.position);
  eyeMarker.quaternion.setFromUnitVectors(X_AXIS, vec(t.direction));
  eyeMaterial.color.set(t.limited ? EYE_LIMITED : EYE_OK);
  eyeMarker.visible = true;
  return true;
}
```

In the `window.aptViewer = { ... }` object add `setEye, eye: () => eyeState,` next to `setState, getState, setAllPower,`.

- [ ] **Step 6: Check in the browser**

Run: `uv run python -m studio serve`, open `http://127.0.0.1:8100/apartment/viewer/`, then in the console:

```js
aptViewer.setEye({ position: [3.9, 5.51], height_m: 1.4, yaw_deg: 270, pitch_deg: -20, tracking: "ok" });
const d = new aptViewer.THREE.Vector3(1, 0, 0).applyQuaternion(aptViewer.scene.getObjectByName("cloid_eye").quaternion);
[d.x, d.y, d.z].map((v) => Math.round(v * 100) / 100 + 0); // + 0은 -0을 0으로
```

Expected: an orange cone over the hallway dock pointing toward the top of the plan (entrance side), and `[0, -0.34, -0.94]`.

Then run the full viewer suite: `node --test` → Expected: PASS.

- [ ] **Step 7: Commit (twin-studio)**

```bash
git add apartment/viewer/eye.mjs apartment/viewer/live.mjs apartment/viewer/main.mjs apartment/viewer/test/eye.test.mjs apartment/viewer/test/live.test.mjs
git commit -m "feat(viewer): 폰 AR 자세를 '클로이드의 눈' 마커로 표시"
```

---

### Task 6: 문서와 실제 폰 확인

**Files:**
- Modify: `twin-home/docs/plan.md` (새 절 `## 폰 AR 눈 (3단계)`), `twin-home/docs/reference.md` (폰 설정), `twin-home/README.md` (실행 표), `twin-studio/apartment/README.md` (눈 마커)

- [ ] **Step 1: Write the contract in `twin-home/docs/plan.md`** (after `## 3D 트윈 연결`)

```markdown
## 폰 AR 눈 (3단계)

- `PHONE_PORT`(예: 8210)를 주면 폰 전용 서버가 `PHONE_HOST`(기본 0.0.0.0)에 뜬다. 주는 것은 `/phone/`(페이지)과 `/phone/events`(WebSocket)뿐이다. 기기 API는 본 서버(127.0.0.1)에만 있다.
- 폰 → 서버: `{type:"pose", position:[x,y,z], orientation:[x,y,z,w], tracking:"ok"|"limited"}`(WebXR local 공간, 초당 10번) · `{type:"anchor", id:"dock"|"door_main", point:[x,y,z]}`(조준점이 닿은 바닥 점) · `{type:"reset"}`. 서버 → 폰: `{type:"status", anchors, aligned, mismatch_m, error?}`.
- 기준점 두 곳(scene.json `dock`, `door_main`의 평면 위치)으로 수평 회전·이동·바닥 높이를 구한다(`src/phone/align.ts`). 두 점이 0.5m보다 가까우면 거절하고, 실제·트윈 거리 차이를 `mismatch_m`으로 알린다.
- 맞춘 뒤 자세는 본 서버 `/events`로 `{type:"eye", eye:{position:[x,y], height_m, yaw_deg, pitch_deg, tracking, at}}`가 된다. 뷰어는 `aptViewer.setEye`로 눈 마커만 움직인다. 판단에는 쓰지 않는다.
- WebSocket은 페이지를 준 호스트와 같은 출처만 받는다.
```

- [ ] **Step 2: Write the setup in `docs/reference.md` and `README.md`**

`docs/reference.md`에 `## 폰 AR(클로이드의 눈)` 절:

```markdown
## 폰 AR(클로이드의 눈)

1. PC: `PHONE_PORT=8210 npm start`. 시작 로그의 `폰 AR http://<PC IP>:8210/phone/`를 확인한다. Windows 방화벽 창이 뜨면 **개인 네트워크**를 허용한다.
2. 폰(안드로이드 크롬, 같은 와이파이): `chrome://flags`에서 **Insecure origins treated as secure**를 켜고 `http://<PC IP>:8210`을 넣은 뒤 크롬을 다시 시작한다. WebXR은 보안 출처에서만 켜지기 때문이다.
3. 폰에서 `http://<PC IP>:8210/phone/` → AR 시작 → 도크 자리 바닥, 현관문 문턱 가운데 바닥을 차례로 조준해 기록한다. 거리 차이가 30cm를 넘으면 다시 맞춘다.
4. PC 브라우저 `http://127.0.0.1:8200/`의 3D에서 눈 마커가 폰을 따라 움직인다.

- 아이폰은 Safari가 WebXR AR을 지원하지 않아 쓸 수 없다.
- 흰 벽·어두운 곳·빠른 움직임에서는 추적이 약해진다(마커가 회색). 오래 걸으면 조금씩 밀리므로 도크에서 다시 맞춘다.
- 트윈과 같은 구조의 집에서만 위치가 맞는다.
```

`README.md`의 실행 표에 행 추가: `| PHONE_PORT=8210 npm start | 폰 AR 페이지도 연다(docs/reference.md "폰 AR") |`

`twin-studio/apartment/README.md`의 `?live=` 설명 아래 한 줄: `- 실시간 연결 중 twin-home이 보낸 폰 AR 자세(eye)는 '클로이드의 눈' 원뿔로 표시한다(aptViewer.setEye).`

- [ ] **Step 3: Run all checks**

Run: `cd twin-home && npm run typecheck && npx vitest run` and `cd ../twin-studio && node --test`
Expected: all PASS

- [ ] **Step 4: Verify on the real phone (사용자와 함께)**

1. `cd twin-home && PHONE_PORT=8210 npm start` (PowerShell: `$env:PHONE_PORT=8210; npm start`)
2. 폰에서 위 설정 후 AR 시작, 기준점 두 곳 기록 → 폰 상태 줄에 "트윈에 맞췄어요 · 거리 차이 N cm"
3. PC `http://127.0.0.1:8200/`의 3D에서 눈 마커가 폰과 같은 방향으로 움직이는지, 폰을 들고 방을 옮기면 마커가 그 방으로 가는지 본다.
Expected: 마커가 1초 안에 따라오고, 도크로 돌아오면 도크 근처에 있다. 실제 결과(거리 차이, 밀림 정도)를 기록한다.

- [ ] **Step 5: Commit**

```bash
cd twin-home && git add docs/plan.md docs/reference.md README.md docs/superpowers/plans/2026-10-24-phone-ar-eye.md && git commit -m "docs: 폰 AR 눈 계약과 설정 방법"
cd ../twin-studio && git add apartment/README.md && git commit -m "docs: 뷰어 눈 마커 설명"
```
