// 한양목련 실제 자료로 컵 치우기: 평면도가 싱크대를 알고, 에이전트 계획 모드(가짜 모델 도구 호출)가 네 단계를 만들며, 싱크대는 고정 설비이고 윗면이 0.9 m다.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadLayout } from "../src/layout/load.js";
import { DEFAULT_TWIN_DIR } from "../src/model/devices.js";
import { resolveHome } from "../src/model/homes.js";
import { loadScene } from "../src/model/scene.js";
import { STEP_LABEL } from "../src/plan/labels.js";
import { floorPlanFrom } from "../src/plan/route.js";
import type { WorldView } from "../src/contract/world.js";
import type { DecisionRecord } from "../src/world/decide.js";
import { cupPlan } from "./helpers/cup-plan.js";
import { planContext, startFakePlanner, testPlanner } from "./helpers/planner.js";

const home = resolveHome(DEFAULT_TWIN_DIR, "mokryeon_180b");
const fp = floorPlanFrom(loadScene(home));
const NOW = "2026-11-09T00:00:00.000Z";

describe("한양목련 컵 치우기", () => {
  it("평면도가 싱크대를 안다", () => {
    expect(fp.objects.get("sink_counter_kitchen")).toEqual({ id: "sink_counter_kitchen", type: "sink_counter", room: "kitchen", position: [5.853, 0.761] });
  });
  it("에이전트가 식탁·컵·싱크대·내려놓기 네 단계를 만들고, 경로·단계가 컵 계획 모양(cupPlan)과 같다", async () => {
    const llm = await startFakePlanner();
    try {
      const at = { ...fp, robot: { ...fp.robot, position: [10.6, 8.6] as [number, number], room: "living" } };
      const cup = { id: "cup_1", position: [9.96, 0.75, 3.92] as [number, number, number] };
      const world: WorldView = {
        at_ms: 0, frame_ms: null, vlm_missing: 0, yolo_missing: 0, eye: null, fixtures: [], devices: [],
        person: { visible: false, since_ms: 0, last_seen_ms: null, count: 0, room: null, room_label: null, position: null, near: [], holding: [], position_ms: null, answered_ms: null, facts: {} },
        objects: [{ ...cup, cls: "cup", surface: "dining_table_978b20c7", surface_label: "거실·복도 식탁", room: "living", error_m: 0.1, status: "present", first_seen_ms: 0, last_seen_ms: 0, last_in_view_ms: 0, facts: {}, answered_ms: null, devices: [], closer_hold: false }],
      };
      const decision: DecisionRecord = {
        id: "t1", seq: 1, atMs: 0, textSent: "t", finalTime: "x", status: "valid", prediction: { observation: "o", reasoning: "", task_index: 0 }, action: "컵 치우기", memoryVersion: 1,
        world: { objects: [], person_visible: false, vlm_missing: 0, yolo_missing: 0 },
      };
      const r = await testPlanner(llm).plan(planContext({ decision, world, floor: at, nowIso: NOW }));
      expect(r.ok).toBe(true);
      const p = r.ok ? r.plan.view : null;
      expect(p!.steps.map((s) => s.label)).toEqual([STEP_LABEL.goTable, STEP_LABEL.pickCup, STEP_LABEL.goSink, STEP_LABEL.placeCup]);
      expect(p!.steps[2]!.target).toEqual({ objectId: "sink_counter_kitchen", room: "kitchen" });
      expect(p!.steps[3]!.target).toEqual({ objectId: "sink_counter_kitchen" });
      const want = cupPlan(at, "plan:t1", NOW, cup)!;
      expect(p).toEqual({ ...want, updatedAt: NOW });
    } finally {
      await llm.close();
    }
  });
  it("로봇이 거실에 있으면 식탁을 거쳐 싱크대 앞까지 길이 이어진다", () => {
    const at = { ...fp, robot: { ...fp.robot, position: [10.6, 8.6] as [number, number], room: "living" } };
    const p = cupPlan(at, "plan:t2", NOW)!;
    expect(p.legs.map((l) => l.stepId)).toEqual(["plan:t2:1", "plan:t2:3"]);
    const end = p.path.at(-1)!;
    expect(Math.hypot(end[0] - 5.853, end[1] - 0.761)).toBeLessThanOrEqual(1.2);
  });
  it("배치 편집기에서 싱크대는 고정 설비이고 가운데 높이는 0.45 m다", () => {
    const { editor } = loadLayout(home, { runtimeDir: mkdtempSync(join(tmpdir(), "rt-")), log: () => {} })!;
    expect(editor.center("sink_counter_kitchen")).toEqual({ id: "sink_counter_kitchen", label: "주방·식당 싱크대", position: [5.853, 0.45, 0.761] });
    expect(() => editor.move("sink_counter_kitchen", { dx: 0.5, dy: 0 })).toThrow(/옮길 수 없는/);
  });
});
