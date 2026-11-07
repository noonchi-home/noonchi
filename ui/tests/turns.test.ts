import { describe, expect, it } from "vitest";
import type { AgentAction, BrainLog, ExecState, PendingView, ServerMessage } from "../../src/contract/events.ts";
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

describe("관찰과 판단 카드", () => {
  type Observe = Extract<BrainLog, { type: "observe" }>;
  const observe = (extra: Partial<Observe>): ServerMessage => ({ type: "brain", event: { type: "observe", at_ms: 0, frame_id: "e1", captured_at_ms: 0, yolo: null, vlm: null, ...extra } });
  const change = (text: string): ServerMessage => ({ type: "brain", event: { type: "world_change", at_ms: 0, kind: "appeared", text } });
  const decision = (extra: Partial<Extract<BrainLog, { type: "decision" }>> = {}): ServerMessage => ({ type: "brain", event: {
    type: "decision", at_ms: 0, id: "pam-1", seq: 1, text_sent: "t", status: "valid", prediction: { observation: "o", reasoning: "컵이 비어 있음", task_index: 0 },
    action: "컵 치우기", memory_version: 0, world: { objects: [], person_visible: false, vlm_missing: 0, yolo_missing: 0 }, ...extra,
  } });

  it("YOLOX·VLM 기록은 지금·판정 두 줄에서 갈아 끼우고, 분석 없음은 그 글로 보인다", () => {
    const t = run([observe({ yolo: "컵 0.90" }), observe({ vlm: "컵이 식탁 위" }), observe({ frame_id: "e2", yolo_missing: "cap", vlm_missing: "cap" })]);
    expect(t).toHaveLength(1);
    expect(t[0]).toMatchObject({ source: "brain", ask: "관찰과 판단", state: "busy", label: "관찰 중" });
    expect(t[0]!.now).toEqual({ seen: "요청이 몰려 YOLOX·VLM 분석 없음", judged: "요청이 몰려 VLM 분석 없음" });
    const u = run([observe({ yolo_missing: "error" }), observe({ vlm_missing: "timeout" }), observe({ vlm_missing: "format" })]);
    expect(u[0]!.now).toEqual({ seen: "감지 오류로 YOLOX 분석 없음", judged: "형식 오류로 VLM 분석 없음" });
  });

  it("World State 변화·연결·판단 멈춤은 단계 줄, 판단 줄이 카드를 닫고 다음 기록은 새 카드", () => {
    const t = run([
      change("컵 cup_1 보임"),
      { type: "brain", event: { type: "link", at_ms: 0, target: "pam", up: false, text: "PAM 연결 끊김" } },
      { type: "brain", event: { type: "trigger", at_ms: 0, paused: true, text: "사람이 없어 판단을 멈춤" } },
      decision(),
      observe({ yolo: "감지 없음" }),
    ]);
    expect(t).toHaveLength(2);
    expect(lines(t[0]!)).toEqual(["컵 cup_1 보임", "PAM 연결 끊김", "사람이 없어 판단을 멈춤", "컵 치우기 · 컵이 비어 있음"]);
    expect(t[0]).toMatchObject({ state: "ok", label: "컵 치우기", ended: true });
    expect(t[1]).toMatchObject({ source: "brain", state: "busy", now: { seen: "감지 없음", judged: "" } });
  });

  it("대기는 대기, 판단 실패는 fail", () => {
    expect(run([decision({ action: null, prediction: { observation: "o", reasoning: "더 본다", task_index: -1 } })])[0]).toMatchObject({ state: "ok", label: "대기" });
    const f = run([decision({ status: "failed", prediction: null, action: null, error: "PAM 연결 실패" })]);
    expect(f[0]).toMatchObject({ state: "fail", label: "판단 실패", ended: true });
    expect(lines(f[0]!)).toEqual(["판단 실패 · PAM 연결 실패"]);
  });

  it("실행 줄은 그 판단 카드의 단계로 쌓이고, 실행 중이면 카드 알약이 그 단계, 끝나면 완료·실패", () => {
    const exec = (plan_id: string, state: ExecState, text: string): ServerMessage => ({ type: "brain", event: { type: "execution", at_ms: 0, plan_id, state, text } });
    const t = run([
      decision(), exec("plan:pam-1", "decided", "판단"), exec("plan:pam-1", "planned", "계획"), exec("plan:pam-1", "running", "실행 중"),
      observe({ yolo: "감지 없음" }), decision({ id: "pam-2", seq: 2 }), exec("plan:pam-2", "decided", "같은 행동을 진행 중"),
      exec("plan:pam-1", "verifying", "결과 확인"), exec("plan:pam-1", "done", "완료"),
    ]);
    expect(t).toHaveLength(2);
    expect(lines(t[0]!)).toEqual(["컵 치우기 · 컵이 비어 있음", "판단", "계획", "실행 중", "결과 확인", "완료"]);
    expect(t[0]).toMatchObject({ decision: "pam-1", state: "ok", label: "완료" });
    expect(lines(t[1]!)).toEqual(["컵 치우기 · 컵이 비어 있음", "같은 행동을 진행 중"]);
    expect(t[1]).toMatchObject({ decision: "pam-2", label: "컵 치우기" });
    const running = run([decision(), exec("plan:pam-1", "running", "실행 중")]);
    expect(running[0]).toMatchObject({ state: "busy", label: "실행 중" });
    const failed = run([decision(), exec("plan:pam-1", "failed", "대상 물건이 보이지 않아 실행하지 않아요")]);
    expect(failed[0]).toMatchObject({ state: "fail", label: "실패" });
    expect(failed[0]!.steps.at(-1)).toMatchObject({ tone: "fail", mark: "execution" });
  });

  it("판단 카드를 못 찾은 실행 줄은 지금 카드에 쌓인다", () => {
    const t = run([observe({ yolo: "컵 0.90" }), { type: "brain", event: { type: "execution", at_ms: 0, plan_id: "plan:pam-9", state: "failed", text: "실패" } }]);
    expect(t).toHaveLength(1);
    expect(lines(t[0]!)).toEqual(["실패"]);
  });

  it("폰 행동은 관찰 카드에 붙지 않는다", () => {
    const t = run([observe({ yolo: "컵 0.90" }), acted("phone")]);
    expect(t.map((x) => x.source)).toEqual(["brain", "phone"]);
  });
});
