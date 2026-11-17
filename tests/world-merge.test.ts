// VLM 무조건 우선(사용자 결정 2026-11-18): VLM 답과 YOLO가 다르면 VLM이 이긴다. 예외는 미니맵 표시·폰 위치 맞추기·쓰러짐 감지뿐이다.
// 이 규칙은 src/world/merge.ts vlmFirst 한곳에 있고, World State가 YOLO와 VLM을 합치는 곳은 이 함수를 부른다.
import { describe, expect, it } from "vitest";
import { vlmFirst } from "../src/world/merge.js";

describe("VLM 무조건 우선(vlmFirst)", () => {
  it("YOLO가 있다 / VLM이 없다 → 없음", () => {
    expect(vlmFirst(true, false)).toBe(false);
  });
  it("YOLO가 없다 / VLM이 있다 → 있음", () => {
    expect(vlmFirst(false, true)).toBe(true);
  });
  it("VLM이 답하지 않았으면(답 없음·끊김) YOLO를 따른다", () => {
    expect(vlmFirst(true, null)).toBe(true);
    expect(vlmFirst(false, null)).toBe(false);
  });
});
