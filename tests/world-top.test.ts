// 위에서 본 사진(src/world/place.ts topView·topBox·cupInside·sizeOf, src/world/state/contents.ts topPairOf, World State 크기·보기 지킴):
// 카메라가 컵 안을 보는가(테두리 위로 먼 쪽 안벽 바닥 모서리가 보이고 컵이 화면 가운데), 잰 크기로 컵 안 모양, 위에서 본 쌍의 시간 조건, 보기 지킴.
import { describe, expect, it } from "vitest";
import type { CameraView, Detection } from "../src/contract/observe.js";
import { cupInside, ndc, pixelOf, sizeOf, topBox, topView, TOP_CUP_FALLBACK } from "../src/world/place.js";
import { topPairOf } from "../src/world/state/contents.js";
import { WorldState } from "../src/world/state/world.js";
import { engineFrame, LOOK_SIZE, viewLooking } from "./helpers/camera.js";
import { det } from "./helpers/detectors.js";

type V3 = [number, number, number];
const CUP: V3 = [1, 0.75, 0];
const MUG = { radius: 0.035, depth: 0.1 };
const DEEP = { radius: 0.03, depth: 0.15 };
/** 컵 자리에서 수평 d(−x 쪽)·바닥 위 H인 카메라가 컵을 바라본다. */
const from = (d: number, H: number, at: V3 = CUP): CameraView => viewLooking([at[0] - d, at[1] + H, at[2]], at);

describe("컵 안이 보임(topView)", () => {
  it("r 3.5cm·h 10cm 컵: 먼 쪽 안벽 바닥 모서리가 가까운 테두리 위로 보여야 한다", () => {
    expect(topView(from(0.15, 0.4), CUP, MUG)).toBe(true);
    // Codex 반례: 내려다보는 각은 60°지만 테두리가 바닥을 가린다(필요 높이 16.4cm)
    expect(topView(from(0.08, 0.139), CUP, MUG)).toBe(false);
    expect(topView(from(0.2, 0.35), CUP, MUG)).toBe(true);
    expect(topView(from(0.25, 0.35), CUP, MUG)).toBe(false);
    // 입구 바로 위는 테두리보다 높기만 하면 된다
    expect(topView(from(0.02, 0.3), CUP, MUG)).toBe(true);
    expect(topView(from(0.02, 0.09), CUP, MUG)).toBe(false);
  });
  it("r 3cm·h 15cm 컵(Codex 재검토 반례): 수평 15cm·위 40cm는 거짓, 입구 바로 위(수평 2cm)·위 40cm는 참", () => {
    expect(topView(from(0.15, 0.4), CUP, DEEP)).toBe(false);
    expect(topView(from(0.02, 0.4), CUP, DEEP)).toBe(true);
  });
  it("컵이 화면 가운데 절반 밖이거나 카메라 뒤면 거짓이다", () => {
    const side = viewLooking([CUP[0] - 0.02, CUP[1] + 0.4, CUP[2]], [CUP[0], CUP[1], CUP[2] + 0.35]);
    expect(Math.max(...ndc(side, CUP)!.map(Math.abs))).toBeGreaterThan(0.5);
    expect(topView(side, CUP, MUG)).toBe(false);
    const away = viewLooking([CUP[0] - 0.02, CUP[1] + 0.4, CUP[2]], [CUP[0] - 1, CUP[1] + 0.4, CUP[2]]);
    expect(ndc(away, CUP)).toBeNull();
    expect(topView(away, CUP, MUG)).toBe(false);
  });
});

describe("컵 안 모양(cupInside)", () => {
  it("r = 0.85·min(폭, 높이)/2, h = 높이 − 1cm. 모르면 좁고 깊은 컵", () => {
    const m = cupInside({ height: 0.095, width: 0.12 });
    expect(m.radius).toBeCloseTo(0.0404, 3);
    expect(m.depth).toBeCloseTo(0.085, 3);
    expect(cupInside(null)).toEqual(TOP_CUP_FALLBACK);
    expect(cupInside(undefined)).toEqual({ radius: 0.03, depth: 0.15 });
  });
});

/** 컵 원기둥(바닥 가운데 c, 반지름 r, 높이 h)을 그 카메라로 찍은 상자. */
function cylinderBox(view: CameraView, c: V3, r: number, h: number, size = LOOK_SIZE): [number, number, number, number] {
  const pts: [number, number][] = [];
  for (let k = 0; k < 32; k++) {
    const a = (k / 32) * Math.PI * 2;
    for (const y of [0, h]) pts.push(pixelOf(view, [c[0] + r * Math.cos(a), c[1] + y, c[2] + r * Math.sin(a)], size)!);
  }
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)];
}

describe("크기 재기(sizeOf)", () => {
  // 1.4m 높이 카메라가 0.6m 앞 식탁(0.75m) 위 높이 10cm·폭 8cm 원기둥을 본다. 자리는 마스크 바닥 점이라 가까운 바닥 가장자리다
  const c: V3 = [0.6, 0.75, 0];
  const view = viewLooking([0, 1.4, 0], [0.6, 0.8, 0]);
  it("감지 상자에서 높이·폭이 1cm 안이다", () => {
    const s = sizeOf(view, cylinderBox(view, c, 0.04, 0.1), LOOK_SIZE, [0.56, 0.75, 0])!;
    expect(Math.abs(s.height - 0.1)).toBeLessThan(0.01);
    expect(Math.abs(s.width - 0.08)).toBeLessThan(0.01);
  });
  it("사진 가장자리에 닿은 상자는 재지 않는다", () => {
    expect(sizeOf(view, [0, 100, 40, 40], LOOK_SIZE, [0.56, 0.75, 0])).toBeNull();
    expect(sizeOf(view, [200, 100, 40, LOOK_SIZE.height - 100], LOOK_SIZE, [0.56, 0.75, 0])).toBeNull();
  });
});

describe("위에서 보기 상자(topBox)", () => {
  it("바로 위에서 본 상자는 그림 가운데를 감싼다. 카메라 뒤면 null", () => {
    const b = topBox(from(0.02, 0.4), CUP, LOOK_SIZE)!;
    expect(b[0]).toBeLessThan(LOOK_SIZE.width / 2);
    expect(b[0] + b[2]).toBeGreaterThan(LOOK_SIZE.width / 2);
    expect(b[1]).toBeLessThan(LOOK_SIZE.height / 2);
    expect(b[1] + b[3]).toBeGreaterThan(LOOK_SIZE.height / 2);
    expect(topBox(viewLooking([CUP[0] - 0.02, CUP[1] + 0.4, CUP[2]], [CUP[0] - 1, CUP[1] + 0.4, CUP[2]]), CUP, LOOK_SIZE)).toBeNull();
  });
});

describe("위에서 본 쌍(topPairOf)", () => {
  const at = (...xs: number[]) => xs.map((x) => ({ at: x * 1000 }));
  it("1.5초 이상·6초 이하로 떨어진 두 장(가장 새 것과 그 앞)", () => {
    expect(topPairOf(at(0, 2))).toEqual([{ at: 0 }, { at: 2000 }]);
    expect(topPairOf(at(0, 1))).toBeNull();
    expect(topPairOf(at(0, 10))).toBeNull();
    expect(topPairOf(at(0, 7, 9))).toEqual([{ at: 7000 }, { at: 9000 }]);
    expect(topPairOf(at(2, 0))).toEqual([{ at: 0 }, { at: 2000 }]);
    expect(topPairOf([])).toBeNull();
  });
});

describe("World State: 컵 크기와 보기 지킴", () => {
  const table = { id: "table_1", label: "식탁", center: [0.6, 0] as [number, number], top: 0.75, radius: 1 };
  const view = viewLooking([0, 1.4, 0], [0.6, 0.8, 0]);
  it("전체 사진 감지마다 재서 최근 5장의 가운데값을 size_m으로 낸다(잘라 본 사진은 쌓지 않는다)", () => {
    const w = new WorldState({ evidenceStepMs: 1000, surfaces: () => [table], floorAt: () => 0, roomAt: () => ({ id: "kitchen", label: "주방" }), devices: () => [] });
    const box = cylinderBox(view, [0.6, 0.75, 0], 0.04, 0.1);
    const cup: Detection = det("cup", 0.9, box, 41);
    for (let i = 1; i <= 5; i++) w.applyDetections(engineFrame(`e${i}`, i * 1000, { view }), [cup]);
    const o = w.view(5000).objects[0]!;
    expect(o.size_m).toBeDefined();
    expect(Math.abs(o.size_m!.height - 0.1)).toBeLessThan(0.01);
    expect(Math.abs(o.size_m!.width - 0.08)).toBeLessThan(0.01);
    // 사람 같은 물건 아닌 것·그릇 아닌 물건은 재지 않는다
    expect(w.view(5000).objects.filter((x) => x.cls !== "cup").every((x) => x.size_m === undefined)).toBe(true);
  });

  // 바닥만 있는 집에서 LOOK_VIEW로 바닥 (1.5, 0, 0)에 보이는 컵
  const plain = () => new WorldState({ evidenceStepMs: 1000, surfaces: () => [], floorAt: () => 0, roomAt: () => ({ id: "kitchen", label: "주방" }), devices: () => [] });
  const cupIn = det("cup", 0.8, [230, 170, 20, 10], 0);
  const full = (w: WorldState, i: number, dets: Detection[]) => w.applyDetections(engineFrame(`e${i}`, i * 1000), dets);
  it("보기 지킴(guard on) 동안은 전체 사진에서 6초 넘게 못 봐도 사라지지 않는다. 풀면(off) 센다. closer_hold는 건드리지 않는다", () => {
    const w = plain();
    for (let i = 1; i <= 3; i++) full(w, i, [cupIn]);
    w.guard("cup_1", 3000, true);
    for (let i = 4; i <= 12; i++) expect(full(w, i, []).changes).toEqual([]);
    expect(w.view(12_000).objects[0]).toMatchObject({ status: "present", closer_hold: false });
    w.guard("cup_1", 12_000, false);
    const after = [13, 15, 17, 19].flatMap((i) => full(w, i, []).changes);
    expect(after).toEqual([expect.objectContaining({ kind: "gone", subject: "cup_1" })]);
  });
  it("보기 지킴은 풀지 않아도 60초 뒤에는 사라짐을 센다", () => {
    const w = plain();
    for (let i = 1; i <= 3; i++) full(w, i, [cupIn]);
    w.guard("cup_1", 3000, true);
    const changes = [10, 30, 50, 63, 65, 67, 69].flatMap((i) => full(w, i, []).changes);
    expect(changes).toEqual([expect.objectContaining({ kind: "gone", subject: "cup_1" })]);
  });
  it("없는 물건의 지킴은 아무것도 하지 않는다", () => {
    expect(() => plain().guard("cup_9", 0, true)).not.toThrow();
  });
});
