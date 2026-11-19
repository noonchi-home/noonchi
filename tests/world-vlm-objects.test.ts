// World State 물건은 장면 VLM 답(objects)으로만 생기고·확정되고·사라진다(사용자 결정 2026-11-18). YOLO 물건 감지는 미니맵·폰 위치 맞추기·쓰러짐에만 쓴다.
// 가로 키 큰 컵 r4·r5, 머그 r7·r8: 폰이 걷는 동안 YOLO 감지 투영이 후면 발코니·자리 모름 유령 컵을 만들고, 한 컵이 2~3 id로 갈라져 계획 대상이 사라졌다.
import { describe, expect, it } from "vitest";
import type { Detection, EngineFrame, SceneObservation } from "../src/contract/observe.js";
import { WorldState } from "../src/world/state/world.js";
import type { DetLabel } from "../src/world/vocab.js";
import { AWAY_VIEW, engineFrame, LOOK_SIZE, LOOK_VIEW } from "./helpers/camera.js";
import { det as mkDet } from "./helpers/detectors.js";

// 바닥만 있는 집. 컵 [230, 170, 20, 10](엔진 프레임 픽셀)은 바닥 (1.5, 0, 0)이다
const ws = () => new WorldState({ evidenceStepMs: 1000, surfaces: () => [], floorAt: () => 0, roomAt: () => ({ id: "kitchen", label: "주방" }), devices: () => [] });
const det = (label: DetLabel, box: [number, number, number, number], score = 0.8): Detection => mkDet(label, score, box, 0);
const CUP: [number, number, number, number] = [230, 170, 20, 10];
const frac = (b: [number, number, number, number]) => ({ x: b[0] / 480, y: b[1] / 360, w: b[2] / 480, h: b[3] / 360 });
const EYE: [number, number] = [0, 0];
const look = { view: LOOK_VIEW, ...LOOK_SIZE, eye: EYE };
const cupScene = (box: [number, number, number, number] = CUP, det: string | null = null): SceneObservation => ({
  scene: "k", summary: "s", objects: [{ id: "v1", cls: "cup", box: frac(box), det }], observations: [],
});
const none: SceneObservation = { scene: "k", summary: "s", objects: [], observations: [] };
const frame = (id: string, at: number, view = LOOK_VIEW): EngineFrame => ({ ...engineFrame(id, at, { view, jpeg: Buffer.from(id) }), eye: { position: EYE, height_m: 1.5, yaw_deg: 0, pitch_deg: 0 } as never });
const objs = (w: WorldState, at: number) => w.view(at).objects.map((o) => [o.id, o.status]);
/** VLM 사진 두 장으로 컵 하나를 확정한다(1초·2초 촬영). */
const confirmed = () => {
  const w = ws();
  w.applyScene("e1", 1000, cupScene(), new Map(), look);
  w.applyScene("e2", 2000, cupScene(), new Map(), look);
  expect(objs(w, 2000)).toEqual([["cup_1", "present"]]);
  return w;
};

describe("물건은 장면 VLM 답으로만", () => {
  it("YOLO 물건 감지만으로는 물건이 생기지 않는다(카메라가 있어도 없어도, 100ms 프레임 3초)", () => {
    for (const view of [LOOK_VIEW, null]) {
      const w = ws();
      for (let t = 0; t <= 3000; t += 100) w.applyDetections({ ...frame(`e${t}`, t), view }, [det("cup", CUP)]);
      expect(w.view(3000).objects).toEqual([]);
    }
  });

  it("확정된 컵을 YOLO가 계속 봐도 시야 안 VLM 사진 3장이 그 컵을 빼고 답하면 사라짐이다. 2장이면 그대로다", () => {
    const w = confirmed();
    for (const [i, t] of [3000, 4000].entries()) {
      w.applyDetections(frame(`e${3 + i}`, t), [det("cup", CUP)]);
      w.applyScene(`e${3 + i}`, t, none, new Map(), look);
    }
    expect(objs(w, 4000)).toEqual([["cup_1", "present"]]);
    w.applyDetections(frame("e5", 5000), [det("cup", CUP)]);
    const changes = w.applyScene("e5", 5000, none, new Map(), look);
    expect(changes).toContainEqual(expect.objectContaining({ kind: "gone", subject: "cup_1", at_ms: 5000 }));
    expect(objs(w, 5000)).toEqual([["cup_1", "gone"]]);
  });

  it("같은 원본 프레임의 두 답은 한 장이다. 시야 밖 VLM 사진은 세지 않고 시야 밖으로 둔다", () => {
    const w = confirmed();
    w.applyScene("e3", 3000, none, new Map(), look);
    w.applyScene("e3", 3000, none, new Map(), look);
    for (const [i, t] of [4000, 5000, 6000].entries()) w.applyScene(`e${4 + i}`, t, none, new Map(), { ...look, view: AWAY_VIEW });
    expect(objs(w, 6000)).toEqual([["cup_1", "out_of_view"]]);
    w.applyScene("e7", 7000, none, new Map(), look);
    expect(objs(w, 7000)).toEqual([["cup_1", "present"]]);
    w.applyScene("e8", 8000, none, new Map(), look);
    expect(objs(w, 8000)).toEqual([["cup_1", "gone"]]);
  });

  it("늦게 온 옛 VLM 사진이 그 컵을 봤으면 그 뒤 못 본 사진이 3장이 안 되어 사라짐을 거둔다", () => {
    const w = confirmed();
    for (const t of [4000, 6000, 8000]) w.applyScene(`e${t}`, t, none, new Map(), look);
    expect(objs(w, 8000)).toEqual([["cup_1", "gone"]]);
    w.applyScene("e5000", 5000, cupScene(), new Map(), look);
    expect(objs(w, 8000)).toEqual([["cup_1", "present"]]);
  });

  it("VLM 물건이 같은 사진 YOLO 감지(det)와 이어지면 자리는 그 감지의 바닥 점이다(VLM 상자가 어긋나도)", () => {
    const w = ws();
    const dets = [{ id: "d1", box: CUP, foot: [240, 180] as [number, number] }];
    // VLM 상자는 오른쪽으로 크게 어긋났다
    const off: [number, number, number, number] = [330, 120, 20, 10];
    w.applyScene("e1", 1000, cupScene(off, "d1"), new Map(), { ...look, dets });
    w.applyScene("e2", 2000, cupScene(off, "d1"), new Map(), { ...look, dets });
    const cup = w.view(2000).objects[0]!;
    expect(cup.id).toBe("cup_1");
    expect(cup.position![0]).toBeCloseTo(1.5, 1);
    expect(Math.abs(cup.position![2])).toBeLessThan(0.05);
  });

  it("손에 있음·가까이 보기 지킴·실행 추적 대상인 물건은 VLM 목록에 없어도 사라짐을 세지 않는다", () => {
    const w = confirmed();
    w.focus("cup_1", { step: "pick", spot: [1.5, 0] });
    for (const t of [3000, 4000, 5000, 6000]) w.applyScene(`e${t}`, t, none, new Map(), look);
    expect(objs(w, 6000)).toEqual([["cup_1", "present"]]);
    w.focus(null);
    for (const t of [7000, 8000, 9000]) w.applyScene(`e${t}`, t, none, new Map(), look);
    expect(objs(w, 9000)).toEqual([["cup_1", "gone"]]);
  });

  it("맞추기 전(카메라 없음): VLM 사진 2장이 컵을 답하면 자리 없이 확정하고, 3장 이어 빼고 답하면 사라짐이다", () => {
    const w = ws();
    w.applyScene("e1", 1000, cupScene(), new Map(), undefined);
    expect(w.view(1000).objects).toEqual([]);
    w.applyScene("e2", 2000, cupScene(), new Map(), undefined);
    expect(w.view(2000).objects.map((o) => [o.id, o.status, o.position])).toEqual([["cup_1", "present", null]]);
    for (const t of [3000, 4000, 5000]) w.applyScene(`e${t}`, t, none, new Map(), undefined);
    expect(objs(w, 5000)).toEqual([["cup_1", "gone"]]);
  });

  it("확정 전 VLM 후보는 5초 넘게 다시 안 보이면 잊고 그 자리를 후보 자리로 남긴다", () => {
    const w = ws();
    w.applyScene("e1", 1000, cupScene(), new Map(), look);
    w.applyScene("e7", 7000, none, new Map(), look);
    w.applyScene("e8", 8000, cupScene(), new Map(), look);
    // 잊은 뒤 다시 본 한 장은 새 후보다(확정 아님)
    expect(w.view(8000).objects).toEqual([]);
    expect(w.view(8000).sightings?.map((s) => s.cls)).toEqual(["cup"]);
  });

  it("YOLO 감지가 있는 프레임의 VLM 답은 감지 번호(d1)를 그 물건 id로 잇는다(그 번호의 사실을 넣는다)", () => {
    const w = confirmed();
    const { ids } = w.applyDetections(frame("e3", 3000), [det("cup", CUP)]);
    const scene: SceneObservation = { ...cupScene(CUP, "d1"), observations: [{ object_id: "d1", state: "empty" }] };
    w.applyScene("e3", 3000, scene, ids, { ...look, dets: [{ id: "d1", box: CUP, foot: [240, 180] }] });
    expect(ids.get("d1")).toBe("cup_1");
    expect(w.view(3000).objects[0]!.facts.contents?.value).toBe("empty");
  });

  // 가로 유리컵 v1(2026-11-18 08:30): VLM이 한 잔을 거의 같은 상자 둘(v1·v2)로 답해 cup_3이 따로 생겼다
  it("한 답 안에서 같은 무리 상자가 크게 겹치면(IoU 0.5 이상) 한 물건이다: 두 사진이 같은 잔을 두 상자로 답해도 id 하나", () => {
    const w = ws();
    const twice: SceneObservation = { scene: "k", summary: "s", observations: [{ object_id: "v2", state: "empty" }],
      objects: [{ id: "v1", cls: "cup", box: frac(CUP), det: null }, { id: "v2", cls: "cup", box: frac([231, 169, 20, 11]), det: null }] };
    const ids = new Map<string, string>();
    w.applyScene("e1", 1000, twice, ids, look);
    w.applyScene("e2", 2000, twice, ids, look);
    expect(objs(w, 2000)).toEqual([["cup_1", "present"]]);
    expect(ids.get("v2")).toBe("cup_1");
    expect(w.view(2000).objects[0]!.facts.contents?.value).toBe("empty");
  });

  it("상자가 겹쳐도 서로 다른 YOLO 감지와 이은 두 물건(det)은 두 물건이다", () => {
    const w = ws();
    const two: SceneObservation = { scene: "k", summary: "s", observations: [],
      objects: [{ id: "v1", cls: "cup", box: frac(CUP), det: "d1" }, { id: "v2", cls: "bottle", box: frac(CUP), det: "d2" }] };
    w.applyScene("e1", 1000, two, new Map(), undefined);
    w.applyScene("e2", 2000, two, new Map(), undefined);
    expect(w.view(2000).objects.map((o) => o.id)).toEqual(["cup_1", "bottle_1"]);
  });

  it("사진 끝에 닿은 상자(아랫변이 놓인 자리가 아님)로는 새 물건을 만들지 않는다", () => {
    const w = ws();
    for (const [id, at] of [["e1", 1000], ["e2", 2000]] as const) w.applyScene(id, at, cupScene([230, 300, 20, 60]), new Map(), look);
    expect(w.view(2000).objects).toEqual([]);
  });

  // Codex P2(41e1181): 거리 제한 없는 후보 잇기가 서로 먼 곳에 한 장씩 나온 상자 둘을 한 물건의 2장으로 확정했다
  it("확정 전 후보는 0.5m 안에서만 잇는다: 먼 곳에 한 장씩 나온 같은 무리 상자 둘은 확정하지 않는다", () => {
    const w = ws();
    w.applyScene("e1", 1000, cupScene(), new Map(), look);
    w.applyScene("e2", 2000, cupScene([300, 150, 20, 10]), new Map(), look);   // 0.5m 넘게 떨어진 투영
    expect(w.view(2000).objects).toEqual([]);
    w.applyScene("e3", 3000, cupScene([232, 170, 20, 10]), new Map(), look);   // 첫 상자 옆
    expect(objs(w, 3000)).toEqual([["cup_1", "present"]]);
  });
});

// 가로 키 큰 컵 r5·유리컵 v1: 가까이 본 VLM 상자가 잘라 본 칸을 거의 채워 바닥 점이 엉뚱한 자리로 가 새 컵이 생겼고, 가까이 본 「선반 위」가 식탁 위 컵에 그대로 들어갔다
describe("가까이 본 VLM 물건", () => {
  const crop: [number, number, number, number] = [120, 90, 240, 180];
  const closerLook = { view: LOOK_VIEW, ...LOOK_SIZE, crop };
  it("잘라 본 칸 안에 비치는 같은 무리 확인 물건이 하나뿐이면 상자 투영이 어긋나도 그 물건이다(새 id를 만들지 않는다)", () => {
    const w = confirmed();
    const r = w.applyCloser([{ frameId: "e3", capturedAtMs: 3000, view: LOOK_VIEW, ...LOOK_SIZE, dets: [] }]);
    // 칸을 거의 채운 상자: 바닥 점이 칸 아래 끝이다
    const tall: SceneObservation = { scene: "k", summary: "s", observations: [], objects: [{ id: "v1", cls: "cup", box: { x: 0.4, y: 0.02, w: 0.2, h: 0.96 }, det: null }] };
    w.applyCloserScene("e3", 3000, tall, r.ids, r.pending, closerLook);
    expect(objs(w, 3000)).toEqual([["cup_1", "present"]]);
    expect(r.ids.get("v1")).toBe("cup_1");
  });

  it("가까이 본 놓인 곳 답도 트윈 면으로 정한다: 식탁 면 위 컵을 「선반 위」라 해도 식탁 위다", () => {
    const table = { id: "table_1", label: "식탁", kind: "table" as const, center: [1.5, 0] as [number, number], top: 0, radius: 0.7, rect: { center: [1.5, 0] as [number, number], size: [1, 1] as [number, number], facing_deg: 0 } };
    const w = new WorldState({ evidenceStepMs: 1000, surfaces: () => [table], floorAt: () => 0, roomAt: () => null, devices: () => [] });
    w.applyScene("e1", 1000, cupScene(), new Map(), look);
    w.applyScene("e2", 2000, cupScene(), new Map(), look);
    expect(w.view(2000).objects[0]).toMatchObject({ surface: "table_1" });
    const r = w.applyCloser([{ frameId: "e3", capturedAtMs: 3000, view: LOOK_VIEW, ...LOOK_SIZE, dets: [] }]);
    const shelf: SceneObservation = { scene: "k", summary: "s", observations: [{ object_id: "v1", state: "on_shelf" }], objects: [{ id: "v1", cls: "cup", box: { x: 110 / 240, y: 80 / 180, w: 20 / 240, h: 10 / 180 }, det: null }] };
    w.applyCloserScene("e3", 3000, shelf, r.ids, r.pending, closerLook);
    expect(w.view(3000).objects[0]!.facts.place?.value).toBe("on_table");
  });
});

// 가로 키 큰 컵 r5·v1(2026-11-18): VLM 상자 아랫변이 식탁 먼 끝을 조금 넘으면 광선이 식탁을 지나쳐 몇 m 뒤 바닥(후면 발코니)에 닿았다.
// 상자 높이 오차(사진 높이의 몇 %)에 자리가 수 m 흔들리는 바닥 자리는 믿지 않는다
describe("VLM 상자 바닥 점 자리", () => {
  // 식탁: 카메라 앞 x 0.5~1.0, 폭 1m, 윗면 0.75(가운데 광선이 식탁 가운데 (0.75, 0.75, 0)에 닿는다)
  const table = { id: "table_1", label: "식탁", kind: "table" as const, center: [0.75, 0] as [number, number], top: 0.75, radius: 0.56, rect: { center: [0.75, 0] as [number, number], size: [1, 0.5] as [number, number], facing_deg: 0 } };
  const tw = () => new WorldState({ evidenceStepMs: 1000, surfaces: () => [table], floorAt: () => 0, roomAt: () => null, devices: () => [] });
  /** 아랫변 가운데가 (240, bottom)인 VLM 컵 상자(높이 30px). */
  const footAt = (bottom: number) => cupScene([230, bottom - 30, 20, 30]);

  it("아랫변이 식탁 먼 끝을 조금 넘어 광선이 바닥에 닿아도, 사진 높이 4% 안에서 식탁에 닿으면 식탁 위 자리다", () => {
    const w = tw();
    w.applyScene("e1", 1000, footAt(152.5), new Map(), look);
    w.applyScene("e2", 2000, footAt(152.5), new Map(), look);
    const cup = w.view(2000).objects[0]!;
    expect(cup).toMatchObject({ surface: "table_1" });
    expect(cup.position![0]).toBeLessThanOrEqual(1.0);
    expect(cup.position![1]).toBeCloseTo(0.75, 3);
  });

  it("카메라에서 3m 넘는 바닥 자리(트윈 면 위가 아님)로는 VLM 상자만으로 새 물건을 만들지 않는다(창 너머 발코니 장식·걷는 중 어긋난 카메라)", () => {
    const w = tw();
    for (const [id, at] of [["e1", 1000], ["e2", 2000], ["e3", 3000]] as const) w.applyScene(id, at, footAt(108), new Map(), look);
    expect(w.view(3000).objects).toEqual([]);
  });

  it("상자 높이 오차 3%에 0.5m 넘게 흔들리는 먼 바닥 자리로는 새 물건을 만들지 않는다(그 자리로 옮기지도 않는다)", () => {
    const w = tw();
    for (const [id, at] of [["e1", 1000], ["e2", 2000], ["e3", 3000]] as const) w.applyScene(id, at, footAt(60), new Map(), look);
    expect(w.view(3000).objects).toEqual([]);
    const v = tw();
    v.applyScene("e1", 1000, footAt(180), new Map(), look);
    v.applyScene("e2", 2000, footAt(180), new Map(), look);
    const before = v.view(2000).objects[0]!.position;
    for (const [id, at] of [["e3", 3000], ["e4", 4000]] as const) v.applyScene(id, at, footAt(60), new Map(), look);
    expect(v.view(4000).objects.map((o) => [o.id, o.status, o.position])).toEqual([["cup_1", "present", before]]);
  });

  // 가로 키 큰 컵 r5: 식탁 끝 가까이(사각형 안, 끝에서 0.15m 안) 컵을 VLM이 「선반 위」로 답해 그대로 남았다. 트윈에 선반 면은 없다
  it("트윈 면 사각형 안에 놓인 물건을 VLM이 트윈에 없는 면(선반 위)으로 답하면 끝 가까이여도 그 면의 놓인 곳이다", () => {
    const w = tw();
    const shelf = (id: string, at: number) => w.applyScene(id, at, { ...footAt(159.5), observations: [{ object_id: "v1", state: "on_shelf" }] }, new Map(), look);
    shelf("e1", 1000);
    shelf("e2", 2000);
    shelf("e3", 3000);
    const cup = w.view(3000).objects[0]!;
    expect(cup).toMatchObject({ surface: "table_1" });
    expect(cup.position![0]).toBeGreaterThan(0.85);
    expect(cup.facts.place?.value).toBe("on_table");
  });
});

// 찾기가 겨눈 자리에서 다른 id의 같은 무리 물건을 찾으면 계획 대상 id로 잇는다(src/act/robot/find.ts)
describe("계획 대상으로 잇기(relink)", () => {
  it("그 물건의 자리·보임·사실을 대상 id가 받고, 그 물건은 사라짐과 옮김 표시(followed_by: 대상)를 남긴다. 같은 무리가 아니거나 없으면 잇지 않는다", () => {
    const w = confirmed();
    w.applyScene("e3", 3000, none, new Map(), { ...look, view: AWAY_VIEW });
    // 다른 자리에 같은 무리 병(bottle_1)이 확정된다
    const bottle: SceneObservation = { scene: "k", summary: "s", observations: [{ object_id: "v1", state: "empty" }], objects: [{ id: "v1", cls: "bottle", box: frac([300, 150, 20, 10]), det: null }] };
    w.applyScene("e4", 4000, bottle, new Map(), { ...look, view: AWAY_VIEW });
    w.applyScene("e5", 5000, bottle, new Map(), { ...look, view: AWAY_VIEW });
    const b = w.view(5000).objects.find((o) => o.id === "bottle_1")!;
    expect(w.relink("bottle_1", "cup_1", 5000)).toBe(true);
    const v = w.view(5000).objects;
    expect(v.find((o) => o.id === "cup_1")).toMatchObject({ status: "present", position: b.position, last_seen_ms: 5000, facts: { contents: { value: "empty" } } });
    expect(v.find((o) => o.id === "bottle_1")).toMatchObject({ status: "gone", followed_by: "cup_1" });
    expect(w.relink("cup_9", "cup_1", 5000)).toBe(false);
  });

  /** 확인된 cup_1에 「비어 있음」 확인(3·5·8초)을 두고, 다른 자리에 내용물 있음으로 본 병 bottle_1(9·10초)을 확정한 뒤 bottle_1 → cup_1로 잇는다. */
  const linked = () => {
    const w = confirmed();
    for (const t of [3000, 5000, 8000]) w.applyScene(`e${t}`, t, { ...cupScene(), observations: [{ object_id: "v1", state: "empty" }] }, new Map(), look);
    expect(w.view(8000).objects[0]?.facts.contents).toMatchObject({ value: "empty", certainty: "confirmed" });
    const bottle: SceneObservation = { scene: "k", summary: "s", observations: [{ object_id: "v1", state: "has_contents" }], objects: [{ id: "v1", cls: "bottle", box: frac([300, 150, 20, 10]), det: null }] };
    for (const t of [9000, 10000]) w.applyScene(`e${t}`, t, bottle, new Map(), { ...look, view: AWAY_VIEW });
    expect(w.relink("bottle_1", "cup_1", 10000)).toBe(true);
    return { w, bottle };
  };

  // Codex P2(5f230c5): 잇기가 내용물 사실만 옮기고 대상의 내용물 갱신기 상태(옛 「비어 있음·확인됨」)를 남겨, 다음 답에서 옛 값이 되살아났다
  it("대상의 옛 내용물 확인 값은 잇기 뒤 되살아나지 않는다: 내용물 갱신기 상태도 그 물건 것으로 옮긴다", () => {
    const { w } = linked();
    w.applyScene("e11", 11000, { scene: "k", summary: "s", objects: [], observations: [{ object_id: "d1", state: "has_contents" }] }, new Map([["d1", "cup_1"]]), { ...look, view: AWAY_VIEW });
    expect(w.view(11000).objects.find((o) => o.id === "cup_1")?.facts.contents?.value).toBe("has_contents");
  });

  // Codex P2(5f230c5): 합친 원본 bottle_1이 식별 후보에 남아, 다음 병 답이 같은 종류 먼저인 자리 잇기로 bottle_1을 되살려 다시 둘이 됐다
  it("합친 원본은 식별 후보에서 빠진다: 그 자리의 다음 병 답은 대상(cup_1)으로 이어진다", () => {
    const { w, bottle } = linked();
    const ids = new Map<string, string>();
    w.applyScene("e11", 11000, bottle, ids, { ...look, view: AWAY_VIEW });
    expect(ids.get("v1")).toBe("cup_1");
    expect(w.view(11000).objects.map((o) => [o.id, o.status])).toEqual([["cup_1", "present"], ["bottle_1", "gone"]]);
  });
});

// 머그 q2(2026-11-18 09:55): 한 머그를 VLM이 큰 상자와 그 안 작은 상자 둘로 답해(IoU 0.5 아래) cup_2 후보가 생겼고, 같은 사진의 가까이 보기가 그 후보를 확정했다.
// 그 뒤 cup_1이 사라짐이 돼 계획이 「찾은 뒤 다시 판단」으로 취소됐다
describe("머그 q2: 한 머그 두 상자", () => {
  it("한 답에서 작은 상자가 큰 상자 안에 거의 들면(작은 상자의 70% 이상) 한 물건이다", () => {
    const w = ws();
    const nested: SceneObservation = { scene: "k", summary: "s", observations: [],
      objects: [{ id: "v1", cls: "cup", box: { x: 0.45, y: 0.51, w: 0.14, h: 0.35 }, det: null }, { id: "v2", cls: "cup", box: { x: 0.49, y: 0.48, w: 0.1, h: 0.29 }, det: null }] };
    w.applyScene("e1", 1000, nested, new Map(), look);
    w.applyScene("e2", 2000, nested, new Map(), look);
    expect(w.view(2000).objects.map((o) => o.id)).toEqual(["cup_1"]);
  });

  it("가까이 보기는 확정 전 후보보다 그 자리의 확인된 물건을 먼저 잇는다(후보를 확정하지 않는다)", () => {
    const w = confirmed();
    // 확인된 cup_1 옆 0.3m에 후보 하나(같은 사진 한 장)
    w.applyScene("e3", 3000, { scene: "k", summary: "s", observations: [], objects: [{ id: "v1", cls: "cup", box: frac(CUP), det: null }, { id: "v2", cls: "cup", box: frac([258, 172, 20, 10]), det: null }] }, new Map(), look);
    const r = w.applyCloser([{ frameId: "e3", capturedAtMs: 3000, view: LOOK_VIEW, ...LOOK_SIZE, dets: [] }]);
    const sees: SceneObservation = { scene: "k", summary: "s", observations: [], objects: [{ id: "v1", cls: "cup", box: { x: (252 - 120) / 240, y: (170 - 90) / 180, w: 20 / 240, h: 10 / 180 }, det: null }] };
    w.applyCloserScene("e3", 3000, sees, r.ids, r.pending, { view: LOOK_VIEW, ...LOOK_SIZE, crop: [120, 90, 240, 180] });
    expect(w.view(3000).objects.map((o) => o.id)).toEqual(["cup_1"]);
    expect(r.ids.get("v1")).toBe("cup_1");
  });
});

// 키 큰 컵 q2: 싱크대 면 위 컵을 VLM이 「식탁 위」로 답해 「주방·식당 싱크대 · 식탁 위」였다
it("싱크대 면(싱크볼 밖) 위 물건을 VLM이 다른 가구 위(식탁·책상·선반)로 답하면 조리대 위다. 싱크볼 안은 싱크대 안", () => {
  const sink = { id: "sink_1", label: "싱크대", kind: "sink" as const, center: [1.5, 0] as [number, number], top: 0, radius: 1.2,
    rect: { center: [1.5, 0] as [number, number], size: [2, 1] as [number, number], facing_deg: 0 }, basin: { center: [1.5, 0.6] as [number, number], size: [0.6, 0.4] as [number, number], facing_deg: 0 } };
  const w = new WorldState({ evidenceStepMs: 1000, surfaces: () => [sink], floorAt: () => 0, roomAt: () => null, devices: () => [] });
  const said = (id: string, at: number, state: "on_table" | "on_floor") => w.applyScene(id, at, { ...cupScene(), observations: [{ object_id: "v1", state }] }, new Map(), look);
  said("e1", 1000, "on_table");
  said("e2", 2000, "on_table");
  expect(w.view(2000).objects[0]).toMatchObject({ surface: "sink_1", facts: { place: { value: "on_counter" } } });
});

// Codex P2(b8fe7bf): 컵을 들고 나가면 남은 「손에 있음」이 사라짐 셈을 계속 막아, 그 뒤 VLM 사진에 계속 안 보여도 컵과 「손에 있음」이 남았다
describe("손에 있음 보호", () => {
  const PERSON_BOX: [number, number, number, number] = [100, 50, 80, 250];
  /** 사람(YOLO, 0.5초마다)을 보며 VLM이 컵을 손에 있음으로 답한 뒤(2.5·3초), times마다 컵 없는 VLM 답. person이면 그 사이에도 사람을 본다. */
  const run = (times: number[], person: boolean) => {
    const w = confirmed();
    for (let t = 1500; t <= 3000; t += 500) w.applyDetections(frame(`p${t}`, t), [det("person", PERSON_BOX)]);
    // 놓인 곳은 두 장이 같아야 바뀐다(steady)
    for (const [id, t] of [["h1", 2500], ["h2", 3000]] as const) w.applyScene(id, t, { ...cupScene(), observations: [{ object_id: "v1", state: "in_hand" }] }, new Map(), look);
    expect(w.view(3000).objects[0]?.facts.place?.value).toBe("in_hand");
    let last = 3000;
    for (const t of times) {
      for (let p = last + 500; p <= t; p += 500) w.applyDetections(frame(`p${p}`, p), person ? [det("person", PERSON_BOX)] : []);
      w.applyScene(`n${t}`, t, none, new Map(), look);
      last = t;
    }
    return objs(w, last);
  };
  it("사람이 보이고 손에 있음이 새것(6초 안)이면 그 자리가 비어도 사라짐을 세지 않는다", () => {
    expect(run([4000, 5000, 6000], true)).toEqual([["cup_1", "present"]]);
  });
  it("손에 있음이 6초 넘게 새로 오지 않으면 보호를 풀어 VLM 사진 3장으로 사라짐이다", () => {
    expect(run([10000, 11000, 12000], true)).toEqual([["cup_1", "gone"]]);
  });
  it("사람이 안 보이면 손에 있음이 새것이어도 보호를 푼다", () => {
    expect(run([5000, 6000, 7000], false)).toEqual([["cup_1", "gone"]]);
  });
});

// 키 큰 컵 q2: 식탁 위 컵 둘(0.03m·0.38m) 사이를 가까이 본 VLM이 「병」으로 답해 새 병 id가 생겼다
it("다른 종류 같은 무리 답은 가장 가까운 물건이 둘째보다 3배 넘게 가까우면 그 물건이다(새 id를 만들지 않는다)", () => {
  const w = ws();
  const two: SceneObservation = { scene: "k", summary: "s", observations: [], objects: [{ id: "v1", cls: "cup", box: frac(CUP), det: null }, { id: "v2", cls: "cup", box: frac([200, 170, 20, 10]), det: null }] };
  w.applyScene("e1", 1000, two, new Map(), look);
  w.applyScene("e2", 2000, two, new Map(), look);
  expect(w.view(2000).objects.map((o) => o.id)).toEqual(["cup_1", "cup_2"]);
  const [c1, c2] = w.view(2000).objects.map((o) => o.position!);
  expect(Math.hypot(c1![0] - c2![0], c1![2] - c2![2])).toBeLessThan(0.5);
  const bottle: SceneObservation = { scene: "k", summary: "s", observations: [], objects: [{ id: "v1", cls: "bottle", box: frac([231, 170, 20, 10]), det: null }] };
  const ids = new Map<string, string>();
  w.applyScene("e3", 3000, bottle, ids, look);
  expect(ids.get("v1")).toBe("cup_1");
  expect(w.view(3000).objects.map((o) => o.id)).toEqual(["cup_1", "cup_2"]);
});

// 키 큰 컵 m1·c1, 유리잔 c1(2026-11-18): 식탁 위 유리잔을 VLM이 한 장 「병」으로 답해 그 후보가 bottle_1이 됐고, 다음 「컵」 답으로 확정돼 id가 병 꼴로 남았다.
// 컵 치우기 계획 대상이 컵 id 꼴이 아니라 「대상 물건이 보이지 않아」로 실패했다
describe("마시는 그릇 종류: 병은 두 답이 이어야 한다", () => {
  const bottleScene = (): SceneObservation => ({ scene: "k", summary: "s", observations: [], objects: [{ id: "v1", cls: "bottle", box: frac(CUP), det: null }] });
  it("병 답으로 생긴 후보가 다음 장에 컵 답으로 확정되면 컵이고 id도 컵 꼴(cup_1)이다", () => {
    const w = ws();
    w.applyScene("e1", 1000, bottleScene(), new Map(), look);
    const ids = new Map<string, string>();
    w.applyScene("e2", 2000, cupScene(), ids, look);
    expect(w.view(2000).objects.map((o) => [o.id, o.cls])).toEqual([["cup_1", "cup"]]);
    expect(ids.get("v1")).toBe("cup_1");
  });
  it("두 장 다 병이면 병(bottle_1)이다. 컵으로 생긴 후보는 병 답 한 장으로 바뀌지 않는다", () => {
    const w = ws();
    w.applyScene("e1", 1000, bottleScene(), new Map(), look);
    w.applyScene("e2", 2000, bottleScene(), new Map(), look);
    expect(w.view(2000).objects.map((o) => [o.id, o.cls])).toEqual([["bottle_1", "bottle"]]);
    const c = ws();
    c.applyScene("e1", 1000, cupScene(), new Map(), look);
    c.applyScene("e2", 2000, bottleScene(), new Map(), look);
    expect(c.view(2000).objects.map((o) => [o.id, o.cls])).toEqual([["cup_1", "cup"]]);
  });
});

