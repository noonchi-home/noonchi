import { afterEach, describe, expect, it, vi } from "vitest";
import { legacyView, withTimeout } from "../scripts/twin3d/capture-lib.js";

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
