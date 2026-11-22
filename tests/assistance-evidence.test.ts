import { expect, it, vi } from "vitest";
import { AttemptBook } from "../src/act/track/attempt.js";
import { EvidenceRun, allowedEvidence } from "../src/act/track/evidence.js";
import type { AssistanceGoal, EvidenceChoice } from "../src/contract/assistance.js";
import { Observer } from "../src/agent/index.js";
import { createProvider } from "../src/agent/providers/index.js";
import { inProcessModel } from "./helpers/in-process-model.js";

const goal: AssistanceGoal = { kind: "clear", objectId: "cup_1", from: "table", to: "sink", basin: true };

it("only offers a crop for the exact target when the camera sees its position", () => {
  const inside = allowedEvidence(goal, true);
  expect(inside).toContainEqual({ tool: "look_closer", target: "cup_1" });
  expect(allowedEvidence(goal, false)).not.toContainEqual({ tool: "look_closer", target: "cup_1" });
});

it("rejects a fabricated target and repeats only on a new source, with a per-stage and total budget", async () => {
  const attempt = new AttemptBook("boot", "home").issue({id: "d", atMs: 1, action: "clear"});
  attempt.goal = goal;
  const choose = vi.fn<() => Promise<EvidenceChoice>>()
    .mockResolvedValueOnce({ tool: "look_closer", target: "cup_2" })
    .mockResolvedValue({ tool: "look_closer", target: "cup_1" });
  const query = vi.fn(async () => ({ status: "found" as const, ref: { source: "photo", subjectId: "cup_1", originId: "original", observedMs: 11 } }));
  const run = new EvidenceRun(attempt, { choose, acquire: query });
  const allowed = allowedEvidence(goal, true);
  for (let i = 0; i < 3; i++) {
    run.request(0, 11 + i, "p1", goal, allowed);
    await run.idle();
  }
  expect(run.request(0, 15, "p1", goal, allowed)).toBe("exhausted");
  expect(query).toHaveBeenCalledTimes(1);
  for (let i = 0; i < 3; i++) {
    run.request(1, 16 + i, "p" + (i + 2), goal, allowed);
    await run.idle();
  }
  expect(attempt.evidence).toHaveLength(1);
  expect(run.request(2, 30, "p9", goal, allowed)).toBe("exhausted");
  expect(choose).toHaveBeenCalledTimes(6);
});

it("aborts at thirty seconds, even when a chooser resolves after the deadline", async () => {
  const attempt = new AttemptBook("boot", "home").issue({id: "d", atMs: 1, action: "clear"});
  let resolve!: (v: EvidenceChoice) => void;
  const acquire = vi.fn();
  const choose = vi.fn(() => new Promise<EvidenceChoice>(r => { resolve = r; }));
  const run = new EvidenceRun(attempt, { choose, acquire });
  const ask = (t: number) => run.request(0, t, "p1", goal, allowedEvidence(goal, true));
  expect(ask(10)).toBe("pending");
  await Promise.resolve();
  expect(ask(30_010)).toBe("exhausted");
  resolve({ tool: "look_closer", target: "cup_1" });
  await run.idle();
  expect(acquire).not.toHaveBeenCalled();
});

it("offers a different next observation through the production provider when the first read changes", async () => {
  const traces: string[][] = [];
  const model = inProcessModel({ respond: (body) => {
    const input = JSON.parse(body.input[0].content);
    const check = input.checks?.at(-1);
    const name = !check ? "last_seen" : check.status === "position_known" ? "look_closer" : "wait_for_new_photo";
    const args = name === "wait_for_new_photo" ? {} : { target: "cup_1" };
    return { calls: [{ name, args }] };
  }});
  const original = globalThis.fetch;
  globalThis.fetch = model.fetch;
  try {
    const observer = new Observer({ provider: createProvider({ OPENAI_API_KEY: "fixture-only", OPENAI_BASE_URL: model.base,
      OPENAI_MODEL: "gpt-5.4-mini" }).provider });
    for (const status of ["position_known", "stale"] as const) {
      const attempt = new AttemptBook("b", "h").issue({id: "d", atMs: 10, action: "clear"});
      const selected: string[] = [];
      const run = new EvidenceRun(attempt, {
        choose: async (q, signal) => {
          const choice = await observer.chooseEvidence(q, signal);
          if (choice) selected.push(choice.tool);
          return choice;
        },
        acquire: async () => ({ status }),
      });
      run.request(0, 11, "frame-1", goal, allowedEvidence(goal, true), "object_location");
      await run.idle();
      run.request(0, 12, "frame-1", goal, allowedEvidence(goal, true), "object_location");
      await run.idle();
      traces.push(selected);
    }
    expect(traces).toEqual([["last_seen", "look_closer"], ["last_seen", "wait_for_new_photo"]]);
    expect(model.network).toEqual([]);
  } finally { globalThis.fetch = original; }
});
