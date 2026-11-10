// World State 낱말 표(src/world/vocab.ts)가 하나뿐인 원본이다: 감지기 거름, VLM 스키마·프롬프트, World State 면·신뢰도, 화면 글, 관절 자세, 문서 표가
// 모두 거기서 나오는지, 다른 파일에 손으로 맞춘 목록이 없는지 본다.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { DOC_PATH, renderDoc } from "../scripts/world-vocab-doc.js";
import { COCO_LABELS } from "../src/brain/detector.js";
import { SCENE_JSON_SCHEMA, SCENE_PROMPT, SCENE_STATES as SCENE_ENUM } from "../src/observe/scene.js";
import { CONDITION_KINDS } from "../src/world/conditions.js";
import { OBJECT_NAME, STATE_TEXT } from "../src/world/labels.js";
import { WorldState } from "../src/world/state.js";
import { CLASSES, POSE_POSTURE, SCENE_STATES, STATES, type ClassKey } from "../src/world/vocab.js";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const ws = () => new WorldState({ surfaces: () => [], floorAt: () => 0, roomAt: () => null, devices: () => [] });
const classKeys = Object.keys(CLASSES) as ClassKey[];
const stateKeys = Object.keys(STATES);

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) return n === "node_modules" ? [] : files(p);
    return /\.(ts|tsx|mjs)$/.test(n) ? [p] : [];
  });
}

describe("World State 낱말 표", () => {
  it("화면 글은 낱말 표의 글이다", () => {
    expect(OBJECT_NAME).toEqual(Object.fromEntries(classKeys.map((k) => [k, CLASSES[k].label])));
    expect(STATE_TEXT).toEqual(Object.fromEntries(stateKeys.map((k) => [k, STATES[k as keyof typeof STATES].label])));
  });

  it("VLM 스키마 enum과 프롬프트는 낱말 표의 사실 값 전부다", () => {
    expect([...SCENE_ENUM]).toEqual([...SCENE_STATES]);
    const schema = JSON.stringify(SCENE_JSON_SCHEMA);
    for (const k of SCENE_STATES) expect(schema).toContain(`"${k}"`);
    for (const k of stateKeys) expect(SCENE_PROMPT, k).toMatch(new RegExp(`\\b${k}\\b`));
  });

  it("감지기는 사람·물건·가전 설비 종류만 내고 가구·나머지 COCO 종류는 거른다", () => {
    const want: Record<number, string> = {};
    for (const k of classKeys) if (CLASSES[k].role !== "scene") for (const n of Object.keys(CLASSES[k].coco)) want[Number(n)] = k;
    expect(COCO_LABELS).toEqual(want);
    expect(COCO_LABELS[60]).toBeUndefined(); // dining table
    expect(COCO_LABELS[2]).toBeUndefined(); // car
    expect(COCO_LABELS[40]).toBe("cup"); // wine glass는 컵
  });

  it("World State는 종류마다 낱말 표의 최소 신뢰도로 받는다", () => {
    const w = ws();
    for (const k of classKeys) {
      const c = CLASSES[k];
      if (c.role === "scene") {
        expect(w.accepts({ label: k as never, score: 0.99 }), k).toBe(false);
        continue;
      }
      expect(w.accepts({ label: k as never, score: c.minScore }), k).toBe(true);
      expect(w.accepts({ label: k as never, score: c.minScore - 0.01 }), k).toBe(false);
    }
  });

  it("관절 자세는 낱말 표의 자세 값이다", () => {
    for (const v of Object.values(POSE_POSTURE)) expect(STATES[v].facet).toBe("posture");
  });

  it("문서 표는 낱말 표에서 만든 표와 같고, 조건 종류를 모두 다룬다", () => {
    const md = readFileSync(DOC_PATH, "utf8").replace(/\r\n/g, "\n");
    expect(renderDoc(md), "고침: npx tsx scripts/world-vocab-doc.ts").toBe(md);
    for (const k of CONDITION_KINDS) expect(md, k).toContain(`{"${k}"`);
  });

  it("다른 파일에 손으로 맞춘 낱말 목록이 없다(값 → 면·글, COCO 번호 → 종류)", () => {
    const keyMap = new RegExp(`\\b(${stateKeys.join("|")})\\s*:\\s*["'\`]`, "g");
    const classMap = new RegExp(`\\b(${classKeys.join("|")})\\s*:\\s*["'\`]`, "g");
    const cocoMap = new RegExp(`\\b\\d+\\s*:\\s*["'](${classKeys.join("|")})["']`, "g");
    const own = new Set(["src/world/vocab.ts", "src/world/vocab-doc.ts"]);
    const found: string[] = [];
    for (const f of [...files(join(ROOT, "src")), ...files(join(ROOT, "scripts")), ...files(join(ROOT, "ui", "src"))]) {
      const name = relative(ROOT, f).replace(/\\/g, "/");
      if (own.has(name)) continue;
      const src = readFileSync(f, "utf8");
      for (const re of [keyMap, classMap, cocoMap]) {
        const hits = new Set([...src.matchAll(re)].map((m) => m[1]));
        if (hits.size >= 3) found.push(`${name}: ${[...hits].join(", ")}`);
      }
    }
    expect(found, "목록은 src/world/vocab.ts에만 둔다").toEqual([]);
  });
});
