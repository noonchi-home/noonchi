import { WATER_ACTION, taskOf } from "../../act/tasks.js";
import type { WorldView } from "../../contract/world.js";

export function assistanceResident(world: WorldView, resident: string | null, now: number, freshnessMs: number): string | null {
  const photo = world.household_photo;
  return photo && now >= photo.at_ms && now - photo.at_ms <= freshnessMs && photo.proof?.person_count === 1
    && world.person.count === 1 && world.person.visible ? resident : null;
}

export function proactiveIntent(text: string) {
  const phrase = /^(?:앞으로|다음부터)\s+먼저\s+(.+?)\s*[.!?~]*$/.exec(text.trim())?.[1];
  if (!phrase) return null;
  if (/^하지\s*마(?:세요)?$/.test(phrase)) return { kind: "decline" as const };
  if (/^해\s*(?:줘(?:요)?|주세요)$/.test(phrase)) return { kind: "followup" as const };
  if (/^물(?:\s*한\s*잔)?(?:을)?\s*가져다\s*(?:줘(?:요)?|주세요)$/.test(phrase)) {
    return { kind: "named" as const, action: WATER_ACTION };
  }
  const action = /^(.+)\s+해\s*(?:줘(?:요)?|주세요)$/.exec(phrase)?.[1]?.trim();
  return action && taskOf(action) ? { kind: "named" as const, action } : null;
}
