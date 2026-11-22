import type { WorldObject, WorldView } from "../../../src/contract/world.js";
import { WorldState } from "../../../src/world/index.js";
import { LOOK_VIEW } from "../../helpers/camera.js";
import { localTime } from "./learning.js";

const world = new WorldState({ surfaces: () => [], floorAt: () => 0, roomAt: () => null, devices: () => [] });

export function beerCan(at: number, id: string, place: "in_hand" | "on_table" | "in_sink",
  room: string, position: [number, number, number], surface: string | null, firstSeen = at): WorldObject {
  return { id, cls: "beer_can", position, surface, surface_part: place === "in_sink" ? "basin" : undefined,
    surface_label: null, room, status: "present", error_m: null, first_seen_ms: firstSeen, last_seen_ms: at, last_in_view_ms: at,
    facts: { place: { value: place, at_ms: at, since_ms: at, certainty: "confirmed" } }, answered_ms: at + 100,
    devices: [], closer_hold: false, followed_by: null };
}

export function beerPhoto(at: number, input: { room?: string; seat?: [number, number]; seated?: boolean; cans?: WorldObject[];
  surface?: { id: string; label: string; room: string; center: [number, number] }; eye?: [number, number] }): WorldView {
  const w = world.view(at + 100);
  const count = Number(!!input.room);
  const seat = input.seat ?? [1, 1];
  w.objects = input.cans ?? [];
  w.person = { ...w.person, visible: !!input.room, count, room: input.room ?? null, position: input.room ? seat : null,
    position_ms: input.room ? at : null, holding: w.objects.filter(o => o.facts.place?.value === "in_hand").map(o => o.id),
    facts: input.seated ? { activity: { value: "watching_tv", at_ms: at, since_ms: at, certainty: "confirmed" } } : {} };
  w.surfaces_seen = input.surface ? [{ ...input.surface, seen_ms: at }] : [];
  if (input.eye) w.eye = { position: input.eye, height_m: 1.15, yaw_deg: 0, pitch_deg: -10, room: null, room_label: null, at_ms: at };
  w.household_photo = { id: "beer-photo-" + at, at_ms: at, answered_ms: at + 100, serial: at, proof: {
    camera: LOOK_VIEW, person_count: count, seats: "clear", dining_food: "unknown",
    person: input.room ? { position: seat, room: input.room, seated: input.seated ?? false, attention: input.seated ? "toward_tv" : "elsewhere" } : null,
  } };
  return w;
}

export function* beerEvenings(days = 28) {
  for (let i = 0; i < days; i++) {
    const day = new Date(Date.UTC(2026, 9, 24 + i)).toISOString().slice(0, 10);
    for (const time of i % 7 === 0 ? ["14:00:00", "19:00:00"] : ["19:00:00"]) {
      const on = localTime(day, time);
      yield { day, on, off: on + 90 * 60_000, sawBeer: i % 7 === 0 && time === "19:00:00" };
    }
  }
}
