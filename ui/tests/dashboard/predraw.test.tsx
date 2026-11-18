// 미리 그려 보기: 화면이 뜰 때 트윈 첫 그림 뒤 한 번만 PREDRAW_FRAMES 그림을 기다려 GPU 첫 일(타일 그리기·셰이더 만들기)을 끝내 둔다
// (트윈 표시 판의 이름표·말풍선 층은 그동안 따로 합성해 그려 본다, MapOverlay). 다 그린 뒤에 data-ready를 달고 onReady를 부른다. 단계가 바뀔 때는 하지 않는다.
// 할 일 진행도 알약이 없어(2026-11-18 사용자 결정) 화면 틀이 따로 미리 그리는 칸(data-predraw)은 없다.
import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DashboardScreen, type ScreenProps } from "../../src/dashboard/DashboardScreen";
import { PREDRAW_FRAMES } from "../../src/dashboard/motion";
import { screenAt } from "./fixtures";

let frames: FrameRequestCallback[] = [];
beforeEach(() => {
  frames = [];
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb) => { frames.push(cb); return frames.length; });
  vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});
});
afterEach(() => { vi.restoreAllMocks(); });

/** 그림 n개를 넘긴다. */
const tick = (n: number) => act(() => {
  for (let i = 0; i < n; i++) {
    const now = frames;
    frames = [];
    for (const cb of now) cb(performance.now());
  }
});
const predraws = (c: HTMLElement) => c.querySelectorAll("[data-predraw]");

describe("미리 그려 보기", () => {
  it("트윈 첫 그림 전에는 하지 않고, 첫 그림 뒤 한 번 그려 본 다음 data-ready를 달고 onReady를 한 번 부른다", () => {
    const onReady = vi.fn();
    const draw = (p: ScreenProps) => <DashboardScreen {...p} onReady={onReady} />;
    const view = render(draw(screenAt(2, { mapReady: false })));
    const main = view.container.querySelector("main")!;
    tick(PREDRAW_FRAMES + 2);
    expect(predraws(view.container)).toHaveLength(0);
    expect(main).not.toHaveAttribute("data-ready");

    view.rerender(draw(screenAt(2)));
    expect(main).not.toHaveAttribute("data-ready");
    expect(onReady).not.toHaveBeenCalled();

    tick(PREDRAW_FRAMES);
    expect(predraws(view.container)).toHaveLength(0);
    expect(main).toHaveAttribute("data-ready");
    expect(onReady).toHaveBeenCalledTimes(1);
  });

  it("미리 그려 보는 동안에도 화면을 가리는 칸(가림판·진행도 알약 모양)이 없다", () => {
    const view = render(<DashboardScreen {...screenAt(0)} />);
    expect(predraws(view.container)).toHaveLength(0);
    expect(view.container.querySelector("[data-veil], [data-progress]")).toBeNull();
  });

  it("단계가 바뀔 때는 미리 그려 보지 않고 onReady도 다시 부르지 않는다", () => {
    const onReady = vi.fn();
    const draw = (p: ScreenProps) => <DashboardScreen {...p} onReady={onReady} />;
    const view = render(draw(screenAt(2)));
    tick(PREDRAW_FRAMES);
    expect(onReady).toHaveBeenCalledTimes(1);
    let added = 0;
    const seen = new MutationObserver((list) => {
      for (const m of list) for (const n of m.addedNodes) {
        if (n instanceof Element && (n.matches("[data-predraw]") || n.querySelector("[data-predraw]"))) added++;
      }
    });
    seen.observe(view.container, { subtree: true, childList: true });
    for (const n of [3, 4, 0, 1, 2, 3]) {
      view.rerender(draw(screenAt(n)));
      tick(PREDRAW_FRAMES + 1);
      expect(predraws(view.container)).toHaveLength(0);
    }
    seen.disconnect();
    expect(added).toBe(0);
    expect(onReady).toHaveBeenCalledTimes(1);
    expect(view.container.querySelector("main")).toHaveAttribute("data-ready");
  });
});
