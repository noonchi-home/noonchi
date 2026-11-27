// @vitest-environment node
// 「FSM 바뀜」 칸 그림 자리(ui/src/dashboard/fsm-graph.ts): 상태 원 자리, 화살표 모양, 어느 상태로든(*)은 자리에 없음 원, 칸 안에 드는지.
import { describe, expect, it } from "vitest";
import { CUP_FSM_MEMORY } from "../../../src/brain/decision.ts";
import { CHIP_HALF, bendOf, endOf, lanesOf, spotsOf, type Spot } from "../../src/dashboard/fsm-graph";

const box = { width: 842, height: 988 };
const spots = spotsOf(["drinking", "watching_tv", "cooking", "away"], box);
const at = (id: string) => spots.find((s) => s.id === id)!;
const start = (path: string) => path.match(/^M\s*(-?[\d.]+)[\s,]+(-?[\d.]+)/)!.slice(1).map(Number);
const dist = (p: number[], s: Spot) => Math.hypot(p[0]! - s.x, p[1]! - s.y);
const CENTER: [number, number] = [421, 494];
/** path 안 좌표 쌍(M·L·Q·C의 점. 원호 a는 쓰지 않는다). */
const points = (path: string) => {
  const n = path.match(/-?[\d.]+/g)!.map(Number);
  return n.flatMap((_, i) => (i % 2 === 0 ? [[n[i]!, n[i + 1]!] as const] : []));
};

describe("FSM 그림 자리", () => {
  it("상태는 기억 차례로 12시부터 시계 방향이고 원은 칸 안이며 서로 겹치지 않는다", () => {
    expect(spots.map((s) => s.id)).toEqual(["drinking", "watching_tv", "cooking", "away"]);
    expect(at("drinking").x).toBeCloseTo(421);
    expect(at("drinking").y).toBeLessThan(at("cooking").y);
    expect(at("watching_tv").x).toBeGreaterThan(at("away").x);
    for (const s of spots) {
      expect(s.x - s.r).toBeGreaterThanOrEqual(0); expect(s.x + s.r).toBeLessThanOrEqual(box.width);
      expect(s.y - s.r).toBeGreaterThanOrEqual(0); expect(s.y + s.r).toBeLessThanOrEqual(box.height);
      for (const o of spots) if (o !== s) expect(Math.hypot(s.x - o.x, s.y - o.y)).toBeGreaterThanOrEqual(2 * s.r);
    }
    expect(spotsOf(["drinking"], box).map((s) => s.id)).toEqual(["drinking"]);
  });

  it("어느 상태로든(*) 화살표 끝은 자리에 없음 원이다", () => {
    expect(endOf("*")).toBe("away");
    expect(endOf("cooking")).toBe("cooking");
  });

  it("seed FSM 그대로 그리면 모든 화살표 점·고리와 칩 자리가 칸 안이다(제자리 고리가 셋)", () => {
    const states = CUP_FSM_MEMORY.states.map((s) => s.id);
    const edges = CUP_FSM_MEMORY.states.flatMap((s) => s.next.map((e) => ({ from: s.id, to: endOf(e.to) })));
    expect(edges.filter((e) => e.from === e.to).length).toBeGreaterThanOrEqual(3);
    const all = spotsOf(states, box);
    const lanes = lanesOf(edges);
    edges.forEach((e, i) => {
      const bend = bendOf(`e${i}`, all.find((s) => s.id === e.from)!, all.find((s) => s.id === e.to)!, lanes[i]!, CENTER);
      for (const [x, y] of points(bend.path)) {
        expect(x, `${e.from}>${e.to} x`).toBeGreaterThanOrEqual(0); expect(x, `${e.from}>${e.to} x`).toBeLessThanOrEqual(box.width);
        expect(y, `${e.from}>${e.to} y`).toBeGreaterThanOrEqual(0); expect(y, `${e.from}>${e.to} y`).toBeLessThanOrEqual(box.height);
      }
      expect(bend.label[1] - CHIP_HALF, `${e.from}>${e.to} 칩 위`).toBeGreaterThanOrEqual(0);
      expect(bend.label[1] + CHIP_HALF, `${e.from}>${e.to} 칩 아래`).toBeLessThanOrEqual(box.height);
      expect(bend.label[0]).toBeGreaterThanOrEqual(0); expect(bend.label[0]).toBeLessThanOrEqual(box.width);
    });
  });

  it("선은 출발 원 테두리에서 시작한다. 같은 쌍의 두 번째 선은 휘어 칩 자리가 30px 넘게 떨어진다", () => {
    const straight = bendOf("a", at("drinking"), at("away"), 0, CENTER);
    const curved = bendOf("b", at("drinking"), at("away"), 1, CENTER);
    expect(dist(start(straight.path), at("drinking"))).toBeCloseTo(at("drinking").r, 0);
    expect(dist(start(curved.path), at("drinking"))).toBeCloseTo(at("drinking").r, 0);
    expect(Math.hypot(straight.label[0] - curved.label[0], straight.label[1] - curved.label[1])).toBeGreaterThan(30);
  });

  it("반대 방향 화살표가 있는 쌍은 두 방향이 서로 다른 쪽으로 휜다(자리에 없음 ↔ 마시는 중)", () => {
    const go = bendOf("go", at("drinking"), at("away"), 1, CENTER);
    const back = bendOf("back", at("away"), at("drinking"), 1, CENTER);
    expect(Math.hypot(go.label[0] - back.label[0], go.label[1] - back.label[1])).toBeGreaterThan(60);
  });

  it("제자리 화살표는 원 바깥(칸 가운데 반대쪽)에 고리를 그린다", () => {
    const loop = bendOf("c", at("cooking"), at("cooking"), 0, CENTER);
    expect(dist(loop.label, at("cooking"))).toBeGreaterThan(at("cooking").r);
    expect(loop.label[1]).toBeGreaterThan(at("cooking").y);
  });

  it("같은 (출발, 도착) 쌍 안 차례: 반대 방향이 있으면 1부터", () => {
    expect(lanesOf([{ from: "a", to: "b" }, { from: "a", to: "b" }, { from: "c", to: "d" }])).toEqual([0, 1, 0]);
    expect(lanesOf([{ from: "a", to: "b" }, { from: "a", to: "b" }, { from: "b", to: "a" }, { from: "a", to: "b" }])).toEqual([1, 2, 1, 3]);
    expect(lanesOf([{ from: "a", to: "a" }, { from: "a", to: "a" }])).toEqual([0, 1]);
  });
});
