import type { BusNode } from "../bus/index.js";
import type { PlannedCommandMessage } from "../contract/phone.js";
import { PhoneClaims } from "./owner.js";

export function phoneCommandRoutes(node: BusNode, show: (m: PlannedCommandMessage) => void): void {
  let shown: number | null = null;
  node.on("/act/phone_command", ({ cmd, revision }) => {
    if (shown !== null) return;
    show(cmd);
    shown = revision ?? 0;
  });
  node.on("/act/phone_changes", ({ cmd, revision }) => {
    if (revision !== undefined && shown !== null && revision <= shown) return;
    show(cmd);
    shown = revision ?? 0;
  });
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
