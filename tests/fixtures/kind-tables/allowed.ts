// 구조 검사 허용 예제(tests/kinds-registry.test.ts): findKindTables가 하나도 짚지 않아야 한다.
import type { DeviceKind } from "../../../src/devices/hub/types.js";
import { KINDS, KIND_ORDER, mapEntries } from "../../../src/devices/kinds.js";

const lookup = (id: string): string | undefined => (id ? "light" : undefined);
export const NAMES = { deviceKind: (id: string) => lookup(id) };
export interface X { deviceKind?: (id: string) => string | undefined }
export const L: Record<DeviceKind, string> = mapEntries(KINDS, (e) => e.label);
export const BY_ORDER = Object.fromEntries(KIND_ORDER.map((k) => [k, KINDS[k].label]));
export const TASK = { devices: { kinds: ["aircon"], tools: ["turn_on"] } };
export const isGo = (step: { kind: string }) => step.kind === "go";
export const isAc = (adapter: string) => adapter === "air_conditioner";
