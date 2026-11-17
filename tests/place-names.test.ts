// 평면도 물건·가전을 사람에게 부르는 이름은 한 곳(src/layout/names.ts placeName)에서 찾는다:
// 종류 짧은 이름 → 카탈로그 종류 이름 → 배치 이름 → 가전 종류 이름. 계획 단계 글·실행 추적의 부탁·비전 상태 줄이 모두 이것을 쓰고, id는 사람 글에 내지 않는다.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ExecutionTracker } from "../src/act/track/tracker.js";
import { ApprovalStore } from "../src/agent/approval.js";
import { PlanDraft } from "../src/agent/planTools.js";
import type { PlannedCommandMessage } from "../src/contract/phone.js";
import type { WorldView } from "../src/contract/world.js";
import { PlanHub } from "../src/act/hub.js";
import { placeName, type PlaceNames } from "../src/layout/names.js";
import { floorPlanFrom } from "../src/layout/route.js";
import type { DecisionRecord } from "../src/contract/events.js";
import { SMALL_SCENE } from "./helpers/floor.js";
import { planContext } from "./helpers/planner.js";

describe("부르는 이름 찾기(placeName)", () => {
  const labels: PlaceNames = { typeLabel: (t) => ({ bookcase: "책장", freezer: "냉동고", sink_counter: "싱크대 조리대" })[t], layoutName: (id) => ({ bookcase_1: "침실 1 책장", freezer_1: "후면 발코니 냉동고", shelf_1: "거실 선반" })[id] };
  it("종류 짧은 이름 → 카탈로그 종류 이름 → 배치 이름 → 가전 종류 이름 차례다", () => {
    expect(placeName("sink_1", "sink_counter", labels)).toBe("싱크대");
    expect(placeName("bookcase_1", "bookcase", labels)).toBe("책장");
    expect(placeName("shelf_1", "shelf_x", labels)).toBe("거실 선반");
    expect(placeName("freezer_1", "freezer", {})).toBe("냉장고");
    expect(placeName("mw_1", null, { deviceKind: (id) => (id === "mw_1" ? "microwave" : undefined) })).toBe("전자레인지");
  });
  it("부를 이름이 없거나 id와 같으면 null이다(id를 사람 글에 쓰지 않는다)", () => {
    expect(placeName("bookcase_1", "bookcase", {})).toBeNull();
    expect(placeName("bookcase_1", "bookcase", { layoutName: (id) => id })).toBeNull();
    expect(placeName("x_1", null, {})).toBeNull();
  });
});

describe("실행 추적은 같은 이름 찾기만 쓴다", () => {
  const RAMEN = "라면 끓이기 알려 주기";
  const SCENE = { ...structuredClone(SMALL_SCENE), objects: [...structuredClone(SMALL_SCENE.objects), { id: "bookcase_1", type: "bookcase", room: "hall", plan: { position: [2, 3] } }] };
  const floor = () => floorPlanFrom(structuredClone(SCENE));
  const PERSON: WorldView["person"] = { visible: false, since_ms: 0, last_seen_ms: null, count: 0, room: null, room_label: null, position: null, near: [], holding: [], position_ms: null, answered_ms: null, facts: {} };
  const WORLD: WorldView = { at_ms: 0, objects: [], person: PERSON, fixtures: [], devices: [], eye: null, frame_ms: null, vlm_missing: 0, yolo_missing: 0 };
  const decision: DecisionRecord = {
    id: "pam-1", seq: 1, atMs: 8_000, textSent: "t", finalTime: "x", status: "valid", prediction: { observation: "o", reasoning: "r", task_index: 1 }, action: RAMEN, memoryVersion: 1,
    world: { objects: [], person_visible: false, vlm_missing: 0, yolo_missing: 0 },
  };
  const catalog: PlaceNames = { typeLabel: (t) => (t === "bookcase" ? "책장" : undefined) };
  /** 책장으로 가기 → 물 받기. 계획은 카탈로그 이름으로 만들고, 실행 추적에는 names를 준다(없으면 이름을 모르는 실행 추적). */
  function run(names?: PlaceNames) {
    const phone: PlannedCommandMessage[] = [];
    const clock = { t: 10_000, now() { return this.t; } };
    const plans = new PlanHub(floor(), () => {}, () => "t");
    const approvals = new ApprovalStore(join(mkdtempSync(join(tmpdir(), "names-")), "approvals.json"), () => "t");
    approvals.answer(`task:${RAMEN}`, "approve");
    const t = new ExecutionTracker({
      plans, world: () => WORLD, check: () => ({ ok: true }), floor: () => plans.floor(), approvals, toPhone: (m) => phone.push(m), emit: () => {}, clock, ...(names ? { names } : {}),
      planner: () => new PlanDraft(planContext({ decision, world: WORLD, floor: floor(), typeLabel: catalog.typeLabel })).submit({ steps: [
        { kind: "go", act: "가기", target: "bookcase_1", timeout_s: 120 },
        { kind: "do", act: "물 받기", target: "sink_1", timeout_s: 120 },
      ] }),
    });
    t.onDecision(decision);
    return { t, phone, clock };
  }

  it("비전 상태 줄은 계획 명령과 같은 이름(책장)이다", () => {
    const { t, phone, clock } = run(catalog);
    expect(phone.at(-1)).toMatchObject({ step: "plan:pam-1:1", text: "책장으로 가 주세요", vision: "책장까지 거리 모름" });
    clock.t += 600;
    t.onEye([1, 0.5]);
    t.tick();
    expect(phone.at(-1)).toMatchObject({ vision: "책장까지 2.7m" });
  });

  it("부를 이름을 모르면 비전 상태 줄에 id를 내지 않는다", () => {
    const { t, phone, clock } = run();
    expect(phone.at(-1)).toMatchObject({ step: "plan:pam-1:1", text: "책장으로 가 주세요", vision: "거리 모름" });
    clock.t += 600;
    t.onEye([1, 0.5]);
    t.tick();
    expect(phone.at(-1)).toMatchObject({ vision: "2.7m 남음" });
    expect(phone.map((m) => (m.type === "command" ? `${m.text} ${m.vision ?? ""}` : "")).join(" ")).not.toContain("bookcase");
  });
});
