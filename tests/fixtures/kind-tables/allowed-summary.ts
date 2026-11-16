// 구조 검사 허용 예제: 말 꾸밈 파일(ui/src/dashboard/bubbles/summary.ts 자리로 본다)의 종류 이름 비교.
import type { DeviceKind } from "../../../src/devices/kinds.js";

export function tail(d: { kind: DeviceKind; on: boolean }): string {
  if (d.kind === "aircon" && d.on) return "냉방";
  if (["purifier", "fan"].includes(d.kind)) return "바람";
  return "";
}
