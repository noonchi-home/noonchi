// 구조 검사 금지 예제: src/thinq/ 안의 지역 변수 비교(잠시 허용 목록에 없는 줄, 시험이 src/thinq/appliance.ts 자리로 본다).
import type { DeviceKind } from "../../../src/devices/kinds.js";

export function read(kind: DeviceKind): number {
  if (kind === "aircon") return 1; // 금지
  return 0;
}
