// TODO(2026-11-26, 석준): 이 시험은 맥주를 사건 수 학습(learnBeerRules)이 배운다는 전제로 짜여 있다(가짜 반성이 맥주 후보를 내지 않고, learned.rules를 본다).
// 사용자 결정으로 맥주도 반성·시각 찾기·채택 검사로 배우고 실행 문은 그 규칙을 보지 않으니(src/server/home/beer.ts), 가짜 반성이 맥주 후보를 내고
// 가짜 시각 찾기가 시각을 답하는 모양으로 다시 써야 한다. 트윈 자료(twin/)가 있어야 돌아가서 이 작업 폴더에서는 돌려 보지 못했다.
import { join } from "node:path";
import { expect, it } from "vitest";
import { CUP_FSM_MEMORY, type FsmMemory } from "../src/brain/decision.js";
import { candidateFsmOf } from "../src/brain/pam/adopt.js";
import type { PlannedCommand } from "../src/contract/phone.js";
import type { WorldView } from "../src/contract/world.js";
import { beerCan, beerPhoto } from "./fixtures/assistance/beer.js";
import { localTime } from "./fixtures/assistance/learning.js";
import { residentStudio } from "./fixtures/assistance/resident.js";
import { assistanceReplay } from "./helpers/assistance-replay.js";
import { recordBeerHistory } from "./helpers/beer-history.js";
import { viewLooking } from "./helpers/camera.js";
import { pamView } from "./helpers/pam.js";
import { cupSteps, planCalls, plannerRespond } from "./helpers/planner.js";

const home = "mokryeon_180b";
const tv = "tv_62442cb3";
const table = "coffee_table_38536572";
const fridge = "fridge_bbc363a3";
const sink = "sink_counter_kitchen";
const canId = "beer_can_1";
const bring = "맥주 가져다주기";
const clear = "맥주 캔 치우기";
const wrong = "desk_small_ce7e768b";
type Exclusion = "delivery" | "cleanup" | "afternoon" | "sunday" | "other_can" | "obscured" | "self_cleared";
async function play(invalid?: Exclusion) {
  const studio = residentStudio(home);
  const learned = await recordBeerHistory(join(studio.runtimeDir, "noonchi.db"), { home, user: "resident", device: tv });
  expect(learned.rules).toMatchObject([{ action: bring, weekday: 6, hour: 18 }, { action: clear, weekday: 6, hour: 18 }]);
  let phase: string = bring;
  const day = invalid === "sunday" ? "2026-11-22" : "2026-11-21";
  const tvOn = localTime(day, invalid === "afternoon" ? "14:00:00" : "19:00:00");
  const target = invalid === "delivery" ? wrong : table;
  const go = (id: string) => ({ kind: "go", act: "가기", target: id, until: { phone_near: id }, timeout_s: 120 });
  const cleanup = cupSteps({ table, sink: invalid === "cleanup" ? wrong : sink, cup: canId, basin: invalid !== "cleanup" });
  cleanup[1] = { ...cleanup[1], until: { object: canId, facts: { place: "in_hand" } } };
  const respond = plannerRespond({
    [bring]: () => [planCalls([
      go(fridge),
      { kind: "pick", act: "꺼내기", item: "맥주 캔", target: fridge, until: { object: "beer_can", facts: { place: "in_hand" } }, timeout_s: 90 },
      go(target),
      { kind: "place", act: "놓기", item: "맥주 캔", target, until: { all: [
        { object: "beer_can", surface: target }, { not: { object: "beer_can", facts: { place: "in_hand" } } },
      ] }, timeout_s: 90 },
    ])],
    [clear]: () => [planCalls(cleanup)],
  });
  const replay = await assistanceReplay({ ...studio, home, start: tvOn - 12_000,
    model: {
      respond,
      reply: body => {
        const req = pamView(body);
        if (req.role === "predict") {
          const memory = req.memory as FsmMemory;
          const from = req.last_state ?? memory.initial_state;
          const edge = memory.states.find(s => s.id === from)?.next ?? [];
          const index = edge.findIndex(e => e.action === phase);
          if (from === "watching_tv" && index >= 0) return JSON.stringify({
            observation: "거실 시청", reasoning: "거실 TV 상태", from, next_index: index, state: phase === clear ? "away" : "watching_tv",
          });
          const watching = edge.findIndex(e => e.to === "watching_tv");
          if (watching >= 0) return JSON.stringify({ observation: "TV 시청", reasoning: "거실에 있음", from, next_index: watching, state: "watching_tv" });
          return JSON.stringify({ observation: "거실 안", reasoning: "시청", from: null, next_index: -1, state: "watching_tv" });
        }
        return JSON.stringify(req.role === "check" ? { ok: true, items: [] } : candidateFsmOf(CUP_FSM_MEMORY));
      },
    },
  });
  type Sighting = Parameters<typeof beerPhoto>[1];
  let rev = 10_000;
  const point = (id: string) => {
    const place = replay.server.layout?.center(id);
    if (!place) throw Error("fixture missing place " + id);
    return place.position;
  };
  const tablePos = point(table);
  const awayAt = point(wrong);
  let eye: [number, number] = [6.98, 6.38];
  const side = { id: table, label: "소파 탁자", room: "living", center: [tablePos[0], tablePos[2]] as [number, number] };
  const viewer: Sighting = { room: "living", seated: true, seat: [tablePos[0] - 0.5, tablePos[2]], surface: side };
  let facts = viewer;
  let firstSeen: number | undefined;
  let residentTrail: WorldView["person_trail"] = [];
  let aim: [number, number, number] = [tablePos[0], 1, tablePos[2]];
  const photo = async () => {
    const at = replay.clock.now();
    const view = beerPhoto(at, { ...facts, eye, cans: facts.cans?.map(can => ({
      ...can, last_seen_ms: at, last_in_view_ms: at, answered_ms: at,
      facts: { place: can.facts.place && { ...can.facts.place, at_ms: at } },
    })) });
    if (facts.room && facts.seat) residentTrail = [{ room: facts.room, position: facts.seat, at_ms: at }];
    view.person_trail = residentTrail;
    view.household_photo!.proof!.camera = viewLooking([eye[0], 1.3, eye[1]], aim);
    await replay.publish("world", "/world/state", { rev: ++rev, view });
    await replay.publish("world", "/world/household_photo", { photo: view.household_photo! });
    await replay.publish("perception", "/perception/frame_seen", { at_ms: at });
  };
  const pose = async (position: [number, number]) => {
    eye = position;
    await replay.publish("phone", "/phone/pose", { quality: "usable", pose_gen: 1, position, observed_ms: replay.clock.now() });
  };
  const pause = async (ms = 1000) => {
    await replay.advance(replay.clock.now() + ms);
    await pose(eye);
    await photo();
  };
  const commands = () => replay.phoneCommands().filter((c): c is PlannedCommand => c.type === "command");
  let commandCursor = 0;
  const find = async (wanted: (c: PlannedCommand) => boolean) => {
    for (let tries = 0; tries < 16; tries++) {
      const commandsNow = commands();
      const found = commandsNow.findIndex((c, ix) => ix >= commandCursor && wanted(c));
      if (found >= 0) { commandCursor = found + 1; return commandsNow[found]!; }
      await pause();
    }
    throw new Error(JSON.stringify({ phase, phone: [...new Set(commands().map(c => [c.kind, c.target?.id, c.id].join(":")))],
      log: replay.output("/act/log").map(e => e.body).filter(e => e.type === "execution" && e.text !== "대기").slice(-12) }));
  };
  const walkTo = (target: string) => find(c => c.kind === "go" && c.target?.id === target && !!c.guide);
  const move = async (command: PlannedCommand) => {
    const remaining = command.guide?.remaining;
    if (!remaining) throw Error("Missing walking guide for " + command.id);
    if (command.target) aim = command.target.look ?? command.target.position;
    for (const waypoint of remaining) {
      const [x, , y] = waypoint.position;
      const from = eye;
      const points = Math.max(1, Math.ceil(Math.hypot(x - from[0], y - from[1]) / 0.3));
      for (let i = 1; i <= points; i++) {
        await replay.advance(replay.clock.now() + 250);
        await pose([from[0] + (x - from[0]) * i / points, from[1] + (y - from[1]) * i / points]);
        await photo();
      }
    }
    await pause(250);
  };
  const putting = (place: "in_hand" | "on_table" | "in_sink", at: [number, number, number], surface: string | null) => {
    firstSeen ??= replay.clock.now();
    return beerCan(replay.clock.now(), canId, place, place === "in_sink" ? "kitchen" : "living", at, surface, firstSeen);
  };
  const outcome = (action: string) => replay.output("/act/assistance_outcome").find(e => e.body.action === action);
  const submissions = () => replay.requests.filter(r => r.path === "/v1/responses" && r.body.tools?.some((t: { name: string }) => t.name === "submit_plan")).length;
  const returnToStandby = async (target: string) => {
    const command = await find(c => c.id.startsWith("dock:") && c.kind === "go" && c.target?.id === target && !!c.guide);
    await move(command);
    for (let i = 0; i < 9; i++) {
      if (replay.phoneCommands().some(c => c.type === "command_clear" && c.id === command.id)) return;
      await pause();
    }
    throw new Error("No confirmed arrival at " + target);
  };
  try {
    await replay.publish("phone", "/phone/link", { ready: true });
    await pose(eye);
    await photo();
    await replay.advance(tvOn);
    await replay.server.hub.command(tv, { type: "on" });
    await pause();
    if (invalid === "afternoon" || invalid === "sunday") {
      for (let i = 0; i < 8; i++) await pause();
      expect(submissions()).toBe(0);
      expect(commands()).toEqual([]);
      return;
    }
    if (invalid === "delivery") {
      for (let i = 0; i < 8; i++) await pause();
      expect(submissions()).toBeGreaterThan(0);
      expect(commands().filter(c => c.kind === "pick")).toEqual([]);
      expect(outcome(bring)?.body.execution).toBe("failed");
      return;
    }
    await move(await walkTo(fridge));
    await find(c => c.kind === "pick");
    facts = { ...viewer, cans: [putting("in_hand", point(fridge), null)] };
    await pause();
    await move(await walkTo(table));
    await find(c => c.kind === "place" && c.target?.id === table);
    facts = { ...viewer, cans: [putting("on_table", tablePos, table)] };
    await pause();
    await returnToStandby("living_standby");
    expect(outcome(bring)?.body.execution).toBe("done");

    // The viewer picks up the same can after the delivery, then sets it on the table.
    facts = { ...viewer, cans: [putting("in_hand", tablePos, null)] };
    await pause();
    facts = { ...viewer, cans: [putting("on_table", tablePos, table)] };
    await pause();
    const submitted = submissions();
    const deliveredCommands = commands().length;
    await replay.server.hub.command(tv, { type: "off" });
    phase = clear;
    facts = { surface: side, cans: [putting("on_table", tablePos, table)] };
    await pause();
    facts = { room: "bed_sw", seat: [awayAt[0], awayAt[2]] };
    await pause();
    if (invalid === "other_can" || invalid === "obscured" || invalid === "self_cleared") {
      if (invalid === "other_can") facts = { surface: side, cans: [beerCan(replay.clock.now(), "beer_can_earlier",
        "on_table", "living", tablePos, table, tvOn - 30_000)] };
      else if (invalid === "obscured") facts = {};
      else {
        const location = point(sink);
        const seat: [number, number] = [location[0], location[2]];
        facts = { room: "kitchen", seat, cans: [putting("in_hand", location, null)] };
        await pause();
        facts = { room: "kitchen", seat, cans: [putting("in_sink", location, sink)] };
      }
      for (let i = 0; i < 8; i++) await pause();
      expect(submissions()).toBe(submitted);
      expect(commands().slice(deliveredCommands).filter(c => c.kind === "pick")).toEqual([]);
      return;
    }
    facts = { surface: side, cans: [putting("on_table", tablePos, table)] };
    await pause();
    if (invalid === "cleanup") {
      for (let i = 0; i < 8; i++) await pause();
      expect(submissions()).toBeGreaterThan(submitted);
      expect(commands().slice(deliveredCommands).filter(c => c.kind === "pick")).toEqual([]);
      expect(outcome(clear)?.body.execution).toBe("failed");
      return;
    }
    await move(await walkTo(table));
    await find(c => c.kind === "pick" && c.target?.id === canId);
    facts = { cans: [putting("in_hand", tablePos, null)] };
    await pause();
    await move(await walkTo(sink));
    await find(c => c.kind === "place" && c.target?.id === sink);
    expect(outcome(clear)).toBeUndefined();
    facts = { cans: [putting("in_sink", point(sink), sink)] };
    await pause();
    await returnToStandby("desk_watch");
    expect(outcome(clear)?.body.execution).toBe("done");
    expect(commands().flatMap(c => c.choices).every(choice => choice.id === "done")).toBe(true);
    expect(replay.server.history.list({ kinds: ["assistance_outcome"] }).filter(row => (row.data as { execution?: string }).execution === "done")).toHaveLength(2);
  } finally {
    expect(replay.network).toEqual([]);
    await replay.close();
  }
}

it("executes delivery and cleanup after reading the same four-week database through the production server", () => play(), 45000);
it("rejects a planner's wrong-room delivery before any pickup", () => play("delivery"), 45000);
it("rejects a planner's cleanup destination without a basin before any pickup", () => play("cleanup"), 45000);
it.each(["afternoon", "sunday"] as const)("keeps delivery off outside the learned context: %s", play, 45000);
it.each(["other_can", "obscured", "self_cleared"] as const)("issues no cleanup pick without the original can left on the table: %s", play, 45000);
