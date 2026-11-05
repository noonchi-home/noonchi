import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentAction, PendingView, ServerMessage } from "../../src/contract/events.ts";
import { ChatPanel } from "../src/chat/ChatPanel";
import { useChat } from "../src/chat/use-chat";

const action: AgentAction = { tool: "turn_on", args: {}, ok: true, deviceId: "ac_bed2", deviceLabel: "작은방 에어컨", reason: "켜 달라고 해서", observation: "켜짐 · 냉방 · 24°C", at: "t" };
const pending: PendingView = { token: "tok", deviceId: "lock", deviceLabel: "현관 도어록", command: { type: "unlock" }, reason: "문을 열어요", expiresAt: "t" };

let push: (m: ServerMessage) => void = () => {};
function Harness() {
  const chat = useChat();
  push = chat.onMessage;
  return <ChatPanel chat={chat} suggestions={["거실 조명 켜줘"]} />;
}

type Call = { url: string; body: Record<string, unknown> | null };
function stubFetch(answers: Record<string, unknown>) {
  const calls: Call[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : null });
    return new Response(JSON.stringify(answers[url] ?? { ok: false, error: "없음" }), { status: answers[url] ? 200 : 404 });
  }));
  return calls;
}
const send = (text: string) => {
  fireEvent.change(screen.getByLabelText("클로이드에게 보낼 말"), { target: { value: text } });
  fireEvent.click(screen.getByRole("button", { name: "보내기" }));
};

beforeEach(() => { localStorage.setItem("twin-home.session", "s1"); });
afterEach(() => { vi.unstubAllGlobals(); localStorage.clear(); });

describe("ChatPanel", () => {
  it("처음에는 요청해 보라는 글과 추천 문구가 있다", () => {
    stubFetch({});
    render(<Harness />);
    expect(screen.getByText("클로이드에게 말로 요청해 보세요.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "거실 조명 켜줘" })).toBeInTheDocument();
    expect(screen.getByLabelText("클로이드에게 보낼 말")).toHaveAttribute("placeholder", "클로이드에게 요청하기");
  });

  it("보내면 저장된 세션으로 요청하고, 단계 카드와 답을 보인다. 생각은 접혀 있다", async () => {
    const calls = stubFetch({ "/api/agent/chat": { sessionId: "s1", reply: "작은방 에어컨을 켰어요.", actions: [action], pendingConfirmations: [], provider: "mock" } });
    render(<Harness />);
    send("작은방 에어컨 켜줘");
    expect(screen.getByLabelText("클로이드에게 보낼 말")).toHaveValue("");
    await waitFor(() => expect(screen.getByText("작은방 에어컨을 켰어요.")).toBeInTheDocument());
    expect(calls[0]).toEqual({ url: "/api/agent/chat", body: { message: "작은방 에어컨 켜줘", sessionId: "s1" } });
    const card = screen.getByText("작은방 에어컨 켜줘").closest("[data-turn]") as HTMLElement;
    expect(card.dataset.state).toBe("ok");
    expect(within(card).getByText("켜기 · 작은방 에어컨")).toBeInTheDocument();
    expect(within(card).getByText("켜짐 · 냉방 · 24°C")).toBeInTheDocument();
    expect(within(card).getByText("켜 달라고 해서")).not.toBeVisible();
    fireEvent.click(within(card).getByRole("button", { name: /켜기 · 작은방 에어컨/ }));
    expect(within(card).getByText("켜 달라고 해서")).toBeVisible();
  });

  it("답을 기다리는 동안 보내기를 막고, 실시간 단계는 바로 붙는다", async () => {
    let release!: (r: Response) => void;
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>((r) => { release = r; })));
    render(<Harness />);
    send("작은방 에어컨 켜줘");
    expect(screen.getByRole("button", { name: "거실 조명 켜줘" })).toBeDisabled();
    act(() => push({ type: "agent", event: "action", sessionId: "s1", action }));
    const card = screen.getByText("작은방 에어컨 켜줘").closest("[data-turn]") as HTMLElement;
    expect(card.dataset.state).toBe("busy");
    expect(within(card).getByText("켜기 · 작은방 에어컨")).toBeInTheDocument();
    await act(async () => { release(new Response(JSON.stringify({ reply: "켰어요", actions: [action], pendingConfirmations: [] }))); });
    await waitFor(() => expect(card.dataset.state).toBe("ok"));
    expect(within(card).getAllByText("켜기 · 작은방 에어컨")).toHaveLength(1);
  });

  it("승인 대기는 승인 버튼으로 /api/agent/confirm에 토큰을 보낸다", async () => {
    const calls = stubFetch({
      "/api/agent/chat": { reply: "승인해 주세요", actions: [], pendingConfirmations: [pending] },
      "/api/agent/confirm": { ok: true, reply: "문을 열었어요" },
    });
    render(<Harness />);
    send("문 열어");
    const group = await screen.findByRole("group", { name: "승인 요청" });
    expect(within(group).getByText("현관 도어록: 문을 열어요")).toBeInTheDocument();
    fireEvent.click(within(group).getByRole("button", { name: "승인" }));
    await waitFor(() => expect(within(group).getByText("승인함")).toBeInTheDocument());
    expect(calls.at(-1)).toEqual({ url: "/api/agent/confirm", body: { token: "tok" } });
    expect(screen.getAllByText("문을 열었어요").length).toBeGreaterThan(0);
  });

  it("취소는 /api/agent/cancel", async () => {
    const calls = stubFetch({
      "/api/agent/chat": { reply: "승인해 주세요", actions: [], pendingConfirmations: [pending] },
      "/api/agent/cancel": { ok: true, reply: "현관 도어록 명령을 취소했어요." },
    });
    render(<Harness />);
    send("문 열어");
    const group = await screen.findByRole("group", { name: "승인 요청" });
    fireEvent.click(within(group).getByRole("button", { name: "취소" }));
    await waitFor(() => expect(within(group).getByText("취소함")).toBeInTheDocument());
    expect(calls.at(-1)).toEqual({ url: "/api/agent/cancel", body: { token: "tok" } });
  });

  it("추천 문구를 누르면 그 말을 보낸다", async () => {
    const calls = stubFetch({ "/api/agent/chat": { reply: "켰어요", actions: [], pendingConfirmations: [] } });
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "거실 조명 켜줘" }));
    await waitFor(() => expect(calls[0]?.body).toEqual({ message: "거실 조명 켜줘", sessionId: "s1" }));
  });

  it("새 대화는 카드를 지우고 새 세션을 저장한다", async () => {
    stubFetch({ "/api/agent/chat": { reply: "켰어요", actions: [], pendingConfirmations: [] } });
    render(<Harness />);
    send("불 켜줘");
    await screen.findByText("켰어요");
    fireEvent.click(screen.getByRole("button", { name: "새 대화" }));
    expect(screen.queryByText("불 켜줘")).toBeNull();
    expect(screen.getByText("새 대화를 시작했어요.")).toBeInTheDocument();
    expect(localStorage.getItem("twin-home.session")).not.toBe("s1");
  });

  it("폰에서 말한 대화도 카드로 쌓인다", () => {
    stubFetch({});
    render(<Harness />);
    act(() => push({ type: "agent", event: "reply", sessionId: "phone", message: "불 꺼줘", reply: "껐어요", actions: [], pendingConfirmations: [] }));
    const card = screen.getByText("불 꺼줘").closest("[data-turn]") as HTMLElement;
    expect(card.dataset.source).toBe("phone");
    expect(within(card).getByText("껐어요")).toBeInTheDocument();
  });

  it("접으면 머리줄만 남고 다시 펼 수 있다", () => {
    stubFetch({});
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "대화 접기" }));
    expect(screen.queryByLabelText("클로이드에게 보낼 말")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "대화 펴기" }));
    expect(screen.getByLabelText("클로이드에게 보낼 말")).toBeInTheDocument();
  });
});
