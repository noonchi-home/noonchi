// 대시보드 트윈 말풍선은 디자인 시스템 전 크기(2026-11-08 사용자 결정): 이름·verb·상태 줄은 label, 번호는 20px(caption). far(1920 32px)를 쓰지 않는다.
import { act, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DeviceView, ServerMessage } from "../../src/contract/events.ts";
import { Dashboard } from "../src/dashboard/Dashboard";

const SPOT = new Map<string, { x: number; y: number; visible: boolean }>();
vi.mock("../src/twin/use-anchors", () => ({
  useAnchors: (ids: string[]) => {
    for (const id of ids) if (!SPOT.has(id)) SPOT.set(id, { x: 500, y: 400, visible: true });
    return SPOT;
  },
}));

class FakeSocket {
  static last: FakeSocket | null = null;
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  constructor(public url: string) { FakeSocket.last = this; }
  push(m: ServerMessage) { this.onmessage?.({ data: JSON.stringify(m) }); }
  send() {}
  close() {}
}

const lamp: DeviceView = {
  id: "lamp", label: "플로어 스탠드", room: "living", roomLabel: "거실", twinType: "t", kind: "light", matterDeviceType: "x", capabilities: [], sensors: [], twinAttrs: {},
  state: { id: "lamp", online: true, twin: { power: "on" }, matter: {}, updatedAt: "t" },
};
const turnedOn: ServerMessage = {
  type: "agent", event: "action", sessionId: "phone",
  action: { tool: "turn_on", args: {}, ok: true, deviceId: "lamp", deviceLabel: "플로어 스탠드", reason: "켜 달라고 해서", at: "2026-11-08T05:00:00.000Z" },
};

beforeEach(() => {
  SPOT.clear();
  vi.stubGlobal("WebSocket", FakeSocket);
  vi.stubGlobal("fetch", vi.fn(async (path: string) => (path === "/api/devices" ? Response.json([lamp]) : new Response("{}", { status: 404 }))));
});
afterEach(() => { vi.unstubAllGlobals(); });

describe("대시보드 트윈 말풍선 크기", () => {
  it("방금 다룬 기기 말풍선도 글은 label, 번호는 20px: far 글·44px 번호를 쓰지 않는다", async () => {
    render(<Dashboard />);
    await waitFor(() => expect(FakeSocket.last).not.toBeNull());
    await act(async () => { await Promise.resolve(); });
    act(() => FakeSocket.last!.push(turnedOn));
    const bubble = await waitFor(() => {
      const b = document.querySelector<HTMLElement>("[data-check=lamp]");
      expect(b).not.toBeNull();
      return b!;
    });
    expect(bubble).toHaveAttribute("data-focus", "true");
    const card = bubble.querySelector("[data-tone=twin]")!;
    expect(card).toHaveClass("text-label");
    expect(card.outerHTML).not.toContain("text-far");
    expect(bubble.querySelector("[data-order]")).toHaveClass("size-5");
    expect(bubble.querySelector("[data-order]")).not.toHaveClass("size-11");
  });
});
