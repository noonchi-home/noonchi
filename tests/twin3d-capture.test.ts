import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { legacyView, pageStep, readyCheck, stepsOf, withTimeout } from "../scripts/twin3d/capture-lib.js";

/** 크롬에서 돌릴 식을 가짜 document로 풀어 본다. */
const run = (expr: string, doc: { readyState: string; querySelector: (s: string) => unknown }) => new Function("document", "window", `return (${expr});`)(doc, {}) as boolean;

describe("readyCheck: 다 불러왔다고 보는 때", () => {
  it("기본은 지금처럼 새 엔진(window.__twin3d.ready), --legacy는 옛 뷰어(window.aptViewer)", () => {
    expect(readyCheck({})).toBe("Boolean(window.__twin3d?.ready)");
    expect(readyCheck({ legacy: true })).toContain("window.aptViewer");
  });

  it("--ready <CSS 선택자>면 페이지 불러오기가 끝나고 그 선택자에 맞는 요소가 있을 때(React 대시보드)", () => {
    const expr = readyCheck({ selector: "[data-check]" });
    const seen: string[] = [];
    const doc = (readyState: string, found: boolean) => ({ readyState, querySelector: (s: string) => { seen.push(s); return found ? {} : null; } });
    expect(run(expr, doc("loading", true))).toBe(false);
    expect(run(expr, doc("complete", false))).toBe(false);
    expect(run(expr, doc("complete", true))).toBe(true);
    expect(seen).toContain("[data-check]");
    expect(expr).not.toContain("__twin3d");
  });

  it("따옴표가 든 선택자도 그대로 넘긴다", () => {
    const seen: string[] = [];
    run(readyCheck({ selector: `[aria-label="확인한 것"] [data-check]` }), { readyState: "complete", querySelector: (s) => { seen.push(s); return {}; } });
    expect(seen).toEqual([`[aria-label="확인한 것"] [data-check]`]);
  });

  it("빈 선택자, --legacy와 함께 쓰면 오류", () => {
    expect(() => readyCheck({ selector: " " })).toThrow("--ready에는 CSS 선택자를 넣어요");
    expect(() => readyCheck({ selector: "main", legacy: true })).toThrow("--legacy와 --ready는 같이 쓰지 않아요");
  });
});

describe("--ready 페이지의 스크립트 줄", () => {
  it("shot·wait만 된다. 엔진이 있어야 하는 줄은 크롬을 띄우기 전에 멈춘다", () => {
    expect(() => pageStep("shot:dashboard-1920-turn")).not.toThrow();
    expect(() => pageStep("wait:3000")).not.toThrow();
    for (const s of ["view:overview", "play:device_on", "step:1000", "manual:drag", "follow", "tour:high", "remount:2", "cycle:1"]) {
      expect(() => pageStep(s)).toThrow(`--ready 페이지는 shot·wait 줄만 돼요: ${s}`);
    }
  });

  it("--views 이름마다 엔진 페이지는 보기+사진, --ready 페이지는 사진 한 장", () => {
    expect(stepsOf(["overview", "room:living"], false)).toEqual(["view:overview", "shot:overview", "view:room:living", "shot:room:living"]);
    expect(stepsOf(["dashboard-1920-turn"], true)).toEqual(["shot:dashboard-1920-turn"]);
  });

  it("capture.ts가 --ready를 읽고 쓰는 법에 적는다", () => {
    const s = readFileSync("scripts/twin3d/capture.ts", "utf8");
    expect(s).toContain('arg("ready")');
    expect(s).toContain("readyCheck(");
    expect(s.split(/\r?\n/)[0]).toContain("[--ready <CSS 선택자>]");
  });
});

describe("withTimeout", () => {
  afterEach(() => { vi.useRealTimers(); });
  it("일이 먼저 끝나면 타이머를 끈다(캡처가 끝나고 기다리지 않게)", async () => {
    vi.useFakeTimers();
    await expect(withTimeout(Promise.resolve(1), 90_000, "x")).resolves.toBe(1);
    expect(vi.getTimerCount()).toBe(0);
  });
  it("일이 실패해도 타이머를 끈다", async () => {
    vi.useFakeTimers();
    await expect(withTimeout(Promise.reject(new Error("boom")), 90_000, "x")).rejects.toThrow("boom");
    expect(vi.getTimerCount()).toBe(0);
  });
  it("시간이 지나면 오류", async () => {
    vi.useFakeTimers();
    const check = expect(withTimeout(new Promise(() => {}), 2000, "사진")).rejects.toThrow("시간 초과(2초): 사진");
    await vi.advanceTimersByTimeAsync(2000);
    await check;
  });
});

describe("legacyView", () => {
  it("overview는 전체로 돌아가고, room:<id>는 그 방으로", () => {
    expect(legacyView("overview")).toBe("window.aptViewer.focusRoom(null)");
    expect(legacyView("room:living")).toBe('window.aptViewer.focusRoom("living")');
  });
  it("옛 화면이 못 하는 보기는 오류", () => {
    expect(() => legacyView("object:fridge_bbc363a3")).toThrow("옛 화면은 overview·room:<id>만 돼요: object:fridge_bbc363a3");
    expect(() => legacyView("angle:45/50")).toThrow("옛 화면은 overview·room:<id>만 돼요: angle:45/50");
    expect(() => legacyView("room:")).toThrow("옛 화면은 overview·room:<id>만 돼요: room:");
  });
});
