import { describe, expect, it } from "vitest";
import { Confirmer } from "../src/world/confirm.js";

const need = (k: string) => (k === "person" ? 2 : 3);
describe("등장·사라짐 확인", () => {
  it("사람은 2장, 물건은 3장 연속일 때 인정한다", () => {
    const c = new Confirmer(need);
    const all = ["person", "cup_1"];
    expect(c.observe(1, new Set(["person", "cup_1"]), all, () => true)).toEqual([]);
    expect(c.observe(2, new Set(["person", "cup_1"]), all, () => true)).toEqual([{ key: "person", kind: "appeared", atMs: 2 }]);
    expect(c.observe(3, new Set(["person", "cup_1"]), all, () => true)).toEqual([{ key: "cup_1", kind: "appeared", atMs: 3 }]);
  });
  it("시야 밖이면 사라짐으로 세지 않고, 끊기면 처음부터 센다", () => {
    const c = new Confirmer(need);
    for (let i = 1; i <= 3; i++) c.observe(i, new Set(["cup_1"]), ["cup_1"], () => true);
    expect(c.observe(4, new Set(), ["cup_1"], () => false)).toEqual([]);
    c.observe(5, new Set(), ["cup_1"], () => true);
    c.observe(6, new Set(["cup_1"]), ["cup_1"], () => true);
    c.observe(7, new Set(), ["cup_1"], () => true);
    c.observe(8, new Set(), ["cup_1"], () => true);
    expect(c.observe(9, new Set(), ["cup_1"], () => true)).toEqual([{ key: "cup_1", kind: "gone", atMs: 9 }]);
    expect(c.present("cup_1")).toBe(false);
  });
  it("셈하던 키가 다음 장에 안 보이면 candidates에 없어도 처음부터 센다", () => {
    const c = new Confirmer(need);
    expect(c.observe(1, new Set(["cup_1"]), [], () => true)).toEqual([]);
    expect(c.observe(2, new Set(), [], () => true)).toEqual([]);
    expect(c.observe(3, new Set(["cup_1"]), [], () => true)).toEqual([]);
    expect(c.observe(4, new Set(["cup_1"]), [], () => true)).toEqual([]);
    expect(c.observe(5, new Set(["cup_1"]), [], () => true)).toEqual([{ key: "cup_1", kind: "appeared", atMs: 5 }]);
  });
  it("mark는 있다고 인정하고 그 키의 셈을 지운다(가까이 보기가 새 촬영으로 본 물건)", () => {
    const c = new Confirmer(need);
    for (let i = 1; i <= 3; i++) c.observe(i, new Set(["cup_1"]), ["cup_1"], () => true);
    c.observe(4, new Set(), ["cup_1"], () => true);
    c.observe(5, new Set(), ["cup_1"], () => true);
    c.mark("cup_1");
    expect(c.observe(6, new Set(), ["cup_1"], () => true)).toEqual([]);
    expect(c.observe(7, new Set(), ["cup_1"], () => true)).toEqual([]);
    expect(c.observe(8, new Set(), ["cup_1"], () => true)).toEqual([{ key: "cup_1", kind: "gone", atMs: 8 }]);
    c.mark("bowl_1");
    expect(c.present("bowl_1")).toBe(true);
    expect(c.observe(9, new Set(["bowl_1"]), [], () => true)).toEqual([]);
  });
  it("한 장만 보인 키와 잊은 키의 셈은 남지 않는다", () => {
    const c = new Confirmer(need);
    for (let i = 0; i < 100; i++) {
      c.observe(2 * i, new Set([`cup_${i}`]), [], () => true);
      c.observe(2 * i + 1, new Set(), [], () => true);
    }
    expect(c.pending).toBe(0);
    c.observe(300, new Set(["bowl_1"]), [], () => true);
    c.forget("bowl_1");
    expect(c.pending).toBe(0);
  });
});
