import type { DeviceView } from "../../../src/contract/events.ts";
import { SEEN_TEXT } from "../../../src/world/labels.ts";

const ATTR_TEXT: Record<string, Record<string, string>> = {
  power: { on: "켜짐", off: "꺼짐" }, running: { true: "동작 중", false: "멈춤" },
  lock: { locked: "잠김", unlocked: "잠금 해제" }, door: { open: "문 열림", closed: "문 닫힘" },
  curtain: { open: "열림", closed: "닫힘" }, blind: { open: "열림", closed: "닫힘" },
  faucet: { on: "물 나옴", off: "물 잠김" }, water: { on: "물 나옴", off: "물 잠김" },
  heating: { on: "난방 켜짐", off: "난방 꺼짐" }, charging: { on: "충전 중", off: "충전 안 함" },
};
const ACTIVE: Record<string, unknown> = { power: "on", running: true, lock: "unlocked", door: "open", curtain: "closed", blind: "closed", faucet: "on", water: "on", heating: "on", charging: "on" };
const ALERT = new Set(["door", "lock"]);
const MODES: Record<string, string> = { cool: "냉방", heat: "난방", auto: "자동", dry: "제습", fan: "송풍" };
const FANS: Record<string, string> = { low: "약", medium: "중", high: "강", auto: "자동" };

export type Tone = "on" | "off" | "alert" | "unknown";

/** 말풍선 한 장: 이름, 상태 한 줄, 모양(켜짐·꺼짐·경고·모름). 카메라로 본 값이 상태이면 줄 끝에 「카메라로 봄」. */
export function deviceSummary(d: DeviceView): { title: string; line: string; tone: Tone } {
  const s = d.state;
  if (s?.signal === "none") return { title: d.label, line: "모름", tone: "unknown" };
  const twin = s?.twin ?? {};
  const m = s?.matter ?? {};
  const parts: string[] = [];
  let on = false;
  let alert = s?.online === false;
  for (const [attr, v] of Object.entries(twin)) {
    const text = ATTR_TEXT[attr]?.[String(v)];
    if (!text) continue;
    parts.push(text);
    if (ACTIVE[attr] === v && attr !== "curtain" && attr !== "blind") {
      on = true;
      if (ALERT.has(attr)) alert = true;
    }
  }
  if (d.kind === "light" && m.onOff && typeof m.level === "number") parts.push(`밝기 ${m.level}%`);
  if (d.kind === "speaker" && typeof m.level === "number") parts.push(`음량 ${m.level}%`);
  if ((d.kind === "aircon" && m.onOff) || (d.kind === "thermostat" && m.systemMode !== "off")) {
    if (d.kind === "aircon" && typeof m.systemMode === "string" && MODES[m.systemMode]) parts.push(MODES[m.systemMode]);
    if (typeof m.setpointC === "number") parts.push(`${m.setpointC}°C`);
  }
  if (["purifier", "fan", "hood"].includes(d.kind) && typeof m.fanMode === "string" && m.fanMode !== "off") parts.push(`바람 ${FANS[m.fanMode] ?? m.fanMode}`);
  if (s?.online === false) parts.push("오프라인");
  if (!parts.length) parts.push("꺼짐");
  if (s?.vision?.applied) parts.push(SEEN_TEXT);
  return { title: d.label, line: parts.join(" · "), tone: alert ? "alert" : on ? "on" : "off" };
}
