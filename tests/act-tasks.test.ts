import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { WorldObject, WorldView } from "../src/contract/world.js";
import { holdsTarget, lookTargets, opaqueBody, planTargetId, putAway, sureValue, targetOf, TASK_NAMES, TASKS, taskOf, tasksFor, touchTarget, usingNow, wantOf } from "../src/act/tasks.js";
import type { WorldFact } from "../src/contract/world.js";
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
      const more = [...(t.coach ? ["coach"] : []), ...(t.maxSteps ? ["maxSteps"] : []), ...(t.target ? ["target"] : []), ...(t.look ? ["look"] : []), ...(t.want ? ["want"] : []), ...(t.plan === false ? ["plan"] : []), ...(t.carry ? ["carry"] : []), ...(t.carryUnseen ? ["carryUnseen"] : []), ...(t.touch ? ["touch"] : [])];
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

describe("행동 조건(want)", () => {
  const f = (value: string, certainty: "confirmed" | "inferred"): WorldFact => ({ value, at_ms: 1, since_ms: 1, certainty });
  const cupWith = (contents?: WorldFact) => cupAt({ facts: contents ? { contents } : {} });
  it("내용물을 보는 행동은 조건 값을 둔다(그대로 두기 = 내용물 있음, 채우기·콜라 = 비어 있음). 조건 면은 볼 면 안이다", () => {
    expect(TASKS["컵 그대로 두기"]!.want).toEqual({ contents: "has_contents" });
    expect(TASKS["컵에 물 채워 주기"]!.want).toEqual({ contents: "empty" });
    expect(TASKS["컵에 콜라 따라 주기"]!.want).toEqual({ contents: "empty" });
    expect(TASKS["컵 치우기"]!.want).toBeUndefined();
    for (const t of Object.values(TASKS)) for (const k of Object.keys(t.want ?? {})) expect(t.look).toContain(k);
  });
  it("wantOf: 확인된 같은 값 ok, 확인된 반대 값 mismatch, 짐작·안이 안 보임·없음 unknown", () => {
    const fill = TASKS["컵에 물 채워 주기"]!;
    expect(wantOf(fill, cupWith(f("empty", "confirmed")))).toEqual({ ok: true });
    expect(wantOf(fill, cupWith(f("has_contents", "confirmed")))).toEqual({ ok: false, why: "mismatch", facet: "contents" });
    expect(wantOf(fill, cupWith(f("empty", "inferred")))).toEqual({ ok: false, why: "unknown", facet: "contents" });
    expect(wantOf(fill, cupWith(f("contents_unknown", "confirmed")))).toEqual({ ok: false, why: "unknown", facet: "contents" });
    expect(wantOf(fill, cupWith())).toEqual({ ok: false, why: "unknown", facet: "contents" });
    expect(wantOf(TASKS["컵 치우기"]!, cupWith())).toEqual({ ok: true });
  });
  it("sureValue는 확인된 값(「모름」 값 말고)만, opaqueBody는 불투명이 확인됐을 때만", () => {
    expect(sureValue(cupWith(f("empty", "confirmed")), "contents")).toBe("empty");
    expect(sureValue(cupWith(f("empty", "inferred")), "contents")).toBeNull();
    expect(sureValue(cupWith(f("contents_unknown", "confirmed")), "contents")).toBeNull();
    expect(opaqueBody(cupAt({ facts: { body: f("opaque", "confirmed") } }))).toBe(true);
    expect(opaqueBody(cupAt({ facts: { body: f("opaque", "inferred") } }))).toBe(false);
    expect(opaqueBody(cupAt({ facts: { body: f("see_through", "confirmed") } }))).toBe(false);
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

describe("사람이 그 물건을 쓰는 중인가(usingNow, 쓰는 중 지킴의 공통 기준)", () => {
  const seen = (value: string, at = 5_000): WorldFact => ({ value, at_ms: at, since_ms: at, certainty: "confirmed" });
  /** 5초에 나타난 사람(since_ms 5000). */
  const person = (objects: WorldObject[], p: { facts?: WorldView["person"]["facts"]; holding?: string[]; visible?: boolean } = {}, extra: Partial<WorldView> = {}): WorldView => {
    const w = world(objects);
    return { ...w, ...extra, person: { ...w.person, visible: p.visible ?? true, since_ms: 5_000, holding: p.holding ?? [], facts: p.facts ?? {} } };
  };
  it("사람이 보이고 마시는 중이면 컵·병을 쓰는 중이고(활동), 그 종류를 들거나 손에 든 채 봤으면 들고 있음이다", () => {
    expect(usingNow(person([cupAt()], { facts: { activity: seen("drinking") } }), "cup")).toEqual({ why: { kind: "act", act: "drinking" }, ids: null });
    expect(usingNow(person([cupAt()], { facts: { activity: seen("drinking") } }), "bottle")).toEqual({ why: { kind: "act", act: "drinking" }, ids: null });
    // 마시는 중에 손에 든 컵이 보이면 그 컵이다
    expect(usingNow(person([cupAt({ facts: { place: seen("in_hand", 6_000) } })], { facts: { activity: seen("drinking") } }), "cup")).toEqual({ why: { kind: "act", act: "drinking" }, ids: ["cup_1"] });
    expect(usingNow(person([cupAt()], { facts: { holding: seen("holding_object") }, holding: ["cup_1"] }), "cup")).toEqual({ why: { kind: "holding" }, ids: ["cup_1"] });
    expect(usingNow(person([cupAt({ facts: { place: seen("in_hand", 6_000) } })]), "cup")).toEqual({ why: { kind: "holding" }, ids: ["cup_1"] });
    // 든 id가 World State 물건이 아니면(확인 전 물건) 어느 컵인지 몰라 종류 전체다
    expect(usingNow(person([cupAt()], { facts: { holding: seen("holding_object") }, holding: ["cup_9"] }), "cup")).toEqual({ why: { kind: "holding" }, ids: null });
    // 확인 전 후보 자리를 손에 든 채 봤다(ccd08c9의 「손에 든 채 본 자리」)
    const sighting = { cls: "cup" as const, position: [7, 0.75, 3] as [number, number, number], surface: null, surface_label: null, at_ms: 6_000, in_hand: true };
    expect(usingNow(person([], {}, { sightings: [sighting] }), "cup")).toEqual({ why: { kind: "holding" }, ids: null });
    // 무엇을 들었는지 모르면 그 종류를 든 것으로 본다(식탁에 컵이 보여도: 실제 판 real4에서 든 컵을 못 가려 가까이 가기가 나갔다)
    expect(usingNow(person([], { facts: { holding: seen("holding_object") } }), "cup")).toEqual({ why: { kind: "holding" }, ids: null });
    expect(usingNow(person([cupAt()], { facts: { holding: seen("holding_object") } }), "cup")).toEqual({ why: { kind: "holding" }, ids: null });
    // 그 물건·가전이 쓰는 중으로 보였다(전자레인지를 쓰는 사람)
    const microwave = { id: "microwave_kitchen", cls: "microwave" as const, room: "kitchen", room_label: "주방", device: null, first_seen_ms: 0, last_seen_ms: 6_000, facts: { use: seen("in_use", 6_000) }, answered_ms: null };
    expect(usingNow(person([], {}, { fixtures: [microwave] }), "microwave")).toEqual({ why: { kind: "using" }, ids: null });
    expect(usingNow(person([cupAt({ facts: { use: seen("in_use", 6_000) } })]), "cup")).toEqual({ why: { kind: "using" }, ids: ["cup_1"] });
  });
  it("다른 종류를 쓰는 것, 사람이 나타나기 전에 본 사실, 사람이 안 보일 때는 쓰는 중이 아니다", () => {
    expect(usingNow(person([cupAt()], { facts: { holding: seen("holding_object") }, holding: ["book_1"] }), "cup")).toBeNull();
    expect(usingNow(person([cupAt()], { facts: { activity: seen("watching_tv") } }), "cup")).toBeNull();
    expect(usingNow(person([cupAt()], { facts: { activity: seen("drinking", 4_000) } }), "cup")).toBeNull();
    // 사람이 사라지기 전 사진의 늦은 VLM 답(든 물건 있음)은 다시 나타난 사람의 근거가 아니다(Codex 8944cb6 find.ts:356)
    expect(usingNow(person([], { facts: { holding: seen("holding_object", 4_500) } }), "cup")).toBeNull();
    // 쓴 사람이 떠나 푼 뒤(after)에는 그 뒤에 찍힌 근거만 본다
    expect(usingNow(person([cupAt()], { facts: { activity: seen("drinking", 6_000) } }), "cup", 7_000)).toBeNull();
    expect(usingNow(person([cupAt()], { facts: { activity: seen("drinking", 8_000) } }), "cup", 7_000)).not.toBeNull();
    expect(usingNow(person([cupAt({ facts: { place: seen("in_hand", 4_000) } })]), "cup")).toBeNull();
    expect(usingNow(person([cupAt()], { visible: false, facts: { activity: seen("drinking") } }), "cup")).toBeNull();
  });
  it("손대는 행동(touch)만 대상 종류가 있다(그대로 두기·에어컨 켜기는 없다)", () => {
    expect(["컵 치우기", "컵에 물 채워 주기", "컵에 콜라 따라 주기"].map(touchTarget)).toEqual(["cup", "cup", "cup"]);
    expect(["컵 그대로 두기", "에어컨 켜기", null].map(touchTarget)).toEqual([null, null, null]);
  });
});
