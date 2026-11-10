// scripts/video-check.ts의 순수 함수: 영상 시각 글, 앞 판이 남긴 서버 알아보기, 끝까지 돌지 않은 판의 markdown.
import { describe, expect, it } from "vitest";
import { clock, markdown, usedServer } from "../scripts/video-check.js";

describe("video-check", () => {
  it("영상 시각은 0.1초로 반올림한 뒤 분을 올린다", () => {
    expect([clock(0), clock(-5), clock(61_234), clock(59_960), clock(119_950), clock(76_300)]).toEqual(["00:00.0", "00:00.0", "01:01.2", "01:00.0", "02:00.0", "01:16.3"]);
  });
  it("끝나지 않은 계획이 있거나 엔진 프레임을 이미 받은 서버면 다시 띄우라고 하고, 새 서버면 null", () => {
    expect(usedServer({ status: "running", goal: "컵 치우기" }, { frames: 0 })).toMatch(/컵 치우기.*서버를 다시 띄우세요/);
    expect(usedServer({ status: "planned", goal: "컵 치우기" }, null)).toMatch(/서버를 다시 띄우세요/);
    expect(usedServer({ status: "done", goal: "컵 치우기" }, { frames: 38 })).toMatch(/엔진 프레임 38장.*서버를 다시 띄우세요/);
    expect(usedServer({ status: "done", goal: "컵 치우기" }, { frames: 0 })).toBeNull();
    expect(usedServer(null, null)).toBeNull();
  });
  it("끝까지 돌지 않은 판은 판정 줄 위에 그 까닭을 쓴다", () => {
    const md = markdown({ clip: "cup-demo.mp4", mode: "실제 서버", ranAt: "2026-11-11 10:00:00", rows: [], notes: ["끝까지 돌지 않음: 중단", "페이지 오류 2개"], verdict: "판정: 명령 없음 · 표 0줄", cost: "VLM 0장" });
    const lines = md.split("\n");
    expect(lines.indexOf("끝까지 돌지 않음: 중단")).toBeGreaterThan(-1);
    expect(lines.indexOf("페이지 오류 2개")).toBeGreaterThan(-1);
    expect(lines.indexOf("끝까지 돌지 않음: 중단")).toBeLessThan(lines.indexOf("판정: 명령 없음 · 표 0줄"));
  });
});
