// 계획 단계 조건(src/world/conditions.ts): 낱말 표 키로만 쓴 JSON 조건을 World State로 참·거짓·모름으로 판정한다.
import { describe, expect, it } from "vitest";
import type { WorldDevice, WorldFact, WorldFixture, WorldObject, WorldPerson, WorldView } from "../src/contract/world.js";
import { CONDITION_JSON_SCHEMA, ConditionWatch, checkCondition, evaluate, parseCondition, type ConditionHome } from "../src/world/conditions.js";

const fact = (value: string, at = 1000): WorldFact => ({ value, at_ms: at, since_ms: at, certainty: "confirmed" });
const person = (over: Partial<WorldPerson> = {}): WorldPerson => ({
  visible: true, since_ms: 0, last_seen_ms: 1000, count: 1, position: [1, 1], position_ms: 1000, room: "kitchen", room_label: "주방·식당", near: [], holding: [], facts: {}, answered_ms: 1000, ...over,
});
const cup = (over: Partial<WorldObject> = {}): WorldObject => ({
  id: "cup_1", cls: "cup", position: null, surface: null, surface_label: null, room: null, error_m: null, status: "present",
  first_seen_ms: 0, last_seen_ms: 1000, last_in_view_ms: 1000, facts: {}, answered_ms: 1000, devices: [], closer_hold: false, followed_by: null, ...over,
});
const microwave = (over: Partial<WorldFixture> = {}): WorldFixture => ({
  id: "microwave_kitchen", cls: "microwave", room: "kitchen", room_label: "주방", device: null, first_seen_ms: 0, last_seen_ms: 1000, facts: {}, answered_ms: 1000, ...over,
});
const washer = (over: Partial<WorldDevice> = {}): WorldDevice => ({
  id: "washer_1", kind: "washer", label: "세탁기", status: "작동 중", state: ["running"], active: true, changed_ms: 0, event_ms: null, started_ms: 0, remaining_min: null, history: [], ...over,
});
const view = (over: Partial<WorldView> = {}): WorldView => ({
  at_ms: 1000, objects: [], person: person(), fixtures: [], devices: [], eye: null, frame_ms: 1000, vlm_missing: 0, yolo_missing: 0, ...over,
});
const places: Record<string, [number, number]> = { table_1: [1, 1.5], sink_1: [5, 5] };
const rooms: Record<string, string> = { table_1: "living", sink_1: "kitchen" };
const ctx = (nowMs: number, sinceMs = 0) => ({ nowMs, sinceMs, locate: (id: string) => places[id] ?? null, roomOf: (id: string) => rooms[id] ?? null });

describe("계획 단계 조건", () => {
  it("사람: 보임·안 보임, 발 자리로 본 방·가까이, 사실. 안 보이거나 발 자리가 오래되면 모름이고 not(모름)도 모름", () => {
    const w = view({ person: person({ facts: { posture: fact("standing"), activity: fact("drinking") } }) });
    expect(evaluate({ person: "visible" }, w, ctx(1000))).toBe(true);
    expect(evaluate({ person_in_room: "kitchen" }, w, ctx(1000))).toBe(true);
    expect(evaluate({ person_near: "table_1" }, w, ctx(1000))).toBe(true);
    expect(evaluate({ person_near: "table_1", within_m: 0.4 }, w, ctx(1000))).toBe(false);
    expect(evaluate({ person_fact: "posture", value: "standing" }, w, ctx(1000))).toBe(true);
    expect(evaluate({ person_fact: "activity", value: "eating" }, w, ctx(1000))).toBe(false);
    const gone = view({ person: person({ visible: false, facts: {} }) });
    expect(evaluate({ person: "not_visible" }, gone, ctx(1000))).toBe(true);
    expect(evaluate({ not: { person_in_room: "kitchen" } }, gone, ctx(1000))).toBeNull();
    expect(evaluate({ not: { person_near: "table_1" } }, view({ person: person({ position_ms: 1000 }) }), ctx(7000))).toBeNull(); // 발 자리가 6초 전
    expect(evaluate({ not: { person_fact: "activity", value: "drinking" } }, gone, ctx(1000))).toBeNull();
  });

  it("person_holding: 분석한 프레임에 사람이 안 보이면 거짓이고 프레임이 끊기면 모름. 그래서 not person_holding은 들고 있다는 양성 근거가 있을 때만 막는다", () => {
    const holding = (ids: string[]) => view({ person: person({ holding: ids, facts: { holding: fact("holding_object") } }) });
    const notHeld = { not: { person_holding: "cup_1" } };
    expect(evaluate(notHeld, holding(["cup_1"]), ctx(1000))).toBe(false);
    expect(evaluate(notHeld, holding([]), ctx(1000))).toBe(false); // 든 것을 모르면 그 컵일 수 있다
    expect(evaluate(notHeld, holding(["book_1"]), ctx(1000))).toBe(true);
    expect(evaluate(notHeld, view(), ctx(1000))).toBe(true); // 보이는 사람의 VLM 답에 들고 있음이 없다
    const away = view({ person: person({ visible: false, facts: {} }) });
    expect(evaluate({ person_holding: "cup_1" }, away, ctx(1000))).toBe(false);
    expect(evaluate(notHeld, away, ctx(1000))).toBe(true);
    // 분석한 프레임이 FACT_FRESH_MS 넘게 없으면 모름
    expect(evaluate(notHeld, away, ctx(12_000))).toBeNull();
    expect(evaluate(notHeld, { ...away, frame_ms: null }, ctx(1000))).toBeNull();
  });

  it("part basin: 물건이 그 면의 싱크볼 안(World State surface_part)일 때만 참이고, 단계 시작 뒤 본 자리만 쓴다. 면만 보면 싱크볼 안도 그 면이다", () => {
    const at = (over: Partial<WorldObject>) => view({ objects: [cup({ surface: "sink_1", ...over })] });
    const inBasin = { object: "cup_1", surface: "sink_1", part: "basin" };
    expect(evaluate(inBasin, at({ surface_part: "basin" }), ctx(1000))).toBe(true);
    expect(evaluate(inBasin, at({}), ctx(1000))).toBe(false); // 싱크볼 옆 조리대
    expect(evaluate(inBasin, at({ surface: "table_1" }), ctx(1000))).toBe(false);
    expect(evaluate(inBasin, at({ surface_part: "basin" }), ctx(1500, 1200))).toBeNull(); // 단계 전에 본 자리
    expect(evaluate({ object: "cup_1", surface: "sink_1" }, at({ surface_part: "basin" }), ctx(1000))).toBe(true);
    expect(() => parseCondition({ object: "cup_1", part: "basin" })).toThrow(); // part는 면과 함께
    expect(() => parseCondition({ object: "cup_1", surface: "sink_1", part: "drawer" })).toThrow();
  });

  it("단계 시작 뒤 본 사실만 쓴다: 그 전 사실은 모름, 하는 일이 없으면 단계 시작 뒤 답이 있었을 때만 거짓", () => {
    const w = view({ person: person({ facts: { activity: fact("drinking", 500) }, answered_ms: 500 }) });
    expect(evaluate({ person_fact: "activity", value: "drinking" }, w, ctx(1000, 800))).toBeNull();
    const after = view({ person: person({ facts: {}, answered_ms: 900 }) });
    expect(evaluate({ person_fact: "activity", value: "drinking" }, after, ctx(1000, 800))).toBe(false);
    expect(evaluate({ person_fact: "posture", value: "sitting" }, after, ctx(1000, 800))).toBeNull(); // 자세는 지금만 맞는 면이 아니다
  });

  it("물건: id나 종류, 한 물건이 모든 칸을 함께 맞춘다, 사라진 물건은 단계 뒤 본 마지막 사실, 없는 물건은 모름", () => {
    const w = view({ objects: [cup({ facts: { place: fact("in_sink") } }), cup({ id: "cup_2", status: "gone", facts: { contents: fact("empty"), place: fact("in_fridge") } })] });
    expect(evaluate({ object: "cup", facts: { place: "in_sink" } }, w, ctx(1000))).toBe(true);
    expect(evaluate({ object: "cup", facts: { place: "in_sink", contents: "empty" } }, w, ctx(1000))).toBeNull(); // cup_1 안 내용 모름, cup_2는 싱크대 아님
    expect(evaluate({ object: "cup_2", facts: { place: "in_fridge" } }, w, ctx(1000))).toBe(true);
    expect(evaluate({ object: "cup_2", facts: { place: "in_fridge" } }, w, ctx(1500, 1200))).toBeNull(); // 단계 전에 본 사실
    expect(evaluate({ object: "cup", status: "gone" }, w, ctx(1000))).toBe(false);
    expect(evaluate({ object: "cup_2", status: "gone" }, w, ctx(1000))).toBe(true);
    expect(evaluate({ object: "bowl", facts: { place: "in_sink" } }, w, ctx(1000))).toBeNull();
    expect(evaluate({ object: "cup", surface: "sink_1" }, view({ objects: [cup({ surface: "sink_1" })] }), ctx(1000))).toBe(true);
  });

  it("가전: 지금 상태, 단계 시작 뒤 그 상태가 됨(세탁 멈춤), 종류로도 찾고, 신호 없으면 모름", () => {
    const done = view({ devices: [washer({ state: ["stopped", "door_closed"], status: "멈춤 · 문 닫힘", history: [{ attr: "running", from: true, to: false, at_ms: 5000 }] })] });
    expect(evaluate({ device: "washer", state: "stopped" }, done, ctx(6000))).toBe(true);
    expect(evaluate({ device: "washer_1", became: "stopped" }, done, ctx(6000, 1000))).toBe(true);
    expect(evaluate({ device: "washer", became: "stopped" }, done, ctx(6000, 5500))).toBe(false); // 단계 전에 멈춤
    const first = view({ devices: [washer({ state: ["stopped"], history: [{ attr: "running", from: null, to: false, at_ms: 5000 }] })] });
    expect(evaluate({ device: "washer", became: "stopped" }, first, ctx(6000))).toBe(false); // 처음 받은 상태는 사건이 아니다
    expect(evaluate({ device: "washer", state: "running" }, view({ devices: [washer({ status: null, state: [] })] }), ctx(0))).toBeNull();
  });

  it("became은 근거 시각(카메라면 촬영 시각 seen_ms, 허브 신호면 도착 시각)이 단계 시작 뒤여야 한다", () => {
    const off = (h: Partial<WorldDevice["history"][number]>) => view({ devices: [washer({ id: "mw_1", kind: "microwave", state: ["off"], status: "꺼짐", history: [{ attr: "power", from: "on", to: "off", at_ms: 5000, ...h }] })] });
    // 단계 시작(4000) 전에 찍힌 꺼짐 사진의 답이 단계 시작 뒤(5000) 도착: 끝나지 않는다
    expect(evaluate({ device: "mw_1", became: "off" }, off({ seen_ms: 3000, explicit: true }), ctx(6000, 4000))).toBe(false);
    // 단계 시작 뒤 찍힌 꺼짐이면 끝난다(추정 꺼짐도 단계 진행에는 쓴다)
    expect(evaluate({ device: "mw_1", became: "off" }, off({ seen_ms: 4500, explicit: true }), ctx(6000, 4000))).toBe(true);
    expect(evaluate({ device: "mw_1", became: "off" }, off({ seen_ms: 4500, explicit: false }), ctx(6000, 4000))).toBe(true);
    // 허브 신호(seen_ms 없음)는 도착 시각으로 본다
    expect(evaluate({ device: "mw_1", became: "off" }, off({}), ctx(6000, 4000))).toBe(true);
  });

  it("가전 설비(방까지), 폰 근처는 같은 방·평면 거리·새 폰 자리, 지난 시간, 하루 때, 사람 수", () => {
    const eye = { position: [5, 5.5] as [number, number], height_m: 1.2, yaw_deg: 0, pitch_deg: 0, room: "kitchen", room_label: "주방", at_ms: 1000 };
    const w = view({ fixtures: [microwave({ facts: { use: fact("in_use") } })], eye });
    expect(evaluate({ fixture: "microwave", facts: { use: "in_use" } }, w, ctx(1000))).toBe(true);
    expect(evaluate({ fixture: "microwave", room: "living", facts: { use: "in_use" } }, w, ctx(1000))).toBeNull();
    expect(evaluate({ fixture: "microwave", facts: { use: "in_use" } }, view({ fixtures: [microwave({ answered_ms: 1000 })] }), ctx(1000))).toBe(false); // 쓰는 중이 답에 없음
    expect(evaluate({ phone_near: "sink_1" }, w, ctx(1000))).toBe(true);
    expect(evaluate({ phone_near: "sink_1" }, w, ctx(7000))).toBeNull(); // 폰 자리가 6초 전
    expect(evaluate({ phone_near: "table_1", within_m: 9 }, w, ctx(1000))).toBe(false); // 다른 방
    expect(evaluate({ elapsed_s: 300 }, w, ctx(299_000))).toBe(false);
    expect(evaluate({ elapsed_s: 300 }, w, ctx(300_000))).toBe(true);
    expect(evaluate({ day_part: "night" }, w, ctx(Date.UTC(2026, 10, 7, 13, 0, 0)))).toBe(true); // 22시(+9)
    expect(evaluate({ people_at_least: 2 }, view({ person: person({ count: 2 }) }), ctx(0))).toBe(true);
  });

  it("for_s: 안 조건이 그 시간 넘게 이어서 참이어야 참, 거짓·모름이면 다시 센다", () => {
    const watch = new ConditionWatch({ for_s: 10, cond: { not: { person_near: "table_1" } } });
    const away = (t: number) => view({ person: person({ position: [4, 4], position_ms: t }) });
    expect(watch.check(away(0), ctx(0))).toBe(false);
    expect(watch.check(away(9000), ctx(9000))).toBe(false);
    expect(watch.state(view({ person: person({ visible: false }) }), ctx(9500))).toBeNull();
    expect(watch.check(away(10_000), ctx(10_000))).toBe(false);
    expect(watch.check(away(20_000), ctx(20_000))).toBe(true);
  });

  it("seq: 앞 조건이 참이 된 뒤 다음 조건. 식탁을 떠남 = 식탁 가까이 → 10초 넘게 떨어짐, 돌아옴 = 안 보임 → 보임", () => {
    const left = new ConditionWatch({ seq: [{ person_near: "table_1" }, { for_s: 10, cond: { not: { person_near: "table_1" } } }] });
    const at = (t: number, p: [number, number]) => view({ person: person({ position: p, position_ms: t }) });
    expect(left.check(at(0, [4, 4]), ctx(0))).toBe(false); // 처음부터 식탁에 없던 사람은 떠난 것이 아니다
    expect(left.check(at(20_000, [4, 4]), ctx(20_000))).toBe(false);
    expect(left.check(at(21_000, [1, 1]), ctx(21_000))).toBe(false);
    expect(left.check(at(22_000, [4, 4]), ctx(22_000))).toBe(false);
    expect(left.check(at(32_000, [4, 4]), ctx(32_000))).toBe(true);
    const back = new ConditionWatch({ seq: [{ person: "not_visible" }, { person: "visible" }] });
    expect(back.check(view(), ctx(0))).toBe(false);
    expect(back.check(view({ person: person({ visible: false }) }), ctx(1000))).toBe(false);
    expect(back.check(view(), ctx(2000))).toBe(true);
  });

  it("「모름」 값(하는 일 모름·안이 안 보임)은 다른 값과 견주면 모름, 지금만 맞는 면은 10초 넘은 답이면 모름", () => {
    const w = view({ person: person({ facts: { activity: fact("unknown") } }), objects: [cup({ facts: { contents: fact("contents_unknown") } })] });
    expect(evaluate({ not: { person_fact: "activity", value: "drinking" } }, w, ctx(1000))).toBeNull();
    expect(evaluate({ object: "cup", facts: { contents: "empty" } }, w, ctx(1000))).toBeNull();
    expect(evaluate({ person_fact: "activity", value: "unknown" }, w, ctx(1000))).toBe(true);
    const old = view({ person: person({ facts: {}, answered_ms: 1000 }) });
    expect(evaluate({ not: { person_fact: "activity", value: "drinking" } }, old, ctx(5000))).toBe(true);
    expect(evaluate({ not: { person_fact: "activity", value: "drinking" } }, old, ctx(12_000))).toBeNull(); // 답이 11초 전
    const watch = new ConditionWatch({ for_s: 30, cond: { not: { person_fact: "activity", value: "drinking" } } });
    expect(watch.check(old, ctx(2000))).toBe(false);
    expect(watch.state(old, ctx(12_000))).toBeNull(); // 관측이 끊기면 다시 센다
    expect(watch.check(view({ person: person({ facts: {}, answered_ms: 40_000 }) }), ctx(40_000))).toBe(false);
  });

  it("방을 모르면 모름: 사람 발 자리의 방이 없거나, 폰·자리의 방을 모르면", () => {
    expect(evaluate({ not: { person_in_room: "kitchen" } }, view({ person: person({ room: null }) }), ctx(1000))).toBeNull();
    const eye = { position: [5, 5.5] as [number, number], height_m: 1.2, yaw_deg: 0, pitch_deg: 0, room: null, room_label: null, at_ms: 1000 };
    expect(evaluate({ phone_near: "sink_1" }, view({ eye }), ctx(1000))).toBeNull();
    expect(evaluate({ phone_near: "sink_1" }, view({ eye: { ...eye, room: "kitchen" } }), { ...ctx(1000), roomOf: () => null })).toBeNull();
  });

  it("seq 칸마다 기준 시각이 앞 칸이 참이 된 때로 바뀐다: 멈춤 → 시작 이력으로 「시작 뒤 멈춤」이 되지 않는다", () => {
    const history = [{ attr: "running", from: true, to: false, at_ms: 2000 }, { attr: "running", from: false, to: true, at_ms: 3000 }];
    const w = view({ devices: [washer({ history })] });
    const run = new ConditionWatch({ seq: [{ device: "washer", became: "running" }, { device: "washer", became: "stopped" }] });
    expect(run.check(w, ctx(4000))).toBe(false);
    expect(run.check(w, ctx(5000))).toBe(false);
    const stopped = view({ devices: [washer({ state: ["stopped"], history: [...history, { attr: "running", from: true, to: false, at_ms: 6000 }] })] });
    expect(run.check(stopped, ctx(6500))).toBe(true);
  });

  it("follow: 그 id와 단계 시작 뒤 새로 생긴 같은 종류 물건(옮겨서 새 id), 전부터 있던 다른 컵은 아니다", () => {
    const w = view({ objects: [
      cup({ id: "cup_1", status: "gone", first_seen_ms: 0 }), cup({ id: "cup_2", first_seen_ms: 100, facts: { place: fact("in_sink") } }),
      cup({ id: "cup_3", first_seen_ms: 900, facts: { place: fact("on_table") } }),
    ] });
    expect(evaluate({ object: "cup_1", follow: true, facts: { place: "in_sink" } }, w, ctx(1000, 500))).toBeNull(); // cup_2는 단계 전부터 있었다
    expect(evaluate({ object: "cup_1", follow: true, facts: { place: "on_table" } }, w, ctx(1000, 500))).toBe(true);
    // gone + facts는 「그 사실로 사라진 물건이 하나 있음」(냉장고에 넣고 문을 닫음)
    const fridge = view({ objects: [cup({ id: "cup_1", status: "gone", facts: { place: fact("in_fridge") } }), cup({ id: "cup_2" })] });
    expect(evaluate({ object: "cup", status: "gone", facts: { place: "in_fridge" } }, fridge, ctx(1000))).toBe(true);
    expect(evaluate({ object: "cup", status: "gone" }, fridge, ctx(1000))).toBe(false);
  });

  it("사람 보임·수는 10초 안에 분석한 프레임이 있을 때만, for_s는 검사 사이가 10초 넘게 비면 다시 센다", () => {
    expect(evaluate({ person: "visible" }, view({ frame_ms: 1000 }), ctx(5000))).toBe(true);
    expect(evaluate({ person: "visible" }, view({ frame_ms: 1000 }), ctx(12_000))).toBeNull(); // 폰이 끊김
    expect(evaluate({ person: "not_visible" }, view({ frame_ms: null, person: person({ visible: false }) }), ctx(0))).toBeNull();
    expect(evaluate({ people_at_least: 1 }, view({ frame_ms: 1000 }), ctx(12_000))).toBeNull();
    const watch = new ConditionWatch({ for_s: 30, cond: { elapsed_s: 0 } });
    expect(watch.check(view(), ctx(0))).toBe(false);
    expect(watch.check(view(), ctx(40_000))).toBe(false); // 40초 동안 검사하지 않았다
    expect(watch.check(view(), ctx(49_000))).toBe(false);
    expect(watch.check(view(), ctx(58_000))).toBe(false);
    expect(watch.check(view(), ctx(67_000))).toBe(false);
    expect(watch.check(view(), ctx(70_000))).toBe(true);
  });

  it("follow를 실행 추적이 주면 지금 그 물건으로 보는 것만 본다: 옮겨 새 id로 이었으면 사라진 원래 id는 보지 않아 not(손에 있음)도 새 물건으로 정한다", () => {
    const moved = cup({ id: "cup_3", first_seen_ms: 700, surface: "sink_1", facts: { place: fact("on_table") } });
    const w = view({ objects: [cup({ id: "cup_1", status: "gone", last_seen_ms: 300 }), moved] });
    const followed = { ...ctx(1000, 500), follow: () => ["cup_3"] };
    const notHeld = { not: { object: "cup_1", follow: true, facts: { place: "in_hand" } } };
    expect(evaluate(notHeld, w, followed)).toBe(true);
    expect(evaluate({ all: [{ object: "cup_1", follow: true, surface: "sink_1" }, notHeld] }, w, followed)).toBe(true);
    const held = view({ objects: [w.objects[0]!, { ...moved, facts: { place: fact("in_hand") } }] });
    expect(evaluate(notHeld, held, followed)).toBe(false);
    // 실행 추적이 잇지 못하면(빈 목록) 그 id를 본다
    expect(evaluate({ object: "cup_1", follow: true, status: "gone" }, w, { ...ctx(1000, 500), follow: () => [] })).toBe(true);
    expect(evaluate(notHeld, w, { ...ctx(1000, 500), follow: () => [] })).toBeNull();
  });

  it("follow: 원래 물건이 보이는 동안은 그것만, 옮겨 새로 생긴 물건이 여럿이면 모두 같은 답일 때만", () => {
    const here = view({ objects: [cup({ id: "cup_1", facts: { place: fact("on_table") } }), cup({ id: "cup_2", first_seen_ms: 900, facts: { place: fact("in_sink") } })] });
    expect(evaluate({ object: "cup_1", follow: true, facts: { place: "in_sink" } }, here, ctx(1000, 500))).toBe(false);
    const two = view({ objects: [cup({ id: "cup_1", status: "out_of_view" }), cup({ id: "cup_2", first_seen_ms: 900, facts: { place: fact("in_sink") } }), cup({ id: "cup_3", first_seen_ms: 950, facts: { place: fact("on_table") } })] });
    expect(evaluate({ object: "cup_1", follow: true, facts: { place: "in_sink" } }, two, ctx(1000, 500))).toBeNull();
  });

  it("묶기는 참·거짓·모름 셈: all은 거짓 하나면 거짓, any는 참 하나면 참", () => {
    const w = view({ objects: [cup({ facts: { contents: fact("empty") } })], person: person({ visible: false }) });
    expect(evaluate({ any: [{ object: "cup", facts: { contents: "empty" } }, { person_in_room: "kitchen" }] }, w, ctx(1000))).toBe(true);
    expect(evaluate({ all: [{ person: "visible" }, { person_in_room: "kitchen" }] }, w, ctx(1000))).toBe(false);
    expect(evaluate({ all: [{ object: "cup", facts: { contents: "empty" } }, { person_in_room: "kitchen" }] }, w, ctx(1000))).toBeNull();
  });

  it("모르는 키, 면·대상에 맞지 않는 값은 받지 않는다. 계획 에이전트에 줄 JSON Schema가 있다", () => {
    expect(() => parseCondition({ person_fact: "activity", value: "standing" })).toThrow();
    expect(() => parseCondition({ object: "cup", facts: { place: "empty" } })).toThrow();
    expect(() => parseCondition({ object: "cup", facts: { use: "water_running" } })).toThrow(); // 싱크대(가전 설비) 값
    expect(() => parseCondition({ object: "cup" })).toThrow();
    expect(() => parseCondition({ object: "cup", status: "gone", facts: {} })).toThrow(); // 빈 facts가 gone 뜻을 바꾸지 않게
    expect(() => parseCondition({ fixture: "tv", facts: {} })).toThrow();
    expect(() => parseCondition({ device: "washer", became: "finished" })).toThrow();
    expect(() => parseCondition({ person: "visible", extra: 1 })).toThrow();
    expect(() => parseCondition({ seq: [{ person: "visible" }] })).toThrow();
    expect(parseCondition({ for_s: 5, cond: { device: "cooktop", state: "off" } })).toEqual({ for_s: 5, cond: { device: "cooktop", state: "off" } });
    expect(JSON.stringify(CONDITION_JSON_SCHEMA)).toContain("washing_dishes");
  });

  it("checkCondition: 이 집에 없는 가전·방·자리, 그 가전에 없는 상태, 그 종류에 없는 면을 말한다", () => {
    const home: ConditionHome = {
      devices: [{ id: "washer_1", kind: "washer", twinAttrs: { running: [false, true], door: ["closed", "open"] } }, { id: "cooktop_1", kind: "cooktop", twinAttrs: { power: ["off", "on"] } }],
      rooms: ["kitchen", "living"], hasPlace: (id: string) => id in places, hasBasin: (id: string) => id === "sink_1",
    };
    expect(checkCondition(parseCondition({ object: "cup_3", surface: "sink_1", part: "basin" }), home)).toEqual([]);
    expect(checkCondition(parseCondition({ object: "cup_3", surface: "table_1", part: "basin" }), home)).toEqual(["싱크볼이 없는 자리: table_1"]);
    expect(checkCondition(parseCondition({ all: [{ device: "washer", became: "stopped" }, { device: "cooktop", state: "off" }, { phone_near: "sink_1" }] }), home)).toEqual([]);
    expect(checkCondition(parseCondition({ device: "microwave", state: "on" }), home)).toEqual(["이 집에 없는 가전: microwave"]);
    expect(checkCondition(parseCondition({ device: "cooktop", state: "running" }), home)).toEqual(["cooktop에 없는 상태: running"]);
    expect(checkCondition(parseCondition({ person_in_room: "garage" }), home)).toEqual(["없는 방: garage"]);
    expect(checkCondition(parseCondition({ object: "cup", facts: { screen: "screen_on" } }), home)).toEqual(["cup에 없는 면: screen"]);
    expect(checkCondition(parseCondition({ object: "chair", status: "gone" }), home)).toEqual(["물건 종류나 id가 아님: chair"]);
    expect(checkCondition(parseCondition({ object: "cup_3", surface: "desk_9" }), home)).toEqual(["없는 자리: desk_9"]);
    expect(checkCondition(parseCondition({ object: "cup", follow: true, status: "gone" }), home)).toEqual(["follow는 물건 id에만: cup"]);
  });
});
