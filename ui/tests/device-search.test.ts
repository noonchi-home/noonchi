// 설정 2단계 가전 검색(ui/src/setup/device-search.ts): 이름·종류·방·id, 띄어쓰기 무시, 초성.
import { describe, expect, it } from "vitest";
import { searchDevices } from "../src/setup/device-search";

const devices = [
  { id: "fridge_1", label: "냉장고", kindLabel: "냉장고", roomLabel: "주방" },
  { id: "tv_living", label: "거실 TV", kindLabel: "TV", roomLabel: "거실" },
  { id: "light_living", label: "거실 조명", kindLabel: "조명", roomLabel: "거실" },
  { id: "light_room1", label: "안방 조명", kindLabel: "조명", roomLabel: "안방" },
];
const ids = (q: string) => searchDevices(devices, q).map((d) => d.id);

describe("가전 검색", () => {
  it("빈 검색어는 아무것도 고르지 않는다", () => {
    expect(ids("")).toEqual([]);
    expect(ids("   ")).toEqual([]);
  });

  it("이름·종류·방·id 어디에 있어도 찾고, 대소문자는 가리지 않는다", () => {
    expect(ids("냉장")).toEqual(["fridge_1"]);
    expect(ids("거실")).toEqual(["tv_living", "light_living"]);
    expect(ids("tv")).toEqual(["tv_living"]);
    expect(ids("room1")).toEqual(["light_room1"]);
  });

  it("낱말을 모두 품은 기기만, 띄어쓰기는 무시한다", () => {
    expect(ids("거실 조명")).toEqual(["light_living"]);
    expect(ids("조명 안방")).toEqual(["light_room1"]);
    expect(ids("거실조명")).toEqual(["light_living"]);
  });

  it("자음만 치면 초성으로 찾는다", () => {
    expect(ids("ㄴㅈㄱ")).toEqual(["fridge_1"]);
    expect(ids("ㄱㅅ ㅈㅁ")).toEqual(["light_living"]);
  });
});
