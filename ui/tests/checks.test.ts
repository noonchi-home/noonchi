import { describe, expect, it } from "vitest";
import type { AgentAction, BrainLog, PendingView, ServerMessage } from "../../src/contract/events.ts";
import type { PlanStatus, PlanStep, PlanView } from "../../src/contract/plan.ts";
import { checkList, checksReducer, EMPTY_CHECKS, type ChecksState } from "../src/checks/checks";

const act = (tool: string, deviceId: string | undefined, extra: Partial<AgentAction> = {}): AgentAction =>
  ({ tool, args: {}, ok: true, deviceId, deviceLabel: deviceId, at: "t", ...extra });
const acted = (a: AgentAction, sessionId = "phone"): ServerMessage => ({ type: "agent", event: "action", sessionId, action: a });
const replied = (actions: AgentAction[] = [], pendingConfirmations: PendingView[] = [], sessionId = "phone"): ServerMessage =>
  ({ type: "agent", event: "reply", sessionId, message: "m", reply: "r", actions, pendingConfirmations });
const brain = (event: BrainLog): ServerMessage => ({ type: "brain", event });
const yolo = (text: string): ServerMessage => brain({ type: "observe", at_ms: 0, frame_id: "e1", captured_at_ms: 0, yolo: text, vlm: null });
const pending: PendingView = { token: "k", deviceId: "lock", deviceLabel: "현관 도어록", command: { type: "unlock" }, reason: "문을 열어요", expiresAt: "t" };

/** 메시지를 차례로 넣는다. now는 메시지마다 1초씩 늘린다. */
const run = (messages: ServerMessage[], start: ChecksState = EMPTY_CHECKS, from = 0) =>
  messages.reduce((s, message, i) => checksReducer(s, { type: "message", message, now: from + i * 1000 }), start);
const seen = (s: ChecksState) => s.turn.map((c) => [c.order, c.deviceId, c.verb]);

describe("checksReducer · 에이전트", () => {
  it("기기를 다룬 행동마다 한 줄, 번호는 이번 요청 안에서 1부터. 기기 없는 행동은 넣지 않는다", () => {
    const s = run([acted(act("find_devices", undefined)), acted(act("turn_on", "ac")), acted(act("get_state", "light"))]);
    expect(seen(s)).toEqual([[1, "ac", "바꿈"], [2, "light", "확인"]]);
    expect(s.turn.every((c) => c.source === "agent")).toBe(true);
  });

  it("같은 기기를 다시 다루면 번호는 처음 것 그대로, verb만 바뀐다. 바꾼 뒤 다시 읽어도 「바꿈」은 남는다", () => {
    let s = run([acted(act("get_state", "ac")), acted(act("get_state", "tv")), acted(act("set_climate", "ac"))]);
    expect(seen(s)).toEqual([[1, "ac", "바꿈"], [2, "tv", "확인"]]);
    s = run([acted(act("get_state", "ac"))], s);
    expect(seen(s)).toEqual([[1, "ac", "바꿈"], [2, "tv", "확인"]]);
  });

  it("바꾸는 도구가 실패하면 「실패」, 승인이 필요하면 「승인 대기」", () => {
    const s = run([acted(act("turn_on", "tv", { ok: false, error: "x" })), acted(act("unlock", "lock", { ok: false, needsConfirmation: true }))]);
    expect(seen(s)).toEqual([[1, "tv", "실패"], [2, "lock", "승인 대기"]]);
  });

  it("승인 대기는 폰에서 승인하면 「바꿈」, 승인이 실패하면 「실패」, 취소하면 「취소」", () => {
    const waiting = run([acted(act("unlock", "lock", { ok: false, needsConfirmation: true })), replied([], [pending])]);
    expect(seen(run([{ type: "agent", event: "confirmed", token: "k", ok: true, reply: "열었어요", deviceId: "lock" }], waiting))).toEqual([[1, "lock", "바꿈"]]);
    expect(seen(run([{ type: "agent", event: "confirmed", token: "k", ok: false, reply: "못 열었어요", deviceId: "lock" }], waiting))).toEqual([[1, "lock", "실패"]]);
    expect(seen(run([{ type: "agent", event: "cancelled", token: "k" }], waiting))).toEqual([[1, "lock", "취소"]]);
  });

  it("승인 대기 알림(pending)으로 받은 표로도 취소를 찾는다", () => {
    const s = run([
      acted(act("unlock", "lock", { ok: false, needsConfirmation: true })),
      { type: "agent", event: "pending", sessionId: "phone", pending },
      { type: "agent", event: "cancelled", token: "k" },
    ]);
    expect(seen(s)).toEqual([[1, "lock", "취소"]]);
  });

  it("답이 와도 목록은 남고, 다음 요청의 첫 행동이 오면 지우고 1부터 다시", () => {
    let s = run([acted(act("turn_on", "ac")), acted(act("turn_on", "tv")), replied([act("turn_on", "ac"), act("turn_on", "tv")])]);
    expect(seen(s)).toEqual([[1, "ac", "바꿈"], [2, "tv", "바꿈"]]);
    s = run([acted(act("get_state", "tv"))], s);
    expect(seen(s)).toEqual([[1, "tv", "확인"]]);
  });

  it("행동 없이 답만 온 새 요청도 앞 목록을 지우고, 답에 실린 행동으로 채운다", () => {
    let s = run([acted(act("turn_on", "ac")), replied([act("turn_on", "ac")])]);
    s = run([replied([act("turn_off", "tv")])], s);
    expect(seen(s)).toEqual([[1, "tv", "바꿈"]]);
    s = run([replied()], s);
    expect(s.turn).toEqual([]);
  });

  it("ask가 오면 이번 요청 목록을 지운다", () => {
    const s = run([acted(act("turn_on", "ac"))]);
    expect(checksReducer(s, { type: "ask", now: 5000 }).turn).toEqual([]);
  });
});

describe("checksReducer · 관찰 흐름", () => {
  it("관찰 기록이 오면 식탁에 「지켜봄」 한 줄, note는 YOLOX 글", () => {
    const s = run([yolo("사람 0.91 · 컵 0.80")]);
    expect(s.brain).toEqual([expect.objectContaining({ source: "brain", verb: "지켜봄", note: "사람 0.91 · 컵 0.80" })]);
    expect(s.brainAt).toBe(0);
    const t = run([yolo("감지 없음")], s, 4000);
    expect(t.brain[0]!.note).toBe("감지 없음");
  });

  it("VLM 답·분석 없음·변화·판단 기록은 note를 바꾸지 않고 시각만 새로 한다", () => {
    let s = run([yolo("컵 0.80")]);
    s = run([
      brain({ type: "observe", at_ms: 0, frame_id: "e1", captured_at_ms: 0, yolo: null, vlm: "컵이 식탁 위" }),
      brain({ type: "observe", at_ms: 0, frame_id: "e2", captured_at_ms: 0, yolo: null, yolo_missing: "error", vlm: null }),
      brain({ type: "world_change", at_ms: 0, kind: "appeared", text: "컵 cup_1 보임" }),
    ], s, 1000);
    expect(s.brain[0]!.note).toBe("컵 0.80");
    expect(s.brainAt).toBe(3000);
  });

  it("마지막 두뇌 메시지 뒤 30초가 지나면 지운다", () => {
    const s = run([yolo("사람 0.90 · 컵 0.80")], EMPTY_CHECKS, 1000);
    expect(checksReducer(s, { type: "tick", now: 30_999 }).brain).toHaveLength(1);
    const gone = checksReducer(s, { type: "tick", now: 31_000 });
    expect(gone.brain).toEqual([]);
    expect(gone.brainAt).toBeNull();
  });

  it("두뇌 목록은 에이전트 새 요청에 지워지지 않는다", () => {
    const s = run([yolo("사람 0.90 · 컵 0.80"), acted(act("turn_on", "ac")), replied(), acted(act("turn_on", "tv"))]);
    expect(s.brain).toHaveLength(1);
  });

  it("접속 묶음으로 다시 온 옛 판단·observe(replay)는 식탁 줄을 넣지 않고, 이미 있는 줄의 note·시각도 바꾸지 않는다", () => {
    const decision: BrainLog = {
      type: "decision", at_ms: 10, id: "pam-1", seq: 1, text_sent: "t", status: "valid", prediction: { observation: "o", reasoning: "r", task_index: 0 }, action: "컵 치우기", memory_version: 1,
      world: { objects: [], person_visible: false, vlm_missing: 0, yolo_missing: 0 },
    };
    const observe: BrainLog = { type: "observe", at_ms: 11, frame_id: "e7", captured_at_ms: 9, yolo: "컵 0.83", vlm: null, boxes: [{ label: "cup", score: 0.83, box: [100, 50, 40, 60] }] };
    const replayed: ServerMessage[] = [{ type: "brain", event: decision, replay: true }, { type: "brain", event: observe, replay: true }];
    const s = run(replayed);
    expect(s).toBe(EMPTY_CHECKS);
    expect(checkList(s, "table_1")).toEqual([]);
    const watching = run([yolo("사람 0.90")], EMPTY_CHECKS, 5000);
    expect(run(replayed, watching, 9000)).toBe(watching);
  });

  it("다른 메시지는 상태를 그대로 둔다", () => {
    const s = run([acted(act("turn_on", "ac"))]);
    expect(checksReducer(s, { type: "message", message: { type: "hello", devices: 1, provider: null, hub: "memory", home: null }, now: 9 })).toBe(s);
    expect(checksReducer(EMPTY_CHECKS, { type: "tick", now: 99_999 })).toBe(EMPTY_CHECKS);
  });
});

describe("checkList", () => {
  it("에이전트 목록 뒤에 두뇌 목록. 두뇌 줄은 식탁 id에 붙고, 식탁이 없으면 빠진다", () => {
    const s = run([yolo("사람 0.90 · 컵 0.80"), acted(act("turn_on", "ac"))]);
    expect(checkList(s, "table_1").map((c) => [c.deviceId ?? c.objectId, c.verb])).toEqual([["ac", "바꿈"], ["table_1", "지켜봄"]]);
    expect(checkList(s, null).map((c) => c.deviceId)).toEqual(["ac"]);
  });
});

describe("checksReducer · 지금 계획의 대상", () => {
  const plan = (status: PlanStatus, steps: PlanStep[], extra: Partial<PlanView> = {}): ServerMessage => ({ type: "plan", plan: {
    id: "plan:pam-1", revision: 1, source: "brain", goal: "컵 치우기", judgment: "", dryRun: true, robot: { position: null, room: null }, path: [], legs: [], steps, status, updatedAt: "t", ...extra,
  } });
  const cupSteps: PlanStep[] = [
    { id: "s1", kind: "move", label: "식탁으로 가기", target: { objectId: "table_1" }, status: "active" },
    { id: "s2", kind: "act", label: "컵 집기", target: { objectId: "cup_1", position: [1, 2] }, status: "pending" },
    { id: "s3", kind: "device", label: "식기세척기 시작", target: { deviceId: "dishwasher" }, status: "pending" },
  ];

  it("열린 판단 계획의 집기 대상 물건과 가전을 확인 목록에 넣고, 계획이 끝나면 뺀다", () => {
    const s = run([plan("running", cupSteps)]);
    expect(checkList(s, null).map((c) => [c.objectId ?? c.deviceId, c.verb])).toEqual([["cup_1", "확인"], ["dishwasher", "확인"]]);
    expect(checkList(run([plan("done", cupSteps)], s), null)).toEqual([]);
    expect(checkList(run([{ type: "plan", plan: null }], s), null)).toEqual([]);
  });

  it("에이전트 기기 계획은 넣지 않는다(에이전트 행동 줄이 이미 있다). 같은 기기가 에이전트 줄에 있으면 한 번만", () => {
    expect(checkList(run([plan("planned", cupSteps, { source: "agent" })]), null)).toEqual([]);
    const s = run([acted(act("turn_on", "dishwasher")), plan("running", cupSteps)]);
    expect(checkList(s, null).map((c) => c.objectId ?? c.deviceId)).toEqual(["dishwasher", "cup_1"]);
  });
});
