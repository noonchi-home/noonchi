import { describe, expect, it } from "vitest";
import type { DeviceView } from "../../src/contract/events.ts";
import { suggestions } from "../src/chat/suggestions";

const dev = (id: string, kind: string, label: string) => ({ id, kind, label }) as DeviceView;

describe("추천 요청", () => {
  it("고른 집 기기 이름으로 조명·TV·에어컨·도어록 순서, 4개까지", () => {
    const list = [dev("a", "aircon", "작은방 에어컨"), dev("l", "light", "거실 조명"), dev("v", "vacuum", "로봇청소기"), dev("t", "tv", "거실 TV"), dev("k", "lock", "현관 도어록")];
    expect(suggestions(list)).toEqual(["거실 조명 켜줘", "거실 TV 켜줘", "작은방 에어컨 24도로 맞춰줘", "현관 도어록 상태 알려줘"]);
  });
  it("자리가 남으면 로봇청소기", () => {
    expect(suggestions([dev("v", "vacuum", "로봇청소기"), dev("l", "light", "안방 등")])).toEqual(["안방 등 켜줘", "로봇청소기 시작해줘"]);
  });
  it("기기가 없으면 없음", () => {
    expect(suggestions([])).toEqual([]);
  });
});
