// 내용물 갱신기(src/world/state/contents.ts): 새 값은 서로 다른 사진 3장·4초(이웃 사진 6초 안)이거나 사람 답. 확인 값은 행동(사건·따르기 단계)으로만 다시 연다.
import { describe, expect, it } from "vitest";
import { WorldState } from "../src/world/state/world.js";
import { sha256 } from "../src/observe/ring.js";
import type { CameraView, Detection, EngineFrame, Keypoint, SceneObservation } from "../src/contract/observe.js";
import { atMouth, pouringInto } from "../src/world/sip.js";
import { describePose } from "../src/world/pose.js";
import { det } from "./helpers/detectors.js";
import { standing } from "./helpers/poses.js";
import { LOOK_VIEW } from "./helpers/camera.js";
import { tilted } from "./helpers/masks.js";
import { emptyMask, fullMask } from "../src/shared/mask.js";
import { see } from "./helpers/vlm-scene.js";

const ws = () => new WorldState({ evidenceStepMs: 1000, surfaces: () => [], floorAt: () => 0, roomAt: () => ({ id: "kitchen", label: "주방" }), devices: () => [] });
const frame = (i: number, view: CameraView | null = null): EngineFrame => ({ id: `e${i}`, capturedAtMs: i * 1000, latestAtMs: i * 1000, jpeg: Buffer.from(`${i}`), sha256: sha256(Buffer.from(`${i}`)), width: 480, height: 360, eye: null, view });
const cup: Detection = det("cup", 0.9, [220, 160, 40, 20], 41);

/** 컵 하나를 1~3초 장면 VLM 사진으로 등장 확인한 World State와 도우미. say: 그 초의 전체 사진 VLM 답(그 컵을 물건 목록에 넣는다), crop: 그 초 원본 프레임을 잘라 본 VLM 답.
 *  view: 그 카메라로 찍은 프레임(없으면 맞추기 전). */
function scene(view: CameraView | null = null, seen: Detection = cup) {
  const w = ws();
  let ids = new Map<string, string>();
  for (let i = 1; i <= 3; i++) ids = see(w, frame(i, view), [seen]).ids;
  const box = { x: seen.box[0] / 480, y: seen.box[1] / 360, w: seen.box[2] / 480, h: seen.box[3] / 360 };
  const obs = (states: string[]): SceneObservation => ({ scene: "k", objects: [{ id: "v1", cls: seen.label, box, det: "d1" }], observations: states.map((state) => ({ object_id: "d1", state: state as SceneObservation["observations"][number]["state"] })), summary: "s" });
  const say = (i: number, ...states: string[]) => w.applyScene(`e${i}`, i * 1000, obs(states), ids);
  const crop = (i: number, ...states: string[]) => w.applyCloserScene(`e${i}`, i * 1000, obs(states), ids);
  /** 그 초 원본 프레임을 위에서 본 답(대상 확인을 거친 장, src/observe/pipeline.ts topLook). */
  const top = (i: number, value: "empty" | "has_contents") => w.applyTop("cup_1", `e${i}`, i * 1000, value);
  const cupNow = () => w.view(99_000).objects[0]!;
  const lines = (c: { kind: string; text: string; meaningful: boolean }[]) => c.filter((x) => x.kind === "state").map((x) => [x.text, x.meaningful]);
  return { w, say, crop, top, cupNow, lines };
}

describe("내용물 확인", () => {
  it("좌표가 없어도 그 컵 입구 안을 직접 본 서로 다른 두 사진에만 확인 시각을 붙인다", () => {
    const s = scene();
    s.say(4, "opaque", "empty");
    s.say(5, "opaque", "empty");
    expect(s.cupNow().facts.contents?.inside_ms).toBeUndefined();
    s.say(6, "interior_visible", "empty");
    s.say(6, "interior_visible", "empty");
    expect(s.cupNow().facts.contents?.inside_ms).toBeUndefined();
    s.say(8, "interior_visible", "empty");
    expect(s.cupNow().facts.contents).toMatchObject({ value: "empty", certainty: "confirmed", inside_ms: [6000, 8000] });
  });
  it("같은 값이 서로 다른 사진 3장이고 처음과 마지막이 4초 넘게 이어져야 확인됨이다. 그 전은 짐작이고 변화 줄이 없다", () => {
    const s = scene();
    expect(s.lines(s.say(1, "empty"))).toEqual([]);
    expect(s.cupNow().facts.contents).toMatchObject({ value: "empty", certainty: "inferred", since_ms: 1000 });
    s.say(2, "empty");
    s.say(3, "empty"); // 3장이지만 2초
    expect(s.cupNow().facts.contents).toMatchObject({ certainty: "inferred" });
    expect(s.lines(s.say(5, "empty"))).toEqual([["컵 cup_1 비어 있음", true]]);
    expect(s.cupNow().facts.contents).toMatchObject({ value: "empty", certainty: "confirmed", since_ms: 1000, at_ms: 5000 });
    expect(s.cupNow().contents_gen).toBe(1);
  });

  it("같은 원본 프레임은 한 장으로 센다(전체 사진과 잘라 본 답, 같은 답을 두 번)", () => {
    const s = scene();
    s.say(1, "empty"); s.crop(1, "empty"); s.say(1, "empty");
    s.say(5, "empty");
    expect(s.cupNow().facts.contents).toMatchObject({ certainty: "inferred" });
    s.say(6, "empty");
    expect(s.cupNow().facts.contents).toMatchObject({ value: "empty", certainty: "confirmed" });
  });

  it("같은 원본 프레임이면 잘라 본 답이 전체 사진 답보다 앞선다(오는 차례와 상관없이)", () => {
    const s = scene();
    s.crop(1, "has_contents"); s.say(1, "empty"); s.say(3, "has_contents"); s.say(5, "has_contents");
    expect(s.cupNow().facts.contents).toMatchObject({ value: "has_contents", certainty: "confirmed" });
  });

  it("확인을 받치던 사진이 같은 원본 프레임의 잘라 본 답으로 반대가 되면 바뀐 근거로 다시 센다: 다 이어진 묶음이 없으면 확인을 거둔다(세대 +1)", () => {
    const s = scene();
    for (const i of [1, 3, 5]) s.say(i, "empty");
    expect(s.cupNow()).toMatchObject({ contents_gen: 1, facts: { contents: { value: "empty", certainty: "confirmed" } } });
    s.crop(3, "has_contents");
    expect(s.cupNow()).toMatchObject({ contents_gen: 2, facts: { contents: { value: "empty", certainty: "inferred" } } });
    // 받치는 사진이 다시 다 이어지면 확인
    s.say(6, "empty"); s.say(9, "empty");
    expect(s.cupNow().facts.contents).toMatchObject({ value: "empty", certainty: "confirmed" });
  });

  it("이웃 사진 사이가 6초 넘으면 처음부터 센다", () => {
    const s = scene();
    s.say(1, "empty"); s.say(2, "empty"); s.say(9, "empty"); s.say(10, "empty");
    expect(s.cupNow().facts.contents).toMatchObject({ certainty: "inferred", since_ms: 9000 });
    s.say(13, "empty");
    expect(s.cupNow().facts.contents).toMatchObject({ certainty: "confirmed", since_ms: 9000 });
  });

  it("확인된 값은 반대 값 한 장으로 바뀌지 않는다. 반대 값이 두 장 이어지면 짐작으로 낮추고(실행에서 모름) 다 이어져도 바꾸지 않는다. 같은 값이 다시 오면 확인됨", () => {
    const s = scene();
    for (const i of [1, 3, 5]) s.say(i, "empty");
    s.say(6, "has_contents");
    expect(s.cupNow().facts.contents).toMatchObject({ value: "empty", certainty: "confirmed" });
    s.say(7, "has_contents");
    expect(s.cupNow().facts.contents).toMatchObject({ value: "empty", certainty: "inferred" });
    for (const i of [9, 11, 13]) expect(s.lines(s.say(i, "has_contents"))).toEqual([]);
    expect(s.cupNow().facts.contents).toMatchObject({ value: "empty", certainty: "inferred" });
    expect(s.cupNow().contents_gen).toBe(1);
    s.say(14, "empty");
    expect(s.cupNow().facts.contents).toMatchObject({ value: "empty", certainty: "confirmed" });
  });

  it("안이 안 보임 답은 후보가 아니다: 확인을 끊지 않고, 아무 값도 없을 때만 짐작 「안이 안 보임」이다", () => {
    const s = scene();
    s.say(1, "contents_unknown");
    expect(s.cupNow().facts.contents).toMatchObject({ value: "contents_unknown", certainty: "inferred" });
    s.say(2, "empty"); s.say(3, "contents_unknown"); s.say(4, "empty"); s.say(6, "empty");
    expect(s.cupNow().facts.contents).toMatchObject({ value: "empty", certainty: "confirmed" });
  });

  it("후보 충돌은 기억한다: 반대 값 묶음이 공백으로 끊겨도 같은 값의 새 사진 없이 확인됨으로 되살리지 않는다", () => {
    const s = scene();
    for (const i of [1, 3, 5]) s.say(i, "empty");
    s.say(6, "has_contents"); s.say(7, "has_contents");
    expect(s.cupNow().facts.contents).toMatchObject({ value: "empty", certainty: "inferred" });
    s.say(14, "has_contents"); // 7초 뒤 반대 값 한 장: 묶음은 끊겼지만 충돌은 이어진다
    expect(s.cupNow().facts.contents).toMatchObject({ value: "empty", certainty: "inferred" });
    s.say(15, "empty"); // 같은 값의 새 사진
    expect(s.cupNow().facts.contents).toMatchObject({ value: "empty", certainty: "confirmed" });
  });

  it("같은 답에서 불투명이 안 내용 뒤에 와도, 불투명이 확인되면 안 내용 확인 줄을 내지 않는다(몸통을 먼저 넣는다). 가까이 본 답도 같다", () => {
    const s = scene();
    s.say(1, "empty");
    expect(s.lines(s.say(3, "empty", "opaque"))).toEqual([["컵 cup_1 불투명", true]]);
    // 셋째 사진(4초)에 불투명이 확인된다: 안 내용 「비어 있음」 확인 줄을 내지 않는다
    expect(s.lines(s.say(5, "empty", "opaque"))).toEqual([]);
    expect(s.cupNow().facts.contents).toMatchObject({ value: "contents_unknown", certainty: "confirmed" });
    const c = scene();
    c.say(1, "empty"); c.say(3, "empty", "opaque");
    expect(c.lines(c.crop(5, "empty", "opaque"))).toEqual([]);
    expect(c.cupNow().facts.contents).toMatchObject({ value: "contents_unknown", certainty: "confirmed" });
  });

  it("확인을 받치는 사진 목록도 쌓는 사진 수(12장) 안이다(오래 보는 컵)", () => {
    const s = scene();
    for (let i = 1; i <= 40; i++) s.say(i * 2, "empty");
    const core = (s.w as unknown as { core: { objects: Map<string, { contents: { sure: { frames: string[] } } }> } }).core;
    expect(core.objects.get("cup_1")!.contents.sure.frames.length).toBeLessThanOrEqual(12);
    expect(s.cupNow().facts.contents).toMatchObject({ value: "empty", certainty: "confirmed" });
  });

  it("가까이 본 답이 넣은 값의 closer_ms는 같은 값이 이어지는 동안 남고(전체 사진이 같은 값을 이어 봐도), 값이 바뀌면 없어진다", () => {
    const s = scene();
    s.crop(1, "empty");
    expect(s.cupNow().facts.contents).toMatchObject({ value: "empty", closer_ms: 1000 });
    s.say(3, "empty"); s.say(5, "empty");
    expect(s.cupNow().facts.contents).toMatchObject({ value: "empty", certainty: "confirmed", closer_ms: 1000 });
    const t = scene();
    t.crop(1, "empty"); t.say(2, "has_contents");
    expect(t.cupNow().facts.contents).toMatchObject({ value: "has_contents" });
    expect(t.cupNow().facts.contents).not.toHaveProperty("closer_ms");
  });
});

describe("위에서 본 사진(2장·1.5초 이상·공백 6초 이하)", () => {
  it("불투명이 확인된 컵: 옆 사진은 버리고, 위에서 본 두 장(0초·2초 간격)이면 확인됨이다(세대 +1, 판단 계기 줄)", () => {
    const s = scene();
    s.say(1, "opaque"); s.say(2, "opaque");
    for (const i of [3, 5, 7]) s.say(i, "empty");
    expect(s.cupNow().facts.contents).toMatchObject({ value: "contents_unknown", certainty: "confirmed" });
    const gen = s.cupNow().contents_gen ?? 0;
    expect(s.lines(s.top(8, "empty"))).toEqual([]);
    expect(s.cupNow().facts.contents).toMatchObject({ value: "contents_unknown", certainty: "confirmed" });
    expect(s.lines(s.top(10, "empty"))).toEqual([["컵 cup_1 비어 있음", true]]);
    expect(s.cupNow()).toMatchObject({ contents_gen: gen + 1, facts: { contents: { value: "empty", certainty: "confirmed" } } });
  });
  it("한 장, 1초 간격, 10초 간격은 확인이 아니다", () => {
    for (const [a, b] of [[8, 9], [8, 18]] as const) {
      const s = scene();
      s.say(1, "opaque"); s.say(2, "opaque");
      s.top(a, "empty"); s.top(b, "empty");
      expect(s.cupNow().facts.contents).toMatchObject({ value: "contents_unknown", certainty: "confirmed" });
    }
  });
  it("속이 비치는 컵도 위 두 장으로 확인된다. 옆 사진 3장·4초 규칙도 그대로다", () => {
    const s = scene();
    s.top(1, "has_contents"); s.top(3, "has_contents");
    expect(s.cupNow().facts.contents).toMatchObject({ value: "has_contents", certainty: "confirmed" });
  });
  it("옆 사진으로 확인된 값은 창 밖에서도 위 두 장이 반대면 바뀐다(이전 값 보관, 세대 +1). 그 뒤 옆 사진의 반대 값은 바꾸지 않는다", () => {
    const s = scene();
    for (const i of [1, 3, 5]) s.say(i, "has_contents");
    expect(s.cupNow()).toMatchObject({ contents_gen: 1, facts: { contents: { value: "has_contents", certainty: "confirmed" } } });
    s.top(6, "empty");
    expect(s.cupNow().facts.contents).toMatchObject({ value: "has_contents", certainty: "confirmed" });
    s.top(8, "empty");
    expect(s.cupNow()).toMatchObject({ contents_gen: 2, contents_past: [{ value: "has_contents" }], facts: { contents: { value: "empty", certainty: "confirmed" } } });
    for (const i of [9, 11, 13]) s.say(i, "has_contents");
    expect(s.cupNow().facts.contents).toMatchObject({ value: "empty" });
    expect(s.cupNow().contents_gen).toBe(2);
  });
  it("옆 사진으로 확인된 값은 불투명이 확인되면 거둔다(보관, 세대 +1)", () => {
    const s = scene();
    for (const i of [1, 3, 5]) s.say(i, "empty");
    s.say(6, "opaque"); s.say(7, "opaque");
    expect(s.cupNow()).toMatchObject({ contents_gen: 2, contents_past: [{ value: "empty" }], facts: { contents: { value: "contents_unknown", certainty: "confirmed" } } });
  });
  it("위에서 확인한 값도 따르기 창이 다시 연다", () => {
    const s = scene();
    s.top(1, "empty"); s.top(3, "empty");
    s.w.contentsAction("cup_1", 4000, true);
    expect(s.cupNow().facts.contents).toMatchObject({ value: "empty", certainty: "inferred" });
  });
  it("같은 원본 프레임은 위에서 본 답 > 잘라 본 답 > 전체 사진 답 차례로 덮는다", () => {
    const s = scene();
    s.say(1, "has_contents"); s.crop(1, "has_contents"); s.top(1, "empty");
    s.top(3, "empty");
    expect(s.cupNow().facts.contents).toMatchObject({ value: "empty", certainty: "confirmed" });
  });
  it("같은 원본 프레임의 위에서 본 답 뒤에 온 잘라 본 답은 버린다", () => {
    const s = scene();
    s.top(1, "empty"); s.crop(1, "has_contents"); s.top(3, "empty");
    expect(s.cupNow().facts.contents).toMatchObject({ value: "empty", certainty: "confirmed" });
  });
  it("잘라 본 답으로 받치던 프레임을 위에서 본 반대 답이 덮으면 확인을 다시 센다", () => {
    const s = scene();
    for (const i of [1, 3, 5]) s.crop(i, "has_contents");
    expect(s.cupNow()).toMatchObject({ contents_gen: 1, facts: { contents: { value: "has_contents", certainty: "confirmed" } } });
    s.top(3, "empty");
    expect(s.cupNow().contents_gen).toBe(2);
    expect(s.cupNow().facts.contents?.certainty).toBe("inferred");
    s.top(5, "empty");
    expect(s.cupNow().facts.contents).toMatchObject({ value: "empty", certainty: "confirmed" });
  });
  it("따르기 창: 위 두 장이 확인한 뒤 더 새 옆 사진 3장·4초가 반대를 확인하면 바뀌고, 옛 위 쌍이 다시 덮지 않는다(줄·세대가 되풀이되지 않음)", () => {
    const s = scene();
    s.w.contentsAction("cup_1", 500, true);
    s.top(1, "empty"); s.top(3, "empty");
    expect(s.cupNow().facts.contents).toMatchObject({ value: "empty", certainty: "confirmed" });
    s.say(5, "has_contents"); s.say(7, "has_contents");
    expect(s.lines(s.say(9, "has_contents"))).toEqual([["컵 cup_1 내용물 있음", true]]);
    expect(s.cupNow().facts.contents).toMatchObject({ value: "has_contents", certainty: "confirmed" });
    const gen = s.cupNow().contents_gen;
    expect(s.lines(s.say(10, "has_contents"))).toEqual([]);
    expect(s.cupNow()).toMatchObject({ contents_gen: gen, facts: { contents: { value: "has_contents", certainty: "confirmed" } } });
  });
  it("늦게 온 위 사진 답은 그보다 새로 본 기록이 있으면 보임·지킴을 바꾸지 않는다(내용물은 넣는다)", () => {
    const s = scene();
    s.top(20, "empty");
    see(s.w, frame(30), [cup]);
    s.top(25, "empty");
    expect(s.cupNow().facts.contents).toMatchObject({ value: "empty", certainty: "confirmed" });
    expect(s.w.view(51_000).objects[0]!.closer_hold).toBe(false);
  });
  it("위에서 본 답은 마지막 본 때를 올리고 closer 지킴을 건다. 없거나 사라진 물건이면 빈 목록", () => {
    const s = scene();
    s.top(20, "empty");
    expect(s.w.view(20_000).objects[0]).toMatchObject({ last_seen_ms: 20_000, closer_hold: true });
    expect(s.w.applyTop("cup_9", "e21", 21_000, "empty")).toEqual([]);
  });
});

describe("불투명 컵", () => {
  it("불투명이 확인되면 VLM 내용물 답을 쓰지 않고 「안이 안 보임」(확인됨)이다", () => {
    const s = scene();
    s.say(1, "opaque", "has_contents"); s.say(2, "opaque");
    expect(s.cupNow().facts.contents).toMatchObject({ value: "contents_unknown", certainty: "confirmed" });
    for (const i of [3, 5, 7]) s.say(i, "empty");
    expect(s.cupNow().facts.contents).toMatchObject({ value: "contents_unknown", certainty: "confirmed" });
  });
  it("내용물 답이 없어도 불투명이 확인되면 「안이 안 보임」(확인됨)이다", () => {
    const s = scene();
    s.say(1, "opaque"); s.say(2, "opaque");
    expect(s.cupNow().facts.contents).toMatchObject({ value: "contents_unknown", certainty: "confirmed" });
  });
  it("불투명 한 장(짐작)으로는 VLM 답을 버리지 않는다", () => {
    const s = scene();
    s.say(1, "opaque", "empty"); s.say(3, "empty"); s.say(5, "empty");
    expect(s.cupNow().facts.contents).toMatchObject({ value: "empty", certainty: "confirmed" });
  });
});

describe("따르기 창(계획의 따르기 단계)", () => {
  it("열면 확인 값을 보관하고 짐작으로 낮춘다(세대 +1). 연 뒤 찍힌 사진만 쓰고, 창 안에서는 다 이어진 반대 값이 확인 값을 바꾼다. 닫아도 값은 남는다", () => {
    const s = scene();
    for (const i of [1, 3, 5]) s.say(i, "empty");
    expect(s.w.contentsAction("cup_1", 6000, true)).toBe(true);
    expect(s.cupNow()).toMatchObject({ contents_gen: 2, contents_past: [{ value: "empty", at_ms: 5000 }] });
    expect(s.cupNow().facts.contents).toMatchObject({ value: "empty", certainty: "inferred" });
    s.say(5, "has_contents"); // 연 앞에 찍힘: 버림
    for (const i of [7, 9]) s.say(i, "empty");
    s.say(11, "empty");
    expect(s.cupNow().facts.contents).toMatchObject({ value: "empty", certainty: "confirmed" });
    for (const i of [12, 14]) s.say(i, "has_contents");
    expect(s.lines(s.say(16, "has_contents"))).toEqual([["컵 cup_1 내용물 있음", true]]);
    expect(s.cupNow().facts.contents).toMatchObject({ value: "has_contents", certainty: "confirmed" });
    s.w.contentsAction("cup_1", 17_000, false);
    for (const i of [18, 20, 22]) s.say(i, "empty");
    expect(s.cupNow().facts.contents).toMatchObject({ value: "has_contents", certainty: "inferred" });
    expect(s.w.contentsAction("cup_9", 1, true)).toBe(false);
  });
});

// 서 있는 사람(어깨 너비 40, 몸통 100 → scale 60). 컵 상자 [220,160,40,20], 손목이 그 안이면 든 것이다
const CUP_BOX: [number, number, number, number] = [220, 160, 40, 20];
const AT_MOUTH: Record<number, Keypoint> = { 9: [230, 170, 0.9], 0: [240, 150, 0.9] };
const drinker = describePose(standing({ ...AT_MOUTH }));
const waist = describePose(standing({ 9: [230, 170, 0.9], 0: [130, 40, 0.9] }));
const someone = det("person", 0.9, [80, 60, 200, 300], 0);

// 마시기·따르기 판정 규칙(src/world/sip.ts). World State에는 넣지 않는다: 관절·YOLO 상자는 물건 사실을 정하지 않는다(사용자 결정 2026-11-18,
// tests/world-yolo-objects.test.ts). 장면 VLM의 마심·따름 답(계획 Task 8)으로 옮길 때 이 규칙을 쓴다.
describe("마시기·따르기 사건", () => {
  it("입에 댐: 컵을 든 손목이 있고 얼굴 점이 컵 상자에서 scale × 0.5 안", () => {
    expect(atMouth([drinker], CUP_BOX)).toBe(true);
    expect(atMouth([waist], CUP_BOX)).toBe(false);
    expect(atMouth([describePose(standing({ 0: [240, 150, 0.9] }))], CUP_BOX)).toBe(false); // 들지 않음
  });
  it("따름(마스크): 폰을 0°·45°·90° 돌려 들어도 컵 위에 세운 병은 따르기가 아니고, 기울여 든 병은 따르기다(마스크 긴 축과 중력 방향을 견줌)", () => {
    for (const phi of [0, 45, 90]) {
      const g = tilted(phi);
      const cupT = g.thing(0, 0, 40, 30, 0); // 컵 위 끝: u = 20
      const upright = g.thing(0, 60, 70, 25, 0);
      const pour = g.thing(0, 53, 70, 25, 60);
      const hold = (b: { center: [number, number] }) => describePose(standing({ 10: [b.center[0], b.center[1], 0.9] }));
      expect(pouringInto([hold(upright)], upright, cupT, g.down), `${phi}° 세운 병`).toBe(false);
      expect(pouringInto([hold(pour)], pour, cupT, g.down), `${phi}° 기운 병`).toBe(true);
    }
  });

  it("따름(마스크): 병 아래가 컵 위보다 컵 높이 절반 넘게 아래면(컵 앞에서 든 병), 옆으로 떨어지면, 들지 않았으면 아니다", () => {
    const g = tilted(0);
    const cupT = g.thing(0, 0, 40, 30, 0);
    const low = g.thing(0, 15, 70, 25, 60);
    const far = g.thing(120, 53, 70, 25, 60);
    const pour = g.thing(0, 53, 70, 25, 60);
    const hold = (b: { center: [number, number] }) => describePose(standing({ 10: [b.center[0], b.center[1], 0.9] }));
    expect(pouringInto([hold(low)], low, cupT, g.down)).toBe(false);
    expect(pouringInto([hold(far)], far, cupT, g.down)).toBe(false);
    expect(pouringInto([describePose(standing())], pour, cupT, g.down)).toBe(false);
  });

  it("따름(마스크): 카메라 자세가 없거나(중력 모름) 마스크가 없거나 너무 작으면 보류한다", () => {
    const g = tilted(0);
    const cupT = g.thing(0, 0, 40, 30, 0);
    const pour = g.thing(0, 53, 70, 25, 60);
    const hold = describePose(standing({ 10: [pour.center[0], pour.center[1], 0.9] }));
    expect(pouringInto([hold], pour, cupT, null)).toBe(false);
    expect(pouringInto([hold], { box: pour.box, mask: fullMask(pour.box) }, cupT, g.down)).toBe(false);
    expect(pouringInto([hold], pour, { box: cupT.box, mask: emptyMask(cupT.box) }, g.down)).toBe(false);
  });
});
