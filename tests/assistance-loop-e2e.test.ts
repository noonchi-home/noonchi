import { expect, it } from "vitest";
import type { DecisionRecord } from "../src/contract/events.js";
import { assistanceReplay } from "./helpers/assistance-replay.js";
import { planCalls, plannerRespond } from "./helpers/planner.js";
import { CUP_FSM_MEMORY } from "../src/brain/decision.js";
import { candidateFsmOf } from "../src/brain/pam/adopt.js";
import { pamView } from "./helpers/pam.js";
import { ambiguousVariant, assistanceEvenings, learningVariant, localTime as at, type LearningEvening } from "./fixtures/assistance/learning.js";
import { residentStudio, seeResident } from "./fixtures/assistance/resident.js";

it("runs a safe request through the live manager and act nodes without a phone, network device or model", async () => {
  const replay = await assistanceReplay({});
  try {
    const at = replay.clock.now();
    const decision: DecisionRecord = { id: "offline-observe", seq: 1, atMs: at, finalTime: new Date(at).toISOString(),
      status: "valid", action: null, prediction: null, memoryVersion: 0, textSent: "",
      world: { objects: [], person_visible: false, vlm_missing: 0, yolo_missing: 0 } };
    await replay.publish("brain", "/brain/decision", { decision, at_ms: at, rev: 0, check: { ok: true }, assist: "noonchi" });
    expect(replay.output("/manager/order")).toContainEqual(expect.objectContaining({
      body: expect.objectContaining({ input: expect.objectContaining({ decision }) }),
    }));
    expect(replay.output("/act/log")).toContainEqual(expect.objectContaining({
      body: expect.objectContaining({ type: "execution", plan_id: "plan:offline-observe", state: "decided" }),
    }));
    expect(replay.phoneCommands().filter(c => c.type === "command")).toEqual([]);
    expect(replay.requests).toHaveLength(0);
    await expect(replay.answer("done")).rejects.toThrow("No issued command");
    expect(replay.network).toEqual([]);
  } finally { await replay.close(); }
});

it("ends an unreadable power request after bounded observations and does not resend a command", async () => {
  const planned = plannerRespond({ "에어컨 켜기": () => [planCalls([
    { kind: "device", label: "에어컨 켜기", target: "ac_1", tool: "turn_on", until: { device: "ac_1", state: "on" }, timeout_s: 60 },
  ])] });
  const replay = await assistanceReplay({ home: "oneroom", model: { respond: body => {
    const tools = (body.tools ?? []).map((t: { name: string }) => t.name);
    if (tools.includes("read_device")) return { calls: [{ name: "read_device", args: { target: "ac_1" } }] };
    if (tools.includes("wait_for_new_photo")) return { calls: [{ name: "wait_for_new_photo", args: {} }] };
    return planned(body);
  } } });
  try {
    replay.server.signals.setSources({ ac_1: { kind: "none" } });
    const at = replay.clock.now();
    const d: DecisionRecord = { id: "unreadable-ac", seq: 1, atMs: at, finalTime: new Date(at).toISOString(),
      status: "valid", action: "에어컨 켜기", prediction: null, memoryVersion: 0, textSent: "",
      world: { objects: [], person_visible: false, vlm_missing: 0, yolo_missing: 0 } };
    await replay.publish("brain", "/brain/decision", { decision: d, at_ms: at, rev: 0, check: { ok: true }, assist: "noonchi" });
    const calls = () => replay.requests.filter(r => r.body.tools?.some((t: { name: string }) => t.name === "stop"));
    for (let i = 1; i <= 125; i++) await replay.advance(at + i * 250);
    expect(calls().length).toBeGreaterThan(0);
    expect(calls().length).toBeLessThanOrEqual(3);
    expect(replay.output("/act/log")).toContainEqual(expect.objectContaining({
      body: expect.objectContaining({ type: "execution", plan_id: "plan:unreadable-ac", state: "failed" }),
    }));
    const ended = calls().length;
    await replay.advance(at + 330_000);
    expect(calls()).toHaveLength(ended);
    expect(replay.output("/device/command")).toHaveLength(0);
    expect(replay.phoneCommands().some(c => c.type === "command")).toBe(false);
    expect(replay.network).toEqual([]);
  } finally { await replay.close(); }
}, 20000);

it("finishes on the oneroom hub's fresh power state without invoking the model or commanding a device", async () => {
  const replay = await assistanceReplay({ home: "oneroom" });
  try {
    const device = replay.server.signals.list().find(d => d.kind === "aircon")!;
    expect(device.id).toBe("ac_1");
    // The test household was already cool when the decision arrived.
    await replay.server.hub.command(device.id, { type: "on" });
    const synced = replay.server.signals.get(device.id);
    expect(synced?.twin.power).toBe("on");
    const at = Math.max(replay.clock.now(), Date.parse(synced!.updatedAt) + 100);
    await replay.advance(at);
    const before = replay.requests.length;
    const d: DecisionRecord = { id: "already-cool", seq: 1, atMs: at, finalTime: new Date(at).toISOString(),
      status: "valid", action: "에어컨 켜기", prediction: null, memoryVersion: 0, textSent: "",
      world: { objects: [], person_visible: false, vlm_missing: 0, yolo_missing: 0 } };
    await replay.publish("brain", "/brain/decision", { decision: d, at_ms: at, rev: 0, check: { ok: true }, assist: "noonchi" });
    expect(replay.output("/act/log")).toContainEqual(expect.objectContaining({
      body: expect.objectContaining({ type: "execution", plan_id: "plan:already-cool", state: "done" }),
    }));
    expect(replay.server.signals.get(device.id)?.updatedAt).toBe(synced?.updatedAt);
    expect(replay.output("/device/command")).toHaveLength(0);
    expect(replay.requests).toHaveLength(before);
    const rows = replay.server.history.list({}).filter(row => row.kind === ("assistance_outcome" as string));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.data).toMatchObject({ key: { homeEpoch: "oneroom#1", attemptId: "already-cool", gen: 0 },
      home: "oneroom", execution: "done", reaction: "unknown", proof: null });
    expect(replay.phoneCommands().some(c => c.type === "command")).toBe(false);
    expect(replay.network).toEqual([]);
  } finally { await replay.close(); }
});

it("learns only from recorded answers across evenings and gates a real next-day phone command", async () => {
  async function play(tape: readonly LearningEvening[], omitAssistanceRecords = false) {
    const studio = residentStudio();
    const planner = plannerRespond({ "에어컨 켜기": () => [planCalls([
      { kind: "device", label: "에어컨 켜기", target: "ac_1", tool: "turn_on", timeout_s: 60 },
    ])] });
    const result: { commands: number; power: unknown; reactions: string[]; emitted: string[]; policy: string }[] = [];
    for (const item of tape) {
      const replay = await assistanceReplay({
        home: "oneroom", start: at(item.day, "23:29:48"), reflectAt: "23:30", askFirst: true,
        ...studio, omitAssistanceRecords,
        model: {
          respond: planner,
          reply: body => {
            const view = pamView(body);
            if (view.role === "predict") {
              if (!view.observation_text.includes("사람 보임")) return JSON.stringify({ observation: "조용함", reasoning: "대기", state: "away", from: "away", next_index: -1 });
              return JSON.stringify({ observation: "TV 시청", reasoning: "관찰 확인", state: "watching_tv",
                from: view.last_state === "watching_tv" ? "watching_tv" : "away", next_index: 1 });
            }
            return JSON.stringify(view.role === "reflect" ? candidateFsmOf(CUP_FSM_MEMORY) : view.role === "check"
              ? { ok: true, items: [] } : { candidates: [], actions: [], unseen: [] });
          },
        },
      });
      try {
        expect(replay.server.hub.get("ac_1")?.twin.power).toBe("off");
        const seen = at(item.day, item.capture);
        const arrive = at(item.day, item.arrive);
        await replay.publish("phone", "/phone/link", { ready: true });
        if (item.speech) await replay.publish("phone", "/phone/heard", { text: item.speech, observed_ms: replay.clock.now() });
        for (let offset = 0; offset <= 6000; offset += 2000) {
          const captured = seen + offset;
          await replay.advance(arrive + offset);
          await seeResident(replay, captured, item.people);
        }
        await replay.advance(arrive + 6_250);
        const asks = replay.phoneCommands().filter(c => c.type === "command" && c.choices.some(a => a.id === "reject"));
        if (item.answer) {
          const diagnostic = JSON.stringify({
            day: item.day,
            decisions: replay.output("/brain/decision").map(e => [e.body.decision.action, e.body.decision.error]),
            activity: replay.output("/world/state").at(-1)?.body.view.person,
            execution: replay.output("/act/log").map(e => e.body),
          });
          expect(asks.length, diagnostic).toBeGreaterThan(0);
          await replay.answer(item.answer);
        }
        await replay.advance(at(item.day, "23:30:01"));
        const reflection = () => replay.server.history.list({ day: item.day, kinds: ["reflection"] }).at(-1)?.data;
        await expect.poll(reflection, { timeout: 3000 }).toMatchObject({ ok: true });
        const rows = replay.server.history.list({ kinds: ["assistance_outcome"] });
        if (item.answer && item.people === 1 && !omitAssistanceRecords) expect(rows.at(-1)?.data).toMatchObject({
          user: "resident", proof: { evidence: { source: "phone_answer", subjectId: "resident" } },
        });
        result.push({
          commands: new Set(asks.flatMap(c => c.type === "command" ? [c.step] : [])).size,
          power: replay.server.signals.get("ac_1")?.twin.power,
          reactions: rows.map(row => (row.data as { reaction: string }).reaction).sort(),
          emitted: replay.output("/act/assistance_outcome").map(e => e.body.reaction),
          policy: replay.server.history.policyFor("oneroom", "resident", { action: "에어컨 켜기", context: JSON.stringify(["state", "watching_tv"]) }, item.day),
        });
        expect(replay.network).toEqual([]);
      } finally { await replay.close(); }
    }
    return result;
  }
  const refused = await play(assistanceEvenings);
  const mixed = await play(learningVariant);
  const ambiguous = await play(ambiguousVariant);
  const missing = await play(assistanceEvenings, true);
  expect(refused[1]?.reactions).toEqual(["declined", "declined"]);
  expect(refused[2]).toMatchObject({ policy: "defer_proactive", commands: 0, power: "off" });
  expect(mixed[1]?.reactions).toEqual(["accepted", "declined"]);
  expect(mixed[2]).toMatchObject({ policy: "default", commands: 0, power: "on" });
  expect(ambiguous[1]?.reactions).toEqual(["declined", "unknown"]);
  expect(ambiguous[2]).toMatchObject({ policy: "default", commands: 1 });
  expect(missing.slice(0, 2).flatMap(day => day.emitted)).toEqual(["declined", "declined"]);
  expect(missing[2]).toMatchObject({ reactions: [], policy: "default", commands: 1 });
}, 45000);
