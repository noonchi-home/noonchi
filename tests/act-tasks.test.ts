import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { WorldObject, WorldView } from "../src/contract/world.js";
import { holdsTarget, lookTargets, planTargetId, putAway, targetOf, TASK_NAMES, TASKS, taskOf, tasksFor } from "../src/act/tasks.js";
import { smallFloor } from "./helpers/floor.js";
import { cupPlan } from "./helpers/cup-plan.js";

const cupAt = (over: Partial<WorldObject> = {}): WorldObject => ({
  id: "cup_1", cls: "cup", position: [7, 0.75, 3], surface: "table_1", surface_label: "식탁", room: "kitchen", error_m: 0.1, status: "present",
  first_seen_ms: 0, last_seen_ms: 0, last_in_view_ms: 0, facts: {}, answered_ms: null, devices: [], closer_hold: false, followed_by: null, ...over,
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
      const more = [...(t.coach ? ["coach"] : []), ...(t.maxSteps ? ["maxSteps"] : []), ...(t.target ? ["target"] : []), ...(t.look ? ["look"] : []), ...(t.plan === false ? ["plan"] : []), ...(t.carry ? ["carry"] : []), ...(t.carryUnseen ? ["carryUnseen"] : [])];
      expect(Object.keys(t).sort()).toEqual(["allow", "description", "name", ...more].sort());
      if (t.plan !== false) expect(t.allow.kinds.length).toBeGreaterThan(0);
    }
    expect(TASKS["컵 치우기"]!.allow.kinds).toEqual(["go", "pick", "place"]);
    expect(TASKS["사용자에게 물어보기"]!.allow).toEqual({ kinds: ["ask", "say"], need: ["ask"] });
    expect(TASKS["컵 치우기"]!.allow.need).toEqual(["go", "pick", "place"]);
    expect(TASKS["에어컨 켜기"]!.allow.devices).toEqual({ kinds: ["aircon"], tools: ["turn_on"] });
    expect(taskOf("춤추기")).toBeNull();
    expect(taskOf(null)).toBeNull();
  });

  it("눈치 모드 행동 목록은 일곱이고 앞 넷의 순서는 그대로다(task_index를 지킨다). 코치 행동은 없다", () => {
    expect(tasksFor("noonchi")).toEqual(["컵 치우기", "사용자에게 물어보기", "세탁물 건조기로 옮기기", "에어컨 켜기", "컵 그대로 두기", "컵에 물 채워 주기", "컵에 콜라 따라 주기"]);
    expect(TASK_NAMES).toEqual([...tasksFor("noonchi"), "라면 끓이기 알려 주기", "전자레인지로 데우기 알려 주기"]);
    expect(TASK_NAMES).toHaveLength(9);
    expect(tasksFor("noonchi")).not.toContain("전자레인지로 데우기 알려 주기");
  });

  it("자동이면 PAM에 눈치·코치 행동을 모두 순서 그대로 보낸다(task_index가 같다)", () => {
    expect(tasksFor("auto")).toEqual([...TASK_NAMES]);
  });

  it("코치 모드에서는 PAM에 코치 행동과 「사용자에게 물어보기」만 보낸다", () => {
    expect(tasksFor("coach")).toEqual(["사용자에게 물어보기", "라면 끓이기 알려 주기", "전자레인지로 데우기 알려 주기"]);
    expect(TASK_NAMES.filter((n) => TASKS[n]!.coach)).toEqual(["라면 끓이기 알려 주기", "전자레인지로 데우기 알려 주기"]);
    expect(tasksFor("auto")).toContain("전자레인지로 데우기 알려 주기");
  });

  it("코치 행동은 가전을 조작하지 않는다: device 단계를 쓸 수 없고 do가 꼭 있어야 하며 14단계까지다", () => {
    for (const name of TASK_NAMES.filter((n) => TASKS[n]!.coach)) {
      const t = TASKS[name]!;
      expect(t.allow.kinds, name).not.toContain("device");
      expect(t.allow.devices, name).toBeUndefined();
      expect(t.allow.need, name).toContain("do");
    }
    const ramen = TASKS["라면 끓이기 알려 주기"]!;
    expect(ramen.allow).toEqual({ kinds: ["go", "pick", "place", "do", "wait", "say"], need: ["do"] });
    expect([ramen.maxSteps, ramen.target, ramen.plan]).toEqual([14, undefined, undefined]);
    // 전자레인지: 문 열기부터 꺼내기까지, 저절로 꺼지는 가전이라 끄기 do 대신 꺼짐을 기다리는 wait가 꼭 있다
    const mw = TASKS["전자레인지로 데우기 알려 주기"]!;
    expect(mw.allow).toEqual({ kinds: ["go", "pick", "place", "do", "wait", "say"], need: ["do", "wait"] });
    expect([mw.coach, mw.maxSteps, mw.target, mw.plan]).toEqual([true, 12, undefined, undefined]);
    expect(TASKS["컵 치우기"]!.maxSteps).toBeUndefined();
  });

  it("컵 그대로 두기는 계획을 만들지 않는 행동이다", () => {
    const t = TASKS["컵 그대로 두기"]!;
    expect(t.plan).toBe(false);
    expect(t.target).toBe("cup");
    expect(t.allow).toEqual({ kinds: [], need: [] });
    expect(TASK_NAMES.filter((n) => TASKS[n]!.plan === false)).toEqual(["컵 그대로 두기"]);
  });

  it("채워 주기 둘은 대상이 컵이고 집는 것은 병이며(안 보여도 됨) do 단계가 꼭 있어야 한다", () => {
    for (const name of ["컵에 물 채워 주기", "컵에 콜라 따라 주기"]) {
      const t = TASKS[name]!;
      expect([t.target, t.carry, t.carryUnseen, t.plan]).toEqual(["cup", "bottle", true, undefined]);
      expect(t.allow).toEqual({ kinds: ["go", "pick", "do", "place"], need: ["go", "pick", "do"] });
    }
    expect(TASKS["컵에 물 채워 주기"]!.description).toContain("물병");
    expect(TASKS["컵에 콜라 따라 주기"]!.description).toContain("콜라");
    expect(TASKS["컵 치우기"]!.carry).toBeUndefined();
  });

  it("계획 전 검사 대상: 사라지지 않았고 싱크대 안이 아닌 같은 종류 중 가장 최근에 본 것. 대상 종류가 없는 행동은 null", () => {
    const inSink = { place: { value: "in_sink", at_ms: 40, since_ms: 40, certainty: "confirmed" as const } };
    const objects = [cupAt({ id: "cup_1", last_seen_ms: 5 }), cupAt({ id: "cup_2", last_seen_ms: 9 }), cupAt({ id: "cup_3", last_seen_ms: 20, status: "gone" }),
      cupAt({ id: "bottle_1", cls: "bottle", last_seen_ms: 30 }), cupAt({ id: "cup_4", last_seen_ms: 40, facts: inSink })];
    expect(targetOf(TASKS["컵 치우기"]!, world(objects))?.id).toBe("cup_2");
    expect(targetOf(TASKS["사용자에게 물어보기"]!, world(objects))).toBeNull();
  });

  it("실행 추적이 놓기 단계를 끝낸 물건(placed)도 이미 치운 것이라 대상에서 빠진다", () => {
    const objects = [cupAt({ id: "cup_1", last_seen_ms: 5 }), cupAt({ id: "cup_2", last_seen_ms: 9, surface: "sink_1", facts: { place: { value: "on_table", at_ms: 9, since_ms: 9, certainty: "confirmed" } } })];
    const placed = new Map([["cup_2", { target: "sink_1", atMs: 8 }]]);
    expect(targetOf(TASKS["컵 치우기"]!, world(objects))?.id).toBe("cup_2");
    expect(targetOf(TASKS["컵 치우기"]!, world(objects), placed)?.id).toBe("cup_1");
    expect(putAway(objects[1]!, placed)).toBe(true);
    expect(putAway(objects[0]!, placed)).toBe(false);
    expect(putAway(objects[1]!)).toBe(false);
  });

  it("판단 전에 더 잘 볼 면: 컵 치우기는 내용물을 보지 않고(컵을 두고 떠나면 치우는 습관), 그대로 두기·채우기류는 컵의 contents. 대상 종류가 있는 행동만이다", () => {
    expect(TASKS["컵 치우기"]!.look).toBeUndefined();
    expect(TASKS["컵에 물 채워 주기"]!.look).toEqual(["contents"]);
    expect(lookTargets()).toEqual([{ cls: "cup", facets: ["contents"] }]);
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
