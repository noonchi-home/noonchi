// 가상 가전·ThinQ(구현명세서 3.1·4·9.2)
// 다른 도메인은 이 입구로만 가져온다(도메인 나누기 설계 2.4).
export { loadTwin, type TwinData, resolveTwinStudioDir } from "./devices.js";
export { MemoryHub } from "./hub/memory.js";
export { isUnknown, SignalHub, type SignalSource } from "./hub/signals.js";
export { type DeviceHub, type RoomSpec, type Command, type CommandResult, type DeviceKind, type DeviceSpec, type DeviceState, type Capability, type CommandType, type SightEvidence, type VisionResult, type VisionSeen } from "./hub/types.js";
export { checkKinds } from "./kinds-check.js";
export { describeDevice, KIND_LABELS, findTypeRule, checkCommand, normalizeCommand, twinChange } from "./mapping.js";
export { PAIRABLE_KINDS, fitsKind } from "./thinq/appliance.js";
export { ThinqClient, ThinqError, thinqConfig } from "./thinq/client.js";
export { ThinqLink, DEFAULT_POLL_MS, DEFAULT_READBACK_MS } from "./thinq/link.js";
