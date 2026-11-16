// 한국어 문장 조각: 조사, 상태 설명, "~를 켰어요" 같은 결과 문장.

import type { Command, DeviceKind, DeviceSpec, DeviceState } from "../devices/index.js";
import { josa } from "../shared/korean.js";


const MODE_KO: Record<string, string> = { cool: "냉방", heat: "난방", auto: "자동", dry: "제습", fan: "송풍", off: "꺼짐" };
const FAN_KO: Record<string, string> = { low: "약", medium: "중", high: "강", auto: "자동", off: "꺼짐" };

const ATTR_TEXT: Record<string, Record<string, string>> = {
  power: { on: "켜짐", off: "꺼짐" },
  running: { true: "동작 중", false: "멈춤" },
  lock: { locked: "잠김", unlocked: "잠금 해제" },
  door: { open: "문 열림", closed: "문 닫힘" },
  curtain: { open: "열림", closed: "닫힘" },
  blind: { open: "열림", closed: "닫힘" },
  faucet: { on: "물 나옴", off: "물 잠김" },
  water: { on: "물 나옴", off: "물 잠김" },
  heating: { on: "난방 켜짐", off: "난방 꺼짐" },
  charging: { on: "충전 중", off: "충전 안 함" },
};

/** 상태를 사람이 읽는 말로(예: "켜짐, 밝기 30%"). */
export function stateText(spec: Pick<DeviceSpec, "kind">, state: Pick<DeviceState, "twin" | "matter">): string {
  const out: string[] = [];
  for (const [attr, v] of Object.entries(state.twin)) out.push(ATTR_TEXT[attr]?.[String(v)] ?? `${attr}=${String(v)}`);
  const m = state.matter;
  const on = m.onOff === true;
  if (spec.kind === "light" && on && typeof m.level === "number" && m.level < 100) out.push(`밝기 ${m.level}%`);
  if (spec.kind === "speaker" && typeof m.level === "number") out.push(`음량 ${m.level}%`);
  if (spec.kind === "aircon" && on) {
    if (typeof m.systemMode === "string") out.push(MODE_KO[m.systemMode] ?? m.systemMode);
    if (typeof m.setpointC === "number") out.push(`${m.setpointC}°C`);
  }
  if (spec.kind === "thermostat" && m.systemMode !== "off" && typeof m.setpointC === "number") out.push(`${m.setpointC}°C`);
  if (spec.kind === "covering" && typeof m.openPercent === "number" && m.openPercent > 0 && m.openPercent < 100) out.push(`${m.openPercent}% 열림`);
  if (m.operationalState === "paused") out.push("일시정지");
  return out.join(", ");
}

/** 결과 문장: 여러 기기를 한 문장으로("거실 천장등, 플로어 스탠드를 켰어요."). */
export function doneSentence(labels: string[], kind: DeviceKind, cmd: Command): string {
  const names = labels.join(", ");
  const obj = (verb: string) => `${josa(names, "을/를")} ${verb}`;
  switch (cmd.type) {
    case "on":
      return `${obj("켰어요")}.`;
    case "off":
      return `${obj("껐어요")}.`;
    case "level":
      return kind === "speaker" ? `${names} 음량을 ${cmd.percent}%로 맞췄어요.` : `${names} 밝기를 ${cmd.percent}%로 맞췄어요.`;
    case "climate": {
      const parts: string[] = [];
      if (cmd.mode) parts.push(MODE_KO[cmd.mode] ?? cmd.mode);
      if (cmd.setpointC !== undefined) parts.push(`${cmd.setpointC}°C`);
      if (cmd.fan) parts.push(`바람 ${FAN_KO[cmd.fan] ?? cmd.fan}`);
      return parts.length > 0 ? `${josa(names, "을/를")} ${josa(parts.join(", "), "으로/로")} 맞췄어요.` : `${obj("설정했어요")}.`;
    }
    case "covering":
      if (cmd.openPercent <= 0) return `${obj("닫았어요")}.`;
      if (cmd.openPercent >= 100) return `${obj("열었어요")}.`;
      return `${josa(names, "을/를")} ${cmd.openPercent}% 열었어요.`;
    case "lock":
      return `${obj("잠갔어요")}.`;
    case "unlock":
      return `${names} 잠금을 해제했어요.`;
    case "start":
      return `${obj("시작했어요")}.`;
    case "stop":
      return `${obj("멈췄어요")}.`;
    case "pause":
      return `${obj("일시정지했어요")}.`;
    case "valve":
      return cmd.open ? `${names} 물을 틀었어요.` : `${names} 물을 잠갔어요.`;
  }
}

/** 명령 → 같은 일을 하는 도구 이름(승인 확정 기록용). */
export function toolForCommand(cmd: Command): string {
  switch (cmd.type) {
    case "on": return "turn_on";
    case "off": return "turn_off";
    case "level": return "set_level";
    case "climate": return "set_climate";
    case "covering": return "set_covering";
    case "valve": return "set_valve";
    case "pause": return "stop";
    default: return cmd.type;
  }
}

/** 사용자에게 승인을 묻는 문장. */
export function askApproval(reason: string): string {
  return `${reason} 진행할까요? 화면의 승인 버튼을 누르거나 '응'이라고 답해 주세요.`;
}
