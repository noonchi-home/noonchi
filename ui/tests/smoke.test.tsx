import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Dashboard } from "../src/dashboard/Dashboard";

afterEach(() => { vi.unstubAllGlobals(); });

describe("대시보드 뼈대", () => {
  it("3D 트윈 자리가 있다", () => {
    render(<Dashboard />);
    expect(screen.getByLabelText("3D 트윈")).toBeInTheDocument();
  });

  it("트윈 위에 상태 알약·눈 창·대화 패널이 떠 있고, 모두 덮개 층 바로 아래라 빈 곳의 마우스는 3D로 간다", () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 404 })));
    render(<Dashboard />);
    for (const name of ["집 상태", "클로이드의 눈", "대화"]) {
      const panel = screen.getByRole("region", { name });
      expect(panel).toHaveClass("glass");
      expect(panel.parentElement).toHaveClass("pointer-events-none");
    }
  });
});
