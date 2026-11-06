import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Dashboard } from "../src/dashboard/Dashboard";

afterEach(() => { vi.unstubAllGlobals(); history.replaceState(null, "", "/"); });

describe("대시보드 뼈대", () => {
  it("3D 트윈 자리가 있다", () => {
    render(<Dashboard />);
    expect(screen.getByLabelText("3D 트윈")).toBeInTheDocument();
  });

  it("트윈 위에 상태 알약·눈 창·판단 기록 패널이 떠 있고, 패널만 마우스를 받아 빈 곳의 마우스는 3D로 간다", () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 404 })));
    render(<Dashboard />);
    const overlay = screen.getByLabelText("3D 트윈").querySelector<HTMLElement>(":scope > .pointer-events-none")!;
    for (const name of ["집 상태", "클로이드의 눈", "판단 기록"]) {
      const panel = screen.getByRole("region", { name });
      expect(overlay.contains(panel)).toBe(true);
      expect(panel.parentElement).toHaveClass("*:pointer-events-auto");
      // 덮개와 패널 사이 상자(좁은 화면 쌓기 상자)는 넓은 화면에서 상자가 없고 좁은 화면에서도 마우스를 받지 않는다
      for (let box = panel.parentElement!; box !== overlay; box = box.parentElement!) expect(box).toHaveClass("contents", "max-sm:pointer-events-none!");
    }
  });

  it("패널·알약·눈 창은 21st.dev 부품 흰 카드다. 옛 주소 ?look=glass로 열어도 같다", () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 404 })));
    history.replaceState(null, "", "/?look=glass");
    const { container } = render(<Dashboard />);
    for (const name of ["집 상태", "클로이드의 눈", "판단 기록"]) {
      expect(screen.getByRole("region", { name }).querySelector(".bg-surface.shadow-card")).not.toBeNull();
    }
    expect(container.querySelector("[data-look]")).toBeNull();
    expect(document.getElementById("glass-distortion")).toBeNull();
    expect(document.getElementById("glass-blur")).toBeNull();
  });
});
