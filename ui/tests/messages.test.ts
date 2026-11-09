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
    expect(parseMessage('{"type":"say","text":"컵을 들라고 했어요."}')).toEqual({ type: "say", text: "컵을 들라고 했어요." });
    expect(parseMessage('{"type":"say","text":null}')?.type).toBe("say");
  });
  it("모르는 type·깨진 JSON은 null", () => {
    expect(parseMessage("{oops")).toBeNull();
    expect(parseMessage(JSON.stringify({ type: "nope" }))).toBeNull();
  });
});
