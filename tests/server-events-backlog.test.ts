// /events 보내기: 느린 대시보드 연결에 물체 모양(seen)이 쌓이지 않게 하는 규칙.
import { describe, expect, it } from "vitest";
import { EVENTS_SEEN_MAX_BUFFERED, skipsWhenBehind } from "../src/server/app.js";

describe("/events 밀림", () => {
  it("보낼 것이 상한 넘게 쌓인 연결에는 seen을 보내지 않는다(다음 seen이 그 자리를 채운다)", () => {
    expect(skipsWhenBehind({ type: "seen" }, EVENTS_SEEN_MAX_BUFFERED + 1)).toBe(true);
    expect(skipsWhenBehind({ type: "seen" }, EVENTS_SEEN_MAX_BUFFERED)).toBe(false);
    expect(skipsWhenBehind({ type: "seen" }, 0)).toBe(false);
  });

  it("다른 메시지(상태·판단·계획·world)는 쌓여 있어도 건너뛰지 않는다", () => {
    for (const type of ["state", "brain", "plan", "world", "say", "eye"]) expect(skipsWhenBehind({ type }, EVENTS_SEEN_MAX_BUFFERED * 10), type).toBe(false);
    expect(skipsWhenBehind("text", EVENTS_SEEN_MAX_BUFFERED * 10)).toBe(false);
  });
});
