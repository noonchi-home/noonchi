import type { Body, BusNode, Header } from "../bus/index.js";
import type { PlannedCommandMessage } from "../contract/phone.js";
import { PhoneClaims } from "./owner.js";

export function phoneCommandRoutes(node: BusNode, show: (m: PlannedCommandMessage) => void, live?: {
  plan(p: Body<"/act/plan">): void; status(s: Body<"/act/status">): void;
}): void {
  let shown = false;
  let publisher = "";
  let lastRevision = -1;
  function deliver(cmd: PlannedCommandMessage, header: Header, revision: number | undefined, replay: boolean) {
    if (cmd.type === "command_clear") { show(cmd); return; }
    const { boot, home, inst } = header;
    const speech = revision === undefined ? {} : { speech_id: { boot, homeEpoch: home, publisher: inst, revision } };
    show({ ...cmd, speak: !replay && cmd.speak, ...speech });
  }
  function accept(header: Header, revision: number | undefined): boolean {
    const scope = JSON.stringify([header.boot, header.home, header.inst]);
    if (publisher !== scope) { publisher = scope; lastRevision = -1; }
    if (revision !== undefined) {
      if (revision <= lastRevision) return false;
      lastRevision = revision;
    }
    shown = true;
    return true;
  }
  node.on("/act/phone_changes", (change, { e }) => {
    if ("plan" in change) { live?.plan(change); return; }
    if ("status" in change) { live?.status(change.status); return; }
    const { cmd, revision } = change;
    if (accept(e.header, revision)) deliver(cmd, e.header, revision, false);
  });
  // 먼저 변화 구독을 준비한다. 준비 때의 명령만 복구해 생방송 첫 단계를 건너뛰지 않는다.
  node.on("/act/phone_command", ({ cmd, revision }, { e }) => {
    if (!shown && accept(e.header, revision)) deliver(cmd, e.header, revision, true);
  }, { mode: "snapshot" });
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
