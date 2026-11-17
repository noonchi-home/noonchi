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

const ws = () => new WorldState({ evidenceStepMs: 1000, surfaces: () => [], floorAt: () => 0, roomAt: () => ({ id: "kitchen", label: "주방" }), devices: () => [] });
const frame = (i: number, view: CameraView | null = null): EngineFrame => ({ id: `e${i}`, capturedAtMs: i * 1000, latestAtMs: i * 1000, jpeg: Buffer.from(`${i}`), sha256: sha256(Buffer.from(`${i}`)), width: 480, height: 360, eye: null, view });
const cup: Detection = det("cup", 0.9, [220, 160, 40, 20], 41);

/** 컵 하나를 1~3초에 등장 확인한 World State와 도우미. say: 그 초의 전체 사진 VLM 답, crop: 그 초 원본 프레임을 잘라 본 VLM 답. view: 그 카메라로 찍은 프레임(없으면 맞추기 전). */
function scene(view: CameraView | null = null) {
  const w = ws();
  let ids = new Map<string, string>();
  for (let i = 1; i <= 3; i++) ids = w.applyDetections(frame(i, view), [cup]).ids;
  const obs = (states: string[]): SceneObservation => ({ scene: "k", observations: states.map((state) => ({ object_id: "d1", state: state as SceneObservation["observations"][number]["state"] })), summary: "s" });
  const say = (i: number, ...states: string[]) => w.applyScene(`e${i}`, i * 1000, obs(states), ids);
  const crop = (i: number, ...states: string[]) => w.applyCloserScene(`e${i}`, i * 1000, obs(states), ids);
  const cupNow = () => w.view(99_000).objects[0]!;
  const lines = (c: { kind: string; text: string; meaningful: boolean }[]) => c.filter((x) => x.kind === "state").map((x) => [x.text, x.meaningful]);
  return { w, say, crop, cupNow, lines };
}

describe("내용물 확인", () => {
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

describe("사람 답", () => {
  it("지금 세대의 답은 확인 값(출처 사람)이고 판단 계기다. 그 뒤 VLM 답은 받지 않는다. 늦은 세대의 답은 버린다", () => {
    const s = scene();
    s.say(1, "has_contents");
    const gen = s.cupNow().contents_gen ?? 0;
    expect(s.w.answerContents("cup_1", "empty", 6000, gen + 1)).toBeNull();
    expect(s.w.answerContents("cup_9", "empty", 6000, gen)).toBeNull();
    expect(s.w.answerContents("cup_1", "empty", 6000, gen)).toEqual([expect.objectContaining({ kind: "state", subject: "cup_1", text: "컵 cup_1 비어 있음 · 사람이 답함", meaningful: true })]);
    expect(s.cupNow().facts.contents).toMatchObject({ value: "empty", certainty: "confirmed", by: "person", since_ms: 6000 });
    for (const i of [7, 9, 11, 13]) s.say(i, "has_contents");
    s.say(5, "has_contents"); // 답 앞에 찍힌 늦은 사진
    expect(s.cupNow().facts.contents).toMatchObject({ value: "empty", by: "person", certainty: "confirmed" });
    expect(s.w.answerContents("cup_1", "has_contents", 14_000, gen)).toBeNull(); // 같은 질문의 두 번째 답
  });
});

describe("불투명 컵", () => {
  it("불투명이 확인되면 VLM 내용물 답을 쓰지 않고 「안이 안 보임」(확인됨)이다. 사람 답은 받는다", () => {
    const s = scene();
    s.say(1, "opaque", "has_contents"); s.say(2, "opaque");
    expect(s.cupNow().facts.contents).toMatchObject({ value: "contents_unknown", certainty: "confirmed" });
    for (const i of [3, 5, 7]) s.say(i, "empty");
    expect(s.cupNow().facts.contents).toMatchObject({ value: "contents_unknown", certainty: "confirmed" });
    s.w.answerContents("cup_1", "empty", 8000, s.cupNow().contents_gen ?? 0);
    expect(s.cupNow().facts.contents).toMatchObject({ value: "empty", certainty: "confirmed", by: "person" });
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
    expect(s.cupNow()).toMatchObject({ contents_gen: 2, contents_past: [{ value: "empty", by: "vlm", at_ms: 5000 }] });
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
const BOTTLE_TILT: [number, number, number, number] = [215, 100, 60, 40];
const BOTTLE_UP: [number, number, number, number] = [225, 70, 25, 70];
const pourer = describePose(standing({ 10: [240, 120, 0.9] }));
const someone = det("person", 0.9, [80, 60, 200, 300], 0);

describe("마시기·따르기 사건", () => {
  it("입에 댐: 컵을 든 손목이 있고 얼굴 점이 컵 상자에서 scale × 0.5 안", () => {
    expect(atMouth([drinker], CUP_BOX)).toBe(true);
    expect(atMouth([waist], CUP_BOX)).toBe(false);
    expect(atMouth([describePose(standing({ 0: [240, 150, 0.9] }))], CUP_BOX)).toBe(false); // 들지 않음
  });
  it("따름: 중력 방향 좌표에서 든 병이 기울었고(옆/위 0.8 이상) 컵 위에서 옆으로 겹치며, 병 아래가 컵 위에서 컵 높이 안(아래로는 컵 높이 절반까지)", () => {
    const DOWN: [number, number] = [0, 1]; // 폰을 세워 들었다: 사진 아래가 중력 아래
    expect(pouringInto([pourer], BOTTLE_TILT, CUP_BOX, DOWN)).toBe(true);
    expect(pouringInto([describePose(standing({ 10: [237, 100, 0.9] }))], BOTTLE_UP, CUP_BOX, DOWN)).toBe(false);
    expect(pouringInto([pourer], [400, 100, 60, 40], CUP_BOX, DOWN)).toBe(false);
    // 병 아래가 컵 위보다 한참 아래(컵 앞에서 병을 들고 있음): 따름이 아니다
    expect(pouringInto([describePose(standing({ 10: [240, 170, 0.9] }))], [215, 150, 60, 40], CUP_BOX, DOWN)).toBe(false);
    // 카메라 자세가 없으면(중력 방향 모름) 보류한다
    expect(pouringInto([pourer], BOTTLE_TILT, CUP_BOX, null)).toBe(false);
  });

  it("따름: 폰을 90° 돌려 들면 사진에서 가로로 누운 세운 병은 기운 병이 아니고, 사진에서 세로로 선 기운 병은 기운 병이다", () => {
    const RIGHT: [number, number] = [1, 0]; // 중력이 사진 오른쪽
    // 컵(중력 위는 사진 왼쪽): 사진 [300,150,20,40]. 세운 병: 컵 왼쪽(위)에서 사진 가로로 긴 상자
    const cupR: [number, number, number, number] = [300, 150, 20, 40];
    const upright: [number, number, number, number] = [220, 155, 70, 25];
    expect(pouringInto([describePose(standing({ 10: [250, 165, 0.9] }))], upright, cupR, RIGHT)).toBe(false);
    // 기운 병: 사진 세로로 긴 상자(중력 옆으로 길다), 컵 위쪽(사진 왼쪽)에 붙어 옆으로 겹침
    const tilted: [number, number, number, number] = [265, 140, 30, 60];
    expect(pouringInto([describePose(standing({ 10: [280, 170, 0.9] }))], tilted, cupR, RIGHT)).toBe(true);
    expect(pouringInto([describePose(standing({ 10: [280, 170, 0.9] }))], tilted, cupR, [0, 1])).toBe(false); // 사진 축으로 보면 세운 병
  });
  it("확인된 내용물 있음 컵을 입에 대면 「다시 확인 필요」로 열린다(이전 값 보관, 계기 아닌 줄 하나). 사건 앞에 찍힌 늦은 사진은 버리고 그 뒤 3장·4초가 새 값을 정한다", () => {
    const s = scene();
    for (const i of [1, 3, 5]) s.say(i, "has_contents");
    const { changes } = s.w.applyDetections(frame(6), [someone, cup], [standing({ ...AT_MOUTH })]);
    expect(changes.filter((c) => c.text.includes("내용물 다시 확인"))).toEqual([expect.objectContaining({ text: "컵 cup_1 입에 댐 · 내용물 다시 확인", meaningful: false })]);
    expect(s.cupNow()).toMatchObject({ contents_past: [{ value: "has_contents" }] });
    expect(s.cupNow().facts.contents).toMatchObject({ value: "has_contents", certainty: "inferred" });
    // 이어서 입에 댐: 줄 없음
    expect(s.w.applyDetections(frame(7), [someone, cup], [standing({ ...AT_MOUTH })]).changes.filter((c) => c.text.includes("내용물 다시 확인"))).toEqual([]);
    s.say(5, "empty"); // 사건 앞에 찍힌 늦은 답
    for (const i of [8, 10]) s.say(i, "empty");
    expect(s.cupNow().facts.contents).toMatchObject({ certainty: "inferred" });
    s.say(12, "empty");
    expect(s.cupNow().facts.contents).toMatchObject({ value: "empty", certainty: "confirmed" });
  });
  it("따름: 중력이 사진 축에서 20° 넘게 기울면(상자로는 병 방향을 모름) 보류한다: 45°로 든 폰에서 세운 병도 기운 병도 따르기로 보지 않는다", () => {
    const D45: [number, number] = [Math.SQRT1_2, Math.SQRT1_2];
    // 세운 25×70 병을 45° 돌린 사진 상자(약 67×67): 중력 위쪽으로 컵 바로 위에 있다(상자로만 보면 기운 병으로 보인다)
    const p = describePose(standing({ 10: [210, 90, 0.9] }));
    expect(pouringInto([p], [180, 60, 67, 67], CUP_BOX, D45)).toBe(false);
    expect(pouringInto([pourer], BOTTLE_TILT, CUP_BOX, [Math.sin(0.3), Math.cos(0.3)])).toBe(true); // 17°: 본다
  });

  it("기운 병을 컵 위에서 들면 그 컵이 「따르는 모습」으로 열린다(카메라 자세가 있을 때만)", () => {
    const s = scene(LOOK_VIEW);
    for (const i of [1, 3, 5]) s.say(i, "empty");
    const bottle = det("bottle", 0.9, BOTTLE_TILT, 39);
    const { changes } = s.w.applyDetections(frame(6, LOOK_VIEW), [someone, cup, bottle], [standing({ 10: [240, 120, 0.9] })]);
    expect(changes.filter((c) => c.text.includes("내용물 다시 확인")).map((c) => c.text)).toEqual(["컵 cup_1 따르는 모습 · 내용물 다시 확인"]);
    const n = scene();
    for (const i of [1, 3, 5]) n.say(i, "empty");
    const none = n.w.applyDetections(frame(6), [someone, cup, bottle], [standing({ 10: [240, 120, 0.9] })]).changes;
    expect(none.filter((c) => c.text.includes("내용물 다시 확인"))).toEqual([]);
  });
  it("사람 답보다 먼저 찍힌 관절 사건(감지 대기열에서 늦게 나온 프레임)은 사람 답을 지우지 않고 세대도 올리지 않는다", () => {
    const s = scene();
    s.w.answerContents("cup_1", "empty", 6000, 0);
    const gen = s.cupNow().contents_gen;
    s.w.applyDetections(frame(5), [someone, cup], [standing({ ...AT_MOUTH })]);
    expect(s.cupNow()).toMatchObject({ contents_gen: gen, facts: { contents: { value: "empty", certainty: "confirmed", by: "person" } } });
  });
  it("사람이 답한 값도 사건이 다시 연다", () => {
    const s = scene();
    s.w.answerContents("cup_1", "has_contents", 4000, 0);
    s.w.applyDetections(frame(6), [someone, cup], [standing({ ...AT_MOUTH })]);
    expect(s.cupNow().facts.contents).toMatchObject({ value: "has_contents", certainty: "inferred" });
    expect(s.cupNow().facts.contents?.by).toBeUndefined();
  });
});
