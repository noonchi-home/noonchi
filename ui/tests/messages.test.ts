import { describe, expect, it } from "vitest";
import { parseMessage } from "../src/lib/messages";

describe("parseMessage", () => {
  it("아는 type은 그대로 돌려준다", () => {
    const m = parseMessage(JSON.stringify({ type: "state", state: { id: "light_1", online: true, twin: { power: "on" }, matter: {}, updatedAt: "t" } }));
    expect(m?.type).toBe("state");
  });
  it("계획 메시지도 받는다(plan: null은 계획 지움)", () => {
    expect(parseMessage('{"type":"plan","plan":null}')?.type).toBe("plan");
  });
  it("배치 메시지도 받는다", () => expect(parseMessage('{"type":"layout","op":"remove","id":"sofa_1"}')?.type).toBe("layout"));
  it("말풍선 글 메시지도 받는다(text: null은 글 없음)", () => {
    expect(parseMessage('{"type":"say","text":"컵을 들게요."}')).toEqual({ type: "say", text: "컵을 들게요." });
    expect(parseMessage('{"type":"say","text":null}')?.type).toBe("say");
  });
  it("미리 세운 목표 메시지도 받는다(받지 않으면 메시지 상자 「목표」 알약이 실제 화면에 뜨지 않는다)", () => {
    const goal = {
      id: "goal-1", action: "컵 치우기", state: "left_cup", trigger: "t", object: "cup_1", cls: "cup", status: "armed", prep: "ready", reason: null, text: "컵을 두고 자리를 뜨면 컵을 치울게요",
      armed_ms: 1, ready_ms: 2, gone_ms: null, fired_ms: null, plan: null,
    };
    expect(parseMessage(JSON.stringify({ type: "goal", goal }))).toEqual({ type: "goal", goal });
  });
  it("사람 줄 메시지도 받는다(받지 않으면 시간 줄 사람 줄이 비어 있다)", () => {
    expect(parseMessage('{"type":"person","state":"drinking","name":"먹거나 마시는 중","since_ms":1,"source":"world","decision_id":null}')?.type).toBe("person");
  });
  it("모르는 type·깨진 JSON은 null", () => {
    expect(parseMessage("{oops")).toBeNull();
    expect(parseMessage(JSON.stringify({ type: "nope" }))).toBeNull();
  });
});
