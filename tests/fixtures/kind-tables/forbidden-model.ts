// 구조 검사 금지 예제: 등록부(src/devices/kinds.ts)·매핑(mapping.ts) 밖 가전 쪽 파일의 종류 이름 비교(시험이 src/devices/control.ts 자리로 본다).
import type { DeviceSpec } from "../../../src/contract/devices.js";

export function command(spec: Pick<DeviceSpec, "kind">): string {
  if (spec.kind === "lock") return "lock"; // 금지
  return "on";
}
