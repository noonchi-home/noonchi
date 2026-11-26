import { describe, expect, it } from "vitest";
import * as goals from "../src/goal/index.js";
import { recordBeerHistory } from "./helpers/beer-history.js";
import { parseScene } from "../src/observe/scene.js";
import type { WorldObject, WorldView } from "../src/contract/world.js";
import { WorldState } from "../src/world/index.js";
import { LOOK_SIZE, LOOK_VIEW } from "./helpers/camera.js";
import { det } from "./helpers/detectors.js";

const base = new WorldState({ surfaces: () => [], floorAt: () => 0, roomAt: () => null, devices: () => [] });
const power = (on: boolean, atMs: number) => ({ device: "tv", room: "living", on, atMs, originId: "power-" + atMs });
const can = (id: string, place: "in_hand" | "on_table" | "in_sink", at: number): WorldObject => ({
  id, cls: "beer_can", position: [1, 1, 1], surface: place === "on_table" ? "table" : place === "in_sink" ? "sink" : null,
  surface_label: null, room: place === "in_sink" ? "kitchen" : "living", error_m: null, status: "present",
  first_seen_ms: 1000, last_seen_ms: at, last_in_view_ms: at, facts: { place: { value: place, at_ms: at, since_ms: at, certainty: "confirmed" } },
  answered_ms: at + 100, devices: [], closer_hold: false, followed_by: null,
});
function view(at: number, room: string | null, objects: WorldObject[], tableVisible = true): WorldView {
  const w = base.view(at + 100);
  w.person = { ...w.person, visible: room !== null, count: Number(room !== null), room, holding: objects.filter(o => o.facts.place?.value === "in_hand").map(o => o.id) };
  w.objects = objects;
  w.surfaces_seen = tableVisible ? [{ id: "table", room: "living", label: "탁자", center: [1, 1], seen_ms: at }] : [];
  w.household_photo = { id: "photo-" + at, at_ms: at, answered_ms: at + 100, serial: at, proof: {
    camera: LOOK_VIEW, seats: "clear", person_count: Number(room !== null), dining_food: "unknown",
    person: room ? { position: [1, 1], room, seated: room === "living", attention: room === "living" ? "toward_tv" : "elsewhere" } : null,
  } };
  return w;
}

describe("beer observations from confirmed TV power and camera evidence", () => {
  it.each(["same_can", "other_can", "obscured", "self_cleared"] as const)("only offers the observed session can left on the table: %s", variant => {
    const observed: { kind: string; object?: string }[] = [];
    const watch = goals.BeerObservation && new goals.BeerObservation("home", "alice", e => { observed.push(e); });
    const read = (w: WorldView, on: boolean, powerAt: number) => watch?.observe(w, power(on, powerAt), false, w.at_ms);
    read(view(900, null, [can("prior-can", "on_table", 900)]), false, 800);
    read(view(1000, "living", [can("prior-can", "on_table", 900)]), true, 950);
    read(view(1400, "kitchen", [can("session-can", "in_hand", 1400)]), true, 950);
    read(view(1500, "living", [can("session-can", "in_hand", 1500)]), true, 950);
    read(view(1800, "living", [can("session-can", "on_table", 1800)]), true, 950);
    read(view(2100, "living", [can("session-can", "on_table", 2100)]), false, 2000);
    if (variant === "self_cleared") {
      read(view(2200, "kitchen", [can("session-can", "in_hand", 2200)]), false, 2000);
      read(view(2300, "kitchen", [can("session-can", "in_sink", 2300)]), false, 2000);
    } else {
      read(view(2200, "bedroom", []), false, 2000);
    }
    const visible = variant !== "obscured";
    const cans = variant === "same_can" ? [can("session-can", "on_table", 2500)] :
      variant === "other_can" ? [can("prior-can", "on_table", 2500)] : [];
    read(view(2500, null, cans, visible), false, 2000);
    expect(watch?.candidate("맥주 캔 치우기", 2600)?.object ?? null).toBe(variant === "same_can" ? "session-can" : null);
    expect(observed.map(e => e.kind)).toEqual(variant === "self_cleared"
      ? ["tv_on", "beer_taken", "tv_off", "can_put_away"] : ["tv_on", "beer_taken", "tv_off"]);
  });

  it("keeps the five-minute cutoff when a read repeats the same TV power", () => {
    const watch = new goals.BeerObservation("home", "alice", () => {});
    watch.observe(view(900, null, []), power(false, 800), false, 1000);
    watch.observe(view(1000, "living", []), power(true, 950), false, 1100);
    const late = 320_000;
    watch.observe(view(late, "living", []), power(true, late - 100), false, late + 100);
    expect(watch.candidate("맥주 가져다주기", late + 100)).toBeNull();
  });

  it("records bringing a beer only after the same can is seen leaving and returning", () => {
    const events: string[] = [];
    const watch = new goals.BeerObservation("home", "alice", e => { events.push(e.kind); });
    watch.observe(view(900, null, []), power(false, 800), false, 1000);
    watch.observe(view(1000, "living", []), power(true, 950), false, 1100);
    watch.observe(view(1200, "living", [can("first-seen-on-sofa", "in_hand", 1200)]), power(true, 950), false, 1300);
    expect(events).toEqual(["tv_on"]);
  });

  it("binds parsed camera evidence to the same can across a hand, the table and a resident's change of rooms", () => {
    const roomAt = ([, z]: [number, number]) => z < 0 ? { id: "kitchen", label: "Kitchen" } : { id: "living", label: "Living room" };
    const table = { id: "table", label: "Coffee table", kind: "table" as const, center: [0.75, 0.12] as [number, number], top: .75, radius: .2 };
    const basin = { id: "basin", label: "Sink", kind: "counter" as const, center: [2.75, -0.05] as [number, number], top: .75, radius: .2 };
    const state = new WorldState({ surfaces: () => [table, basin], floorAt: () => 0, roomAt, devices: () => [], evidenceStepMs: 1000 });
    const events: string[] = [];
    const watch = new goals.BeerObservation("home", "alice", event => events.push(event.kind));
    const person = det("person", 0.99, [180, 38, 120, 142], 0);
    const photo = (at: number, z: number, tvAt: number, stateOfCan?: "in_hand" | "on_table" | "in_sink", seated = false, x = 0) => {
      const camera = { ...LOOK_VIEW, origin: [x, 1.5, z] as [number, number, number] };
      const id = "frame-" + at;
      for (let t = at - 800; t < at; t += 100) {
        state.applyDetections({ id: id + "-" + t, capturedAtMs: t, latestAtMs: t, ...LOOK_SIZE, eye: null, view: camera }, [person]);
      }
      const { ids } = state.applyDetections({ id, capturedAtMs: at, latestAtMs: at, ...LOOK_SIZE, eye: null, view: camera }, [person]);
      const look = { view: camera, ...LOOK_SIZE, eye: [x, z] as [number, number], fresh: true, person_ids: ["d1"],
        dets: [{ id: "d1", box: person.box }] };
      const scene = parseScene(JSON.stringify({ scene: "room", summary: "",
        household: { seats: "clear", dining_food: "unknown", people: [{ id: "d1", attention: seated ? "toward_tv" : "elsewhere" }] },
        objects: stateOfCan ? [{ id: "v1", cls: "beer_can", box: { x: .475, y: .44, w: .05, h: .06 }, det: null }] : [],
        observations: [{ object_id: "d1", state: seated ? "sitting" : "standing" },
          ...(stateOfCan ? [{ object_id: "v1", state: stateOfCan }] : [])],
      }), new Set(["d1"]));
      state.applyScene(id, at, scene, ids, look);
      const observed = state.view(at + 100);
      watch.observe(observed, power(tvAt === 2000, tvAt), false, at + 100);
      return observed;
    };
    photo(1000, 0.12, 500);
    const viewer = photo(3000, 0.12, 2000, undefined, true);
    expect(viewer.household_photo?.proof?.person).toMatchObject({ room: "living", seated: true });
    expect(viewer.surfaces_seen).toContainEqual(expect.objectContaining({ id: "table", seen_ms: 3000 }));
    expect(photo(4000, -0.05, 2000, "in_hand").objects).toEqual([]);
    photo(5000, -0.05, 2000, "in_hand");
    const hand = photo(6000, -0.05, 2000, "in_hand");
    const id = hand.objects.find(o => o.cls === "beer_can")?.id;
    expect(id).toBeDefined();
    expect(hand.person.holding).toEqual([id]);
    expect(hand.household_photo?.proof?.person?.room).toBe("kitchen");
    expect(hand.objects[0]?.facts.place).toMatchObject({ value: "in_hand", certainty: "confirmed" });
    const returned = photo(7000, 0.12, 2000, "in_hand");
    expect(returned.person.holding).toEqual([id]);
    photo(8000, 0.12, 2000, "on_table", true);
    const setDown = photo(9000, 0.12, 2000, "on_table", true);
    expect(setDown.objects.find(o => o.id === id)).toMatchObject({ surface: "table", facts: { place: { value: "on_table" } } });
    const away = photo(11000, -0.05, 10000);
    expect(away.household_photo?.proof?.person?.room).toBe("kitchen");
    photo(12000, 0.12, 10000, "in_hand");
    photo(13000, 0.12, 10000, "in_hand");
    const carried = photo(14000, -0.05, 10000, "in_hand", false, 2);
    expect(carried.person.holding).toEqual([id]);
    expect(carried.objects.find(o => o.id === id)).toMatchObject({ last_seen_ms: 14000, facts: { place: { value: "in_hand", certainty: "confirmed" } } });
    photo(15000, -0.05, 10000, "in_sink", false, 2);
    photo(16000, -0.05, 10000, "in_sink", false, 2);
    const sink = photo(17000, -0.05, 10000, "in_sink", false, 2);
    expect(sink.objects.find(o => o.id === id)).toMatchObject({ surface: "basin", facts: { place: { value: "in_sink", certainty: "confirmed" } } });
    expect(events).toEqual(["tv_on", "beer_taken", "tv_off", "can_put_away"]);
  });

  // 2026-11-26 사용자 결정: 맥주도 반성·시각 찾기·채택 검사로 배운다. 밤 흐름은 맥주 사건만 세던 학습(learnBeerRules)의 규칙을 더 저장하지 않는다.
  // 사건은 그대로 기록되고 그 학습 코드도 남아 있어, 기록된 사건으로 직접 부르면 같은 토요일 18시 규칙이 나온다.
  it("live observation events reach the recorder; the night save no longer stores the event-count beer rules", async () => {
    const { result, rules, counts } = await recordBeerHistory(":memory:", { home: "home", user: "alice", device: "tv" });
    expect(counts).toMatchObject({ tvOn: 32, beer: 4, cleanup: 4 });
    expect(counts.rules).toMatchObject([{ weekday: 6, hour: 18 }, { weekday: 6, hour: 18 }]);
    expect(result.ok).toBe(true);
    expect(rules).toEqual([]);
  });
});
