// 사용자가 있는 방: 한 사람만 보인 사진의 발 자리로만 쌓이는 사람 자취(person_trail)의 마지막 방이다. 둘 이상 보이면 자취가 비므로
// (src/world/state/people.ts) 둘이 보일 때 남은 발 자리를 지금 보이는 한 사람의 방으로 쓰지 않는다.
// 사람이 보이면 5초 안(FRESH_MS)의 것, 안 보이면 USER_ROOM_MS 안의 것만 쓴다. 대기 자리 복귀(src/act/robot/dock.ts)와 부름 목적지(src/agent/call-target.ts)가 같이 쓴다.
import type { WorldView } from "../contract/world.js";
import { FRESH_MS } from "./vocab.js";

/** 사용자 방을 마지막으로 확인한(발 자리를 본) 뒤 이만큼(ms) 안이면 그 방이다. 폰은 일하는 동안 사용자를 못 보기 쉽다(싱크대 앞에서 소파는 등 뒤). 목표 확인 창 5분과 같다. */
export const USER_ROOM_MS = 300_000;

/** 지금 사용자가 있다고 볼 방과 그 자취 시각. 모르면 null. */
export function userRoomOf(view: Pick<WorldView, "person" | "person_trail">, now: number): { room: string; at_ms: number } | null {
  const last = view.person_trail?.at(-1);
  if (!last?.room || last.at_ms > now) return null;
  const age = now - last.at_ms, p = view.person;
  const ok = p.visible ? p.count === 1 && age <= FRESH_MS : age <= USER_ROOM_MS;
  return ok ? { room: last.room, at_ms: last.at_ms } : null;
}
