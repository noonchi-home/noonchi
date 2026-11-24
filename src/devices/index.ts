// 가상 가전·ThinQ·TV 중계(구현명세서 3.1·4·9.2)
// 다른 도메인은 이 입구로만 가져온다.
export { buildDevices, type Attrs, type RawObject, type SkippedObject, type StatesSpec } from "./devices.js";
export { loadIrConfig } from "./hub/ir-config.js";
export { openIrPort } from "./hub/ir-serial.js";
export type { IrConfig, IrPort } from "./hub/ir.js";
export { MemoryHub } from "./hub/memory.js";
export { isUnknown, SignalHub, type RealLinkLike, type SignalSource } from "./hub/signals.js";
export { checkKinds } from "./kinds-check.js";
export { loadMatterHub } from "./matter/load.js";
export { describeDevice, KIND_LABELS, findTypeRule, checkCommand, normalizeCommand, twinChange } from "./mapping.js";
export { PAIRABLE_KINDS, fitsKind } from "./thinq/appliance.js";
export { ThinqClient, ThinqError, thinqConfig } from "./thinq/client.js";
export { ThinqLink, DEFAULT_POLL_MS, DEFAULT_READBACK_MS } from "./thinq/link.js";
export { RelayClient, RelayError, relayConfig, type RelayConfig } from "./relay/client.js";
export { RelayLink, DEFAULT_RELAY_POLL_MS } from "./relay/link.js";
