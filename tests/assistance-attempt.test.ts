import { expect, it } from "vitest";
import * as track from "../src/act/track/core.js";
import { AttemptBook, assess, acceptEvidence } from "../src/act/track/attempt.js";

it("binds repeated decisions and replacement plans to one attempt, and isolates houses", () => {
  expect(track.TrackCore).toBeDefined();
  const book = new AttemptBook("boot", "home:1");
  const decision = { id: "d1", atMs: 100, action: "컵 치우기" };
  const a = book.issue(decision);
  expect(book.issue(decision)).toBe(a);
  const old = a.key;
  book.advance(a);
  expect(book.issue(decision).key).toEqual({ ...old, gen: old.gen + 1 });
  expect(book.issue({ ...decision, id: "d2" }).key.attemptId).not.toBe(old.attemptId);
  const inOtherHome = new AttemptBook("boot", "home:2").issue(decision);
  const ref = { source: "photo", subjectId: "cup_1", originId: "p2", observedMs: 101 };
  expect(acceptEvidence(a, old, ref, ["cup_1"], 102)).toBe(false);
  expect(acceptEvidence(a, inOtherHome.key, ref, ["cup_1"], 102)).toBe(false);
  expect(acceptEvidence(a, a.key, ref, ["cup_1"], 102)).toBe(true);
  expect(acceptEvidence(a, a.key, { ...ref, observedMs: 102 }, ["cup_1"], 102)).toBe(false);
});

it("requires exact positive evidence for cleanup and does not use a missing cup as completion", () => {
  const a = new AttemptBook("boot", "home").issue({ id: "d", atMs: 10, action: "컵 치우기" });
  a.goal = { kind: "clear", objectId: "cup_1", from: "table", to: "sink", basin: true };
  const object = { id: "cup_2", surface: "sink", surface_part: "basin" as const, status: "present" as const,
    last_seen_ms: 11, facts: {}, closer_hold: false };
  const world = { now: 12, photo: { id: "p", at_ms: 11 }, objects: [object], holding: [] };
  expect(assess(a, world).kind).toBe("need_evidence");
  expect(assess(a, { ...world, objects: [{ ...object, id: "cup_1", status: "gone" }] }).kind).toBe("need_evidence");
  expect(assess(a, { ...world, objects: [{ ...object, id: "cup_1" }] })).toMatchObject({
    kind: "fulfilled", evidence: [{ originId: "p", subjectId: "cup_1", observedMs: 11 }],
  });
});
