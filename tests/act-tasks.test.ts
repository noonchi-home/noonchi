import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { WorldObject, WorldView } from "../src/contract/world.js";
import { holdsTarget, planTargetId, targetOf, TASK_NAMES, TASKS, taskOf } from "../src/act/tasks.js";
import { smallFloor } from "./helpers/floor.js";
import { cupPlan } from "./helpers/cup-plan.js";

const cupAt = (over: Partial<WorldObject> = {}): WorldObject => ({
  id: "cup_1", cls: "cup", position: [7, 0.75, 3], surface: "table_1", surface_label: "식탁", room: "kitchen", error_m: 0.1, status: "present",
  first_seen_ms: 0, last_seen_ms: 0, last_in_view_ms: 0, facts: {}, answered_ms: null, devices: [], ...over,
});
const world = (objects: WorldObject[] = [cupAt()]): WorldView => ({
  at_ms: 0, frame_ms: null, vlm_missing: 0, yolo_missing: 0, eye: null, fixtures: [], devices: [], person: { visible: false, since_ms: 0, last_seen_ms: null, count: 0, room: null, room_label: null, position: null, near: [], holding: [], position_ms: null, answered_ms: null, facts: {} }, objects,
});

describe("행동 목록", () => {
  it("PAM에 보내는 행동 목록은 services/pam/scenarios/noonchi/tasks.json과 같고, 행동마다 설명과 쓸 수 있는 단계가 있다. 계획 모양은 없다", () => {
    const json = JSON.parse(readFileSync(new URL("../services/pam/scenarios/noonchi/tasks.json", import.meta.url), "utf8")) as string[];
    expect(TASK_NAMES).toEqual(json);
    expect(TASK_NAMES.slice(0, 2)).toEqual(["컵 치우기", "사용자에게 물어보기"]);
    for (const name of TASK_NAMES) {
      const t = TASKS[name]!;
      expect(t.name).toBe(name);
      expect(t.description.length).toBeGreaterThan(5);
      expect(t.allow.kinds.length).toBeGreaterThan(0);
      expect(Object.keys(t).sort()).toEqual(["allow", "description", "name", ...(t.target ? ["target"] : [])].sort());
    }
    expect(TASKS["컵 치우기"]!.allow.kinds).toEqual(["go", "pick", "place"]);
    expect(TASKS["사용자에게 물어보기"]!.allow).toEqual({ kinds: ["ask", "say"], need: ["ask"] });
    expect(TASKS["컵 치우기"]!.allow.need).toEqual(["go", "pick", "place"]);
    expect(TASKS["에어컨 켜기"]!.allow.devices).toEqual({ kinds: ["aircon"], tools: ["turn_on"] });
    expect(taskOf("춤추기")).toBeNull();
    expect(taskOf(null)).toBeNull();
  });

  it("계획 전 검사 대상: 사라지지 않았고 싱크대 안이 아닌 같은 종류 중 가장 최근에 본 것. 대상 종류가 없는 행동은 null", () => {
    const inSink = { place: { value: "in_sink", at_ms: 40, since_ms: 40, certainty: "confirmed" as const } };
    const objects = [cupAt({ id: "cup_1", last_seen_ms: 5 }), cupAt({ id: "cup_2", last_seen_ms: 9 }), cupAt({ id: "cup_3", last_seen_ms: 20, status: "gone" }),
      cupAt({ id: "bottle_1", cls: "bottle", last_seen_ms: 30 }), cupAt({ id: "cup_4", last_seen_ms: 40, facts: inSink })];
    expect(targetOf(TASKS["컵 치우기"]!, world(objects))?.id).toBe("cup_2");
    expect(targetOf(TASKS["사용자에게 물어보기"]!, world(objects))).toBeNull();
  });

  it("계획이 다루는 물건은 첫 act 단계의 대상", () => {
    expect(planTargetId(cupPlan(smallFloor(), "p", "t", { id: "cup_1", position: [7, 0.75, 3] })!)).toBe("cup_1");
    expect(planTargetId(cupPlan(smallFloor(), "p", "t")!)).toBe("table_1");
  });
});

describe("사람이 그 물건을 들고 있는가(holdsTarget)", () => {
  const holding = (objects: WorldObject[], held: string[]): WorldView => {
    const w = world(objects);
    return { ...w, person: { ...w.person, visible: true, holding: held, facts: { holding: { value: "holding_object", at_ms: 0, since_ms: 0, certainty: "confirmed" } } } };
  };
  it("든 것을 모르거나 컵이면 컵을 든 것이고, 관절로 든 것이 책·리모컨뿐이면 아니다(실행 전 검사가 쓴다)", () => {
    const book = cupAt({ id: "book_1", cls: "book" });
    expect(holdsTarget(holding([cupAt()], []), "cup")).toBe(true);
    expect(holdsTarget(holding([cupAt(), book], ["cup_1"]), "cup")).toBe(true);
    expect(holdsTarget(holding([cupAt(), book], ["book_1"]), "cup")).toBe(false);
    expect(holdsTarget(world(), "cup")).toBe(false);
  });
});
