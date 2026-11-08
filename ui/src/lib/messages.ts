import type { ServerMessage } from "../../../src/contract/events.ts";

// ServerMessage의 type 전부. 계약에 type을 더하고 여기를 빼먹으면 typecheck가 실패한다.
const KNOWN: Record<ServerMessage["type"], true> = { hello: true, state: true, agent: true, brain: true, photo: true, focus: true, eye: true, plan: true, world: true, say: true };

export function parseMessage(text: string): ServerMessage | null {
  try {
    const m = JSON.parse(text) as { type?: unknown };
    return typeof m?.type === "string" && Object.hasOwn(KNOWN, m.type) ? (m as ServerMessage) : null;
  } catch {
    return null;
  }
}
