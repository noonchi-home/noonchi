import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { AgentAction, PendingView, ServerMessage } from "../../src/contract/events.ts";
import { DecisionLog } from "../src/chat/DecisionLog";
import { turnsReducer, type Turn } from "../src/chat/turns";

const find: AgentAction = { tool: "find_devices", args: { query: "작은방 에어컨" }, ok: true, reason: "'작은방 에어컨'가 어느 기기인지 먼저 찾으려고", observation: "1개 찾음", at: "2026-11-06T05:01:12.000Z" };
const turnOn: AgentAction = { tool: "turn_on", args: {}, ok: true, deviceId: "ac_bed2", deviceLabel: "작은방 에어컨", reason: "켜 달라고 해서", observation: "켜짐 · 냉방 · 24°C", at: "2026-11-06T05:01:13.000Z" };
const pending: PendingView = { token: "tok", deviceId: "lock", deviceLabel: "현관 도어록", command: { type: "unlock" }, reason: "문을 열어요", expiresAt: "t" };
const turnsOf = (messages: ServerMessage[]) => messages.reduce<Turn[]>(turnsReducer, []);
const reply = (message: string, text: string, actions: AgentAction[] = [], pendingConfirmations: PendingView[] = []): ServerMessage =>
  ({ type: "agent", event: "reply", sessionId: "phone", message, reply: text, actions, pendingConfirmations });

function show(turns: Turn[], view: "log" | "phone" = "log", onView = vi.fn()) {
  render(<DecisionLog turns={turns} view={view} onView={onView} phone={<p>폰 화면 자리</p>} />);
  return onView;
}
const card = (text: string) => screen.getByText(text).closest("[data-turn]") as HTMLElement;

describe("DecisionLog", () => {
  it("보기만 하는 판단 기록 패널이다", () => {
    show([]);
    const panel = screen.getByRole("region", { name: "판단 기록" });
    expect(within(panel).getByText("폰에서 클로이드에게 말해 보세요.")).toBeInTheDocument();
    expect(panel.querySelector("input, textarea, select, form, [contenteditable]")).toBeNull();
  });

  it("요청 카드: 누가·들은 말, 생각, 확인·행동 단계, 폰으로 돌려준 답", async () => {
    show(turnsOf([reply("작은방 에어컨 켜줘", "작은방 에어컨을 켰어요.", [find, turnOn])]));
    const c = card("작은방 에어컨 켜줘");
    expect(c.dataset.source).toBe("phone");
    expect(within(c).getByText("거주자 · 폰")).toBeInTheDocument();
    expect(within(c).getByText("생각 2개")).toBeInTheDocument();
    await waitFor(() => expect(within(c).getByText("켜 달라고 해서")).toBeVisible());
    const steps = within(c).getByRole("list", { name: "단계" });
    expect(within(steps).getByText("확인")).toBeInTheDocument();
    expect(within(steps).getByText("행동")).toBeInTheDocument();
    expect(within(steps).getByText("켜기 · 작은방 에어컨")).toBeInTheDocument();
    expect(within(steps).getAllByText("완료")).toHaveLength(2);
    expect(within(steps).getByText("켜짐 · 냉방 · 24°C")).not.toBeVisible();
    await userEvent.click(within(steps).getByRole("button", { name: /켜기 · 작은방 에어컨/ }));
    expect(within(steps).getByText("켜짐 · 냉방 · 24°C")).toBeVisible();
    const answer = within(c).getByRole("region", { name: "폰으로 돌려준 답" });
    expect(answer).toHaveTextContent("폰에 답함");
    expect(answer).toHaveTextContent("작은방 에어컨을 켰어요.");
  });

  it("승인은 폰에서 한다: 대기 글만 있고 승인·취소 단추가 없다", () => {
    show(turnsOf([reply("문 열어", "폰에서 승인해 주세요", [], [pending])]));
    const group = screen.getByRole("group", { name: "승인 요청" });
    expect(group).toHaveTextContent("폰에서 승인 대기");
    expect(group).toHaveTextContent("현관 도어록: 문을 열어요");
    expect(screen.queryByRole("button", { name: "승인" })).toBeNull();
    expect(screen.queryByRole("button", { name: "취소" })).toBeNull();
  });

  it("폰에서 승인하면 결과가 바뀐다", () => {
    show(turnsOf([reply("문 열어", "승인해 주세요", [], [pending]), { type: "agent", event: "confirmed", sessionId: "phone", token: "tok", ok: true, reply: "문을 열었어요" }]));
    expect(screen.getByRole("group", { name: "승인 요청" })).toHaveTextContent("승인함");
  });

  it("마지막 카드만 펼치고, 앞 카드는 단계 요약으로 접는다", async () => {
    show(turnsOf([reply("거실 불 켜줘", "켰어요", [turnOn]), reply("작은방 에어컨 켜줘", "켰어요", [find, turnOn])]));
    const first = card("거실 불 켜줘");
    expect(within(first).queryByRole("list", { name: "단계" })).toBeNull();
    const summary = within(first).getByRole("button", { name: "단계 1개" });
    await userEvent.click(summary);
    expect(within(first).getByRole("list", { name: "단계" })).toBeInTheDocument();
    expect(within(card("작은방 에어컨 켜줘")).getByRole("list", { name: "단계" })).toBeInTheDocument();
  });

  it("컵 두뇌 카드는 판단 단계와 지금 보이는 것·판정을 보인다", () => {
    show(turnsOf([
      { type: "brain", event: { type: "presence", at_ms: 0, evidence_age_ms: 0, person: "no", cup: "yes", table: "yes", scores: { person: 0.1, cup: 0.8 }, summary: "x" } },
      { type: "brain", event: { type: "brain", stage: "away", state: "away_check", text: "자리를 비웠어요", at_ms: 0, evidence_age_ms: null, generation: 1 } },
    ]));
    const c = card("자리를 비웠어요");
    expect(c.dataset.source).toBe("brain");
    expect(within(c).getByText("클로이드 · 컵 지켜보기")).toBeInTheDocument();
    expect(within(c).getByText("자리 비움")).toBeInTheDocument();
    expect(within(c).getByText("사람 없음 · 컵 있음")).toBeInTheDocument();
  });

  it("알약 탭으로 판단 기록과 폰 화면을 바꾼다", async () => {
    const onView = show([]);
    await userEvent.click(screen.getByRole("tab", { name: "폰 화면" }));
    expect(onView).toHaveBeenCalledWith("phone");
  });

  it("폰 화면 탭이면 폰 화면 자리를 보인다", () => {
    show([], "phone");
    expect(screen.getByText("폰 화면 자리")).toBeInTheDocument();
    expect(screen.queryByText("폰에서 클로이드에게 말해 보세요.")).toBeNull();
  });

  it("접으면 머리줄만 남고 다시 펼 수 있다", async () => {
    show([]);
    await userEvent.click(screen.getByRole("button", { name: "판단 기록 접기" }));
    expect(screen.queryByText("폰에서 클로이드에게 말해 보세요.")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "판단 기록 펴기" }));
    expect(screen.getByText("폰에서 클로이드에게 말해 보세요.")).toBeInTheDocument();
  });
});
