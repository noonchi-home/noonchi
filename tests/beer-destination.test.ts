import { expect, it } from "vitest";
import { HistoryDb } from "../src/brain/index.js";
import type { AgentPlan } from "../src/contract/plan-work.js";
import type { DecisionRecord } from "../src/contract/events.js";
import type { PlanView } from "../src/contract/plan.js";
import { HomeBeer } from "../src/server/home/beer.js";
import type { HomeCore } from "../src/server/home/core.js";
import { WorldState } from "../src/world/index.js";
import { LOOK_VIEW } from "./helpers/camera.js";
import { localTime } from "./fixtures/assistance/learning.js";

it("rejects a plan that takes beer to a surface outside the verified viewer room", () => {
  const start = localTime("2026-11-21", "19:00:00");
  const action = "맥주 가져다주기";
  let now = start;
  let tv = { online: true, twin: { power: "off" }, updatedAt: new Date(now).toISOString() };
  const db = HistoryDb.open(":memory:");
  try {
    // This unit test starts with a previously learned rule for the exact home.
    db.saveNight({ day: "2026-11-20", appliesDay: "2026-11-21", robot: {}, candidates: {},
      beerRules: [{ action, trigger: "tv_on", home: "home", user: "resident", device: "tv", weekday: 6, hour: 18, seen: 4, matched: 4, baseline: 0.125, p: 0.000244140625 }],
      reflection: version => ({ atMs: start - 30000, text: "night", data: { version } }) });
    const core = { nowMs: () => now, epoch: { boot: "b", home: "home#1" }, twin: { home: { id: "home" } },
      out: {}, ctx: { history: { db } }, signals: { list: () => [{ id: "tv", kind: "tv", room: "living" }], get: () => tv },
      surfaces: () => [{ id: "viewer-table", room: "living" }, { id: "other-room-table", room: "bedroom" }] } as unknown as HomeCore;
    const world = new WorldState({ surfaces: () => [], floorAt: () => 0, roomAt: () => null, devices: () => [] }).view(now);
    const beer = new HomeBeer(core, "resident");
    beer.see(world);
    now += 500;
    tv = { ...tv, twin: { power: "on" }, updatedAt: new Date(now).toISOString() };
    now += 500;
    world.person = { ...world.person, count: 1, visible: true, room: "living" };
    world.household_photo = { id: "view-1", at_ms: now, serial: 1, proof: {
      camera: LOOK_VIEW, person_count: 1, person: { room: "living", position: [2, 2], seated: true, attention: "toward_tv" },
      seats: "clear", dining_food: "unknown",
    } };
    world.surfaces_seen = [{ id: "viewer-table", label: "소파 탁자", room: "living", center: [2, 2.5], seen_ms: now }];
    beer.see(world);
    const candidate = beer.available(action);
    expect(candidate?.surface).toBe("viewer-table");
    const decision = { id: "pam-1", action } as DecisionRecord;
    const plan = { task: action, steps: [
      { id: "pick", kind: "pick", target: "fridge", object: null },
      { id: "place", kind: "place", target: "other-room-table", object: null },
    ] } as AgentPlan;
    expect(beer.reserve(decision, candidate!, plan)).toBe(false);
    expect(beer.valid(decision, world)).toBe(false);
    plan.steps[1]!.target = "viewer-table";
    expect(beer.reserve(decision, candidate!, plan)).toBe(true);
    const runner = { steps: [{ id: "place", target: { objectId: "viewer-table" } }] } as PlanView;
    expect(beer.valid(decision, world, runner)).toBe(true);
    runner.steps[0]!.target!.objectId = "other-room-table";
    expect(beer.valid(decision, world, runner)).toBe(false);
    runner.steps[0]!.target!.objectId = "viewer-table";
    expect(beer.valid(decision, { ...world, surfaces_seen: [] }, runner)).toBe(false);
  } finally { db.close(); }
});
