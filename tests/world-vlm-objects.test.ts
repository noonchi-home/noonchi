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
});
