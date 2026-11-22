import type { WorldView } from "../../contract/world.js";

export function assistanceResident(world: WorldView, resident: string | null, now: number, freshnessMs: number): string | null {
  const photo = world.household_photo;
  return photo && now >= photo.at_ms && now - photo.at_ms <= freshnessMs && photo.proof?.person_count === 1
    && world.person.count === 1 && world.person.visible ? resident : null;
}
