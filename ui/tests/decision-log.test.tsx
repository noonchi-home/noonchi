import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { AgentAction, BrainLog, DecisionWorld, PendingView, ServerMessage } from "../../src/contract/events.ts";
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

  it("관찰과 판단 카드는 World State 변화 줄과 지금 보이는 것·판정을 보인다", () => {
    show(turnsOf([
      { type: "brain", event: { type: "observe", at_ms: 0, frame_id: "e1", captured_at_ms: 0, yolo: "컵 0.90", vlm: null } },
      { type: "brain", event: { type: "observe", at_ms: 0, frame_id: "e1", captured_at_ms: 0, yolo: null, vlm: null, vlm_missing: "timeout" } },
      { type: "brain", event: { type: "world_change", at_ms: 0, kind: "appeared", text: "컵 cup_1 보임" } },
    ]));
    const c = card("컵 cup_1 보임");
    expect(c.dataset.source).toBe("brain");
    expect(within(c).getByText("클로이드 · 관찰과 판단")).toBeInTheDocument();
    expect(within(c).getByText("변화")).toBeInTheDocument();
    expect(within(c).getByText("컵 0.90")).toBeInTheDocument();
    expect(within(c).getByText("시간 초과로 VLM 분석 없음")).toBeInTheDocument();
  });

  it("판단 줄을 누르면 보낸 관찰 텍스트·World State·확신도·위치 오차·기억 판본이 보이고 반성 결과 줄이 있다", async () => {
    const world: DecisionWorld = {
      objects: [{ id: "cup_1", cls: "cup", status: "present", surface: "table_1", surface_label: "식탁", error_m: 0.12,
        facts: { contents: { value: "empty", certainty: "confirmed" }, place: { value: "on_table", certainty: "inferred" } } }],
      person_visible: false, vlm_missing: 2, yolo_missing: 0,
    };
    const brainMsg = (event: BrainLog): ServerMessage => ({ type: "brain", event });
    show(turnsOf([
      brainMsg({ type: "decision", at_ms: 1, id: "pam-1", seq: 1, text_sent: "21:00:00 사람 안 보임\n[지속] 컵 cup_1 식탁 위", status: "valid",
        prediction: { observation: "o", reasoning: "자리를 비워 컵을 치운다", task_index: 0 }, action: "컵 치우기", memory_version: 3, world }),
      brainMsg({ type: "reflection", at_ms: 2, day: "2026-11-07", ok: true, version: 4, applies_day: "2026-11-08", text: "반성 완료: 기억 4판, 2026-11-08부터" }),
    ]));
    const c = document.querySelector('[data-turn="b0"]') as HTMLElement;
    await userEvent.click(within(c).getByRole("button", { name: "컵 치우기" }));
    const row = within(c).getByRole("button", { name: /컵 치우기 · 자리를 비워 컵을 치운다/ });
    expect(row).toHaveAttribute("aria-expanded", "false");
    expect(within(c).queryByText(/21:00:00 사람 안 보임/)).toBeNull();
    await userEvent.click(row);
    expect(row).toHaveAttribute("aria-expanded", "true");
    const detail = within(c).getByRole("region", { name: "판단 근거" });
    expect(within(detail).getByText(/21:00:00 사람 안 보임/)).toBeInTheDocument();
    expect(within(detail).getByText("컵 cup_1 · 식탁 위")).toBeInTheDocument();
    expect(within(detail).getByText("비어 있음 · 확인됨")).toBeInTheDocument();
    expect(within(detail).getByText("식탁 위 · 추정")).toBeInTheDocument();
    expect(within(detail).getByText("위치 오차 ±0.12m")).toBeInTheDocument();
    expect(within(detail).getByText("사람 안 보임 · VLM 분석 없음 2장 · YOLOX 분석 없음 0장")).toBeInTheDocument();
    expect(within(detail).getByText("기억 3판")).toBeInTheDocument();
    expect(screen.getByText(/반성 완료: 기억 4판/)).toBeInTheDocument();
    expect(document.querySelector("input, textarea, select, form, [contenteditable]")).toBeNull();
    await userEvent.click(row);
    expect(within(c).queryByRole("region", { name: "판단 근거" })).toBeNull();
  });

  it("판단 근거의 물건: 위치를 모르면 위치 모름, 시야 밖이면 그 상태", async () => {
    const world: DecisionWorld = {
      objects: [{ id: "bottle_1", cls: "bottle", status: "out_of_view", surface: null, surface_label: null, error_m: null, facts: {} }],
      person_visible: true, vlm_missing: 0, yolo_missing: 1,
    };
    show(turnsOf([{ type: "brain", event: { type: "decision", at_ms: 1, id: "pam-2", seq: 2, text_sent: "t", status: "valid",
      prediction: { observation: "o", reasoning: "더 본다", task_index: -1 }, action: null, memory_version: 1, world } }]));
    await userEvent.click(screen.getByRole("button", { name: /대기 · 더 본다/ }));
    const detail = screen.getByRole("region", { name: "판단 근거" });
    expect(within(detail).getByText("병 bottle_1 · 시야 밖")).toBeInTheDocument();
    expect(within(detail).getByText("위치 모름")).toBeInTheDocument();
    expect(within(detail).getByText("사람 보임 · VLM 분석 없음 0장 · YOLOX 분석 없음 1장")).toBeInTheDocument();
  });

  it("클로이드의 눈 사진은 누르면 크게 본다(새 탭 대신 21st.dev Image Preview)", async () => {
    show(turnsOf([{ type: "photo", photo: { id: "p1", at: "t", url: "/api/photos/p1.jpg", width: 640, height: 480, measured_pose: null } }]));
    const open = screen.getByRole("button", { name: "사진 크게 보기" });
    expect(within(open).getByAltText("클로이드의 눈 사진")).toHaveAttribute("src", "/api/photos/p1.jpg");
    expect(document.querySelector('a[target="_blank"]')).toBeNull();
    await userEvent.click(open);
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByAltText("클로이드의 눈 사진")).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole("button", { name: "닫기" }));
    expect(screen.queryByRole("dialog")).toBeNull();
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
