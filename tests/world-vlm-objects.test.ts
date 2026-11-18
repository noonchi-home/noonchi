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

  it("확정 전 후보도 그 사진 시야 안 같은 무리 후보가 하나뿐이면 잇는다(상자 투영이 흔들려 두 후보로 갈라지지 않는다)", () => {
    const w = ws();
    w.applyScene("e1", 1000, cupScene(), new Map(), look);
    w.applyScene("e2", 2000, cupScene([300, 150, 20, 10]), new Map(), look);   // 0.5m 넘게 떨어진 투영
    expect(objs(w, 2000)).toEqual([["cup_1", "present"]]);
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
