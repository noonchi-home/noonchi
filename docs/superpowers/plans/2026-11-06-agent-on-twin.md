# 트윈 위 에이전트 계획 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 클로이드가 지금 상황을 어떻게 판단했는지, 무엇을 할지, 어디로 움직일지를 3D 트윈 위에서 바로 알아보게 한다.

**Architecture:** 서버가 「계획」 하나(`PlanView`: 판단 한 줄, 단계 목록, 로봇 위치, 바닥 경로)를 만들어 `/events`로 `{type:"plan"}`을 보낸다. 지금은 컵 시나리오(brain)와 에이전트 기기 행동에서 계획을 만들고, 경로는 평면도(scene.json `plan`의 방·문·트인 경계)로 서버가 직접 찾는다. 나중에 task planner(ai 저장소)가 같은 모양을 `POST /api/plan`으로 보내면 그대로 그린다. 화면은 뷰어 장면에 바닥 띠·목적지 고리를 넣고, 로봇 위에 판단 말풍선, 목적지에 단계 번호를 띄운다.

**Tech Stack:** 서버 TypeScript(Node), 화면 React(`2026-11-06-react-ui.md`의 `ui/`), three.js는 뷰어의 `aptViewer.THREE`.

**Spec:** 사용자 요청(2026-11-06): 「에이전트의 상황 판단뿐만 아니라 어떤 행동을 할 거고 어디로 이동할 거고를 트윈 위에서 최대한 알기 편하게」. 팀 대화: FSM이 행동을 보내면 task planner가 집 구조로 세부 행동을 나누고, 그 이동 경로를 트윈에 보여 준다.

## Global Constraints

- `2026-11-06-react-ui.md`의 Task 1~5가 먼저 끝나 있어야 한다(`TwinStage`, `useViewer`, `projectPoint`, `deviceAnchor`, `useEvents`, `src/contract/events.ts`).
- 행동은 지금처럼 모두 모의다. 계획은 「로봇이라면 할 일」이고 `dryRun: true`면 화면에 「모의」를 붙인다. 기기 명령·ThinQ 호출을 새로 하지 않는다.
- 화면 글 규칙(`CLAUDE.md`) 그대로. 서버가 만들어 화면에 그대로 나가는 글은 `src/plan/labels.ts` 한 파일에만 두고, `npm run lint`가 그 파일도 검사한다. 단계는 번호로 보이고 화살표 글로 잇지 않는다.
- twin-studio 저장소, ai 저장소(박석준)는 고치지 않는다. ai 저장소에는 커밋·푸시하지 않는다.
- 커밋은 사용자가 허락한 뒤에만, `git add`는 경로를 하나씩.

## 파일 구조

```
src/contract/plan.ts       PlanView 계약(순수 타입). ServerMessage에 {type:"plan"} 추가
src/plan/floor.ts          scene.json → FloorPlan(방 다각형·문·트인 경계·물건 평면 위치·로봇 위치)
src/plan/route.ts          roomAt, portals, route(바닥 경로), approach(목적지 앞에서 멈추기)
src/plan/labels.ts         화면에 나가는 판단·단계 글 표(lint 대상)
src/plan/planner.ts        brain 행동·에이전트 행동 → PlanView
src/plan/hub.ts            지금 계획 보관·상태 갱신·방송, POST /api/plan 받기
docs/plan-contract.md      task planner가 보낼 JSON 모양(팀 공유용)
ui/src/plan/ribbon.ts      ribbonPositions, pointAlong(순수)
ui/src/plan/PathLayer.tsx  뷰어 장면에 경로 띠·고리·움직이는 점 넣기
ui/src/plan/RobotBubble.tsx 로봇 위 판단·지금 단계 말풍선, 목적지 단계 번호
ui/src/plan/PlanCard.tsx   대화 패널 위쪽 계획 카드(단계 목록·상태)
```

---

### Task 1: 계획 계약과 팀 공유 문서

**Files:**
- Create: `src/contract/plan.ts`, `docs/plan-contract.md`
- Modify: `src/contract/events.ts`(ServerMessage), `ui/src/lib/messages.ts`(KNOWN에 `"plan"`), `tests/contract.test.ts`

**Interfaces:**
- Produces:

```ts
// src/contract/plan.ts
// 클로이드 계획(판단·단계·이동 경로) 계약. 서버 planner와 task planner(ai 저장소)가 같은 모양을 보낸다. 평면 좌표는 scene.json plan과 같은 [x, z] 미터.
export type XZ = [number, number];
export type PlanSource = "brain" | "agent" | "planner";
export type StepKind = "move" | "act" | "ask" | "device" | "wait";
export type StepStatus = "pending" | "active" | "done" | "failed" | "skipped";

export interface PlanTarget { objectId?: string; deviceId?: string; room?: string; position?: XZ }

export interface PlanStep { id: string; kind: StepKind; label: string; target?: PlanTarget; status: StepStatus }

export interface PlanView {
  id: string;
  source: PlanSource;
  goal: string;
  judgment: string;
  dryRun: boolean;
  robot: { position: XZ; room: string | null };
  /** 로봇에서 시작하는 바닥 경로. 이동이 없으면 []. move 단계마다 legs에 끝 점 번호가 있다. */
  path: XZ[];
  legs: { stepId: string; end: number }[];
  steps: PlanStep[];
  status: "planned" | "running" | "done" | "cancelled" | "failed";
  updatedAt: string;
}
```

- `ServerMessage`에 `| { type: "plan"; plan: PlanView | null }`(null = 계획 지움).

- [ ] **Step 1: 테스트** — `tests/contract.test.ts`에 `src/contract/plan.ts`도 「타입만 가져온다」 검사를 더한다. `ui/tests/messages.test.ts`에 `parseMessage('{"type":"plan","plan":null}')?.type === "plan"`을 더한다. Run → FAIL
- [ ] **Step 2: 구현** — 위 타입 파일, `events.ts`·`messages.ts` 고치기. Run → PASS
- [ ] **Step 3: `docs/plan-contract.md`** — 결론만 쓴다: 보내는 곳(`POST http://127.0.0.1:8200/api/plan`, 본문 `{ plan: PlanView }`, `id`가 같으면 갱신), 좌표 기준(scene.json `plan`, 미터, [x, z]), 컵 치우기 예시 JSON 하나(아래 Task 3 테스트의 기대값과 같은 값), 단계 상태만 바꿀 때 `POST /api/plan/:id/steps/:stepId {status}`.
- [ ] **Step 4: Commit**(사용자 허락 뒤)

```bash
git add src/contract/plan.ts src/contract/events.ts ui/src/lib/messages.ts tests/contract.test.ts ui/tests/messages.test.ts docs/plan-contract.md
git commit -m "feat: define the Cloid plan contract (judgment, steps, floor path)"
```

---

### Task 2: 평면도와 바닥 경로

**Files:**
- Create: `src/plan/floor.ts`, `src/plan/route.ts`, `tests/plan-route.test.ts`

**Interfaces:**
- Produces:
  - `interface FloorPlan { rooms: { id: string; polygon: XZ[] }[]; portals: Portal[]; objects: Map<string, { id: string; type: string; room: string | null; position: XZ }>; robot: { position: XZ; room: string | null; reachable: string[] } }`
  - `interface Portal { id: string; rooms: [string, string]; point: XZ }`
  - `floorPlanFrom(scene: unknown): FloorPlan`(scene.json 전체를 받는다. 문 `connects`, `open_edges`는 두 방 다각형이 겹치는 변의 가운데)
  - `roomAt(fp: FloorPlan, p: XZ): string | null`
  - `route(fp: FloorPlan, from: XZ, to: XZ): XZ[] | null`(문·트인 경계를 잇는 최단 거리, 로봇이 갈 수 있는 방만 지난다)
  - `approach(path: XZ[], stopM: number): XZ[]`(마지막 구간을 stopM만큼 줄인다)

- [ ] **Step 1: 실패하는 테스트**

`tests/plan-route.test.ts`
```ts
import { describe, expect, it } from "vitest";
import { approach, floorPlanFrom, roomAt, route } from "../src/plan/route.js";

// A(0..4 × 0..4)와 B(4..8 × 0..4)는 트여 있고, C(0..4 × 4..8)는 A와 (2,4) 문으로 이어진다
const scene = {
  plan: {
    rooms: [
      { id: "A", polygon: [[0, 0], [4, 0], [4, 4], [0, 4]] },
      { id: "B", polygon: [[4, 0], [8, 0], [8, 4], [4, 4]] },
      { id: "C", polygon: [[0, 4], [4, 4], [4, 8], [0, 8]] },
    ],
    doors: [{ id: "d1", position: [2, 4], connects: ["A", "C"] }],
    open_edges: [["A", "B"]],
    robot: { dock: "dock", reachable_rooms: ["A", "B", "C"] },
  },
  objects: [
    { id: "dock", type: "robot_dock", room: "C", plan: { position: [2, 6] } },
    { id: "table", type: "dining_table", room: "B", plan: { position: [6, 2] } },
  ],
};

describe("바닥 경로", () => {
  const fp = floorPlanFrom(scene);
  it("로봇은 충전대 자리에서 시작", () => {
    expect(fp.robot).toEqual({ position: [2, 6], room: "C", reachable: ["A", "B", "C"] });
  });
  it("트인 경계는 겹치는 변의 가운데", () => {
    expect(fp.portals.find((p) => p.rooms.includes("B"))?.point).toEqual([4, 2]);
  });
  it("방 찾기", () => {
    expect(roomAt(fp, [6, 1])).toBe("B");
    expect(roomAt(fp, [20, 20])).toBeNull();
  });
  it("C에서 B 식탁까지: 문 → 트인 경계 → 식탁", () => {
    expect(route(fp, [2, 6], [6, 2])).toEqual([[2, 6], [2, 4], [4, 2], [6, 2]]);
  });
  it("갈 수 없는 방이면 null", () => {
    const blocked = floorPlanFrom({ ...scene, plan: { ...scene.plan, robot: { dock: "dock", reachable_rooms: ["C"] } } });
    expect(route(blocked, [2, 6], [6, 2])).toBeNull();
  });
  it("목적지 0.5m 앞에서 멈춘다", () => {
    expect(approach([[0, 0], [0, 2]], 0.5)).toEqual([[0, 0], [0, 1.5]]);
  });
});
```

- [ ] **Step 2: 구현**

`src/plan/route.ts`
```ts
// 평면도 위 바닥 경로: 방은 다각형, 방 사이는 문·트인 경계(포털)로 잇는다. 같은 방 안은 곧은 선으로 본다.
// 실제 로봇 경로가 아니라 「어디로 갈지」를 보여 주는 선이다. task planner가 경로를 보내면 그것을 쓴다.
import type { XZ } from "../contract/plan.js";
import { floorPlanFrom, type FloorPlan } from "./floor.js";

export { floorPlanFrom };

const dist = (a: XZ, b: XZ) => Math.hypot(a[0] - b[0], a[1] - b[1]);

export function roomAt(fp: FloorPlan, [x, z]: XZ): string | null {
  for (const r of fp.rooms) {
    let inside = false;
    for (let i = 0, j = r.polygon.length - 1; i < r.polygon.length; j = i++) {
      const [xi, zi] = r.polygon[i]!;
      const [xj, zj] = r.polygon[j]!;
      if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
    }
    if (inside) return r.id;
  }
  return null;
}

/** 시작·끝 점과 포털을 마디로 둔 최단 거리(다익스트라). 두 마디가 같은 방에 있으면 잇는다. */
export function route(fp: FloorPlan, from: XZ, to: XZ): XZ[] | null {
  const startRoom = roomAt(fp, from);
  const endRoom = roomAt(fp, to);
  if (!startRoom || !endRoom) return null;
  if (startRoom === endRoom) return [from, to];
  const ok = new Set([...fp.robot.reachable, startRoom, endRoom]);
  if (!fp.robot.reachable.includes(endRoom)) return null;
  const nodes: { point: XZ; rooms: string[] }[] = [
    { point: from, rooms: [startRoom] },
    { point: to, rooms: [endRoom] },
    ...fp.portals.filter((p) => ok.has(p.rooms[0]) && ok.has(p.rooms[1])).map((p) => ({ point: p.point, rooms: [...p.rooms] })),
  ];
  const best = nodes.map(() => Infinity);
  const prev = nodes.map(() => -1);
  const done = nodes.map(() => false);
  best[0] = 0;
  for (;;) {
    let u = -1;
    for (let i = 0; i < nodes.length; i++) if (!done[i] && best[i]! < Infinity && (u < 0 || best[i]! < best[u]!)) u = i;
    if (u < 0 || u === 1) break;
    done[u] = true;
    for (let v = 0; v < nodes.length; v++) {
      if (done[v] || !nodes[u]!.rooms.some((r) => nodes[v]!.rooms.includes(r))) continue;
      const d = best[u]! + dist(nodes[u]!.point, nodes[v]!.point);
      if (d < best[v]!) { best[v] = d; prev[v] = u; }
    }
  }
  if (best[1] === Infinity) return null;
  const out: XZ[] = [];
  for (let i = 1; i >= 0; i = prev[i]!) out.unshift(nodes[i]!.point);
  return out;
}

export function approach(path: XZ[], stopM: number): XZ[] {
  if (path.length < 2) return path;
  const a = path[path.length - 2]!;
  const b = path[path.length - 1]!;
  const len = dist(a, b);
  if (len <= stopM) return path.slice(0, -1);
  const t = (len - stopM) / len;
  const round = (n: number) => Math.round(n * 1000) / 1000;
  return [...path.slice(0, -1), [round(a[0] + (b[0] - a[0]) * t), round(a[1] + (b[1] - a[1]) * t)]];
}
```

`src/plan/floor.ts`
```ts
// scene.json(twin-studio 집 산출물) → 경로 찾기에 쓰는 평면도. 좌표는 plan과 같은 [x, z] 미터.
import type { XZ } from "../contract/plan.js";

export interface Portal { id: string; rooms: [string, string]; point: XZ }
export interface FloorPlan {
  rooms: { id: string; polygon: XZ[] }[];
  portals: Portal[];
  objects: Map<string, { id: string; type: string; room: string | null; position: XZ }>;
  robot: { position: XZ; room: string | null; reachable: string[] };
}

type Scene = {
  plan?: { rooms?: { id: string; polygon: XZ[] }[]; doors?: { id: string; position: XZ; connects: string[] }[]; open_edges?: [string, string][]; robot?: { dock?: string; reachable_rooms?: string[] } };
  objects?: { id: string; type: string; room?: string | null; plan?: { position?: XZ } }[];
};

const EPS = 0.06;

/** 두 다각형이 맞닿은 변들 중 가장 길게 겹치는 구간의 가운데. 없으면 null. */
export function sharedEdgeMidpoint(a: XZ[], b: XZ[]): XZ | null {
  let best: { len: number; mid: XZ } | null = null;
  const segs = (p: XZ[]) => p.map((q, i) => [q, p[(i + 1) % p.length]!] as [XZ, XZ]);
  for (const [p1, p2] of segs(a)) {
    const dx = p2[0] - p1[0];
    const dz = p2[1] - p1[1];
    const len = Math.hypot(dx, dz);
    if (len < EPS) continue;
    const ux = dx / len;
    const uz = dz / len;
    for (const [q1, q2] of segs(b)) {
      const off = (q: XZ) => Math.abs((q[0] - p1[0]) * uz - (q[1] - p1[1]) * ux);
      if (off(q1) > EPS || off(q2) > EPS) continue;
      const t = (q: XZ) => (q[0] - p1[0]) * ux + (q[1] - p1[1]) * uz;
      const lo = Math.max(0, Math.min(t(q1), t(q2)));
      const hi = Math.min(len, Math.max(t(q1), t(q2)));
      if (hi - lo > EPS && (!best || hi - lo > best.len)) {
        const m = (lo + hi) / 2;
        best = { len: hi - lo, mid: [Math.round((p1[0] + ux * m) * 1000) / 1000, Math.round((p1[1] + uz * m) * 1000) / 1000] };
      }
    }
  }
  return best?.mid ?? null;
}

export function floorPlanFrom(scene: unknown): FloorPlan {
  const s = scene as Scene;
  const rooms = s.plan?.rooms ?? [];
  const byId = new Map(rooms.map((r) => [r.id, r]));
  const portals: Portal[] = [];
  for (const d of s.plan?.doors ?? []) {
    const [a, b] = d.connects;
    if (a && b && byId.has(a) && byId.has(b)) portals.push({ id: d.id, rooms: [a, b], point: d.position });
  }
  for (const [a, b] of s.plan?.open_edges ?? []) {
    const mid = byId.has(a) && byId.has(b) ? sharedEdgeMidpoint(byId.get(a)!.polygon, byId.get(b)!.polygon) : null;
    if (mid) portals.push({ id: `open:${a}:${b}`, rooms: [a, b], point: mid });
  }
  const objects = new Map<string, { id: string; type: string; room: string | null; position: XZ }>();
  for (const o of s.objects ?? []) if (o.plan?.position) objects.set(o.id, { id: o.id, type: o.type, room: o.room ?? null, position: o.plan.position });
  const dockId = s.plan?.robot?.dock;
  const start = [...objects.values()].find((o) => o.type === "robot") ?? (dockId ? objects.get(dockId) : undefined);
  return {
    rooms, portals, objects,
    robot: { position: start?.position ?? [0, 0], room: start?.room ?? null, reachable: s.plan?.robot?.reachable_rooms ?? rooms.map((r) => r.id) },
  };
}
```

(fixture에는 `robot` 종류가 없어 충전대 자리를 쓴다. 실제 마곡 집은 `robot`(3.9, 5.51, 복도)이 있다.)

- [ ] **Step 3: 실제 집으로 한 번 더** — 같은 테스트 파일에 `../twin-studio/apartment/scene.json`이 있을 때만 도는 테스트를 더한다: 로봇(복도)에서 식탁 `table_1`(8.04, 2.7)까지 경로가 있고, 첫 점이 [3.9, 5.51], 끝 점이 [8.04, 2.7], 지나는 점이 3개 이하인지 본다(`it.skipIf(!existsSync(path))`).
- [ ] **Step 4: 확인** — `npx vitest run tests/plan-route.test.ts` PASS
- [ ] **Step 5: Commit**(사용자 허락 뒤)

```bash
git add src/plan/floor.ts src/plan/route.ts tests/plan-route.test.ts
git commit -m "feat(plan): find a floor path through doors and open edges of the twin plan"
```

---

### Task 3: 계획 만들기와 방송

**Files:**
- Create: `src/plan/labels.ts`, `src/plan/planner.ts`, `src/plan/hub.ts`, `tests/plan-planner.test.ts`, `tests/plan-hub.test.ts`
- Modify: `src/server/home.ts`(brain·eye 이벤트를 PlanHub로), `src/server/app.ts`(에이전트 이벤트 구독 463줄 근처, `GET/POST /api/plan`, 연결 때 지금 계획 보내기 457줄 근처), `scripts/lint-ui-copy.ts`(`src/plan/labels.ts`도 검사)

**Interfaces:**
- Consumes: `BrainEvent`, `AgentEvent`(src/contract/events.ts), `FloorPlan`, `route`, `approach`
- Produces:
  - `JUDGMENT: Record<BrainStage, string>`, `STEP_LABEL`(labels.ts)
  - `cupPlan(fp: FloorPlan, id: string, nowIso: string): PlanView | null`(식탁·싱크대를 종류 `dining_table`·`sink_counter`로 찾는다)
  - `devicePlan(fp: FloorPlan, a: AgentAction, nowIso: string): PlanView`
  - `class PlanHub { constructor(fp: FloorPlan, broadcast: (m: ServerMessage) => void, now?: () => string); current(): PlanView | null; onBrain(e: BrainEvent): void; onAgent(e: AgentEvent): void; onEye(position: XZ): void; put(plan: PlanView): void; setStep(planId: string, stepId: string, status: StepStatus): boolean }`

화면 글 표(`src/plan/labels.ts`, 모두 60자 아래, 화살표·괄호 없음):
```ts
// 서버가 만들어 화면에 그대로 나가는 글. npm run lint가 이 파일도 검사한다.
import type { BrainStage } from "../contract/events.js";

export const JUDGMENT: Record<BrainStage, string> = {
  use: "사람이 컵을 쓰고 있어요", away: "자리를 비웠는지 보는 중", request: "폰으로 사진을 부탁했어요",
  answer: "부탁한 사진을 받았어요", decide: "할 일을 고르는 중", confirm: "하기 전에 한 번 더 보는 중",
  act: "컵을 치우러 가요", result: "끝났어요", wait: "근거를 모으는 중",
  cancel: "사람이 돌아와 멈췄어요", stale: "화면이 오래돼 다시 보는 중", error: "판단하지 못했어요",
};

export const STEP_LABEL = {
  goTable: "식탁으로 가기", pickCup: "컵 집기", goSink: "싱크대로 가기", placeCup: "컵 내려놓기",
  askUser: "폰으로 물어보기", device: (device: string, tool: string) => `${device} ${tool}`,
};

export const GOAL = { clearCup: "컵 치우기", askUser: "사용자에게 물어보기" };
```

- [ ] **Step 1: 실패하는 테스트**

`tests/plan-planner.test.ts`
```ts
import { describe, expect, it } from "vitest";
import { cupPlan, devicePlan } from "../src/plan/planner.js";
import { floorPlanFrom } from "../src/plan/route.js";

const fp = floorPlanFrom({
  plan: {
    rooms: [
      { id: "hall", polygon: [[0, 0], [4, 0], [4, 4], [0, 4]] },
      { id: "kitchen", polygon: [[4, 0], [8, 0], [8, 4], [4, 4]] },
    ],
    doors: [], open_edges: [["hall", "kitchen"]], robot: { reachable_rooms: ["hall", "kitchen"] },
  },
  objects: [
    { id: "robot", type: "robot", room: "hall", plan: { position: [1, 2] } },
    { id: "table_1", type: "dining_table", room: "kitchen", plan: { position: [7, 3] } },
    { id: "sink_1", type: "sink_counter", room: "kitchen", plan: { position: [5, 1] } },
  ],
});

describe("cupPlan", () => {
  const p = cupPlan(fp, "p1", "2026-11-06T00:00:00Z")!;
  it("네 단계: 식탁 가기, 컵 집기, 싱크대 가기, 내려놓기", () => {
    expect(p.steps.map((s) => [s.kind, s.label, s.target?.objectId])).toEqual([
      ["move", "식탁으로 가기", "table_1"], ["act", "컵 집기", "table_1"],
      ["move", "싱크대로 가기", "sink_1"], ["act", "컵 내려놓기", "sink_1"],
    ]);
  });
  it("경로는 로봇에서 시작하고 이동 단계마다 끝 점이 있다", () => {
    expect(p.path[0]).toEqual([1, 2]);
    expect(p.legs.map((l) => l.stepId)).toEqual([p.steps[0]!.id, p.steps[2]!.id]);
    expect(p.dryRun).toBe(true);
  });
});

describe("devicePlan", () => {
  it("기기 행동은 이동 없이 한 단계", () => {
    const p = devicePlan(fp, { tool: "turn_on", args: {}, ok: true, deviceId: "ac", deviceLabel: "거실 에어컨", at: "t" }, "t");
    expect(p).toMatchObject({ source: "agent", path: [], steps: [{ kind: "device", label: "거실 에어컨 켜기", status: "done" }] });
  });
});
```

`tests/plan-hub.test.ts`
```ts
import { describe, expect, it } from "vitest";
import { PlanHub } from "../src/plan/hub.js";
// fp는 plan-planner.test.ts와 같은 평면도(테스트 도우미로 tests/helpers/floor.ts에 둔다)
import { smallFloor } from "./helpers/floor.js";

describe("PlanHub", () => {
  it("컵 치우기 행동이 오면 계획을 보내고, 결과가 오면 끝낸다", () => {
    const sent: unknown[] = [];
    const hub = new PlanHub(smallFloor(), (m) => sent.push(m), () => "t");
    hub.onBrain({ type: "brain", stage: "decide", state: "deciding", text: "", at_ms: 0, evidence_age_ms: null, generation: 1 });
    expect(hub.current()).toBeNull();
    hub.onBrain({ type: "action", id: "a1", task: "컵 치우기", plan: {} as never, active: true, at_ms: 1 });
    expect(hub.current()).toMatchObject({ goal: "컵 치우기", judgment: "할 일을 고르는 중", status: "running" });
    hub.onBrain({ type: "result", id: "a1", task: "컵 치우기", outcome: "cleared", text: "", at_ms: 2 });
    expect(hub.current()?.status).toBe("done");
    expect(sent.at(-1)).toMatchObject({ type: "plan", plan: { status: "done" } });
  });
  it("사람이 돌아오면 취소", () => {
    const hub = new PlanHub(smallFloor(), () => {}, () => "t");
    hub.onBrain({ type: "action", id: "a1", task: "컵 치우기", plan: {} as never, active: true, at_ms: 1 });
    hub.onBrain({ type: "brain", stage: "cancel", state: "in_use", text: "", at_ms: 2, evidence_age_ms: null, generation: 2 });
    expect(hub.current()).toMatchObject({ status: "cancelled", judgment: "사람이 돌아와 멈췄어요" });
  });
});
```

Run → FAIL

- [ ] **Step 2: planner.ts 구현**

```ts
import type { AgentAction } from "../contract/events.js";
import type { PlanStep, PlanView, XZ } from "../contract/plan.js";
import type { FloorPlan } from "./floor.js";
import { GOAL, STEP_LABEL } from "./labels.js";
import { approach, route } from "./route.js";

const STOP_M = 0.55; // 로봇 반지름 0.22m + 여유

const byType = (fp: FloorPlan, type: string) => [...fp.objects.values()].find((o) => o.type === type);

export function cupPlan(fp: FloorPlan, id: string, nowIso: string): PlanView | null {
  const table = byType(fp, "dining_table");
  const sink = byType(fp, "sink_counter");
  if (!table || !sink) return null;
  const leg1 = route(fp, fp.robot.position, table.position);
  if (!leg1) return null;
  const toTable = approach(leg1, STOP_M);
  const from = toTable.at(-1)!;
  const leg2 = route(fp, from, sink.position);
  const toSink = leg2 ? approach(leg2, STOP_M) : [from];
  const steps: PlanStep[] = [
    { id: `${id}:1`, kind: "move", label: STEP_LABEL.goTable, target: { objectId: table.id, room: table.room ?? undefined }, status: "pending" },
    { id: `${id}:2`, kind: "act", label: STEP_LABEL.pickCup, target: { objectId: table.id }, status: "pending" },
    { id: `${id}:3`, kind: "move", label: STEP_LABEL.goSink, target: { objectId: sink.id, room: sink.room ?? undefined }, status: "pending" },
    { id: `${id}:4`, kind: "act", label: STEP_LABEL.placeCup, target: { objectId: sink.id }, status: "pending" },
  ];
  const path: XZ[] = [...toTable, ...toSink.slice(1)];
  return {
    id, source: "brain", goal: GOAL.clearCup, judgment: "", dryRun: true,
    robot: { position: fp.robot.position, room: fp.robot.room }, path,
    legs: [{ stepId: steps[0]!.id, end: toTable.length - 1 }, { stepId: steps[2]!.id, end: path.length - 1 }],
    steps, status: "planned", updatedAt: nowIso,
  };
}

const TOOL_VERB: Record<string, string> = { turn_on: "켜기", turn_off: "끄기", set_level: "맞추기", set_climate: "맞추기", set_covering: "맞추기", lock: "잠그기", unlock: "잠금 풀기", start: "시작", stop: "멈추기", set_valve: "맞추기" };

export function devicePlan(fp: FloorPlan, a: AgentAction, nowIso: string): PlanView {
  const id = `agent:${a.at}:${a.deviceId ?? a.tool}`;
  return {
    id, source: "agent", goal: STEP_LABEL.device(a.deviceLabel ?? "", TOOL_VERB[a.tool] ?? a.tool), judgment: "", dryRun: false,
    robot: { position: fp.robot.position, room: fp.robot.room }, path: [], legs: [],
    steps: [{ id: `${id}:1`, kind: "device", label: STEP_LABEL.device(a.deviceLabel ?? "", TOOL_VERB[a.tool] ?? a.tool), target: { deviceId: a.deviceId }, status: a.needsConfirmation ? "pending" : a.ok ? "done" : "failed" }],
    status: a.needsConfirmation ? "planned" : a.ok ? "done" : "failed", updatedAt: nowIso,
  };
}
```

- [ ] **Step 3: hub.ts 구현** — 규칙:
  - `brain` 이벤트: 지금 계획이 brain 것이면 `judgment = JUDGMENT[stage]`로 바꿔 보낸다. 계획이 없으면 마지막 판단만 기억한다(다음 계획의 judgment).
  - `action`(task 「컵 치우기」): `cupPlan`으로 만들고 status `running`, 첫 단계 `active`. 「사용자에게 물어보기」는 경로 없는 `ask` 한 단계.
  - `result`: outcome `cleared`·`answered`면 모든 단계 done·status done, `declined`·`withdrawn`이면 cancelled, 그 밖은 failed.
  - `brain` stage `cancel`: 지금 brain 계획을 cancelled.
  - `agent` 이벤트 `action`(deviceId 있음): `devicePlan`. 브레인 계획이 running이면 덮지 않는다.
  - `onEye(position)`: 폰(클로이드의 눈) 바닥 위치를 로봇 위치로 쓴다. 다음 계획부터 반영.
  - `put(plan)`: task planner가 보낸 계획. 같은 id면 바꾼다.
  - 바뀔 때마다 `broadcast({ type: "plan", plan })`.
- [ ] **Step 4: 서버 잇기**
  - `src/server/home.ts`: 집을 띄울 때 `floorPlanFrom(JSON.parse(readFileSync(home.scenePath)))`로 `PlanHub`를 만든다(scene이 없으면 만들지 않는다). brain의 `toDashboard`로 나가는 `{type:"brain", event}`를 `hub.onBrain(event)`에도 넘긴다. 165줄 `onEye`에서 `hub.onEye([eye의 x, eye의 z])`(EyePose 필드는 `src/phone/align.ts`를 보고 고른다).
  - `src/server/app.ts`: 463줄 `agent?.subscribe`에서 `hub.onAgent(e)`. 457줄 처음 연결 때 `send(ws, { type: "plan", plan: hub.current() })`. `GET /api/plan` → `{ ok: true, plan }`. `POST /api/plan`(로컬 출처만) → `hub.put(body.plan)`. `POST /api/plan/:id/steps/:stepId` → `hub.setStep`.
  - `scripts/lint-ui-copy.ts`: `lintUiCopy`가 `src/plan/labels.ts`를 `jsCopy`로 함께 본다.
- [ ] **Step 5: 확인** — `npx vitest run tests/plan-planner.test.ts tests/plan-hub.test.ts` PASS, `npm test`·`npm run lint`·`npm run typecheck` PASS
- [ ] **Step 6: Commit**(사용자 허락 뒤)

```bash
git add src/plan/labels.ts src/plan/planner.ts src/plan/hub.ts src/server/home.ts src/server/app.ts scripts/lint-ui-copy.ts tests/plan-planner.test.ts tests/plan-hub.test.ts tests/helpers/floor.ts
git commit -m "feat(plan): build Cloid plans from the cup brain and agent actions and broadcast them"
```

---

### Task 4: 트윈 위 경로 띠와 목적지

**Files:**
- Create: `ui/src/plan/ribbon.ts`, `ui/src/plan/PathLayer.tsx`, `ui/src/plan/use-plan.ts`, `ui/tests/ribbon.test.ts`
- Modify: `ui/src/dashboard/Dashboard.tsx`

**Interfaces:**
- Consumes: `PlanView`, `useViewer()`, `AptViewer.THREE/scene/renderNow`
- Produces:
  - `ribbonPositions(path: XZ[], width: number, y: number): Float32Array`(구간마다 사각형 = 삼각형 2개, 정점 18개 값)
  - `pointAlong(path: XZ[], t: number): XZ`(t는 0~1, 길이 비례)
  - `usePlan(): PlanView | null`(`GET /api/plan`으로 시작, `plan` 메시지로 갱신)
  - `<PathLayer plan />`: 장면에 띠(지나온 구간 흐리게, 남은 구간 밝게), 목적지마다 고리, 띠 위를 도는 점. 계획이 바뀌거나 사라지면 지운다.

- [ ] **Step 1: 실패하는 테스트**

`ui/tests/ribbon.test.ts`
```ts
import { describe, expect, it } from "vitest";
import { pointAlong, ribbonPositions } from "../src/plan/ribbon";

describe("ribbonPositions", () => {
  it("한 구간(0,0)→(2,0), 폭 0.2 → 삼각형 2개, 높이 y", () => {
    const p = Array.from(ribbonPositions([[0, 0], [2, 0]], 0.2, 0.02));
    expect(p).toHaveLength(18);
    expect(p.filter((_, i) => i % 3 === 1).every((y) => y === 0.02)).toBe(true);
    const zs = p.filter((_, i) => i % 3 === 2).map((z) => Math.round(z * 100) / 100);
    expect(new Set(zs)).toEqual(new Set([0.1, -0.1]));
  });
  it("점이 하나뿐이면 빈 배열", () => {
    expect(ribbonPositions([[1, 1]], 0.2, 0)).toHaveLength(0);
  });
});

describe("pointAlong", () => {
  it("길이 비례로 걷는다", () => {
    expect(pointAlong([[0, 0], [2, 0], [2, 2]], 0.75)).toEqual([2, 1]);
    expect(pointAlong([[0, 0], [2, 0]], 0)).toEqual([0, 0]);
    expect(pointAlong([[0, 0], [2, 0]], 1)).toEqual([2, 0]);
  });
});
```

- [ ] **Step 2: ribbon.ts 구현**

```ts
import type { XZ } from "../../../src/contract/plan.ts";

/** 바닥에 까는 띠. 평면 [x, z]를 three 좌표 (x, y, z)로 쓴다. */
export function ribbonPositions(path: XZ[], width: number, y: number): Float32Array {
  const out: number[] = [];
  const h = width / 2;
  for (let i = 0; i + 1 < path.length; i++) {
    const [ax, az] = path[i]!;
    const [bx, bz] = path[i + 1]!;
    const len = Math.hypot(bx - ax, bz - az);
    if (len === 0) continue;
    const nx = (-(bz - az) / len) * h;
    const nz = ((bx - ax) / len) * h;
    const a1 = [ax + nx, y, az + nz], a2 = [ax - nx, y, az - nz], b1 = [bx + nx, y, bz + nz], b2 = [bx - nx, y, bz - nz];
    out.push(...a1, ...a2, ...b1, ...b1, ...a2, ...b2);
  }
  return new Float32Array(out);
}

export function pointAlong(path: XZ[], t: number): XZ {
  if (path.length === 1 || t <= 0) return path[0]!;
  const lens = path.slice(1).map((p, i) => Math.hypot(p[0] - path[i]![0], p[1] - path[i]![1]));
  let left = Math.min(1, t) * lens.reduce((a, b) => a + b, 0);
  for (let i = 0; i < lens.length; i++) {
    if (left <= lens[i]! || i === lens.length - 1) {
      const k = lens[i]! === 0 ? 0 : Math.min(1, left / lens[i]!);
      const [ax, az] = path[i]!;
      const [bx, bz] = path[i + 1]!;
      return [ax + (bx - ax) * k, az + (bz - az) * k];
    }
    left -= lens[i]!;
  }
  return path.at(-1)!;
}
```

- [ ] **Step 3: PathLayer** — `useEffect([viewer, plan])`에서 `const { THREE, scene } = viewer`로 `Group`을 만들어 `scene.add`, 정리 때 `scene.remove` + `geometry.dispose()` + `material.dispose()`, 매번 `viewer.renderNow()`.
  - 띠: `BufferGeometry`에 `ribbonPositions(plan.path, 0.14, 0.03)`, `MeshBasicMaterial({ color: 0x4fd1b5, transparent: true, opacity: 0.85, depthWrite: false })`. 지나온 이동 단계(`done`) 구간은 opacity 0.25로 따로 만든다(`legs`의 end로 자른다).
  - 목적지 고리: 이동 단계 끝 점마다 `RingGeometry(0.22, 0.3, 40)`를 바닥에 눕혀(`rotation.x = -Math.PI / 2`) 놓는다.
  - 움직이는 점: `SphereGeometry(0.07)`을 `requestAnimationFrame`마다 `pointAlong(남은 경로, (time % 2400) / 2400)`에 놓고 `renderNow()`. 계획 status가 `running`·`planned`일 때만 돈다.
  - `dryRun`이면 색을 `0xc9b26b`(모의)로.
- [ ] **Step 4: 확인** — `npm --prefix ui test` PASS. 서버를 모의로 띄우고 `curl -X POST /api/plan`으로 컵 치우기 예시(`docs/plan-contract.md`)를 보내, 헤드리스 크롬 화면에서 복도 로봇부터 식탁·싱크대까지 띠가 바닥에 깔리고 벽 뒤에서는 가려지는지 찍어 본다.
- [ ] **Step 5: Commit**(사용자 허락 뒤)

```bash
git add ui/src/plan/ribbon.ts ui/src/plan/PathLayer.tsx ui/src/plan/use-plan.ts ui/src/dashboard/Dashboard.tsx ui/tests/ribbon.test.ts
git commit -m "feat(ui): draw Cloid's planned floor path and destinations on the twin"
```

---

### Task 5: 로봇 판단 말풍선과 단계 번호

**Files:**
- Create: `ui/src/plan/RobotBubble.tsx`, `ui/src/plan/StepPins.tsx`, `ui/src/plan/PlanCard.tsx`, `ui/src/plan/steps.ts`, `ui/tests/plan-steps.test.ts`
- Modify: `ui/src/dashboard/Dashboard.tsx`, `ui/src/chat/ChatPanel.tsx`(위쪽에 PlanCard)

**Interfaces:**
- Consumes: `PlanView`, `useAnchors`(로봇 노드 id `robot`), `projectPoint`
- Produces:
  - `currentStep(plan: PlanView): { index: number; step: PlanStep } | null`(active, 없으면 첫 pending)
  - `pinsByTarget(plan: PlanView): { key: string; anchor: { objectId?: string; deviceId?: string; position?: XZ }; numbers: number[]; status: StepStatus }[]`(같은 물건의 단계 번호를 묶는다: 식탁 1·2, 싱크대 3·4)
  - `<RobotBubble plan />`: 로봇 머리 위 큰 유리 말풍선. 첫 줄 판단(`plan.judgment`), 둘째 줄 「지금 2/4 · 컵 집기」, `dryRun`이면 「모의」 표시
  - `<StepPins plan />`: 목적지 물건 위에 번호 동그라미(끝난 번호는 ✓, 지금 번호는 깜빡임)
  - `<PlanCard plan />`: 단계 목록(번호 · 이름 · 상태 점)

- [ ] **Step 1: 실패하는 테스트**

`ui/tests/plan-steps.test.ts`
```ts
import { describe, expect, it } from "vitest";
import { currentStep, pinsByTarget } from "../src/plan/steps";

const plan = {
  id: "p", source: "brain", goal: "컵 치우기", judgment: "컵을 치우러 가요", dryRun: true,
  robot: { position: [1, 2], room: "hall" }, path: [], legs: [], status: "running", updatedAt: "t",
  steps: [
    { id: "1", kind: "move", label: "식탁으로 가기", target: { objectId: "table_1" }, status: "done" },
    { id: "2", kind: "act", label: "컵 집기", target: { objectId: "table_1" }, status: "active" },
    { id: "3", kind: "move", label: "싱크대로 가기", target: { objectId: "sink_1" }, status: "pending" },
    { id: "4", kind: "act", label: "컵 내려놓기", target: { objectId: "sink_1" }, status: "pending" },
  ],
} as const;

describe("계획 단계", () => {
  it("지금 단계는 active", () => {
    expect(currentStep(plan as never)).toMatchObject({ index: 1, step: { label: "컵 집기" } });
  });
  it("같은 물건 단계 번호를 묶는다", () => {
    expect(pinsByTarget(plan as never).map((p) => [p.key, p.numbers, p.status])).toEqual([
      ["table_1", [1, 2], "active"], ["sink_1", [3, 4], "pending"],
    ]);
  });
});
```

- [ ] **Step 2: steps.ts 구현** — `currentStep`: `findIndex(s => s.status === "active")`, 없으면 첫 `pending`, 둘 다 없으면 null. `pinsByTarget`: `target.objectId ?? target.deviceId ?? position 문자열`로 묶고, 묶음 상태는 active가 하나라도 있으면 active, 모두 done이면 done, 아니면 pending.
- [ ] **Step 3: 화면 조각** — RobotBubble은 `useAnchors(["robot"])`로 로봇 노드 위에 붙인다(로봇 노드가 없으면 `plan.robot.position`을 `projectPoint`로). StepPins는 물건 id로 `useAnchors`, position만 있으면 바닥 높이 0.9m로 투영. 21st.dev Tool Call Timeline(id 37517)의 단계 카드 모양을 PlanCard에 쓴다.
- [ ] **Step 4: 확인** — `npm --prefix ui test` PASS. 모의 서버에 Task 4의 예시 계획을 보내고 `POST /api/plan/:id/steps/:stepId`로 단계 2를 active로 바꿔, 로봇 말풍선 「지금 2/4 · 컵 집기」, 식탁 위 「1 ✓ · 2」, 싱크대 위 「3 · 4」가 보이는지 헤드리스 크롬으로 찍는다.
- [ ] **Step 5: Commit**(사용자 허락 뒤)

```bash
git add ui/src/plan/RobotBubble.tsx ui/src/plan/StepPins.tsx ui/src/plan/PlanCard.tsx ui/src/plan/steps.ts ui/src/dashboard/Dashboard.tsx ui/src/chat/ChatPanel.tsx ui/tests/plan-steps.test.ts
git commit -m "feat(ui): show Cloid's judgment, current step and numbered destinations on the twin"
```

---

### Task 6: 컵 시나리오로 끝까지 확인

- [ ] **Step 1:** 서버를 `HUB=memory AGENT_PROVIDER=mock`, brain 재생 모드(`tests/brain-live.test.ts`가 쓰는 녹화 판정 또는 `scripts/demo.ts`)로 띄운다. 컵 치우기까지 가는 동안 화면을 2초마다 헤드리스 크롬으로 찍는다.
- [ ] **Step 2:** 확인할 것: 판단 말풍선 글이 단계마다 바뀐다(자리를 비웠는지 보는 중, 할 일을 고르는 중, 컵을 치우러 가요), 경로 띠가 로봇에서 식탁·싱크대로 깔린다, 사람이 돌아오면 「사람이 돌아와 멈췄어요」와 함께 띠가 사라진다, 콘솔 오류 0.
- [ ] **Step 3:** `npm test`, `npm run lint`, `npm run typecheck`, `npm --prefix ui run typecheck` 모두 PASS. 결과 사진을 사용자에게 보인다.

## 자체 점검

- 「상황 판단」: Task 3 `JUDGMENT`, Task 5 RobotBubble 첫 줄.
- 「어떤 행동을 할 거고」: Task 3 단계 목록, Task 5 지금 단계·PlanCard·물건 위 번호.
- 「어디로 이동할 거고」: Task 2 경로, Task 4 바닥 띠·목적지 고리·움직이는 점.
- 팀 task planner와 맞추기: Task 1 `docs/plan-contract.md`, `POST /api/plan`.
- 바닥 경로는 방 안을 곧은 선으로 본다. ㄱ자 방에서는 벽을 가로지를 수 있다. task planner 경로가 오면 그것을 그린다.
