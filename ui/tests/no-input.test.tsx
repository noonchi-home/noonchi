// 대시보드(허브 화면)에는 입력창이 없다. 요청·질문·답·승인은 폰 음성으로 오간다.
import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { HealthView, ServerMessage } from "../../src/contract/events.ts";
import { Dashboard } from "../src/dashboard/Dashboard";

const FIELDS = "input, textarea, select, form, [contenteditable], [role=textbox], [role=searchbox], [role=combobox]";

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

const waiting: ServerMessage = {
  type: "agent", event: "reply", sessionId: "phone", message: "현관문 열어줘", reply: "폰에서 승인해 주세요",
  actions: [{ tool: "unlock", args: {}, ok: false, needsConfirmation: true, deviceId: "lock", deviceLabel: "현관 도어록", reason: "열어 달라고 해서", at: "t" }],
  pendingConfirmations: [{ token: "k", deviceId: "lock", deviceLabel: "현관 도어록", command: { type: "unlock" }, reason: "문을 열어요", choices: [], expiresAt: "t" }],
};

const health: HealthView = {
  ok: true, devices: 1, hub: "memory", transport: null, provider: "openai", model: "m", twin: true, eye: true,
  home: { id: "h", name: "우리 집" }, phone_urls: ["http://192.168.0.7:8210/phone/"], brain: false, mode: "test",
  ready: { ok: false, inference_mode: "openai", vlm: { base_url: "", model: "", key: false, reachable: false }, pam: { base_url: "", model: "", key: false, reachable: false },
    agent: { provider: "openai", base_url: "", model: "", key: false, reachable: false }, db: false },
};

beforeEach(() => {
  vi.stubGlobal("WebSocket", FakeSocket);
  vi.stubGlobal("fetch", vi.fn(async (path: string) => (path === "/api/health" ? Response.json(health) : new Response("{}", { status: 404 }))));
});
afterEach(() => {
  vi.unstubAllGlobals();
  history.replaceState(null, "", "/");
});

describe("대시보드", () => {
  it("입력창·폼이 하나도 없다: 처음, 폰 요청·승인 대기 메시지가 온 뒤, 설정 창을 연 뒤", async () => {
    const { container } = render(<Dashboard />);
    expect(document.querySelectorAll(FIELDS)).toHaveLength(0);
    act(() => FakeSocket.last!.push(waiting));
    expect(container.querySelectorAll(FIELDS)).toHaveLength(0);
    expect(screen.queryByRole("button", { name: /보내기|승인$/ })).toBeNull();
    await screen.findByRole("img", { name: "폰 연결 QR" });
    await userEvent.click(within(screen.getByRole("region", { name: "마스코트" })).getByRole("button", { name: "설정 열기" }));
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent("집 다시 설정하기");
    expect(document.querySelectorAll(FIELDS)).toHaveLength(0);
  });
});
