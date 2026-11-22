import { expect, it } from "vitest";
import { ambiguousVariant, assistanceEvenings, learningVariant } from "./fixtures/assistance/learning.js";
import { replayLearning } from "./helpers/assistance-learning-replay.js";

it("uses two recorded refusals to block the next proactive phone command", async () => {
  const declined = await replayLearning(assistanceEvenings);
  const mixed = await replayLearning(learningVariant);
  const unrecorded = await replayLearning(assistanceEvenings, false);

  expect(declined.emitted.map(o => o.reaction), JSON.stringify({ decisions: declined.decisions.map(d => [d.decision.status, d.decision.error, d.decision.action]), trace: declined.trace })).toEqual(["declined", "declined"]);
  expect(declined.rows).toHaveLength(2);
  expect(declined.policy).toBe("defer_proactive");
  expect(declined.decisions.filter(d => d.date === "2026-11-22").map(d => d.decision.action)).toEqual([null, null]);
  expect(declined.commands.map(c => c.date)).toEqual(["2026-11-20", "2026-11-21"]);
  expect(mixed.policy).toBe("default");
  expect(mixed.commands.map(c => c.date)).toContain("2026-11-22");
  expect(unrecorded.emitted.map(o => o.reaction)).toEqual(["declined", "declined"]);
  expect(unrecorded.rows).toEqual([]);
  expect(unrecorded.commands.map(c => c.date)).toContain("2026-11-22");
});

it("still accepts a real direct request on the day a matching proactive plan is deferred", async () => {
  const replay = await replayLearning(assistanceEvenings, true, "에어컨 켜 주세요");
  expect(replay.policy).toBe("defer_proactive");
  const today = replay.commands.filter(c => c.date === "2026-11-22");
  expect(today).toHaveLength(1);
  expect(today[0]?.command.id).toMatch(/^plan:say-/);
});

it("honors the same phone answer without learning a preference when the responder is ambiguous", async () => {
  const replay = await replayLearning(ambiguousVariant);
  expect(replay.emitted.map(o => [o.execution, o.reaction])).toEqual([["cancelled", "declined"], ["cancelled", "unknown"]]);
  expect(replay.policy).toBe("default");
  expect(replay.commands.map(c => c.date)).toContain("2026-11-22");
});
