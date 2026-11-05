import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Dashboard } from "../src/dashboard/Dashboard";

describe("대시보드 뼈대", () => {
  it("3D 트윈 자리가 있다", () => {
    render(<Dashboard />);
    expect(screen.getByLabelText("3D 트윈")).toBeInTheDocument();
  });
});
