import { describe, expect, it } from "vitest";
import type { AgentAction, BrainLog, PendingView, ServerMessage } from "../../src/contract/events.ts";
import { checkList, checksReducer, EMPTY_CHECKS, type ChecksState } from "../src/checks/checks";

const act = (tool: string, deviceId: string | undefined, extra: Partial<AgentAction> = {}): AgentAction =>
  ({ tool, args: {}, ok: true, deviceId, deviceLabel: deviceId, at: "t", ...extra });
const acted = (a: AgentAction, sessionId = "phone"): ServerMessage => ({ type: "agent", event: "action", sessionId, action: a });
const replied = (actions: AgentAction[] = [], pendingConfirmations: PendingView[] = [], sessionId = "phone"): ServerMessage =>
  ({ type: "agent", event: "reply", sessionId, message: "m", reply: "r", actions, pendingConfirmations });
const brain = (event: BrainLog): ServerMessage => ({ type: "brain", event });
const presence = (person: "yes" | "no" | "unknown", cup: "yes" | "no" | "unknown"): ServerMessage =>
  brain({ type: "presence", at_ms: 0, evidence_age_ms: 0, person, cup, table: "unknown", scores: { person: 0, cup: 0 }, summary: "" });
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

describe("checksReducer · 컵 두뇌", () => {
  it("두뇌 메시지가 오면 식탁에 「지켜봄」 한 줄, note는 사람·컵 판정", () => {
    const s = run([presence("yes", "no")]);
    expect(s.brain).toEqual([expect.objectContaining({ source: "brain", verb: "지켜봄", note: "사람 있음 · 컵 없음" })]);
    expect(s.brainAt).toBe(0);
    const t = run([presence("no", "yes")], s, 4000);
    expect(t.brain[0]!.note).toBe("사람 없음 · 컵 있음");
  });

  it("VLM 판정 요약에서도 사람·컵을 읽고, 판정 실패나 단계 글은 note를 바꾸지 않는다", () => {
    const judged = brain({ type: "perception", at_ms: 0, evidence_age_ms: 0, frames: 3, cost_usd: 0, summary: "사람 예 · 들고 있음 아니오 · 마심 아니오 · 컵 예(table) · 내용물 empty" });
    let s = run([judged]);
    expect(s.brain[0]!.note).toBe("사람 있음 · 컵 있음");
    s = run([
      brain({ type: "perception", at_ms: 0, evidence_age_ms: 0, frames: 0, cost_usd: 0, summary: "", error: "x" }),
      brain({ type: "brain", stage: "use", state: "in_use", text: "컵을 쓰는 중", at_ms: 0, evidence_age_ms: null, generation: 1 }),
    ], s, 1000);
    expect(s.brain[0]!.note).toBe("사람 있음 · 컵 있음");
    expect(s.brainAt).toBe(2000);
  });

  it("마지막 두뇌 메시지 뒤 30초가 지나면 지운다", () => {
    const s = run([presence("yes", "yes")], EMPTY_CHECKS, 1000);
    expect(checksReducer(s, { type: "tick", now: 30_999 }).brain).toHaveLength(1);
    const gone = checksReducer(s, { type: "tick", now: 31_000 });
    expect(gone.brain).toEqual([]);
    expect(gone.brainAt).toBeNull();
  });

  it("두뇌 목록은 에이전트 새 요청에 지워지지 않는다", () => {
    const s = run([presence("yes", "yes"), acted(act("turn_on", "ac")), replied(), acted(act("turn_on", "tv"))]);
    expect(s.brain).toHaveLength(1);
  });

  it("다른 메시지는 상태를 그대로 둔다", () => {
    const s = run([acted(act("turn_on", "ac"))]);
    expect(checksReducer(s, { type: "message", message: { type: "hello", devices: 1, provider: null, hub: "memory", home: null }, now: 9 })).toBe(s);
    expect(checksReducer(EMPTY_CHECKS, { type: "tick", now: 99_999 })).toBe(EMPTY_CHECKS);
  });
});

describe("checkList", () => {
  it("에이전트 목록 뒤에 두뇌 목록. 두뇌 줄은 식탁 id에 붙고, 식탁이 없으면 빠진다", () => {
    const s = run([presence("yes", "yes"), acted(act("turn_on", "ac"))]);
    expect(checkList(s, "table_1").map((c) => [c.deviceId ?? c.objectId, c.verb])).toEqual([["ac", "바꿈"], ["table_1", "지켜봄"]]);
    expect(checkList(s, null).map((c) => c.deviceId)).toEqual(["ac"]);
  });
});
