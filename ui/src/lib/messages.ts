import type { ServerMessage } from "../../../src/contract/events.ts";

const KNOWN = new Set<ServerMessage["type"]>(["hello", "state", "agent", "brain", "photo", "focus", "eye"]);

export function parseMessage(text: string): ServerMessage | null {
  try {
    const m = JSON.parse(text) as { type?: unknown };
    return typeof m?.type === "string" && KNOWN.has(m.type as ServerMessage["type"]) ? (m as ServerMessage) : null;
  } catch {
    return null;
  }
}
