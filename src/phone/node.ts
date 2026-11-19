import type { BusNode } from "../bus/index.js";
import type { PlannedCommandMessage } from "../contract/phone.js";
import { PhoneClaims } from "./owner.js";

export function phoneCommandRoutes(node: BusNode, show: (m: PlannedCommandMessage) => void): void {
  node.on("/act/phone_command", ({ cmd }) => show(cmd));
}

/** 폰 노드가 받은 요청 안에서만 다음 사용자를 고른다. 같은 사용자를 매번 방송하지 않는다. */
export function phoneOwnerRoutes(node: BusNode): void {
  const claims = new PhoneClaims();
  let previous: string | null | undefined;
  node.on("/phone/claim", async (c) => {
    claims.set(c.claim_id, c.kind, c.since_ms);
    const owner = claims.owner();
    const key = owner ? JSON.stringify(owner) : null;
    if (key === previous) return;
    await node.publish("/phone/owner", { owner });
    previous = key;
  });
}
