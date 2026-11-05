import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Dashboard } from "../src/dashboard/Dashboard";
import { lookOf } from "../src/look/look";

describe("lookOf", () => {
  it("?look=glass만 유리 모양, 없거나 모르는 값은 부품 모양", () => {
    expect(lookOf("")).toBe("parts");
    expect(lookOf("?look=parts")).toBe("parts");
    expect(lookOf("?look=glass")).toBe("glass");
    expect(lookOf("?x=1&look=glass")).toBe("glass");
    expect(lookOf("?look=dark")).toBe("parts");
  });
});

describe("대시보드 두 모양", () => {
  beforeEach(() => { vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 404 }))); });
  afterEach(() => { vi.unstubAllGlobals(); history.replaceState(null, "", "/"); });

  const surfaces = () => ["집 상태", "클로이드의 눈", "판단 기록"].map((name) => screen.getByRole("region", { name }).querySelector<HTMLElement>("[data-surface]")?.dataset.surface);

  it("?look가 없으면 부품 모양: 패널·알약·눈 창이 흰 카드", () => {
    const { container } = render(<Dashboard />);
    expect(container.querySelector("main")).toHaveAttribute("data-look", "parts");
    expect(surfaces()).toEqual(["card", "card", "card"]);
    expect(document.getElementById("glass-distortion")).toBeNull();
  });

  it("?look=glass면 유리 모양: 굴절 필터를 깔고 패널·알약·눈 창을 유리로 감싼다", () => {
    history.replaceState(null, "", "/?look=glass");
    const { container } = render(<Dashboard />);
    expect(container.querySelector("main")).toHaveAttribute("data-look", "glass");
    expect(surfaces()).toEqual(["glass", "glass", "glass"]);
    expect(document.getElementById("glass-distortion")).not.toBeNull();
    expect(document.getElementById("glass-blur")).not.toBeNull();
  });
});
