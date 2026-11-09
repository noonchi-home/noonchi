// 한양목련 실제 자료로 컵 치우기: 평면도가 싱크대를 알고, cupPlan이 네 단계를 만들며, 싱크대는 고정 설비이고 윗면이 0.9 m다.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadLayout } from "../src/layout/load.js";
import { DEFAULT_TWIN_DIR } from "../src/model/devices.js";
import { resolveHome } from "../src/model/homes.js";
import { loadScene } from "../src/model/scene.js";
import { STEP_LABEL } from "../src/plan/labels.js";
import { cupPlan } from "../src/plan/planner.js";
import { floorPlanFrom } from "../src/plan/route.js";

const home = resolveHome(DEFAULT_TWIN_DIR, "mokryeon_180b");
const fp = floorPlanFrom(loadScene(home));
const NOW = "2026-11-09T00:00:00.000Z";

describe("한양목련 컵 치우기", () => {
  it("평면도가 싱크대를 안다", () => {
    expect(fp.objects.get("sink_counter_kitchen")).toEqual({ id: "sink_counter_kitchen", type: "sink_counter", room: "kitchen", position: [5.853, 0.761] });
  });
  it("cupPlan이 식탁·컵·싱크대·내려놓기 네 단계를 만든다", () => {
    const p = cupPlan(fp, "plan:t1", NOW)!;
    expect(p.steps.map((s) => s.label)).toEqual([STEP_LABEL.goTable, STEP_LABEL.pickCup, STEP_LABEL.goSink, STEP_LABEL.placeCup]);
    expect(p.steps[2]!.target).toEqual({ objectId: "sink_counter_kitchen", room: "kitchen" });
    expect(p.steps[3]!.target).toEqual({ objectId: "sink_counter_kitchen" });
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
