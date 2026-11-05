import { describe, expect, it } from "vitest";
import type { ActionPlan, AgentAction, PendingView, ServerMessage } from "../../src/contract/events.ts";
import { turnsReducer, type Turn } from "../src/chat/turns";

const action: AgentAction = { tool: "turn_on", args: {}, ok: true, deviceId: "ac", deviceLabel: "거실 에어컨", reason: "덥다고 해서", observation: "켜짐", at: "t" };
const pending: PendingView = { token: "k", deviceId: "lock", deviceLabel: "현관 도어록", command: { type: "unlock" }, reason: "문을 열어요", expiresAt: "t" };
const run = (messages: ServerMessage[], start: Turn[] = []) => messages.reduce(turnsReducer, start);
const lines = (t: Turn) => t.steps.flatMap((s) => (s.kind === "line" ? [`${s.label} ${s.text}`.trim()] : []));
const acted = (sessionId: string, a: AgentAction = action): ServerMessage => ({ type: "agent", event: "action", sessionId, action: a });
const replied = (sessionId: string, message: string, reply: string, actions: AgentAction[] = [], pendingConfirmations: PendingView[] = []): ServerMessage =>
  ({ type: "agent", event: "reply", sessionId, message, reply, actions, pendingConfirmations });

describe("turnsReducer", () => {
  it("폰 세션의 실시간 행동은 진행 중 카드에 붙고, 답이 오면 들은 말과 함께 끝난다", () => {
    let t = run([acted("phone")]);
    expect(t).toHaveLength(1);
    expect(t[0]).toMatchObject({ source: "phone", session: "phone", ask: "", state: "busy" });
    expect(t[0]!.steps.filter((s) => s.kind === "action")).toHaveLength(1);
    t = run([replied("phone", "더워", "에어컨을 켰어요", [action])], t);
    expect(t).toHaveLength(1);
    expect(t[0]).toMatchObject({ ask: "더워", state: "ok", answer: "에어컨을 켰어요" });
    expect(t[0]!.steps.filter((s) => s.kind === "action")).toHaveLength(1);
    expect(lines(t[0]!)).toEqual(["답 에어컨을 켰어요"]);
  });

  it("실시간 행동 없이 답만 오면 답의 행동으로 새 카드를 채운다", () => {
    const t = run([replied("phone", "불 꺼줘", "껐어요", [action])]);
    expect(t[0]).toMatchObject({ source: "phone", ask: "불 꺼줘", state: "ok", answer: "껐어요" });
    expect(t[0]!.steps.filter((s) => s.kind === "action")).toHaveLength(1);
  });

  it("세션마다 카드가 따로 쌓이고, 폰이 아닌 세션은 다른 화면 카드다", () => {
    const t = run([acted("phone"), acted("web-1"), replied("web-1", "a", "b", [action]), replied("phone", "c", "d", [action])]);
    expect(t.map((x) => [x.source, x.session, x.ask, x.state])).toEqual([["phone", "phone", "c", "ok"], ["other", "web-1", "a", "ok"]]);
  });

  it("끝난 카드 뒤의 행동은 새 카드로 시작한다", () => {
    const t = run([replied("phone", "a", "b"), acted("phone")]);
    expect(t).toHaveLength(2);
    expect(t[1]).toMatchObject({ state: "busy", ask: "" });
  });

  it("성공 없이 실패만 있으면 fail, 하나라도 성공하면 ok", () => {
    const failed = { ...action, ok: false, error: "기기가 꺼져 있어요" };
    const t = run([replied("phone", "a", "못 켰어요", [failed]), replied("phone", "b", "하나는 켰어요", [failed, action])]);
    expect(t.map((x) => x.state)).toEqual(["fail", "ok"]);
  });

  it("승인 대기가 있으면 wait, 폰에서 승인되면 승인 후 실행으로 끝나고 같은 토큰이 다시 와도 한 번만", () => {
    let t = run([replied("phone", "문 열어", "승인해 주세요", [], [pending])]);
    expect(t[0]!.state).toBe("wait");
    expect(t[0]!.pending).toEqual([{ ...pending, status: "open" }]);
    const ok: ServerMessage = { type: "agent", event: "confirmed", sessionId: "phone", token: "k", ok: true, reply: "문을 열었어요" };
    t = run([ok, ok], t);
    expect(t[0]).toMatchObject({ state: "ok", answer: "문을 열었어요" });
    expect(t[0]!.pending[0]!.status).toBe("ok");
    expect(lines(t[0]!)).toEqual(["답 승인해 주세요", "승인 후 실행 문을 열었어요"]);
  });

  it("세션에 남은 승인 대기가 다음 답에 다시 와도 앞 카드에만 둔다", () => {
    const t = run([replied("phone", "문 열어", "승인해 주세요", [], [pending]), replied("phone", "에어컨 켜줘", "켰어요", [action], [pending])]);
    expect(t.map((x) => [x.state, x.pending.length])).toEqual([["wait", 1], ["ok", 0]]);
  });

  it("폰에서 취소와 승인 실패", () => {
    const two = { ...pending, token: "k2" };
    const t = run([
      replied("phone", "문 열어", "승인해 주세요", [], [pending, two]),
      { type: "agent", event: "cancelled", token: "k" },
      { type: "agent", event: "confirmed", token: "k2", ok: false, reply: "만료됐어요" },
    ]);
    expect(t[0]!.pending.map((p) => p.status)).toEqual(["cancel", "fail"]);
    expect(lines(t[0]!).slice(1)).toEqual(["취소 취소했어요.", "승인 실패 만료됐어요"]);
    expect(t[0]!.state).toBe("fail");
  });

  it("초점은 마지막 카드에 남고, 답보다 먼저 와도 답 뒤에 둔다", () => {
    const focus: ServerMessage = { type: "focus", focus: { targets: [{ id: "ac", label: "거실 에어컨", position: [0, 0, 0] }], at: "t", ttl_ms: 8000 } };
    const t = run([acted("phone"), focus, replied("phone", "더워", "켰어요", [action])]);
    expect(lines(t[0]!)).toEqual(["답 켰어요", "초점 거실 에어컨"]);
  });

  it("사진은 찍은 자리와 함께 폰 카드로 남는다", () => {
    const t = run([{ type: "photo", photo: { id: "p", at: "t", url: "/api/photos/p.jpg", width: 1, height: 1, measured_pose: { position: [1.234, 2], height_m: 1.2, yaw_deg: 90.4, pitch_deg: 0, tracking: "ok", at: "t" } } }]);
    expect(t[0]).toMatchObject({ source: "phone", ask: "사진 찍기", state: "ok", label: "저장", photo: "/api/photos/p.jpg" });
    expect(t[0]!.answer).toBe("위치 (1.23, 2.00) · 방향 90° · 높이 1.20m");
  });
});

describe("컵 두뇌 카드", () => {
  const brain = (stage: string, state: string, text: string): ServerMessage => ({ type: "brain", event: { type: "brain", stage, state, text, at_ms: 0, evidence_age_ms: 1500, generation: 1 } as never });

  it("단계 글을 쌓고, 지금 보이는 것·판정은 갈아 끼운다", () => {
    const t = run([
      { type: "brain", event: { type: "presence", at_ms: 0, evidence_age_ms: 0, person: "yes", cup: "no", table: "yes", scores: { person: 0.9, cup: 0.1 }, summary: "x" } },
      { type: "brain", event: { type: "presence", at_ms: 1, evidence_age_ms: 0, person: "no", cup: "yes", table: "yes", scores: { person: 0.1, cup: 0.8 }, summary: "x" } },
      { type: "brain", event: { type: "perception", at_ms: 1, evidence_age_ms: 2000, frames: 3, summary: "컵 있음", cost_usd: 0 } },
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
      { type: "brain", event: { type: "action", id: "a", task: "t", plan, active: true, at_ms: 0 } },
      { type: "brain", event: { type: "result", id: "a", task: "t", outcome: "declined", text: "거절", at_ms: 0 } },
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

  it("폰 행동은 두뇌 카드에 붙지 않는다", () => {
    const t = run([brain("use", "in_use", "컵을 쓰고 있어요"), acted("phone")]);
    expect(t.map((x) => x.source)).toEqual(["brain", "phone"]);
  });
});
