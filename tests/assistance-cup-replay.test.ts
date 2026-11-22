import { cpSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { expect, it } from "vitest";
import { checkDecision } from "../src/act/index.js";
import { WATER_ACTION } from "../src/act/tasks.js";
import type { DecisionRecord } from "../src/contract/events.js";
import type { SceneObservation } from "../src/contract/observe.js";
import { decisionWorld } from "../src/world/index.js";
import { residentStudio } from "./fixtures/assistance/resident.js";
import { assistanceReplay } from "./helpers/assistance-replay.js";
import { cylinderBox, LOOK_SIZE, viewLooking } from "./helpers/camera.js";
import { det } from "./helpers/detectors.js";
import { cupSteps, planCalls, plannerRespond } from "./helpers/planner.js";

const HOME = "apartment";
const CUP = "cup_1";
const OTHER = "cup_2";
const TABLE = "table_1";
const DESK = "desk_2";
const CLEAR = "컵 치우기";
const WIDE = viewLooking([8.04, 1.85, 3.55], [8.04, .8, 2.7]);
const BY_CUP = viewLooking([6.75, 1.85, 3.55], [7.9, .8, 2.7]);
type Replay = Awaited<ReturnType<typeof assistanceReplay>>;

async function photo(replay: Replay, id: string, mode: "table" | "hidden" | "ambiguous" | "held" = "table") {
  const captured = replay.clock.now() + 2000;
  const view = mode === "held" ? BY_CUP : WIDE;
  const isHeld = mode === "held" || mode === "ambiguous";
  const person = det("person", .99, cylinderBox(view, [7.68, 0, 2.42], .14, 1.65));
  const cup = (id: string, center: [number, number, number]) => {
    const [x, y, w, h] = cylinderBox(view, center, .05, .13);
    return { id, cls: "cup", det: null, box: { x: x / LOOK_SIZE.width, y: y / LOOK_SIZE.height,
      w: w / LOOK_SIZE.width, h: h / LOOK_SIZE.height } };
  };
  const scene: SceneObservation = {
    scene: "dining", summary: "",
    household: { seats: mode === "hidden" ? "obscured" : "clear", dining_food: "unknown", people: [{ id: "d1", attention: "elsewhere" }] },
    objects: [cup("v1", isHeld ? [7.67, 1.1, 2.58] : [7.65, .75, 2.7]), cup("v2", [8.43, .75, 2.7])],
    observations: [
      { object_id: "v1", state: mode === "hidden" ? "not_visible" : isHeld ? "in_hand" : "on_table" },
      { object_id: "v1", state: "interior_visible" }, { object_id: "v1", state: "has_contents" },
      { object_id: "v2", state: "on_table" },
    ],
  };
  const arrived = captured + 400;
  await replay.advance(arrived);
  await replay.publish("perception", "/perception/scene", { kind: "frame", frame: {
    id, capturedAtMs: captured, latestAtMs: captured, ...LOOK_SIZE, eye: null, view,
  }, dets: [person] });
  await replay.publish("perception", "/perception/scene", { kind: "scene", frame_id: id, observed_ms: captured, scene,
    look: { view, ...LOOK_SIZE, fresh: true, eye: [view.origin[0], view.origin[2]], person_ids: ["d1"],
      dets: [{ id: "d1", box: person.box }] } });
  return { id, captured, arrived };
}

async function start() {
  const studio = residentStudio();
  mkdirSync(join(studio.studioDir, HOME));
  cpSync(resolve("twin/apartment/scene.json"), join(studio.studioDir, HOME, "scene.json"));
  writeFileSync(join(studio.studioDir, "homes.json"), JSON.stringify({
    default: HOME, homes: [{ id: HOME, name: "Replay apartment", data: "data/apartment", out: HOME, single_resident: "resident" }],
  }));
  const go = (target: string) => ({ kind: "go", act: "가기", target, until: { phone_near: target }, timeout_s: 60 });
  const planner = plannerRespond({
    [CLEAR]: () => [planCalls(cupSteps({ cup: CUP, table: TABLE, sink: "sink_1", basin: false }))],
    [WATER_ACTION]: () => [planCalls([
      go(TABLE), { kind: "do", act: "따르기", item: "물", target: CUP, timeout_s: 60 },
      { kind: "pick", act: "들기", target: CUP, timeout_s: 60 }, go(DESK),
      { kind: "place", act: "놓기", target: DESK, object: CUP, timeout_s: 60 },
    ])],
  });
  return assistanceReplay({ ...studio, home: HOME, askFirst: false, model: {
    respond: body => body.tools?.some((tool: { name: string }) => tool.name === "wait_for_new_photo")
      ? { calls: [{ name: "wait_for_new_photo", args: {} }] } : planner(body),
    reply: () => JSON.stringify({ observation: "장면 관찰", reasoning: "대기", state: "away", from: null, next_index: -1 }),
  } });
}

function worldOf(replay: Replay) {
  return replay.output("/world/state").at(-1)!.body.view;
}

async function decision(replay: Replay, id: string, action: string) {
  await photo(replay, "table-first");
  await photo(replay, "table-second");
  const world = worldOf(replay);
  expect(world.objects.filter(o => o.status === "present").map(o => [o.id, o.surface])).toEqual([[CUP, TABLE], [OTHER, TABLE]]);
  expect(world.person).toMatchObject({ count: 1, visible: true });
  const atMs = replay.clock.now();
  const d: DecisionRecord = { id, seq: 100, atMs, finalTime: new Date(atMs).toISOString(), status: "valid",
    action, prediction: null, memoryVersion: 1, textSent: "", tasks: [action], world: decisionWorld(world) };
  const check = checkDecision({ decision: d, tasks: [action], world });
  expect(check.ok).toBe(true);
  await replay.publish("phone", "/phone/link", { ready: true });
  await replay.publish("brain", "/brain/decision", { decision: d, rev: replay.output("/world/state").at(-1)!.body.rev,
    check, at_ms: atMs, assist: "noonchi" });
  await photo(replay, "after-decision");
  await replay.advance(replay.clock.now() + 250);
  expect(replay.phoneCommands().at(-1), JSON.stringify({
    orders: replay.output("/manager/order").filter(m => m.body.input.decision.id === id).map(m => m.body.gate),
    plans: replay.output("/brain/plan").filter(m => m.body.decision_id === id).map(m => m.body.result),
    actions: replay.output("/act/log").filter(m => m.body.type === "execution").map(m => m.body),
  })).toMatchObject({ type: "command", id: "plan:" + id, target: { id: TABLE } });
}

it("waits for the same cup after occlusion instead of picking the other cup on the table", async () => {
  const replay = await start();
  try {
    replay.server.history.cupAnswers.remember(HOME, "resident", true);
    await decision(replay, "clear-cup", CLEAR);
    const initial = replay.phoneCommands().length;
    const hidden = await photo(replay, "target-occluded", "hidden");
    expect(worldOf(replay).objects.find(o => o.id === CUP)?.last_seen_ms).toBeLessThan(hidden.captured);
    expect(worldOf(replay).objects.find(o => o.id === OTHER)?.last_seen_ms).toBe(hidden.captured);
    await replay.answer("done");
    await replay.advance(replay.clock.now() + 500);
    expect(replay.phoneCommands().slice(initial).filter(c => c.type === "command")).toEqual([]);
    expect(replay.output("/act/assistance_outcome")).toEqual([]);
    const found = await photo(replay, "same-target-visible");
    await replay.advance(replay.clock.now() + 500);
    expect(worldOf(replay).objects.find(o => o.id === CUP)?.last_seen_ms).toBe(found.captured);
    const next = replay.phoneCommands().slice(initial).filter(c => c.type === "command");
    expect(next).toHaveLength(1);
    expect(next[0]).toMatchObject({ id: "plan:clear-cup", target: { id: CUP } });
    expect(replay.network).toEqual([]);
  } finally { await replay.close(); }
}, 20_000);

it("clears delivery before pickup when the resident resolves it and records the original confirming frame", async () => {
  const replay = await start();
  try {
    await decision(replay, "deliver-water", WATER_ACTION);
    const old = replay.phoneCommands().at(-1);
    if (old?.type !== "command") throw new Error("Expected the issued navigation step");
    const initial = replay.phoneCommands().length;
    await photo(replay, "ambiguous-cup", "ambiguous");
    expect(worldOf(replay).person.holding).toEqual([]);
    expect(replay.output("/act/assistance_outcome")).toEqual([]);
    await photo(replay, "first-unambiguous-cup", "held");
    expect(replay.output("/act/assistance_outcome")).toEqual([]);
    const proof = await photo(replay, "confirmed-held-cup", "held");
    expect(worldOf(replay).person.holding).toEqual([CUP]);
    expect(worldOf(replay).household_photo).toMatchObject({ id: proof.id, at_ms: proof.captured, answered_ms: proof.arrived,
      proof: { person_count: 1 } });
    await replay.publish("phone", "/phone/progress", { kind: "button", req: "old-arrival", plan_id: old.id, step: old.step,
      choice: "done", expires_ms: replay.clock.now() + 2500 });
    await replay.advance(replay.clock.now() + 250);
    const later = replay.phoneCommands().slice(initial);
    expect(later).toContainEqual({ type: "command_clear", id: old.id });
    expect(later.filter(c => c.type === "command" && (c.id === old.id || c.target !== null))).toEqual([]);
    expect(replay.output("/act/progress_result").at(-1)?.body).toMatchObject({ req: "old-arrival", status: "stale" });
    const outcomes = replay.output("/act/assistance_outcome").map(m => m.body);
    expect(outcomes).toHaveLength(1);
    expect(outcomes[0]).toMatchObject({ home: HOME, user: "resident", action: WATER_ACTION, execution: "done", reaction: "self_resolved",
      key: { homeEpoch: HOME + "#1", attemptId: "deliver-water", gen: 0 },
      proof: { kind: "self_resolved", user: "resident", evidence: {
        source: "resident_action", subjectId: CUP, observedMs: proof.captured, originId: proof.id,
      } } });
    expect(replay.server.history.list({ kinds: ["assistance_outcome"] }).map(row => row.data)).toEqual(outcomes);
    expect(replay.network).toEqual([]);
  } finally { await replay.close(); }
}, 20_000);
