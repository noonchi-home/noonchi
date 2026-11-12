// 디자인 토큰 대비·색 차이 검사(src/design/color-check.ts). tokens.json contrast 표를 지금 토큰 값으로 다시 재서 같고 기준을 넘는지 본다.
// 토큰 색을 바꾸면 표가 어긋나 실패한다: 값을 바꿀 때는 표도 다시 재서 고친다. 트윈 위 표시는 실제 트윈 캡처 화소(tests/fixtures/twin-pixels) 위에서도 본다.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { contrast, deltaE2000, glareContrast, over, simulate, unitContrast } from "../src/design/color-check.js";
import { readPng } from "./helpers/png.js";

const tokens: unknown = JSON.parse(readFileSync(fileURLToPath(new URL("../src/design/tokens.json", import.meta.url)), "utf8"));

type Row = { fg: string; fgValue: string; bg: string; bgValue: string; ratio: number; need: number };
const T = tokens as unknown as {
  color: Record<string, { value: string }>;
  alias: Record<string, { ref: string } | string>;
  contrast: {
    text: Row[]; largeText: Row[]; ui: Row[];
    twinUnit: { color: string; value: string; cells: { bg: string; core: number; casing: number; edge: number }[] }[];
    twinUnitWorstGray: { gray: string; best: number };
    twinBubble: { bg: string; fill: number; edge: number }[];
    phoneVideo: { color: string; bg: string; core: number; casing: number; edge: number }[];
    phoneGlare10: { fg: string; bg: string; ratio: number }[];
    cvd: Record<"vizStatus" | "pathRoles" | "bubbleNumber", { a: string; b: string; normal: number; protan: number; deutan: number; byColor?: boolean; byShape?: boolean; byIcon?: boolean }[]>;
    deltaE2000: Record<string, number>;
    samples: Record<string, string>;
  };
  overlayLine: { casing: { ref: string; opacity: number }; edge: { ref: string } };
  viz: { status: Record<string, { ref: string }>; attention: { ref: string }; path: Record<string, { color: { ref: string }; width: number; endMark?: string }> };
};

/** 토큰 이름 → hex. 반투명 최악 표본(glass-worst 등)은 contrast.samples에서. */
const hex = (name: string): string => {
  const v = T.color[name]?.value ?? T.contrast.samples[name];
  if (!v) throw new Error(`토큰 ${name} 없음`);
  return v;
};
const near = (calc: number, stored: number, step = 0.01) => Math.abs(calc - stored) <= step / 2 + 1e-9;
const UNIT = { casing: hex(T.overlayLine.casing.ref), opacity: T.overlayLine.casing.opacity, edge: hex(T.overlayLine.edge.ref) };

describe("color-check 함수", () => {
  it("WCAG 대비: 검정/흰 21, 같은 색 1", () => {
    expect(contrast("#000000", "#ffffff")).toBeCloseTo(21, 5);
    expect(contrast("#a1143e", "#a1143e")).toBe(1);
  });
  it("CIEDE2000: 같은 색 0, 흰색과 검정 100", () => {
    expect(deltaE2000("#a1143e", "#a1143e")).toBe(0);
    expect(deltaE2000("#ffffff", "#000000")).toBeCloseTo(100, 0);
  });
  it("색약 모의(Machado 2009, 심함 1.0): 회색은 그대로", () => {
    expect(simulate("#808080", "protan").map(Math.round)).toEqual([128, 128, 128]);
    expect(simulate("#808080", "deutan").map(Math.round)).toEqual([128, 128, 128]);
  });
});

describe("글·큰 글·UI 표시 대비 표", () => {
  for (const [table, rows] of [["text", T.contrast.text], ["largeText", T.contrast.largeText], ["ui", T.contrast.ui]] as const) {
    it(`${table}: 표의 색이 지금 토큰 값이고, 다시 잰 대비가 표와 같고 기준을 넘는다`, () => {
      const bad = rows.flatMap((r) => {
        const calc = contrast(hex(r.fg), hex(r.bg));
        const out: string[] = [];
        if (r.fgValue.toLowerCase() !== hex(r.fg).toLowerCase() || r.bgValue.toLowerCase() !== hex(r.bg).toLowerCase()) out.push(`${r.fg}/${r.bg} 표의 색이 토큰과 다름`);
        if (!near(calc, r.ratio)) out.push(`${r.fg}/${r.bg} 표 ${r.ratio} ≠ 다시 잰 ${calc.toFixed(2)}`);
        if (calc < r.need) out.push(`${r.fg}/${r.bg} ${calc.toFixed(2)} < ${r.need}`);
        return out;
      });
      expect(bad).toEqual([]);
    });
  }
});

describe("트윈·폰 영상 위 세 겹 표시(심 / 흰 테 / 숯색)", () => {
  it("표시 색마다 바탕 8개에서 세 겹 중 하나가 3:1을 넘고, 다시 잰 값이 표와 같다", () => {
    const bad = T.contrast.twinUnit.flatMap((row) => row.cells.flatMap((cell) => {
      const u = unitContrast(hex(row.color), hex(cell.bg), UNIT);
      const out: string[] = [];
      if (!near(u.core, cell.core) || !near(u.casing, cell.casing) || !near(u.edge, cell.edge)) out.push(`${row.color}/${cell.bg} 표와 다름`);
      if (Math.max(u.core, u.casing, u.edge) < 3) out.push(`${row.color}/${cell.bg} 세 겹 모두 3:1 미만`);
      return out;
    }));
    expect(bad).toEqual([]);
    expect(T.contrast.twinUnit.map((r) => r.color)).toEqual(expect.arrayContaining(["brand", "brand-bright", "pending", "ok-vivid", "error-vivid", "warn-vivid", "info-vivid", "ink-3", "mock"]));
  });

  it("흰 테와 숯색 선이 함께 있으면 가장 나쁜 회색에서도 3:1을 넘는다", () => {
    const g = T.contrast.twinUnitWorstGray;
    const u = unitContrast(hex("brand"), g.gray, UNIT);
    expect(near(Math.max(u.casing, u.edge), g.best)).toBe(true);
    expect(Math.max(u.casing, u.edge)).toBeGreaterThanOrEqual(3);
  });

  it("말풍선 판(surface)과 테두리(twin-edge) 중 하나가 트윈 바탕 8개에서 3:1을 넘는다", () => {
    const edge = T.alias["twin-edge"];
    const edgeHex = hex(typeof edge === "string" ? edge : edge.ref);
    for (const r of T.contrast.twinBubble) {
      const fill = contrast(hex("surface"), hex(r.bg));
      const e = contrast(edgeHex, hex(r.bg));
      expect([near(fill, r.fill), near(e, r.edge), Math.max(fill, e) >= 3]).toEqual([true, true, true]);
    }
  });

  it("폰 영상 위 조준점·초점도 세 겹 중 하나가 3:1을 넘는다", () => {
    for (const r of T.contrast.phoneVideo) {
      const u = unitContrast(hex(r.color), hex(r.bg), UNIT);
      expect([near(u.core, r.core), near(u.casing, r.casing), near(u.edge, r.edge), Math.max(u.core, u.casing, u.edge) >= 3]).toEqual([true, true, true, true]);
    }
  });

  it("햇빛 반사 10%에서도 폰 AR 글은 4.5:1을 넘는다", () => {
    for (const r of T.contrast.phoneGlare10) {
      const calc = glareContrast(hex(r.fg), hex(r.bg), 0.1);
      expect([near(calc, r.ratio), calc >= 4.5]).toEqual([true, true]);
    }
  });
});

describe("실제 트윈 캡처 화소 위 세 겹 표시", () => {
  const fixtures = ["hub-1920.png", "hub-1440.png", "bake-mid.png"].map((n) => ({ name: n, ...readPng(fileURLToPath(new URL(`./fixtures/twin-pixels/${n}`, import.meta.url))) }));
  const colors = T.contrast.twinUnit.map((r) => r.color);

  it("표시 색 9개 모두 화소마다 세 겹 중 하나가 3:1을 넘는다(실패 0%)", () => {
    const fails: string[] = [];
    for (const f of fixtures) {
      const seen = new Map<string, [number, number, number]>();
      for (const p of f.pixels) seen.set(p.join(","), p);
      for (const c of colors) {
        const bad = [...seen.values()].filter((p) => { const u = unitContrast(hex(c), p, UNIT); return Math.max(u.core, u.casing, u.edge) < 3; });
        if (bad.length) fails.push(`${f.name} ${c}: ${bad.length}색`);
      }
    }
    expect(fails).toEqual([]);
  });

  it("두 겹(심 + 흰 테)만이면 진홍 경로가 안 보이는 화소가 있다(숯색 바깥 선이 필요한 까닭)", () => {
    const share = fixtures.map((f) => f.pixels.filter((p) => { const u = unitContrast(hex("brand"), p, UNIT); return Math.max(u.core, u.casing) < 3; }).length / f.pixels.length);
    expect(share.every((s) => s > 0.01)).toBe(true);
  });
});

describe("색약 모의(Machado 2009)와 색 차이(CIEDE2000)", () => {
  const vizColor = (k: string) => hex(k === "attention" ? T.viz.attention.ref : T.viz.status[k]!.ref);
  const pathColor = (k: string) => hex(T.viz.path[k]!.color.ref);
  const numberColor: Record<string, string> = { on: "ok", off: "ink-3", alert: "error", unknown: "warn" };
  const triple = (a: string, b: string) => [deltaE2000(a, b), deltaE2000(simulate(a, "protan"), simulate(b, "protan")), deltaE2000(simulate(a, "deutan"), simulate(b, "deutan"))] as const;

  it("VIZ 상태 다섯과 주목: 적색맹·녹색맹 모의에서도 CIEDE2000 10 이상, 다시 잰 값이 표와 같다", () => {
    const bad = T.contrast.cvd.vizStatus.flatMap((r) => {
      const [n, p, d] = triple(vizColor(r.a), vizColor(r.b));
      const out: string[] = [];
      if (!near(n, r.normal, 0.1) || !near(p, r.protan, 0.1) || !near(d, r.deutan, 0.1)) out.push(`${r.a}/${r.b} 표와 다름 ${n.toFixed(1)} ${p.toFixed(1)} ${d.toFixed(1)}`);
      if (Math.min(p, d) < 10) out.push(`${r.a}/${r.b} 색약 모의 ${Math.min(p, d).toFixed(1)} < 10`);
      return out;
    });
    expect(bad).toEqual([]);
  });

  it("VIZ 경로 역할은 색(색약 모의 10 이상)이나 굵기·끝 표시로 다르다", () => {
    const bad = T.contrast.cvd.pathRoles.flatMap((r) => {
      const [, p, d] = triple(pathColor(r.a), pathColor(r.b));
      const byColor = Math.min(p, d) >= 10;
      const A = T.viz.path[r.a]!, B = T.viz.path[r.b]!;
      const byShape = A.width !== B.width || A.endMark !== B.endMark;
      return byColor || byShape ? [] : [`${r.a}/${r.b}`];
    });
    expect(bad).toEqual([]);
  });

  it("말풍선 번호 색은 색약 모의에서 가까우면 아이콘(TriangleAlert·CircleHelp)으로도 다르다", () => {
    const bad = T.contrast.cvd.bubbleNumber.flatMap((r) => {
      const [, p, d] = triple(hex(numberColor[r.a]!), hex(numberColor[r.b]!));
      const byIcon = r.a === "alert" || r.a === "unknown" || r.b === "alert" || r.b === "unknown";
      return Math.min(p, d) >= 10 || byIcon ? [] : [`${r.a}/${r.b} ${Math.min(p, d).toFixed(1)}`];
    });
    expect(bad).toEqual([]);
  });

  it("마스크 색 네 무리(사람·마시는 그릇·그 밖의 물건·가전 설비): 색약 모의에서도 서로 CIEDE2000 10 이상이고, 영상 위에 불투명도대로 겹쳐도 서로·바탕과 10 이상이다. 표와 같다", () => {
    const M = tokens as unknown as {
      viz: { mask: Record<"person" | "vessel" | "object" | "fixture", { ref: string }> & { opacity: number } };
      contrast: { cvd: { mask: { a: string; b: string; normal: number; protan: number; deutan: number; mixed: number }[]; maskOnVideo: { color: string; min: number }[]; maskBackgrounds: string[] } };
    };
    const groups = ["person", "vessel", "object", "fixture"] as const;
    const color = (g: string) => hex(M.viz.mask[g as (typeof groups)[number]].ref);
    const alpha = M.viz.mask.opacity;
    expect(alpha).toBeGreaterThanOrEqual(0.3);
    const bgs = M.contrast.cvd.maskBackgrounds.map(hex);
    expect(bgs.length).toBeGreaterThanOrEqual(4);
    const worst = (a: Parameters<typeof deltaE2000>[0], b: Parameters<typeof deltaE2000>[0]) => Math.min(...triple(a as string, b as string));
    const pairs = groups.flatMap((a, i) => groups.slice(i + 1).map((b) => [a, b] as const));
    expect(M.contrast.cvd.mask.map((r) => `${r.a}/${r.b}`)).toEqual(pairs.map(([a, b]) => `${a}/${b}`));
    const bad: string[] = [];
    for (const r of M.contrast.cvd.mask) {
      const [n, p, d] = triple(color(r.a), color(r.b));
      const mixed = Math.min(...bgs.map((bg) => worst(over(color(r.a), alpha, bg), over(color(r.b), alpha, bg))));
      if (!near(n, r.normal, 0.1) || !near(p, r.protan, 0.1) || !near(d, r.deutan, 0.1) || !near(mixed, r.mixed, 0.1)) bad.push(`${r.a}/${r.b} 표와 다름 ${n.toFixed(1)} ${p.toFixed(1)} ${d.toFixed(1)} ${mixed.toFixed(1)}`);
      if (Math.min(p, d, mixed) < 10) bad.push(`${r.a}/${r.b} ${Math.min(p, d, mixed).toFixed(1)} < 10`);
    }
    expect(M.contrast.cvd.maskOnVideo.map((r) => r.color)).toEqual([...groups]);
    for (const r of M.contrast.cvd.maskOnVideo) {
      const min = Math.min(...bgs.map((bg) => worst(over(color(r.color), alpha, bg), bg)));
      if (!near(min, r.min, 0.1)) bad.push(`${r.color} 바탕과의 차이 표와 다름 ${min.toFixed(1)}`);
      if (min < 10) bad.push(`${r.color} 바탕과 ${min.toFixed(1)} < 10`);
    }
    expect(bad).toEqual([]);
  });

  it("오류 빨강과 브랜드 진홍은 한눈에 다르다(CIEDE2000 10 이상), 표와 같다", () => {
    const pairs: Record<string, [string, string]> = {
      "brand-vs-error": ["brand", "error"], "brand-vs-error-vivid": ["brand", "error-vivid"], "error-vs-warn": ["error", "warn"], "brand-vs-warn": ["brand", "warn"],
    };
    for (const [k, [a, b]] of Object.entries(pairs)) {
      const calc = deltaE2000(hex(a), hex(b));
      expect([k, near(calc, T.contrast.deltaE2000[k]!, 0.1), calc >= 10]).toEqual([k, true, true]);
    }
  });

  it("over: 흰색 0.95를 바탕 위에 겹친 색", () => {
    expect(over("#ffffff", 0.95, "#000000").map((v) => Math.round(v))).toEqual([242, 242, 242]);
  });
});
