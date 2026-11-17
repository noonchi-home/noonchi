// 내용물 갱신기(src/world/state/contents.ts): 새 값은 서로 다른 사진 3장·4초(이웃 사진 6초 안)이거나 사람 답. 확인 값은 행동(사건·따르기 단계)으로만 다시 연다.
import { describe, expect, it } from "vitest";
import { WorldState } from "../src/world/state/world.js";
import { sha256 } from "../src/observe/ring.js";
import type { Detection, EngineFrame } from "../src/contract/observe.js";
import { det } from "./helpers/detectors.js";

const ws = () => new WorldState({ evidenceStepMs: 1000, surfaces: () => [], floorAt: () => 0, roomAt: () => ({ id: "kitchen", label: "주방" }), devices: () => [] });
const frame = (i: number): EngineFrame => ({ id: `e${i}`, capturedAtMs: i * 1000, latestAtMs: i * 1000, jpeg: Buffer.from(`${i}`), sha256: sha256(Buffer.from(`${i}`)), width: 480, height: 360, eye: null, view: null });
const cup: Detection = det("cup", 0.9, [220, 160, 40, 20], 41);

/** 컵 하나를 1~3초에 등장 확인한 World State와 도우미. say: 그 초의 전체 사진 VLM 답, crop: 그 초 원본 프레임을 잘라 본 VLM 답. */
function scene() {
  const w = ws();
  let ids = new Map<string, string>();
  for (let i = 1; i <= 3; i++) ids = w.applyDetections(frame(i), [cup]).ids;
  const obs = (states: string[]) => ({ scene: "k", observations: states.map((state) => ({ object_id: "d1", state })), summary: "s" });
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
