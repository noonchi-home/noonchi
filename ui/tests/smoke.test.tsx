import { render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Dashboard } from "../src/dashboard/Dashboard";

beforeEach(() => { vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 404 }))); });
afterEach(() => { vi.unstubAllGlobals(); history.replaceState(null, "", "/"); });

describe("대시보드 뼈대", () => {
  it("트윈 칸·대시보드 폰 칸(「폰 카메라」)·마스코트가 한 화면(main)에 있다", () => {
    const { container } = render(<Dashboard />);
    const main = container.querySelector("main")!;
    const twin = container.querySelector<HTMLElement>('section[aria-label="트윈"]')!;
    const phone = container.querySelector<HTMLElement>('section[aria-label="폰 카메라"]')!;
    expect(twin).not.toBeNull();
    expect(phone).not.toBeNull();
    expect(main.contains(twin) && main.contains(phone)).toBe(true);
    expect(twin.parentElement).toBe(phone.parentElement);
    expect(main).toHaveAttribute("data-step", "0");
    const mascot = screen.getByRole("region", { name: "마스코트" });
    expect(within(mascot).getByRole("button", { name: "설정 열기" })).toBeInTheDocument();
  });

  it("트윈 칸 지도 자리에 3D 트윈(iframe)이 있다", () => {
    const { container } = render(<Dashboard />);
    const map = container.querySelector<HTMLElement>('section[aria-label="트윈"] [data-map]')!;
    expect(within(map).getByLabelText("3D 트윈")).toBeInTheDocument();
    expect(map.querySelector("iframe")).not.toBeNull();
  });

  it("옛 패널(상태 알약·눈 창·판단 기록)이 없다. 옛 주소 ?look=glass로 열어도 같다", () => {
    history.replaceState(null, "", "/?look=glass");
    const { container } = render(<Dashboard />);
    for (const name of ["집 상태", "클로이드의 눈", "판단 기록"]) expect(screen.queryByRole("region", { name })).toBeNull();
    expect(container.querySelector("[data-panel]")).toBeNull();
    expect(container.querySelector("[data-look]")).toBeNull();
    expect(document.getElementById("glass-distortion")).toBeNull();
    expect(document.getElementById("glass-blur")).toBeNull();
  });

  it("health 전에는 연결 QR·영상 없이 빈 대시보드 폰 칸이다", () => {
    const { container } = render(<Dashboard />);
    const phone = container.querySelector<HTMLElement>('section[aria-label="폰 카메라"]')!;
    expect(phone.querySelector("img")).toBeNull();
    expect(within(phone).queryByRole("img", { name: "폰 연결 QR" })).toBeNull();
  });
});
