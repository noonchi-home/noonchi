// 구조 검사 금지 예제(tests/kinds-registry.test.ts): 「// 금지」 줄마다 findKindTables가 짚어야 한다.
import type { DeviceKind } from "../../../src/hub/types.js";

export const LABELS: Record<DeviceKind, string> = {} as Record<DeviceKind, string>; // 금지
export const PAIR = { aircon: 1, fridge: 2 }; // 금지
export const SIGHT_LIKE = { tv: [1], refrigerator: [2] }; // 금지
export const COMPUTED = { ["aircon"]: 1, ["fridge"]: 2 }; // 금지
const k: DeviceKind = "light";
export const BY_KIND = { [k]: 1 }; // 금지
export const ENTRIES = Object.fromEntries([["aircon", 1], ["fridge", 2]]); // 금지
const kinds: DeviceKind[] = ["light"];
export const MAPPED = Object.fromEntries(kinds.map((x) => [x, 1])); // 금지
export const LIST = ["aircon", "fridge"]; // 금지
export const FIXTURE = { deviceKind: "fridge" }; // 금지
export const RULES = [{ kind: "light" }, { kind: "tv" }]; // 금지
export function pick(kind: DeviceKind): number {
  switch (kind) {
    case "fridge": return 1; // 금지
    default: return 0;
  }
}
