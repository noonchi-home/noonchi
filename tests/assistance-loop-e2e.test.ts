import { expect, it } from "vitest";
import type { DecisionRecord } from "../src/contract/events.js";
import { assistanceReplay } from "./helpers/assistance-replay.js";
import { planCalls, plannerRespond } from "./helpers/planner.js";

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
