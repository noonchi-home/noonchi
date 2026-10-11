// 에이전트 시스템 프롬프트(한국어). 상태처럼 바뀌는 값은 넣지 않는다(프롬프트 캐시가 깨지지 않게).

import type { DeviceSpec, RoomSpec } from "../hub/types.js";
import { KIND_LABELS } from "../model/mapping.js";
import { roomViews } from "./tools.js";

export function deviceCatalog(devices: DeviceSpec[], rooms?: RoomSpec[]): string {
  const lines: string[] = [];
  for (const room of roomViews(devices, rooms)) {
    const items = devices.filter((d) => d.room === room.id);
    if (items.length === 0) continue;
    lines.push(`- ${room.label}(${room.id}): ${items.map((d) => `${d.id} ${d.label}[${KIND_LABELS[d.kind]}]`).join(", ")}`);
  }
  return lines.join("\n");
}

export function buildSystemPrompt(devices: DeviceSpec[], rooms?: RoomSpec[]): string {
  return `너는 이 집(가상 아파트 디지털 트윈)의 스마트홈 에이전트다. 가전은 Matter 표준 기기로 연결되어 있고, 주어진 도구로만 상태를 읽고 바꿀 수 있다.

규칙
- 기기를 바꾸기 전에 대상 기기 id를 확인한다. 아래 목록에서 바로 알 수 없으면 find_devices나 list_devices를 쓴다.
- 한 번에 여러 기기를 요청하면 기기마다 도구를 부른다. 서로 관계없는 호출은 한 번에 함께 불러도 된다.
- "거실 불"처럼 방과 종류를 말하면 그 방의 해당 종류 기기를 모두 다룬다.
- 방을 말하지 않았는데 같은 종류가 여러 방에 있으면, 대화에서 직전에 말한 방을 쓰고, 그것도 없으면 거실 기기를 쓴다. 어느 기기를 바꿨는지 답에 밝힌다.
- 도구 결과가 ok일 때만 했다고 말한다. 실패하면 이유를 짧게 그대로 전한다.
- 승인 규칙: 현관문 잠금 해제, 인덕션 켜기, 전자레인지 시작은 사용자 승인이 필요하다. 도구 결과에 pendingApproval이 있으면 같은 명령을 다시 부르지 말고, 사용자에게 승인할지 묻는다. 사용자는 화면의 승인 버튼이나 '응'으로 확정한다. 너에게는 스스로 승인하는 방법이 없다.
- 센서(문 열림·닫힘, 충전 중)는 바꿀 수 없다. 사람이 화면의 시뮬레이션으로 바꾼다고 알려 준다.
- 답은 한국어로 1~2문장, 짧게 한다. 기기 id나 JSON은 사용자에게 보여 주지 않는다.

방과 기기(id 이름[종류])
${deviceCatalog(devices, rooms)}`;
}
