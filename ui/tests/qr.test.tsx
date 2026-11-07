import { render, screen } from "@testing-library/react";
import { create } from "qrcode";
import { describe, expect, it } from "vitest";
import { QRCode } from "../src/components/ui/qr-code";

const URL_ = "https://phone-pc.example-net.ts.net/phone/";

describe("QR(21st.dev QR Code)", () => {
  it("네모 칸으로, qr-ink 칸을 qr-bg 바탕 위에 그린다(폰 카메라가 멀리서 읽게)", () => {
    render(<QRCode value={URL_} variant="squares" aria-label="폰 접속 QR" />);
    const svg = screen.getByRole("img", { name: "폰 접속 QR" });
    expect(svg).toHaveAttribute("shape-rendering", "crispEdges");
    expect(svg.querySelector(":scope > rect")).toHaveAttribute("fill", "var(--qr-bg)");
    expect(svg.querySelector(":scope > g")).toHaveAttribute("fill", "var(--qr-ink)");
    expect(svg.querySelector("circle")).toBeNull();
  });

  it("판 크기는 QR 칸 수 + 여백 2칸씩", () => {
    render(<QRCode value={URL_} variant="squares" aria-label="폰 접속 QR" />);
    const n = create(URL_, { errorCorrectionLevel: "M" }).modules.size;
    expect(screen.getByRole("img", { name: "폰 접속 QR" })).toHaveAttribute("viewBox", `0 0 ${n + 4} ${n + 4}`);
  });
});
