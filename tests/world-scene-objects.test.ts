// 장면 VLM 물건(scene.objects)으로 보임·되살림·확정·든 컵 잇기(VLM 무조건 우선, src/world/merge.ts). 물건 식별은 자리로 하고 종류는 따로 바꾼다(core.matchAt·voteClass).
// 가로 유리컵 실제 판 r2·r3(2026-11-18): 붙잡은 장면에서 YOLO가 컵을 놓쳐 VLM이 보는 컵이 사라짐이 됐고, 1인칭 집기에서 들린 컵이 새 id(cup_21)로 생겨 집기가 끝나지 않았다.
import { describe, expect, it } from "vitest";
import type { Detection, SceneObservation } from "../src/contract/observe.js";
import type { SceneState } from "../src/observe/scene.js";
import { WorldState } from "../src/world/state/world.js";
import type { DetLabel } from "../src/world/vocab.js";
import { engineFrame, LOOK_SIZE, LOOK_VIEW } from "./helpers/camera.js";
import { det as mkDet } from "./helpers/detectors.js";

// 바닥만 있는 집. 컵 [230, 170, 20, 10](엔진 프레임 픽셀)은 바닥 (1.5, 0, 0)이다
const ws = () => new WorldState({ evidenceStepMs: 1000, surfaces: () => [], floorAt: () => 0, roomAt: () => ({ id: "kitchen", label: "주방" }), devices: () => [] });
const det = (label: DetLabel, box: [number, number, number, number], score = 0.8): Detection => mkDet(label, score, box, 0);
const CUP: [number, number, number, number] = [230, 170, 20, 10];
const cupIn = det("cup", CUP);
/** 들린 컵: 상자 아랫변이 바닥 자리와 멀다. */
const lifted = det("cup", [60, 300, 40, 20]);
const frac = (b: [number, number, number, number]) => ({ x: b[0] / 480, y: b[1] / 360, w: b[2] / 480, h: b[3] / 360 });
/** 그 사진의 카메라·크기·폰 눈(새 물건은 폰 눈을 아는 사진에서만 만든다). */
const look = { view: LOOK_VIEW, ...LOOK_SIZE, eye: [0, 0] as [number, number] };
/** 전체 사진 YOLO 한 장. eye: 그 사진을 찍은 폰 눈 수평 자리(없으면 모름). */
const full = (w: WorldState, id: string, atMs: number, dets: Detection[], eye?: [number, number]) =>
  w.applyDetections({ ...engineFrame(id, atMs, { view: LOOK_VIEW }), eye: eye ? { position: eye, height_m: 1.4, yaw_deg: 0, pitch_deg: 0 } as never : null }, dets);
/** 장면 VLM 답: 물건 하나(종류·상자·det)와 그 사실. */
const scene = (o: { cls?: string; box?: [number, number, number, number]; det?: string | null; facts?: SceneState[] } = {}): SceneObservation => ({
  scene: "k", summary: "s",
  objects: [{ id: "v1", cls: o.cls ?? "cup", box: frac(o.box ?? CUP), det: o.det ?? null }],
  observations: (o.facts ?? []).map((state) => ({ object_id: "v1", state })),
});
const none: SceneObservation = { scene: "k", summary: "s", objects: [], observations: [] };
const objs = (w: WorldState, at: number) => w.view(at).objects.map((o) => [o.id, o.cls, o.status]);

describe("장면 VLM 물건: VLM 무조건 우선", () => {
  it("YOLO가 놓쳐도 장면 VLM이 그 자리 컵을 답하는 동안은 사라지지 않는다(VLM 답이 없으면 지금처럼 사라진다)", () => {
    const run = (vlm: boolean) => {
      const w = ws();
      for (let t = 0; t <= 2000; t += 500) full(w, `e${t}`, t, [cupIn]);
      for (let t = 2500; t <= 12_000; t += 500) {
        full(w, `e${t}`, t, []);
        if (vlm && t % 2000 === 0) w.applyScene(`e${t}`, t, scene(), new Map(), look);
      }
      return w.view(12_000).objects[0]!.status;
    };
    expect(run(true)).toBe("present");
    expect(run(false)).toBe("gone");
  });

  it("사라진 컵을 장면 VLM이 그 자리에서 답하면(더 새 촬영) 되살린다", () => {
    const w = ws();
    for (let t = 0; t <= 2000; t += 500) full(w, `e${t}`, t, [cupIn]);
    for (let t = 2500; t <= 9500; t += 500) full(w, `e${t}`, t, []);
    expect(objs(w, 9500)).toEqual([["cup_1", "cup", "gone"]]);
    const changes = w.applyScene("e10000", 10_000, scene(), new Map(), look);
    expect(changes).toContainEqual(expect.objectContaining({ kind: "appeared", subject: "cup_1" }));
    expect(objs(w, 10_000)).toEqual([["cup_1", "cup", "present"]]);
  });

  it("YOLO 감지 없이 장면 VLM 사진 2장(서로 다른 원본 프레임)이 같은 자리 컵을 답하면 확정한다. 1장·같은 프레임 두 답은 확정하지 않는다", () => {
    const w = ws();
    w.applyScene("e1000", 1000, scene(), new Map(), look);
    w.applyScene("e1000", 1000, scene(), new Map(), look);
    full(w, "e1500", 1500, []);
    expect(w.view(1500).objects).toEqual([]);
    w.applyScene("e3000", 3000, scene(), new Map(), look);
    expect(objs(w, 3000)).toEqual([["cup_1", "cup", "present"]]);
  });
});

describe("든 컵 잇기(1인칭 집기)", () => {
  it("식탁 컵 가까이(폰 눈 1.5m 안)에서 들린 컵을 YOLO가 다른 자리 새 후보로 잡아도, 장면 VLM이 손에 있음으로 답하면 그 컵(cup_1)으로 잇고 손에 있음을 넣는다. 새 id가 생기지 않는다", () => {
    const w = ws();
    for (let t = 0; t <= 2000; t += 500) full(w, `e${t}`, t, [cupIn]);
    // 그 사진을 찍은 때의 폰 눈(Codex 25ddddd 6: 답이 온 때의 눈이 아니다)
    const near = { ...look, eye: [1, 0] as [number, number] };
    w.setEye({ position: [9, 9], height_m: 1.4, yaw_deg: 0, pitch_deg: 0 }, 2000);
    full(w, "e2500", 2500, [lifted], [1, 0]);
    const r = full(w, "e3000", 3000, [lifted], [1, 0]);
    w.applyScene("e3000", 3000, scene({ box: [60, 300, 40, 20], det: "d1", facts: ["in_hand"] }), r.ids, near);
    expect(r.ids.get("d1")).toBe("cup_1");
    // 손에 있음은 VLM 사진 2장 이어서일 때만 켠다(가로 유리컵 r4: 손이 없는 장면 한 장의 손에 있음 오탐)
    expect(w.view(3000).objects.find((o) => o.id === "cup_1")!.facts.place?.value).not.toBe("in_hand");
    const r2 = full(w, "e4000", 4000, [lifted], [1, 0]);
    w.applyScene("e4000", 4000, scene({ box: [60, 300, 40, 20], det: "d1", facts: ["in_hand"] }), r2.ids, near);
    expect(w.view(4000).objects.find((o) => o.id === "cup_1")!.facts.place?.value).toBe("in_hand");
    for (let t = 4500; t <= 8000; t += 500) full(w, `e${t}`, t, [lifted], [1, 0]);
    expect(objs(w, 8000)).toEqual([["cup_1", "cup", "present"]]);
  });
});

describe("물건 식별과 종류(Codex 75104d7·38b5c83)", () => {
  it("같은 종류를 먼저 잇는다: 컵 옆 0.15m의 진짜 병이 있으면 VLM 병은 병으로 잇는다. 무리 다른 종류가 둘 이상이면 모호해 잇지 않는다", () => {
    const w = ws();
    const bottle = det("bottle", [250, 170, 20, 10]);
    for (let t = 0; t <= 2000; t += 500) full(w, `e${t}`, t, [cupIn, bottle]);
    const ids = new Map<string, string>();
    w.applyScene("e3000", 3000, scene({ cls: "bottle", box: [240, 170, 20, 10] }), ids, look);
    expect(ids.get("v1")).toBe("bottle_1");
    const two = ws();
    const cupB = det("cup", [255, 170, 20, 10]);
    for (let t = 0; t <= 2000; t += 500) full(two, `e${t}`, t, [cupIn, cupB]);
    const ids2 = new Map<string, string>();
    two.applyScene("e3000", 3000, scene({ cls: "bottle", box: [242, 170, 20, 10] }), ids2, look);
    expect(ids2.get("v1")).not.toMatch(/^cup_/);
  });

  it("종류 바꾸기는 서로 다른 원본 프레임의 더 새 촬영만 센다: 같은 사진 재시도·늦게 온 옛 답으로 바뀌지 않는다", () => {
    const w = ws();
    for (let t = 0; t <= 2000; t += 500) full(w, `e${t}`, t, [cupIn]);
    w.applyScene("e3000", 3000, scene({ cls: "bottle" }), new Map(), look);
    w.applyScene("e3000", 3000, scene({ cls: "bottle" }), new Map(), look);
    w.applyScene("e2600", 2600, scene({ cls: "bottle" }), new Map(), look);
    expect(objs(w, 3000)).toEqual([["cup_1", "cup", "present"]]);
    w.applyScene("e5000", 5000, scene({ cls: "bottle" }), new Map(), look);
    expect(objs(w, 5000)).toEqual([["cup_1", "bottle", "present"]]);
  });

  it("종류가 병으로 바뀐 cup_1 자리의 전체 사진 YOLO 컵은 새 cup_2가 아니라 cup_1이다(전체 사진도 같은 식별 규칙)", () => {
    const w = ws();
    for (let t = 0; t <= 2000; t += 500) full(w, `e${t}`, t, [cupIn]);
    w.applyScene("e3000", 3000, scene({ cls: "bottle" }), new Map(), look);
    w.applyScene("e5000", 5000, scene({ cls: "bottle" }), new Map(), look);
    for (let t = 5500; t <= 9000; t += 500) full(w, `e${t}`, t, [cupIn]);
    expect(w.view(9000).objects.map((o) => o.id)).toEqual(["cup_1"]);
  });
});

// 가로 유리컵 실제 판 r4(2026-11-18): 컵의 놓인 곳이 VLM 답마다 식탁 위 → 선반 위 → 식탁 위 → 책상 위 → 조리대 위로 바뀌었고, 계획이 「맞지 않아 버림」으로 끝났다.
// 손이 없는 장면에서 손에 있음이 한 장 켜졌고, 상자 투영이 흔들려 같은 자리에 bottle_5가 새로 생겼다
describe("VLM 동기화 흔들림 막기", () => {
  const confirmed = () => {
    const w = ws();
    for (let t = 0; t <= 2000; t += 500) full(w, `e${t}`, t, [cupIn]);
    w.applyScene("e2000", 2000, scene({ facts: ["on_table"] }), new Map(), look);
    return w;
  };
  const place = (w: WorldState, at: number) => w.view(at).objects[0]!.facts.place?.value;

  it("확인된 물건의 놓인 곳은 VLM 사진 2장이 이어서 같은 새 값을 말할 때만 바뀐다. 한 장씩 흔들리는 값은 버린다", () => {
    const w = confirmed();
    expect(place(w, 2000)).toBe("on_table");
    const said: [number, SceneState][] = [[4000, "on_shelf"], [6000, "on_table"], [8000, "on_desk"], [10_000, "on_counter"], [12_000, "on_table"], [14_000, "on_shelf"]];
    for (const [at, s] of said) {
      w.applyScene(`e${at}`, at, scene({ facts: [s] }), new Map(), look);
      expect(place(w, at)).toBe("on_table");
    }
    // 같은 원본 프레임 두 답은 2장이 아니다
    w.applyScene("e14000", 14_000, scene({ facts: ["on_shelf"] }), new Map(), look);
    expect(place(w, 14_000)).toBe("on_table");
    w.applyScene("e16000", 16_000, scene({ facts: ["on_shelf"] }), new Map(), look);
    expect(place(w, 16_000)).toBe("on_shelf");
  });

  it("손에 있음은 VLM 사진 2장 이어서일 때만 켠다", () => {
    const w = confirmed();
    // 든 물건은 그 사진의 폰 눈 가까이 컵 하나로 잇는다(모호하면 미룬다)
    const near = { ...look, eye: [1, 0] as [number, number] };
    w.applyScene("e4000", 4000, scene({ facts: ["in_hand"] }), new Map(), near);
    w.applyScene("e6000", 6000, scene({ facts: ["on_table"] }), new Map(), near);
    expect(place(w, 6000)).toBe("on_table");
    w.applyScene("e8000", 8000, scene({ facts: ["in_hand"] }), new Map(), near);
    w.applyScene("e10000", 10_000, scene({ facts: ["in_hand"] }), new Map(), near);
    expect(place(w, 10_000)).toBe("in_hand");
  });

  it("VLM 상자 투영의 작은 흔들림(0.3m 안)은 자리를 바꾸지 않고, 0.5m 안 흔들림에도 새 id가 생기지 않는다(종류가 병으로 흔들려도)", () => {
    const w = confirmed();
    const at0 = w.view(2000).objects[0]!.position!;
    const jitter: [number, number, number, number][] = [[226, 168, 20, 10], [236, 173, 20, 10], [224, 166, 20, 10], [238, 175, 20, 10]];
    jitter.forEach((b, i) => {
      const at = 4000 + i * 2000;
      w.applyScene(`e${at}`, at, scene({ cls: i === 2 ? "bottle" : "cup", box: b }), new Map(), look);
      full(w, `y${at}`, at + 100, []);
    });
    full(w, "y12000", 12_000, []);
    full(w, "y14000", 14_000, []);
    expect(w.view(14_000).objects.map((o) => [o.id, o.cls])).toEqual([["cup_1", "cup"]]);
    expect(w.view(14_000).objects[0]!.position).toEqual(at0);
  });
});

describe("Codex 25ddddd: VLM 확정과 사라짐 판정기·가림·모호한 든 컵", () => {
  it("VLM만으로 확정한 컵도 VLM 보호(6초)가 끝난 뒤 시야 안에서 안 보이면 사라짐을 센다", () => {
    const w = ws();
    w.applyScene("e1000", 1000, scene(), new Map(), look);
    w.applyScene("e3000", 3000, scene(), new Map(), look);
    expect(objs(w, 3000)).toEqual([["cup_1", "cup", "present"]]);
    for (let t = 3500; t <= 16_000; t += 500) full(w, `e${t}`, t, []);
    expect(objs(w, 16_000)).toEqual([["cup_1", "cup", "gone"]]);
  });

  it("가림(not_visible) 답은 있다는 근거가 아니다: 두 장이어도 확정하지 않고, 사라짐 셈을 막지 않는다", () => {
    const w = ws();
    w.applyScene("e1000", 1000, scene({ facts: ["not_visible"] }), new Map(), look);
    w.applyScene("e3000", 3000, scene({ facts: ["not_visible"] }), new Map(), look);
    full(w, "e3500", 3500, []);
    expect(w.view(3500).objects).toEqual([]);
    const y = ws();
    for (let t = 0; t <= 2000; t += 500) full(y, `e${t}`, t, [cupIn]);
    for (let t = 2500; t <= 10_000; t += 500) {
      full(y, `e${t}`, t, []);
      if (t % 2000 === 0) y.applyScene(`e${t}`, t, scene({ facts: ["not_visible"] }), new Map(), look);
    }
    expect(objs(y, 10_000)).toEqual([["cup_1", "cup", "gone"]]);
  });

  it("손에 있음 VLM 물건을 이을 컵이 폰 눈 가까이에 둘이면 모호해 잇지 않는다. YOLO 감지 번호로 이은 확정 물건은 다른 든 컵으로 덮지 않는다", () => {
    const w = ws();
    const cupB = det("cup", [260, 175, 20, 10]);
    for (let t = 0; t <= 2000; t += 500) full(w, `e${t}`, t, [cupIn, cupB]);
    expect(w.view(2000).objects.map((o) => o.id)).toEqual(["cup_1", "cup_2"]);
    const ids = new Map<string, string>();
    w.applyScene("e3000", 3000, scene({ box: [60, 300, 40, 20], facts: ["in_hand"] }), ids, { ...look, eye: [1, 0] });
    expect(ids.get("v1")).toBeUndefined();
    const linked = new Map([["d1", "cup_2"]]);
    w.applyScene("e4000", 4000, scene({ box: [60, 300, 40, 20], det: "d1", facts: ["in_hand"] }), linked, { ...look, eye: [1, 0] });
    expect(linked.get("d1")).toBe("cup_2");
    expect(linked.get("v1")).toBe("cup_2");
  });

  it("YOLO는 손에 든 컵이 그 사진의 폰 눈 1.5m 밖이면 먼 감지를 그 컵에 잇지 않는다", () => {
    const w = ws();
    for (let t = 0; t <= 2000; t += 500) full(w, `e${t}`, t, [cupIn]);
    w.applyScene("e2000", 2000, scene({ det: "d1", facts: ["in_hand"] }), new Map([["d1", "cup_1"]]), look);
    w.applyScene("e2500", 2500, scene({ det: "d1", facts: ["in_hand"] }), new Map([["d1", "cup_1"]]), look);
    expect(w.view(2500).objects[0]!.facts.place?.value).toBe("in_hand");
    const r = full(w, "e3000", 3000, [lifted], [9, 9]);
    expect(r.ids.get("d1")).not.toBe("cup_1");
  });
});

// 가로 유리컵 실제 판 r6(2026-11-18): 첫 등장부터 한 잔이 cup_9(장면 VLM)·cup_18(YOLO) 두 id였고, VLM이 한쪽만 봐 다른 쪽이 사라짐이 됐다
describe("한 잔은 처음부터 한 물건(YOLO·VLM 자리 차이)", () => {
  it("장면 VLM이 먼저 자리를 정한 컵에서 0.5m 안(0.35m)의 YOLO 감지는 그 컵이다: 새 id를 만들지 않는다", () => {
    const w = ws();
    w.applyScene("e1000", 1000, scene(), new Map(), look);
    w.applyScene("e3000", 3000, scene(), new Map(), look);
    expect(objs(w, 3000)).toEqual([["cup_1", "cup", "present"]]);
    const off = det("cup", [270, 170, 20, 10]);   // 컵 자리에서 0.354m
    for (let t = 3500; t <= 7000; t += 500) full(w, `e${t}`, t, [off]);
    expect(objs(w, 7000)).toEqual([["cup_1", "cup", "present"]]);
  });
});

// 가로 키 큰 컵 실제 판 r1(2026-11-18): 식탁으로 걷는 동안 후면 발코니에 유령 컵(cup_10·cup_12)이 확정됐다
describe("걷는 동안 찍힌 VLM 상자로는 새 물건을 확정하지 않는다", () => {
  it("두 장의 폰 눈이 0.3m 넘게 떨어져 있으면(걷는 중) 확정하지 않고, 폰 눈을 모르는 사진으로는 만들지 않는다", () => {
    const w = ws();
    w.applyScene("e1000", 1000, scene(), new Map(), { ...look, eye: [0, 0] });
    w.applyScene("e3000", 3000, scene(), new Map(), { ...look, eye: [0.8, 0] });
    full(w, "e3500", 3500, []);
    expect(w.view(3500).objects).toEqual([]);
    const blind = ws();
    blind.applyScene("e1000", 1000, scene(), new Map(), { view: LOOK_VIEW, ...LOOK_SIZE });
    blind.applyScene("e3000", 3000, scene(), new Map(), { view: LOOK_VIEW, ...LOOK_SIZE });
    expect(blind.view(3000).objects).toEqual([]);
  });
});
