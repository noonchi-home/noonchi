import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { planFrame, planLines } from "./plan-lines.ts";

const mokryeon = JSON.parse(readFileSync(new URL("../../twin/homes/mokryeon_180b/scene.json", import.meta.url), "utf8"));
const isPoint = (point: unknown) => Array.isArray(point) && point.length === 2 && point.every(Number.isFinite);

test("the mokryeon plan draws every line from real points and fits a finite frame", () => {
  const lines = planLines(mokryeon);
  for (const [index, line] of lines.entries()) assert(line.every(isPoint), `line ${index} has a missing point: ${JSON.stringify(line)}`);
  const frame = planFrame(lines);
  assert(frame);
  for (const value of Object.values(frame)) assert(Number.isFinite(value));
});

test("solid walls without ends are drawn as their closed outline", () => {
  const lines = planLines(mokryeon).map(line => JSON.stringify(line));
  const solids = mokryeon.plan.walls.filter((wall: { a: unknown }) => wall.a === null);
  assert.deepEqual(solids.map((wall: { id: string }) => wall.id), ["shaft_nw", "shaft_center", "shaft_ne", "column_ne"]);
  for (const { id, polygon } of solids) {
    for (const [index, point] of polygon.entries()) {
      const edge = JSON.stringify([point, polygon[(index + 1) % polygon.length]]);
      assert(lines.includes(edge), `${id} misses edge ${edge}`);
    }
  }
});

test("an empty scene has nothing to frame", () => {
  assert.equal(planFrame(planLines(undefined)), null);
  assert.equal(planFrame(planLines({ plan: {}, objects: [] })), null);
});
