import { describe, expect, it } from "vitest";
import { Confirmer, EVIDENCE_GAP_MS, EVIDENCE_STEP_MS, type ConfirmEvent } from "../src/world/confirm.js";

const need = (k: string) => (k === "person" ? 2 : 3);
const S = EVIDENCE_STEP_MS;
const all = ["person", "cup_1"];
const yes = () => true;

/** 같은 장면(촬영 시각 t에 보이는 키)을 stepMs 간격으로 0~endMs까지 넣고 난 사건을 모은다. inView는 사라짐을 셀 수 있는 시각인가. */
function feed(c: Confirmer, stepMs: number, endMs: number, seenAt: (t: number) => string[], inView: (t: number) => boolean = yes): ConfirmEvent[] {
  const out: ConfirmEvent[] = [];
  for (let t = 0; t <= endMs; t += stepMs) out.push(...c.observe(t, new Set(seenAt(t)), all, () => inView(t)));
  return out;
}

describe("등장·사라짐 확인", () => {
  it("2초 간격: 사람은 2장, 물건은 3장 이어 보이면 등장이다(시간 기준 2초·4초)", () => {
    expect([S, EVIDENCE_GAP_MS]).toEqual([2000, 500]);
    const c = new Confirmer(need);
    expect(c.observe(0, new Set(all), all, yes)).toEqual([]);
    expect(c.observe(2000, new Set(all), all, yes)).toEqual([{ key: "person", kind: "appeared", atMs: 2000 }]);
    expect(c.observe(4000, new Set(all), all, yes)).toEqual([{ key: "cup_1", kind: "appeared", atMs: 4000 }]);
  });

  it("같은 장면을 2000ms 간격과 100ms 간격으로 넣으면 같은 촬영 시각에 같은 사건이 난다(등장·사라짐)", () => {
    // 사람은 0~10초, 컵은 2~12초에 보인다. 끝은 30초
    const scene = (t: number) => [...(t <= 10_000 ? ["person"] : []), ...(t >= 2000 && t <= 12_000 ? ["cup_1"] : [])];
    const want = [
      { key: "person", kind: "appeared", atMs: 2000 }, // 처음 본 뒤 2초
      { key: "cup_1", kind: "appeared", atMs: 6000 }, // 처음 본 뒤 4초
      { key: "person", kind: "gone", atMs: 14_000 }, // 마지막으로 본 뒤 4초
      { key: "cup_1", kind: "gone", atMs: 18_000 }, // 마지막으로 본 뒤 6초
    ];
    expect(feed(new Confirmer(need), 2000, 30_000, scene)).toEqual(want);
    expect(feed(new Confirmer(need), 100, 30_000, scene)).toEqual(want);
    expect(feed(new Confirmer(need), 500, 30_000, scene)).toEqual(want);
  });

  it("등장 장 수를 따로 주면(appearNeed) 등장만 그 시간이고 사라짐은 need 그대로다: 물건 등장 2초·사라짐 6초", () => {
    const c = new Confirmer(need, S, () => 2);
    const scene = (t: number) => (t >= 2000 && t <= 12_000 ? ["cup_1"] : []);
    expect(feed(c, 100, 30_000, scene)).toEqual([{ key: "cup_1", kind: "appeared", atMs: 4000 }, { key: "cup_1", kind: "gone", atMs: 18_000 }]);
  });

  it("100ms 간격에서 3장만 보인 물건은 등장이 아니다(장 수가 아니라 시간)", () => {
    const c = new Confirmer(need);
    expect(feed(c, 100, 3900, () => ["cup_1"])).toEqual([]);
    expect(c.observe(4000, new Set(["cup_1"]), all, yes)).toEqual([{ key: "cup_1", kind: "appeared", atMs: 4000 }]);
  });

  it("100ms 간격에서 한두 장 놓쳐도 셈을 끊지 않는다. 500ms 넘게 못 보면 처음부터 센다", () => {
    // 1.0·1.1초 두 장을 놓침: 등장 시각은 그대로 4초
    expect(feed(new Confirmer(need), 100, 6000, (t) => (t === 1000 || t === 1100 ? [] : ["cup_1"]))).toEqual([{ key: "cup_1", kind: "appeared", atMs: 4000 }]);
    // 1.0~1.5초(마지막으로 본 0.9초 뒤 600ms)를 놓침: 1.6초부터 다시 세어 5.6초
    expect(feed(new Confirmer(need), 100, 6000, (t) => (t >= 1000 && t <= 1500 ? [] : ["cup_1"]))).toEqual([{ key: "cup_1", kind: "appeared", atMs: 5600 }]);
  });

  it("절반 넘게 놓치면 시간이 지나도 등장이 아니다(세 장에 한 장만 보임)", () => {
    expect(feed(new Confirmer(need), 100, 20_000, (t) => ((t / 100) % 3 === 0 ? ["cup_1"] : []))).toEqual([]);
  });

  it("사라짐 셈 중에 100ms 한 장 잘못 보여도 끊지 않는다", () => {
    const scene = (t: number) => (t <= 4000 || t === 6000 ? ["cup_1"] : []);
    expect(feed(new Confirmer(need), 100, 12_000, scene).filter((e) => e.kind === "gone")).toEqual([{ key: "cup_1", kind: "gone", atMs: 10_000 }]);
  });

  it("오래 프레임이 없다가 온 한 장은 2초어치로만 센다(60초 비었다고 바로 인정하지 않는다)", () => {
    const c = new Confirmer(need);
    c.observe(0, new Set(["cup_1"]), all, yes);
    expect(c.observe(60_000, new Set(["cup_1"]), all, yes)).toEqual([]);
    expect(c.observe(62_000, new Set(["cup_1"]), all, yes)).toEqual([{ key: "cup_1", kind: "appeared", atMs: 62_000 }]);
    expect(c.observe(120_000, new Set(), all, yes)).toEqual([]);
    expect(c.observe(122_000, new Set(), all, yes)).toEqual([]);
    expect(c.observe(124_000, new Set(), all, yes)).toEqual([{ key: "cup_1", kind: "gone", atMs: 124_000 }]);
  });

  it("시야 밖이면 사라짐으로 세지 않고(셈을 멈춤), 다시 보이면 처음부터 센다", () => {
    for (const step of [2000, 100]) {
      // 컵은 0~4초에 보인다. 4초 뒤~8초는 시야 밖, 12~14초에 다시 보이고 그 뒤 안 보인다
      const scene = (t: number) => (t <= 4000 || (t >= 12_000 && t <= 14_000) ? ["cup_1"] : []);
      const inView = (t: number) => !(t > 4000 && t <= 8000);
      const c = new Confirmer(need);
      // 8초까지는 시야 밖이라 세지 않고, 그 뒤 12초에 다시 보여 끊긴다. 마지막으로 본 14초에서 6초 뒤 사라짐
      expect(feed(c, step, 30_000, scene, inView), `${step}ms`).toEqual([{ key: "cup_1", kind: "appeared", atMs: 4000 }, { key: "cup_1", kind: "gone", atMs: 20_000 }]);
      expect(c.present("cup_1")).toBe(false);
    }
  });

  it("시야 밖 시간은 사라짐 시간에 넣지 않는다", () => {
    for (const step of [2000, 100]) {
      // 컵은 0~4초에 보인다. 4초 뒤~8초는 시야 밖: 시야 안에서 못 본 시간이 6초가 되는 14초에 사라짐
      const c = new Confirmer(need);
      const events = feed(c, step, 30_000, (t) => (t <= 4000 ? ["cup_1"] : []), (t) => !(t > 4000 && t <= 8000));
      expect(events.at(-1), `${step}ms`).toEqual({ key: "cup_1", kind: "gone", atMs: 14_000 });
    }
  });

  it("셈하던 키가 다음 장에 안 보이면 candidates에 없어도 처음부터 센다(2초 간격)", () => {
    const c = new Confirmer(need);
    const at = (t: number, seen: string[]) => c.observe(t, new Set(seen), [], yes);
    expect(at(0, ["cup_1"])).toEqual([]);
    expect(at(2000, [])).toEqual([]);
    expect(at(4000, ["cup_1"])).toEqual([]);
    expect(at(6000, ["cup_1"])).toEqual([]);
    expect(at(8000, ["cup_1"])).toEqual([{ key: "cup_1", kind: "appeared", atMs: 8000 }]);
  });

  it("mark는 있다고 인정하고 그 키의 셈을 지운다(가까이 보기가 새 촬영으로 본 물건)", () => {
    const c = new Confirmer(need);
    for (const t of [0, 2000, 4000]) c.observe(t, new Set(["cup_1"]), ["cup_1"], yes);
    c.observe(6000, new Set(), ["cup_1"], yes);
    c.observe(8000, new Set(), ["cup_1"], yes);
    c.mark("cup_1");
    expect(c.observe(10_000, new Set(), ["cup_1"], yes)).toEqual([]);
    expect(c.observe(12_000, new Set(), ["cup_1"], yes)).toEqual([]);
    expect(c.observe(14_000, new Set(), ["cup_1"], yes)).toEqual([{ key: "cup_1", kind: "gone", atMs: 14_000 }]);
    c.mark("bowl_1");
    expect(c.present("bowl_1")).toBe(true);
    expect(c.observe(16_000, new Set(["bowl_1"]), [], yes)).toEqual([]);
  });

  it("skip인 키는 그 프레임을 넣지 않는다(셈을 늘리지도 끊지도 않는다)", () => {
    const c = new Confirmer(need);
    c.observe(0, new Set(["cup_1"]), all, yes);
    c.observe(2000, new Set(["cup_1"]), all, yes);
    expect(c.observe(3000, new Set(), all, yes, (k) => k === "cup_1")).toEqual([]);
    expect(c.observe(4000, new Set(["cup_1"]), all, yes)).toEqual([{ key: "cup_1", kind: "appeared", atMs: 4000 }]);
  });

  it("한 장만 보인 키와 잊은 키의 셈은 남지 않는다", () => {
    const c = new Confirmer(need);
    for (let i = 0; i < 100; i++) {
      c.observe(4000 * i, new Set([`cup_${i}`]), [], yes);
      c.observe(4000 * i + 2000, new Set(), [], yes);
    }
    expect(c.pending).toBe(0);
    c.observe(500_000, new Set(["bowl_1"]), [], yes);
    c.forget("bowl_1");
    expect(c.pending).toBe(0);
  });
});
