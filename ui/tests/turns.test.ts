import { describe, expect, it } from "vitest";
import type { ActionPlan, AgentAction, PendingView, ServerMessage } from "../../src/contract/events.ts";
import { turnsReducer, type Turn, type TurnEvent } from "../src/chat/turns";

const action: AgentAction = { tool: "turn_on", args: {}, ok: true, deviceId: "ac", deviceLabel: "거실 에어컨", reason: "덥다고 해서", observation: "켜짐", at: "t" };
const pending: PendingView = { token: "k", deviceId: "lock", deviceLabel: "현관 도어록", command: { type: "unlock" }, reason: "문을 열어요", expiresAt: "t" };
const msg = (message: ServerMessage, sessionId = "s"): TurnEvent => ({ type: "message", sessionId, message });
const run = (events: TurnEvent[], start: Turn[] = []) => events.reduce(turnsReducer, start);
const lines = (t: Turn) => t.steps.flatMap((s) => (s.kind === "line" ? [`${s.label} ${s.text}`.trim()] : []));

describe("turnsReducer", () => {
  it("요청 → 행동 → 답 순서로 한 장이 채워진다", () => {
    let t = turnsReducer([], { type: "ask", id: "1", source: "dashboard", text: "더워" });
    t = turnsReducer(t, { type: "message", sessionId: "s", message: { type: "agent", event: "action", sessionId: "s", action } });
    t = turnsReducer(t, { type: "message", sessionId: "s", message: { type: "agent", event: "reply", sessionId: "s", message: "더워", reply: "에어컨을 켰어요", actions: [action], pendingConfirmations: [] } });
    expect(t).toHaveLength(1);
    expect(t[0]).toMatchObject({ state: "ok", answer: "에어컨을 켰어요" });
    expect(t[0]!.steps.filter((s) => s.kind === "action")).toHaveLength(1);
  });

  it("승인 대기가 있으면 wait", () => {
    let t = turnsReducer([], { type: "ask", id: "1", source: "dashboard", text: "문 열어" });
    t = turnsReducer(t, { type: "message", sessionId: "s", message: { type: "agent", event: "reply", sessionId: "s", message: "문 열어", reply: "승인해 주세요", actions: [], pendingConfirmations: [pending] } });
    expect(t[0]!.state).toBe("wait");
    expect(t[0]!.pending).toHaveLength(1);
  });

  it("처음 요청에는 busy로 시작하고, 다른 세션의 행동은 붙이지 않는다", () => {
    const t = run([
      { type: "ask", id: "1", source: "dashboard", text: "더워" },
      msg({ type: "agent", event: "action", sessionId: "other", action }),
    ]);
    expect(t[0]).toMatchObject({ id: "1", source: "dashboard", ask: "더워", state: "busy", answer: "" });
    expect(t[0]!.steps).toEqual([]);
  });

  it("실시간 행동이 없었으면 답의 행동으로 단계를 채운다(HTTP 응답)", () => {
    const t = run([
      { type: "ask", id: "1", source: "dashboard", text: "더워" },
      { type: "result", id: "1", reply: "에어컨을 켰어요", actions: [action], pending: [] },
    ]);
    expect(t[0]!.state).toBe("ok");
    expect(t[0]!.steps.filter((s) => s.kind === "action")).toHaveLength(1);
    expect(lines(t[0]!)).toEqual(["답 에어컨을 켰어요"]);
  });

  it("실시간 답과 HTTP 응답이 둘 다 와도 한 번만 끝낸다", () => {
    const t = run([
      { type: "ask", id: "1", source: "dashboard", text: "더워" },
      msg({ type: "agent", event: "action", sessionId: "s", action }),
      msg({ type: "agent", event: "reply", sessionId: "s", message: "더워", reply: "켰어요", actions: [action], pendingConfirmations: [] }),
      { type: "result", id: "1", reply: "켰어요", actions: [action], pending: [] },
    ]);
    expect(t[0]!.steps.filter((s) => s.kind === "action")).toHaveLength(1);
    expect(lines(t[0]!)).toEqual(["답 켰어요"]);
  });

  it("오류면 fail에 오류 글, 성공 없이 실패만 있으면 fail", () => {
    const failed = { ...action, ok: false, error: "기기가 꺼져 있어요" };
    const t = run([
      { type: "ask", id: "1", source: "dashboard", text: "a" },
      { type: "result", id: "1", error: "에이전트가 답하지 못했습니다." },
      { type: "ask", id: "2", source: "dashboard", text: "b" },
      { type: "result", id: "2", reply: "못 켰어요", actions: [failed], pending: [] },
      { type: "ask", id: "3", source: "dashboard", text: "c" },
      { type: "result", id: "3", reply: "하나는 켰어요", actions: [failed, action], pending: [] },
    ]);
    expect(t[0]).toMatchObject({ state: "fail", label: "오류", answer: "에이전트가 답하지 못했습니다." });
    expect(t[1]!.state).toBe("fail");
    expect(t[2]!.state).toBe("ok");
  });

  it("폰에서 말한 대화는 폰 카드로 새로 쌓는다", () => {
    const t = run([msg({ type: "agent", event: "reply", sessionId: "phone", message: "불 꺼줘", reply: "껐어요", actions: [action], pendingConfirmations: [] })]);
    expect(t[0]).toMatchObject({ source: "phone", ask: "불 꺼줘", state: "ok", answer: "껐어요" });
    expect(t[0]!.steps.filter((s) => s.kind === "action")).toHaveLength(1);
  });

  it("초점은 마지막 카드에 남고, 답보다 먼저 와도 답 뒤에 둔다", () => {
    const focus: ServerMessage = { type: "focus", focus: { targets: [{ id: "ac", label: "거실 에어컨", position: [0, 0, 0] }], at: "t", ttl_ms: 8000 } };
    const t = run([
      { type: "ask", id: "1", source: "dashboard", text: "더워" },
      msg(focus),
      { type: "result", id: "1", reply: "켰어요", actions: [], pending: [] },
    ]);
    expect(lines(t[0]!)).toEqual(["답 켰어요", "초점 거실 에어컨"]);
  });

  it("승인: 처리 중 → 승인 후 실행, 같은 토큰이 다시 와도 한 번만", () => {
    let t = run([
      { type: "ask", id: "1", source: "dashboard", text: "문 열어" },
      { type: "result", id: "1", reply: "승인해 주세요", actions: [], pending: [pending] },
      { type: "confirming", token: "k" },
    ]);
    expect(t[0]!.pending[0]!.status).toBe("busy");
    t = run([
      msg({ type: "agent", event: "confirmed", sessionId: "s", token: "k", ok: true, reply: "문을 열었어요" }),
      { type: "settle", token: "k", ok: true, reply: "문을 열었어요" },
    ], t);
    expect(t[0]).toMatchObject({ state: "ok", answer: "문을 열었어요" });
    expect(t[0]!.pending[0]!.status).toBe("ok");
    expect(lines(t[0]!)).toEqual(["답 승인해 주세요", "승인 후 실행 문을 열었어요"]);
  });

  it("취소와 승인 실패", () => {
    const two = { ...pending, token: "k2" };
    const t = run([
      { type: "ask", id: "1", source: "dashboard", text: "문 열어" },
      { type: "result", id: "1", reply: "승인해 주세요", actions: [], pending: [pending, two] },
      msg({ type: "agent", event: "cancelled", token: "k" }),
      msg({ type: "agent", event: "confirmed", token: "k2", ok: false, reply: "만료됐어요" }),
    ]);
    expect(t[0]!.pending.map((p) => p.status)).toEqual(["cancel", "fail"]);
    expect(lines(t[0]!).slice(1)).toEqual(["취소 취소했어요.", "승인 실패 만료됐어요"]);
    expect(t[0]!.state).toBe("fail");
  });

  it("새 대화는 카드를 모두 지운다", () => {
    const t = run([{ type: "ask", id: "1", source: "dashboard", text: "a" }, { type: "reset" }]);
    expect(t).toEqual([]);
  });

  it("사진은 찍은 자리와 함께 폰 카드로 남는다", () => {
    const t = run([msg({ type: "photo", photo: { id: "p", at: "t", url: "/api/photos/p.jpg", width: 1, height: 1, measured_pose: { position: [1.234, 2], height_m: 1.2, yaw_deg: 90.4, pitch_deg: 0, tracking: "ok", at: "t" } } })]);
    expect(t[0]).toMatchObject({ source: "phone", ask: "사진 찍기", state: "ok", label: "저장", photo: "/api/photos/p.jpg" });
    expect(t[0]!.answer).toBe("위치 (1.23, 2.00) · 방향 90° · 높이 1.20m");
  });
});

describe("컵 두뇌 카드", () => {
  const brain = (stage: string, state: string, text: string): TurnEvent => msg({ type: "brain", event: { type: "brain", stage, state, text, at_ms: 0, evidence_age_ms: 1500, generation: 1 } as never });

  it("단계 글을 쌓고, 지금 보이는 것·판정은 갈아 끼운다", () => {
    const t = run([
      msg({ type: "brain", event: { type: "presence", at_ms: 0, evidence_age_ms: 0, person: "yes", cup: "no", table: "yes", scores: { person: 0.9, cup: 0.1 }, summary: "x" } }),
      msg({ type: "brain", event: { type: "presence", at_ms: 1, evidence_age_ms: 0, person: "no", cup: "yes", table: "yes", scores: { person: 0.1, cup: 0.8 }, summary: "x" } }),
      msg({ type: "brain", event: { type: "perception", at_ms: 1, evidence_age_ms: 2000, frames: 3, summary: "컵 있음", cost_usd: 0 } }),
      brain("away", "away_check", "자리를 비웠어요"),
    ]);
    expect(t).toHaveLength(1);
    expect(t[0]).toMatchObject({ source: "brain", ask: "컵 지켜보기", state: "busy", label: "자리 비움 확인", answer: "자리를 비웠어요 · 근거 1.5초 전" });
    expect(t[0]!.now).toEqual({ seen: "사람 없음 · 컵 있음", judged: "컵 있음 · 근거 2.0초 전" });
    expect(lines(t[0]!)).toEqual(["자리를 비웠어요 · 근거 1.5초 전"]);
  });

  it("폰 부탁과 결과로 끝나면 카드를 닫고, 다음 이벤트는 새 카드", () => {
    const plan: ActionPlan = { id: "a", task: "t", kind: "ask_person_to_clear", dry_run: true, would: "컵을 치워요", dashboard: "치워 달라고 해요", prompt: { text: "컵을 치워 주세요", choices: [] }, check: "cup_gone" };
    const t = run([
      msg({ type: "brain", event: { type: "action", id: "a", task: "t", plan, active: true, at_ms: 0 } }),
      msg({ type: "brain", event: { type: "result", id: "a", task: "t", outcome: "declined", text: "거절", at_ms: 0 } }),
      brain("result", "done", "끝났어요"),
      brain("use", "in_use", "컵을 쓰고 있어요"),
    ]);
    expect(t).toHaveLength(2);
    expect(t[0]).toMatchObject({ state: "wait", label: "끝", ended: true });
    expect(lines(t[0]!)).toEqual(["폰에 부탁: 컵을 치워 주세요", "클로이드라면: 컵을 치워요", "끝났어요 · 근거 1.5초 전"]);
    expect(t[1]).toMatchObject({ source: "brain", state: "busy", label: "사용 중" });
  });

  it("오류로 끝나면 fail", () => {
    const t = run([brain("error", "done", "판단하지 못했어요")]);
    expect(t[0]).toMatchObject({ state: "fail", ended: true });
  });
});
