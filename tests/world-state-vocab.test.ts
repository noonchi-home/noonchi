// World State가 낱말 표의 새 사실을 쌓는다: 새 물건 종류, 가전 설비(TV·냉장고…), 사람 하는 일·자리·방·수, 가전 상태와 사건(세탁 끝남·문 오래 열림).
import { describe, expect, it } from "vitest";
import type { Detection, EngineFrame, CameraView } from "../src/contract/observe.js";
import { sha256 } from "../src/observe/ring.js";
import { WorldState } from "../src/world/state/world.js";
import { holdsTarget } from "../src/act/tasks.js";
import { standing } from "./helpers/poses.js";
import { det as mkDet } from "./helpers/detectors.js";

const frame = (i: number): EngineFrame => ({ id: `e${i}`, capturedAtMs: i * 1000, latestAtMs: i * 1000, jpeg: Buffer.from(`${i}`), sha256: sha256(Buffer.from(`${i}`)), width: 480, height: 360, eye: null, view: null });
const det = (label: Detection["label"], box: Detection["box"], score = 0.9): Detection => mkDet(label, score, box, 0);
const person = det("person", [10, 10, 100, 300]);
const laptop = det("laptop", [200, 200, 120, 80]);
const book = det("book", [340, 220, 40, 30]);
const tv = det("tv", [300, 20, 160, 90]);
const devices = () => [
  { id: "washer_1", kind: "washer", label: "후면 발코니 세탁기" },
  { id: "ac_1", kind: "aircon", label: "거실 에어컨" },
  { id: "fridge_1", kind: "fridge", label: "주방 냉장고" },
  { id: "tv_dev", kind: "tv", label: "거실 TV", room: "living" },
];
const ws = () => new WorldState({ evidenceStepMs: 1000, surfaces: () => [], floorAt: () => 0, roomAt: () => ({ id: "living", label: "거실" }), devices });
// 카메라: 트윈 (0, 1.5, 0)에서 45° 아래로 숙이고 +x를 본다. 90° 시야 투영(열 우선). tests/world-state.test.ts와 같다
const P = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, -1.0002, -1, 0, 0, -0.020002, 0];
const mul = (a: number[], b: number[]) => [a[3]! * b[0]! + a[0]! * b[3]! + a[1]! * b[2]! - a[2]! * b[1]!, a[3]! * b[1]! - a[0]! * b[2]! + a[1]! * b[3]! + a[2]! * b[0]!, a[3]! * b[2]! + a[0]! * b[1]! - a[1]! * b[0]! + a[2]! * b[3]!, a[3]! * b[3]! - a[0]! * b[0]! - a[1]! * b[1]! - a[2]! * b[2]!];
const tilt = [Math.sin(-Math.PI / 8), 0, 0, Math.cos(-Math.PI / 8)];
const look: CameraView = { origin: [0, 1.5, 0], orientation: mul([0, Math.sin(-Math.PI / 4), 0, Math.cos(-Math.PI / 4)], tilt) as [number, number, number, number], theta: 0, projection: P };
const scene = (observations: { object_id: string; state: string }[], summary = "s") => ({ scene: "living room", observations: observations as never, summary });

describe("World State + 낱말 표", () => {
  it("VLM이 고른 하는 일·자리·들고 있음을 사람 면에 두고, 그 종류 면이 아닌 값은 버린다", () => {
    const w = ws();
    let ids = new Map<string, string>();
    for (let i = 1; i <= 3; i++) ids = w.applyDetections(frame(i), [person, laptop, book]).ids;
    const changes = w.applyScene("e3", 3000, scene([
      { object_id: "d1", state: "watching_tv" }, { object_id: "d1", state: "on_sofa" }, { object_id: "d1", state: "sitting" },
      { object_id: "d2", state: "open" }, { object_id: "d2", state: "screen_on" }, { object_id: "d2", state: "on_desk" },
      { object_id: "d3", state: "has_contents" }, { object_id: "d3", state: "screen_on" },
    ]), ids);
    const v = w.view(3000);
    expect(v.person.facts).toMatchObject({ activity: { value: "watching_tv" }, place: { value: "on_sofa" }, posture: { value: "sitting" } });
    const lap = v.objects.find((o) => o.cls === "laptop")!;
    expect(lap.facts).toMatchObject({ open: { value: "open" }, screen: { value: "screen_on" }, place: { value: "on_desk" } });
    expect(v.objects.find((o) => o.cls === "book")!.facts).toEqual({}); // 책에는 안 내용·화면이 없다
    expect(changes.map((c) => c.text)).toEqual(expect.arrayContaining(["사람 TV 보는 중", "사람 소파 위", "노트북 laptop_1 열림", "노트북 laptop_1 화면 켜짐"]));
  });

  it("사람 하는 일·자리·들고 있음은 지금만 맞는 사실이라 그 사람을 본 다음 답에 없으면 지운다", () => {
    const w = ws();
    let ids = new Map<string, string>();
    for (let i = 1; i <= 3; i++) ids = w.applyDetections(frame(i), [person]).ids;
    w.applyScene("e3", 3000, scene([{ object_id: "d1", state: "taking_medicine" }, { object_id: "d1", state: "on_chair" }, { object_id: "d1", state: "holding_object" }]), ids);
    expect(w.view(3000).person.facts).toMatchObject({ activity: { value: "taking_medicine" }, holding: { value: "holding_object" } });
    ids = w.applyDetections(frame(4), [person]).ids;
    w.applyScene("e4", 4000, scene([{ object_id: "d1", state: "standing" }]), ids);
    expect(Object.keys(w.view(4000).person.facts)).toEqual(["posture"]);
  });

  it("관절로 든 물건은 사람 들고 있음과 손에 있음 목록", () => {
    const w = ws();
    const cup = det("cup", [220, 160, 40, 20]);
    for (let i = 1; i <= 3; i++) w.applyDetections(frame(i), [person, cup], [standing({ 10: [230, 170, 0.9] })]);
    const v = w.view(3000);
    expect(v.person.facts.holding?.value).toBe("holding_object");
    expect(v.person.holding).toEqual(["cup_1"]);
  });

  it("새 물건 종류는 종류별 신뢰도로 받고, 음식에는 관계표로 냉장고를 붙인다", () => {
    const w = ws();
    expect(w.accepts({ label: "fork", score: 0.44 })).toBe(false);
    expect(w.accepts({ label: "fork", score: 0.45 })).toBe(true);
    expect(w.accepts({ label: "pizza", score: 0.49 })).toBe(false);
    for (let i = 1; i <= 3; i++) w.applyDetections(frame(i), [det("pizza", [10, 300, 60, 40], 0.7)]);
    expect(w.view(3000).objects.map((o) => [o.id, o.devices])).toEqual([["pizza_1", ["fridge_1"]]]);
  });

  it("가전 설비(TV)는 보임·사라짐 없이 방마다 하나로 두고, 같은 방 트윈 가전 id를 붙이고, 화면 켜짐이 변화 줄이다", () => {
    const w = ws();
    w.setEye({ position: [1, 2], height_m: 1.2, yaw_deg: 0, pitch_deg: -10 }, 0);
    let out: string[] = [];
    let ids = new Map<string, string>();
    for (let i = 1; i <= 3; i++) {
      const r = w.applyDetections({ ...frame(i), eye: { position: [1, 2], height_m: 1.2, yaw_deg: 0, pitch_deg: -10 } }, [tv]);
      ids = r.ids;
      out.push(...r.changes.map((c) => c.kind));
    }
    expect(out).toEqual([]);
    expect(ids.get("d1")).toBe("tv_living");
    const ch = w.applyScene("e3", 3000, scene([{ object_id: "d1", state: "screen_on" }]), ids).filter((c) => c.kind !== "vlm");
    expect(ch).toEqual([expect.objectContaining({ kind: "fixture", subject: "tv_living", text: "거실 TV tv_living 화면 켜짐", meaningful: true })]);
    expect(w.view(3000).fixtures).toEqual([expect.objectContaining({ id: "tv_living", cls: "tv", room: "living", room_label: "거실", device: "tv_dev", facts: { screen: expect.objectContaining({ value: "screen_on" }) } })]);
    out = [];
    for (let i = 4; i <= 9; i++) out.push(...w.applyDetections(frame(i), []).changes.map((c) => c.kind));
    expect(out).toEqual([]);
    expect(w.view(9000).fixtures[0]!.facts.screen?.value).toBe("screen_on"); // 안 보여도 마지막 상태
  });

  it("가전 설비 방은 그 사진을 찍은 눈의 방이다(분석이 끝난 때의 눈이 아니다)", () => {
    const w = new WorldState({ evidenceStepMs: 1000, surfaces: () => [], floorAt: () => 0, roomAt: (p) => (p[0] < 5 ? { id: "living", label: "거실" } : { id: "kitchen", label: "주방" }), devices });
    const eye = { position: [1, 2] as [number, number], height_m: 1.2, yaw_deg: 0, pitch_deg: -10 };
    w.setEye({ ...eye, position: [8, 2] }, 0); // 폰은 이미 주방으로 옮겼다
    const r = w.applyDetections({ ...frame(1), eye }, [tv]);
    expect(r.ids.get("d1")).toBe("tv_living");
  });

  it("VLM이 가렸다(not_visible)고 한 대상은 답이 아니다: 지금만 맞는 사실을 지우지 않고 답 시각도 두지 않는다", () => {
    const w = ws();
    w.setEye({ position: [1, 2], height_m: 1.2, yaw_deg: 0, pitch_deg: -10 }, 0);
    const mw = det("microwave", [300, 100, 120, 80]);
    let ids = w.applyDetections(frame(1), [mw]).ids;
    w.applyScene("e1", 1000, scene([{ object_id: "d1", state: "in_use" }]), ids);
    ids = w.applyDetections(frame(2), [mw]).ids;
    w.applyScene("e2", 2000, scene([{ object_id: "d1", state: "not_visible" }]), ids);
    expect(w.view(2000).fixtures[0]).toMatchObject({ answered_ms: 1000, facts: { use: expect.objectContaining({ value: "in_use", at_ms: 1000 }) } });
  });

  it("지금만 맞는 사실은 답이 10초 넘게 끊겼다 다시 같은 값이면 처음 보인 시각을 새로 둔다", () => {
    const w = ws();
    let ids = new Map<string, string>();
    for (let i = 1; i <= 2; i++) ids = w.applyDetections(frame(i), [person]).ids;
    w.applyScene("e2", 2000, scene([{ object_id: "d1", state: "drinking" }, { object_id: "d1", state: "sitting" }]), ids);
    ids = w.applyDetections(frame(4), [person]).ids;
    w.applyScene("e4", 4000, scene([{ object_id: "d1", state: "drinking" }, { object_id: "d1", state: "sitting" }]), ids);
    expect(w.view(4000).person.facts.activity?.since_ms).toBe(2000);
    ids = w.applyDetections(frame(20), [person]).ids;
    w.applyScene("e20", 20_000, scene([{ object_id: "d1", state: "drinking" }, { object_id: "d1", state: "sitting" }]), ids);
    expect(w.view(20_000).person.facts.activity?.since_ms).toBe(20_000);
    expect(w.view(20_000).person.facts.posture?.since_ms).toBe(2000); // 자세는 이어지는 사실
  });

  it("사람 수는 마지막 프레임의 사람 감지 수, 맞추기 전이면 사람 방은 모름(눈의 방으로 대신하지 않는다)", () => {
    const w = ws();
    w.setEye({ position: [1, 2], height_m: 1.2, yaw_deg: 0, pitch_deg: -10 }, 0);
    w.applyDetections(frame(1), [person, det("person", [200, 10, 100, 300])]);
    const r = w.applyDetections(frame(2), [person, det("person", [200, 10, 100, 300])]);
    expect(r.changes.map((c) => [c.kind, c.text])).toEqual([["person_appeared", "사람 보임"]]);
    expect(w.view(2000).person).toMatchObject({ visible: true, count: 2, room: null, position: null });
  });

  it("맞춘 뒤 발이 보이면 바닥 자리와 그 방, 가까운 가전. 상자 아래가 프레임 끝이면 발이 잘려 자리를 바꾸지 않는다", () => {
    const w = new WorldState({ evidenceStepMs: 1000, surfaces: () => [], floorAt: () => 0, roomAt: () => ({ id: "living", label: "거실" }), devices, locate: (id) => (id === "fridge_1" ? [1.5, 0.5] : null) });
    const at = (i: number, box: Detection["box"]) => w.applyDetections({ ...frame(i), view: look }, [det("person", box)]);
    at(1, [200, 0, 80, 180]);
    const r = at(2, [200, 0, 80, 180]);
    expect(r.changes.map((c) => c.text)).toEqual(["사람 보임", "사람 거실에 있음"]);
    const v = w.view(2000);
    expect(v.person).toMatchObject({ room: "living", room_label: "거실", position_ms: 2000, near: ["fridge_1"] });
    expect(v.person.position![0]).toBeCloseTo(1.5, 1);
    at(3, [200, 100, 80, 260]); // 아래가 프레임 끝(360)
    expect(w.view(3000).person.position_ms).toBe(2000);
    expect(w.view(9000).person.near).toEqual([]); // 발 자리가 오래됨
    const outside = new WorldState({ evidenceStepMs: 1000, surfaces: () => [], floorAt: () => 0, roomAt: (p) => (p[0] < 1 ? { id: "living", label: "거실" } : null), devices });
    outside.applyDetections({ ...frame(1), view: look }, [det("person", [200, 0, 80, 300])]); // 발 자리 x≈0.6
    outside.applyDetections({ ...frame(2), view: look }, [det("person", [200, 0, 80, 300])]);
    expect(outside.view(2000).person.room).toBe("living");
    outside.applyDetections({ ...frame(3), view: look }, [det("person", [200, 0, 80, 180])]); // 발 자리 x≈1.5, 집 안 방이 아님
    expect(outside.view(3000).person).toMatchObject({ room: null, position_ms: 3000 });
  });

  it("가전: 상태 키, 사건 줄(세탁 끝남·에어컨 켜짐), 냉장고 문이 1분 넘게 열리면 한 번", () => {
    const w = ws();
    expect(w.applyDevice({ id: "washer_1", online: true, twin: { running: true, door: "closed" }, matter: {}, updatedAt: "" }, 0).map((c) => c.text)).toEqual(["후면 발코니 세탁기 작동 중 · 문 닫힘"]);
    const done = w.applyDevice({ id: "washer_1", online: true, twin: { running: false, door: "closed" }, matter: {}, updatedAt: "" }, 60_000);
    expect(done).toEqual([expect.objectContaining({ kind: "device", subject: "washer_1", text: "후면 발코니 세탁기 세탁 멈춤", meaningful: true })]);
    expect(w.view(60_000).devices.find((d) => d.id === "washer_1")).toMatchObject({ state: ["stopped", "door_closed"], status: "멈춤 · 문 닫힘", active: false, event_ms: 60_000 });
    w.applyDevice({ id: "ac_1", online: true, twin: { power: "off" }, matter: {}, updatedAt: "" }, 0);
    expect(w.applyDevice({ id: "ac_1", online: true, twin: { power: "on" }, matter: {}, updatedAt: "" }, 1000).map((c) => c.text)).toEqual(["거실 에어컨 켜짐"]);
    w.applyDevice({ id: "fridge_1", online: true, twin: { door: "closed" }, matter: {}, updatedAt: "" }, 0);
    expect(w.applyDevice({ id: "fridge_1", online: true, twin: { door: "open" }, matter: {}, updatedAt: "" }, 10_000).map((c) => c.text)).toEqual(["주방 냉장고 문 열림"]);
    expect(w.tick(69_000)).toEqual([]);
    expect(w.tick(70_000)).toEqual([expect.objectContaining({ kind: "device", subject: "fridge_1", text: "주방 냉장고 문이 1분 넘게 열림", meaningful: true })]);
    expect(w.tick(90_000)).toEqual([]);
    // 신호가 끊기면 오래 이어진 상태도 없다
    w.applyDevice({ id: "fridge_1", online: true, twin: { door: "closed" }, matter: {}, updatedAt: "" }, 100_000);
    w.applyDevice({ id: "fridge_1", online: true, twin: { door: "open" }, matter: {}, updatedAt: "" }, 110_000);
    w.applyDevice({ id: "fridge_1", online: false, twin: {}, matter: {}, updatedAt: "", signal: "none" }, 120_000);
    expect(w.tick(200_000)).toEqual([]);
    // 신호가 같은 값(문 열림)으로 돌아오면 그때부터 다시 센다
    w.applyDevice({ id: "fridge_1", online: true, twin: { door: "open" }, matter: {}, updatedAt: "" }, 210_000);
    expect(w.tick(260_000)).toEqual([]);
    expect(w.tick(270_000).map((c) => c.text)).toEqual(["주방 냉장고 문이 1분 넘게 열림"]);
  });

  it("관절로 든 물건은 확인 전이어도 사람 든 물건 id에 들어, 책을 들면 컵을 든 것이 아니다", () => {
    const w = ws();
    const bookBox = det("book", [220, 160, 40, 20]);
    w.applyDetections(frame(1), [person, bookBox], [standing({ 10: [230, 170, 0.9] })]);
    const v = w.applyDetections(frame(2), [person, bookBox], [standing({ 10: [230, 170, 0.9] })]) && w.view(2000);
    expect(v.objects).toEqual([]); // 책은 아직 확인 전
    expect(v.person).toMatchObject({ holding: ["book_1"], facts: { holding: expect.objectContaining({ value: "holding_object" }) } });
    expect(holdsTarget(v, "cup")).toBe(false);
  });
});
