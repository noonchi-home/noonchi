import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { planFrame, planLines, viewCone } from "./plan-lines.ts";

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

test("the view cone starts at the standing point and spans the field of view around the facing direction", () => {
  const at: [number, number] = [2, 3];
  const cone = viewCone(at, 90, 60, 1.5);
  assert.deepEqual(cone[0], at);
  const arc = cone.slice(1);
  assert(arc.length >= 3);
  const angle = ([x, y]: number[]) => Math.atan2(y - at[1], x - at[0]) * 180 / Math.PI;
  for (const point of arc) assert(Math.abs(Math.hypot(point[0] - at[0], point[1] - at[1]) - 1.5) < 1e-9);
  assert(Math.abs(angle(arc[0]) - 60) < 1e-9);
  assert(Math.abs(angle(arc[arc.length - 1]) - 120) < 1e-9);
  assert(arc.some(point => Math.abs(angle(point) - 90) < 1e-9), "the facing direction itself lies on the arc");
});

test("the view cone wraps across 0 degrees", () => {
  const arc = viewCone([0, 0], 350, 60, 1).slice(1);
  const angle = ([x, y]: number[]) => (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
  assert(Math.abs(angle(arc[0]) - 320) < 1e-9);
  assert(Math.abs(angle(arc[arc.length - 1]) - 20) < 1e-9);
});

test("an empty scene has nothing to frame", () => {
  assert.equal(planFrame(planLines(undefined)), null);
  assert.equal(planFrame(planLines({ plan: {}, objects: [] })), null);
});
