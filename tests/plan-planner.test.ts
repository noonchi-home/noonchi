import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { PlanView } from "../src/contract/plan.js";
import { resolveTwinStudioDir } from "../src/model/devices.js";
import { devicePlan } from "../src/plan/planner.js";
import { askPlan, cupPlan } from "./helpers/cup-plan.js";
import { floorPlanFrom } from "../src/plan/route.js";
import { SMALL_SCENE, smallFloor } from "./helpers/floor.js";

const fp = smallFloor();
const dist = (a: number[], b: number[]) => Math.hypot(a[0]! - b[0]!, a[1]! - b[1]!);

// cupPlan은 에이전트 컵 계획이 맞춰야 할 모양(tests/helpers/cup-plan.ts)이고, 경로는 src assemblePlan이 잇는다
describe("cupPlan(assemblePlan 경로)", () => {
  const p = cupPlan(fp, "p1", "2026-11-06T00:00:00Z")!;
  it("네 단계: 식탁 가기, 컵 집기, 싱크대 가기, 내려놓기", () => {
    expect(p.steps.map((s) => [s.kind, s.label, s.target?.objectId])).toEqual([
      ["move", "식탁으로 가기", "table_1"], ["act", "컵 집기", "table_1"],
      ["move", "싱크대로 가기", "sink_1"], ["act", "컵 내려놓기", "sink_1"],
    ]);
    expect(p.steps.every((s) => s.status === "pending")).toBe(true);
  });
  it("경로는 로봇에서 시작하고 이동 단계마다 끝 점이 있다", () => {
    expect(p.path[0]).toEqual([1, 2]);
    expect(p.legs.map((l) => l.stepId)).toEqual([p.steps[0]!.id, p.steps[2]!.id]);
    expect(p.dryRun).toBe(true);
  });
  it("트인 경계를 지나 식탁 앞, 싱크대 앞 0.55m에서 멈춘다", () => {
    expect(p.path[1]).toEqual([4, 2]);
    expect(p.legs.map((l) => l.end)).toEqual([2, 3]);
    expect(dist(p.path[2]!, [7, 3])).toBeCloseTo(0.55, 2);
    expect(dist(p.path[3]!, [5, 1])).toBeCloseTo(0.55, 2);
  });
  it("새 계획: revision 1, 다시 계획 아님, brain 출처, planned", () => {
    expect(p).toMatchObject({ id: "p1", revision: 1, source: "brain", goal: "컵 치우기", status: "planned", robot: { position: [1, 2], room: "hall" }, updatedAt: "2026-11-06T00:00:00Z" });
    expect(p.supersedes).toBeUndefined();
  });
  it("식탁이 없으면 null", () => {
    const scene = structuredClone(SMALL_SCENE);
    scene.objects = scene.objects.filter((o) => o.type !== "dining_table");
    expect(cupPlan(floorPlanFrom(scene), "p1", "t")).toBeNull();
  });
  it("사람이 걷는 길이라 로봇 이동 가능 방 밖이어도 길이 있고, 집 밖처럼 길이 없으면 단계만, 경로 없음", () => {
    const scene = structuredClone(SMALL_SCENE);
    scene.plan.robot.reachable_rooms = ["hall"];
    expect(cupPlan(floorPlanFrom(scene), "p1", "t")!.path.length).toBeGreaterThan(1);
    const outside = structuredClone(SMALL_SCENE);
    outside.objects = outside.objects.map((o) => (o.type === "dining_table" ? { ...o, plan: { position: [20, 20] } } : o));
    const q = cupPlan(floorPlanFrom(outside), "p1", "t")!;
    expect(q.steps).toHaveLength(4);
    expect([q.path, q.legs, q.robot.position]).toEqual([[], [], [1, 2]]);
  });
});

describe("목련처럼 싱크대·로봇이 없는 집", () => {
  const noSink = floorPlanFrom({ plan: { rooms: [{ id: "hall", polygon: [[0, 0], [4, 0], [4, 4], [0, 4]] }], doors: [], open_edges: [] }, objects: [{ id: "t", type: "dining_table", room: "hall", plan: { position: [2, 2] } }] });
  it("식탁 두 단계만, 경로 없음", () => {
    const p = cupPlan(noSink, "p1", "t")!;
    expect(p.steps.map((s) => s.kind)).toEqual(["move", "act"]);
    expect([p.path, p.legs, p.robot.position, p.revision]).toEqual([[], [], null, 1]);
  });
});

describe("askPlan", () => {
  it("폰으로 묻는 한 단계, 이동 없음", () => {
    const p = askPlan(fp, "q1", "t");
    expect(p).toMatchObject({ id: "q1", revision: 1, source: "brain", goal: "사용자에게 물어보기", dryRun: true, path: [], legs: [], steps: [{ kind: "ask", label: "폰으로 물어보기", status: "pending" }] });
  });
});

describe("devicePlan", () => {
  const act = { tool: "turn_on", args: {}, ok: true, deviceId: "ac", deviceLabel: "거실 에어컨", at: "t" };
  it("기기 행동은 이동 없이 한 단계", () => {
    const p = devicePlan(fp, act, "t");
    expect(p).toMatchObject({ source: "agent", revision: 1, path: [], steps: [{ kind: "device", label: "거실 에어컨 켜기", status: "done" }] });
  });
  it("승인을 기다리면 planned, 실패면 failed", () => {
    expect(devicePlan(fp, { ...act, ok: false, needsConfirmation: true }, "t")).toMatchObject({ status: "planned", steps: [{ status: "pending" }] });
    expect(devicePlan(fp, { ...act, ok: false }, "t")).toMatchObject({ status: "failed", steps: [{ status: "failed" }] });
  });
  it("기기를 바꾸지 않는 도구는 계획이 아니다", () => {
    expect(devicePlan(fp, { ...act, tool: "get_state" }, "t")).toBeNull();
    expect(devicePlan(fp, { ...act, tool: "turn_on", deviceId: undefined }, "t")).toBeNull();
  });
});

// docs/plan-contract.md 예시는 마곡 아파트에서 서버가 만드는 컵 계획과 같다
const APARTMENT = join(resolveTwinStudioDir(process.env.TWIN_STUDIO_DIR, fileURLToPath(new URL("..", import.meta.url))), "apartment", "scene.json");
describe.skipIf(!existsSync(APARTMENT))("마곡 아파트 컵 계획 = 계약 문서 예시", () => {
  it("경로·끝 점·단계가 같다", () => {
    const md = readFileSync(new URL("../docs/plan-contract.md", import.meta.url), "utf8");
    const doc = JSON.parse(/```json\r?\n([\s\S]*?)```/.exec(md)![1]!).plan as PlanView;
    const p = cupPlan(floorPlanFrom(JSON.parse(readFileSync(APARTMENT, "utf8"))), doc.id, "t")!;
    expect([p.robot, p.path, p.legs]).toEqual([doc.robot, doc.path, doc.legs]);
    expect(p.steps.map(({ status: _s, ...rest }) => rest)).toEqual(doc.steps.map(({ status: _s, ...rest }) => rest));
  });
});

describe("cupPlan 집을 물건", () => {
  it("물건을 주면 집기 단계 대상이 그 물건이고, 위치를 알면 첫 이동은 그 물건 앞에서 멈춘다", () => {
    const p = cupPlan(fp, "p1", "t", { id: "cup_1", position: [6, 0.75, 2] })!;
    expect(p.steps[1]!.target).toEqual({ objectId: "cup_1", position: [6, 2] });
    expect(dist(p.path[p.legs[0]!.end]!, [6, 2])).toBeCloseTo(0.55, 2);
    expect(p.steps[0]!.target).toMatchObject({ objectId: "table_1" });
  });
  it("위치를 모르면 대상만 바꾸고 식탁 앞까지 간다", () => {
    const p = cupPlan(fp, "p1", "t", { id: "cup_1", position: null })!;
    expect(p.steps[1]!.target).toEqual({ objectId: "cup_1" });
    expect(dist(p.path[p.legs[0]!.end]!, [7, 3])).toBeCloseTo(0.55, 2);
  });
});
