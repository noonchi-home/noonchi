import { describe, expect, it } from "vitest";
import type { Detection } from "../src/brain/detector.js";
import { CLOSER_HOLD_MS, WorldState, type CloserPass } from "../src/world/state.js";
import type { DetLabel } from "../src/world/vocab.js";
import { AWAY_VIEW, engineFrame, LOOK_SIZE, LOOK_VIEW } from "./helpers/camera.js";

// 바닥만 있는 집. 잘라 본 상자 R = [120, 90, 240, 180](엔진 프레임 픽셀), 그 안 컵 [230, 170, 20, 10]은 바닥 (1.5, 0, 0)이다.
const ws = () => new WorldState({ surfaces: () => [], floorAt: () => 0, roomAt: () => ({ id: "kitchen", label: "주방" }), devices: () => [] });
const det = (label: DetLabel, box: [number, number, number, number], score = 0.8): Detection => ({ label, score, cls: 0, box });
const cupIn = det("cup", [230, 170, 20, 10]);
const cupOut = det("cup", [60, 300, 40, 20]);
const person = det("person", [150, 20, 120, 330], 0.9);
const pass = (frameId: string, atMs: number, dets: (Detection & { edge?: boolean })[], view = LOOK_VIEW): CloserPass =>
  ({ frameId, capturedAtMs: atMs, view, ...LOOK_SIZE, dets: dets.map((d) => ({ ...d, edge: d.edge ?? false })) });
const full = (w: WorldState, id: string, atMs: number, dets: Detection[], view = LOOK_VIEW) => w.applyDetections(engineFrame(id, atMs, { view }), dets);
const obj = (w: WorldState, id: string, nowMs: number) => w.view(nowMs).objects.find((o) => o.id === id);

describe("가까이 보기 합치기(applyCloser)", () => {
  it("서로 다른 원본 프레임 세 장에서 같은 자리로 보인 컵만 확인된 컵 하나로 만든다. 두 장이나 같은 프레임 세 번이면 만들지 않는다", () => {
    const w = ws();
    expect(w.applyCloser([pass("e1", 1000, [cupIn]), pass("e2", 2000, [cupIn])])).toEqual({ changes: [], ids: new Map() });
    expect(w.applyCloser([pass("e2", 2000, [cupIn]), pass("e2", 2000, [cupIn]), pass("e2", 2000, [cupIn])]).changes).toEqual([]);
    expect(w.view(3000).objects).toEqual([]);
    const r = w.applyCloser([pass("e3", 3000, [cupIn]), pass("e1", 1000, [cupIn]), pass("e2", 2000, [cupIn])]);
    expect(r.changes).toEqual([expect.objectContaining({ kind: "appeared", subject: "cup_1", meaningful: true, at_ms: 3000 })]);
    expect(r.ids).toEqual(new Map([["d1", "cup_1"]]));   // 가장 새 원본 프레임(e3)의 감지 번호
    const cup = obj(w, "cup_1", 3000)!;
    expect(cup).toMatchObject({ status: "present", first_seen_ms: 1000, last_seen_ms: 3000, closer_hold: true });
    expect(cup.position![0]).toBeCloseTo(1.5, 2);
  });

  it("사람 감지와 잘라 본 경계에 닿은 상자는 쓰지 않는다: 사람 보임·수·자리는 그대로다", () => {
    const w = ws();
    for (let i = 1; i <= 2; i++) full(w, `e${i}`, i * 1000, [person]);
    const before = w.view(2000).person;
    expect(before).toMatchObject({ visible: true, count: 1 });
    const edgeCup = { ...cupIn, edge: true };
    const r = w.applyCloser([3, 4, 5].map((i) => pass(`e${i}`, i * 1000, [det("person", [200, 100, 60, 160], 0.9), det("person", [130, 100, 60, 160], 0.9), edgeCup])));
    expect(r).toEqual({ changes: [], ids: new Map() });
    expect(w.view(5000).objects).toEqual([]);
    expect(w.view(5000).person).toMatchObject({ visible: true, count: 1, position: before.position, last_seen_ms: 2000 });
  });

  it("맞는 물건은 그 물건의 마지막 촬영보다 새 촬영일 때만 자리·본 시각·상태를 고친다. 옛 촬영은 아무것도 바꾸지 않는다", () => {
    const w = ws();
    for (let i = 1; i <= 3; i++) full(w, `e${i}`, i * 1000, [cupIn]);
    for (let i = 4; i <= 5; i++) full(w, `e${i}`, i * 1000, [], AWAY_VIEW);
    expect(obj(w, "cup_1", 5000)).toMatchObject({ status: "out_of_view", last_seen_ms: 3000 });
    const old = w.applyCloser([pass("e1", 1000, [det("cup", [236, 170, 20, 10])])]);
    expect(old.changes).toEqual([]);
    expect(obj(w, "cup_1", 5000)).toMatchObject({ status: "out_of_view", last_seen_ms: 3000, closer_hold: false });
    const moved = det("cup", [236, 172, 20, 10]);
    const r = w.applyCloser([pass("e6", 6000, [moved])]);
    expect(r.changes).toEqual([expect.objectContaining({ kind: "back_in_view", subject: "cup_1" })]);
    expect(r.ids.get("d1")).toBe("cup_1");
    const cup = obj(w, "cup_1", 6000)!;
    expect(cup).toMatchObject({ status: "present", last_seen_ms: 6000, last_in_view_ms: 6000, closer_hold: true });
    expect(cup.position![2]).not.toBeCloseTo(0, 3);   // 새 촬영의 자리로 옮겼다
  });

  it("사라진 물건도 같은 자리에 새 촬영으로 보이면 다시 있음(등장)이 되고, 전체 사진이 다시 사라짐을 셀 수 있다", () => {
    const w = ws();
    for (let i = 1; i <= 3; i++) full(w, `e${i}`, i * 1000, [cupIn]);
    for (let i = 4; i <= 6; i++) full(w, `e${i}`, i * 1000, []);
    expect(obj(w, "cup_1", 6000)!.status).toBe("gone");
    const r = w.applyCloser([pass("e7", 7000, [cupIn])]);
    expect(r.changes).toEqual([expect.objectContaining({ kind: "appeared", subject: "cup_1" })]);
    expect(obj(w, "cup_1", 7000)!.status).toBe("present");
    full(w, "e8", 8000, [cupIn]);   // 다시 등장 셈을 하지 않는다
    expect(w.view(8000).objects.map((o) => o.id)).toEqual(["cup_1"]);
  });

  it("보이지 않은 물건과 세는 중인 물건은 그대로 둔다", () => {
    const w = ws();
    for (let i = 1; i <= 3; i++) full(w, `e${i}`, i * 1000, [cupIn]);
    for (let i = 4; i <= 5; i++) full(w, `e${i}`, i * 1000, [cupIn, cupOut]);   // 상자 밖 컵 cup_2를 두 장 셈
    expect(w.applyCloser([6, 7, 8].map((i) => pass(`e${i}`, i * 1000, [])))).toEqual({ changes: [], ids: new Map() });
    expect(obj(w, "cup_1", 8000)!.status).toBe("present");
    expect(full(w, "e9", 9000, [cupIn, cupOut]).changes).toEqual([expect.objectContaining({ kind: "appeared", subject: "cup_2" })]);
  });

  it("가까이 보기로 찾은 물건은 30초 동안 전체 사진이 그 자리를 보면서 못 봐도 사라짐으로 세지 않는다. 30초 뒤에는 센다", () => {
    const w = ws();
    w.applyCloser([1, 2, 3].map((i) => pass(`e${i}`, i * 1000, [cupIn])));
    for (let i = 4; i <= 6; i++) expect(full(w, `e${i}`, i * 2000, []).changes).toEqual([]);
    expect(obj(w, "cup_1", 12_000)).toMatchObject({ status: "present", closer_hold: true });
    const after = 3000 + CLOSER_HOLD_MS;
    expect(obj(w, "cup_1", after)!.closer_hold).toBe(false);
    full(w, "e7", after + 1000, []);
    full(w, "e8", after + 3000, []);
    expect(full(w, "e9", after + 5000, []).changes).toEqual([expect.objectContaining({ kind: "gone", subject: "cup_1" })]);
  });

  it("같은 종류 새 물건이 다른 자리에 생기면(옮김) 지킴을 바로 풀어 옛 물건은 사라짐을 센다", () => {
    const w = ws();
    w.applyCloser([1, 2, 3].map((i) => pass(`e${i}`, i * 1000, [cupIn])));
    full(w, "e4", 4000, [cupOut]);
    full(w, "e5", 5000, [cupOut]);
    expect(obj(w, "cup_1", 5000)!.closer_hold).toBe(true);
    expect(full(w, "e6", 6000, [cupOut]).changes).toEqual([expect.objectContaining({ kind: "appeared", subject: "cup_2" })]);
    expect(obj(w, "cup_1", 6000)).toMatchObject({ status: "present", closer_hold: false });
    full(w, "e7", 7000, [cupOut]);
    full(w, "e8", 8000, [cupOut]);
    expect(full(w, "e9", 9000, [cupOut]).changes).toEqual([expect.objectContaining({ kind: "gone", subject: "cup_1" })]);
  });
});

describe("가까이 본 사진의 VLM 답(applyCloserScene)", () => {
  const seeded = () => {
    const w = ws();
    let ids = new Map<string, string>();
    for (let i = 1; i <= 3; i++) ids = full(w, `e${i}`, i * 1000, [cupIn, person]).ids;
    w.applyScene("e3", 3000, { scene: "kitchen", observations: [{ object_id: "d1", state: "in_use" }, { object_id: "d2", state: "standing" }], summary: "s1" }, ids);
    return w;
  };

  it("그 사진에서 잡은 물건 id의 사실만 넣고, 장면 요약·답에 없는 면·지금만 맞는 사실은 그대로 둔다", () => {
    const w = seeded();
    const changes = w.applyCloserScene("e3", 3000, { scene: "k", observations: [{ object_id: "d1", state: "in_sink" }, { object_id: "d1", state: "empty" }, { object_id: "d2", state: "sitting" }], summary: "s2" },
      new Map([["d1", "cup_1"]]));
    expect(changes.map((c) => [c.kind, c.text])).toEqual([["state", "컵 cup_1 싱크대 안"], ["state", "컵 cup_1 비어 있음"]]);
    const v = w.view(3000);
    expect(v.objects[0]!.facts).toMatchObject({ place: { value: "in_sink" }, contents: { value: "empty" }, use: { value: "in_use" } });
    expect(v.person.facts.posture).toMatchObject({ value: "standing" });
    // 요약이 그대로 s1이라 같은 요약은 변화가 아니다
    expect(w.applyScene("e4", 4000, { scene: "k", observations: [], summary: "s1" }, new Map()).filter((c) => c.kind === "vlm")).toEqual([]);
  });

  it("같은 원본 프레임에서 나온 답은 한 번만 넣고, 같은 촬영의 같은 값으로 확신을 올리지 않는다", () => {
    const w = seeded();
    const ids = new Map([["d1", "cup_1"]]);
    w.applyScene("e3", 3000, { scene: "k", observations: [{ object_id: "d1", state: "empty" }, { object_id: "d1", state: "in_use" }], summary: "s1" }, new Map([["d1", "cup_1"]]));
    expect(w.applyCloserScene("e3", 3000, { scene: "k", observations: [{ object_id: "d1", state: "empty" }, { object_id: "d1", state: "in_sink" }], summary: "x" }, ids)).toHaveLength(1);
    expect(w.applyCloserScene("e3", 3000, { scene: "k", observations: [{ object_id: "d1", state: "in_sink" }, { object_id: "d1", state: "has_contents" }], summary: "x" }, ids)).toEqual([]);
    expect(w.view(3000).objects[0]!.facts).toMatchObject({ contents: { value: "empty", certainty: "inferred" }, place: { value: "in_sink", certainty: "inferred" } });
    w.applyCloserScene("e5", 5000, { scene: "k", observations: [{ object_id: "d1", state: "in_sink" }], summary: "x" }, ids);
    expect(w.view(5000).objects[0]!.facts.place).toMatchObject({ value: "in_sink", certainty: "confirmed" });
  });
});
