// 마시기·따르기 사건은 장면 VLM 답으로 낸다(Task 8, 2026-11-18): 그 답의 컵 번호에 단 순간 값 drank(마심)·poured(따름)가 그 컵의 확인된 내용물을 다시 연다.
// 사람의 「마시는 중」(하는 일)은 VLM 장면 사실로 그대로 나오고, 그것만으로는 내용물을 다시 열지 않는다(다른 에이전트가 마시는 걸 보면 목표를 세운다).
import { describe, expect, it } from "vitest";
import type { SceneObservation } from "../src/contract/observe.js";
import type { WorldChange } from "../src/contract/world.js";
import type { SceneState } from "../src/observe/scene.js";
import { SCENE_PROMPT } from "../src/observe/scene.js";
import { WorldState } from "../src/world/state/world.js";
import { AWAY_VIEW, LOOK_SIZE, LOOK_VIEW } from "./helpers/camera.js";

const ws = () => new WorldState({ evidenceStepMs: 1000, surfaces: () => [], floorAt: () => 0, roomAt: () => ({ id: "kitchen", label: "주방" }), devices: () => [] });
const look = { view: LOOK_VIEW, ...LOOK_SIZE, eye: [0, 0] as [number, number] };
const CUP = { id: "v1", cls: "cup" as const, box: { x: 230 / 480, y: 170 / 360, w: 20 / 480, h: 10 / 360 }, det: null };
/** 컵 하나(v1)를 답하고 그 컵·사람(d1)에 사실을 단 장면 답. */
const scene = (facts: [string, SceneState][] = []): SceneObservation => ({ scene: "k", summary: "s", objects: [CUP], observations: facts.map(([object_id, state]) => ({ object_id, state })) });
/** VLM 답 하나: 가장 새 사진 at, 그 답이 본 가장 옛 사진 from(최근 5장, 8초 앞). 사람 감지 d1은 사람이다. */
const answer = (w: WorldState, at: number, facts: [string, SceneState][] = [], from = at - 8000): WorldChange[] =>
  w.applyScene(`e${at}`, at, scene(facts), new Map([["d1", "person"]]), look, from);
const again = (changes: WorldChange[]) => changes.filter((c) => c.text.includes("내용물 다시 확인")).map((c) => c.text);
/** 확인된 컵(1·2초)에 내용물 있음 세 장(3·5·8초)으로 확인 값을 둔다. */
const filled = () => {
  const w = ws();
  answer(w, 1000, [], 1000);
  answer(w, 2000, [], 1000);
  for (const t of [3000, 5000, 8000]) answer(w, t, [["v1", "has_contents"]]);
  expect(w.view(8000).objects[0]?.facts.contents).toMatchObject({ value: "has_contents", certainty: "confirmed" });
  return w;
};

describe("마시기·따르기 사건(VLM 순간 값)", () => {
  it("이웃한 세 답(구간이 겹침)이 같은 컵 마심을 답하면 내용물 다시 열기는 한 번이다", () => {
    const w = filled();
    const lines = [10000, 12000, 14000].flatMap((t) => again(answer(w, t, [["v1", "drank"]])));
    expect(lines).toEqual(["컵 cup_1 마심 · 내용물 다시 확인"]);
    expect(w.view(14000).objects[0]?.facts.contents?.certainty).not.toBe("confirmed");
  });

  it("구간이 떨어진 두 번째 마심은 또 한 번 연다", () => {
    const w = filled();
    expect(again(answer(w, 10000, [["v1", "drank"]]))).toHaveLength(1);
    for (const t of [16000, 18000, 21000]) answer(w, t, [["v1", "has_contents"]], t - 2000);
    expect(w.view(21000).objects[0]?.facts.contents).toMatchObject({ value: "has_contents", certainty: "confirmed" });
    // 앞 사건 구간 [2초, 10초]과 겹치지 않는다
    expect(again(answer(w, 30000, [["v1", "drank"]]))).toEqual(["컵 cup_1 마심 · 내용물 다시 확인"]);
  });

  it("따름도 연다(「따름」)", () => {
    const w = filled();
    expect(again(answer(w, 10000, [["v1", "poured"]]))).toEqual(["컵 cup_1 따름 · 내용물 다시 확인"]);
  });

  it("사람의 마시는 중은 VLM 장면 사실로 그대로 나오고, 그것만으로는 내용물을 다시 열지 않는다", () => {
    const w = filled();
    const lines = [10000, 12000].flatMap((t) => again(answer(w, t, [["d1", "drinking"]])));
    expect(lines).toEqual([]);
    expect(w.view(12000).person.facts.activity?.value).toBe("drinking");
    expect(w.view(12000).objects[0]?.facts.contents).toMatchObject({ value: "has_contents", certainty: "confirmed" });
  });

  it("이은 물건이 없는 번호의 마심은 사건이 아니다", () => {
    const w = filled();
    expect(again(answer(w, 10000, [["v9", "drank"]]))).toEqual([]);
  });

  it("프롬프트는 컵·병·그릇의 순간 값으로 마심·따름을 묻는다(사람 순간 값이 아니다)", () => {
    expect(SCENE_PROMPT).toMatch(/drank \(/);
    expect(SCENE_PROMPT).toMatch(/poured \(/);
    const people = SCENE_PROMPT.slice(SCENE_PROMPT.indexOf("People."));
    expect(people).not.toMatch(/\bdrank\b/);
  });

  // Codex P2(caf638f): 늦게 도착한 옛 마심 답이 더 새 사진으로 확인한 내용물을 다시 열었다
  it("확인 근거(가장 새 확인 사진)보다 옛 마심은 늦게 와도 열지 않는다", () => {
    const w = filled();
    expect(again(answer(w, 6000, [["v1", "drank"]], 0))).toEqual([]);
    expect(w.view(8000).objects[0]?.facts.contents).toMatchObject({ value: "has_contents", certainty: "confirmed" });
  });

  // Codex P2(caf638f): 겹친 구간을 끝없이 늘려 8초 안에 되풀이된 다른 마심까지 한 사건이 돼, 그 사이 확인된 내용물이 다음 마심에 다시 열리지 않았다
  it("사건 사이에 내용물이 확인됐으면 구간이 겹쳐도 새 사건이다", () => {
    const w = filled();
    expect(again(answer(w, 10000, [["v1", "drank"]]))).toHaveLength(1);
    for (const t of [11000, 13000, 15500]) answer(w, t, [["v1", "has_contents"]], t - 1000);
    expect(w.view(15500).objects[0]?.facts.contents).toMatchObject({ value: "has_contents", certainty: "confirmed" });
    // 앞 사건 구간 [2초, 10초]과 겹친다
    expect(again(answer(w, 16000, [["v1", "drank"]]))).toEqual(["컵 cup_1 마심 · 내용물 다시 확인"]);
  });

  it("한 사건 구간은 16초까지만 늘린다: 마심 답이 이어지면 16초를 넘는 답부터 새 사건으로 다시 연다", () => {
    const w = filled();
    const gens: number[] = [];
    for (let t = 10000; t <= 30000; t += 2000) {
      answer(w, t, [["v1", "drank"]]);
      gens.push(w.view(t).objects[0]!.contents_gen!);
    }
    // 사건: [2, 10]초에서 열고, [12, 20]초·[22, 30]초 답에서 다시 연다
    expect(new Set(gens).size).toBe(3);
  });
});

// Codex P2(caf638f): 잇기(relink)가 내용물 상태는 옮겼지만 물건 id별 사건 기록은 옮기지 않아, 합친 뒤 같은 마심을 새 id로 답하면 새 사건이 됐다
it("잇기는 마시기·따르기 사건 기록도 대상 id로 옮긴다: 합친 뒤 같은 마심(구간 겹침)은 다시 열지 않는다", () => {
  const w = ws();
  const bottle = (facts: [string, SceneState][] = []): SceneObservation => ({ scene: "k", summary: "s", objects: [{ ...CUP, cls: "bottle" }], observations: facts.map(([object_id, state]) => ({ object_id, state })) });
  // 병 bottle_1(1·2초 확정)에 내용물 있음 확인(3·5·8초), 10초 답에서 마심
  for (const t of [1000, 2000]) w.applyScene(`e${t}`, t, bottle(), new Map(), look, t);
  for (const t of [3000, 5000, 8000]) w.applyScene(`e${t}`, t, bottle([["v1", "has_contents"]]), new Map(), look, t - 2000);
  // 다른 자리에 대상 컵 cup_2(AWAY 카메라라 같은 자리가 아니다)
  w.applyScene("a1", 8500, { ...scene(), objects: [{ ...CUP, box: { x: 300 / 480, y: 150 / 360, w: 20 / 480, h: 10 / 360 } }] }, new Map(), { ...look, view: AWAY_VIEW }, 8500);
  w.applyScene("a2", 9000, { ...scene(), objects: [{ ...CUP, box: { x: 300 / 480, y: 150 / 360, w: 20 / 480, h: 10 / 360 } }] }, new Map(), { ...look, view: AWAY_VIEW }, 9000);
  const first = w.applyScene("e10000", 10000, bottle([["v1", "drank"]]), new Map(), look, 2000);
  expect(again(first)).toHaveLength(1);
  const cup = w.view(10000).objects.find((o) => o.cls === "cup")!;
  expect(w.relink("bottle_1", cup.id, 10000)).toBe(true);
  const gen = w.view(10000).objects.find((o) => o.id === cup.id)!.contents_gen;
  // 합친 뒤 같은 마심(앞 사건 구간과 겹침, 그 사이 확인 없음)을 대상 id로 답한다: 같은 사건이라 다시 열지 않는다(세대 그대로)
  w.applyScene("e12000", 12000, { scene: "k", summary: "s", objects: [], observations: [{ object_id: "d1", state: "drank" }] }, new Map([["d1", cup.id]]), look, 4000);
  expect(w.view(12000).objects.find((o) => o.id === cup.id)!.contents_gen).toBe(gen);
});

