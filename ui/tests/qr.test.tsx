import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { qrPath } from "../src/panels/qr";
import { QrCode } from "../src/panels/QrCode";

const URL_ = "https://phone-pc.example-net.ts.net/phone/";

describe("QR", () => {
  it("QR 판 크기(21 + 4의 배수)와 왼쪽 위 찾기 무늬로 시작하는 경로", () => {
    const { size, d } = qrPath(URL_);
    expect(size).toBeGreaterThanOrEqual(21);
    expect((size - 17) % 4).toBe(0);
    expect(d.startsWith("M0 0h7v1h-7z")).toBe(true);
    expect(qrPath("https://other.example/phone/").d).not.toBe(d);
  });

  it("흰 바탕 위 검은 칸으로 그린다", () => {
    render(<QrCode value={URL_} />);
    const svg = screen.getByRole("img", { name: "폰 접속 QR" });
    expect(svg.querySelector("rect")).toHaveAttribute("fill", "#fff");
    expect(svg.querySelector("path")?.getAttribute("d")).toBe(qrPath(URL_).d);
  });
});
