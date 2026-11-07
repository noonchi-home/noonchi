import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { HealthView } from "../../src/contract/events.ts";
import { EyeWindow } from "../src/panels/EyeWindow";

const TS = "https://phone-pc.example-net.ts.net/phone/";
const base: HealthView = {
  ok: true, devices: 1, hub: "memory", transport: null, provider: null, model: null, twin: true, eye: true,
  home: null, phone_urls: [TS, "http://192.168.0.7:8210/phone/"], brain: false,
  mode: "test",
  ready: { ok: false, inference_mode: "mock", vlm: { base_url: "", model: "", key: false, reachable: false }, pam: { url: "", reachable: false, llm: null },
    agent: { provider: "openai", base_url: "", model: "", key: false, reachable: false }, db: false },
};

describe("EyeWindow", () => {
  it("폰이 아직 없으면 맨 앞 주소 QR을 크게, 글은 한 줄, 주소는 작게", () => {
    render(<EyeWindow health={base} />);
    expect(screen.getByRole("img", { name: "폰 접속 QR" })).toBeInTheDocument();
    expect(screen.getByText("폰 카메라로 찍으세요")).toBeInTheDocument();
    expect(screen.getByText(TS)).toBeInTheDocument();
    expect(screen.queryByText("http://192.168.0.7:8210/phone/")).toBeNull();
  });

  it("제목·캡션·설명 글이 없다", () => {
    render(<EyeWindow health={base} />);
    expect(screen.queryByRole("heading")).toBeNull();
    expect(screen.queryByText(/클로이드의 눈/)).toBeNull();
    expect(screen.queryByText(/fps|H\.264|KB/)).toBeNull();
    expect(screen.queryByText(/AR을 시작/)).toBeNull();
  });

  it("폰 화면이 오면 QR 대신 영상만 보인다", () => {
    render(<EyeWindow health={base} />);
    const img = screen.getByAltText("폰 카메라 실시간 화면") as HTMLImageElement;
    expect(img.getAttribute("src")).toMatch(/^\/api\/eye\/stream\?t=\d+$/);
    expect(img.closest("figure")).not.toBeVisible();
    fireEvent.load(img);
    expect(img.closest("figure")).toBeVisible();
    expect(screen.queryByRole("img", { name: "폰 접속 QR" })).toBeNull();
    expect(screen.queryByText("폰 카메라로 찍으세요")).toBeNull();
  });

  it("폰 서버가 없으면 한 줄로 알린다", () => {
    render(<EyeWindow health={{ ...base, eye: false }} />);
    expect(screen.getByText("폰 서버가 꺼져 있어요.")).toBeInTheDocument();
    expect(screen.queryByRole("img", { name: "폰 접속 QR" })).toBeNull();
    expect(screen.queryByAltText("폰 카메라 실시간 화면")).toBeNull();
  });

  it("주소를 모르면 한 줄로 AR만 시작하라고 한다", () => {
    render(<EyeWindow health={{ ...base, phone_urls: [] }} />);
    expect(screen.getByText("폰에서 AR을 시작하세요.")).toBeInTheDocument();
    expect(screen.queryByRole("img", { name: "폰 접속 QR" })).toBeNull();
  });

  it("접으면 화면을 내리고 다시 펼 수 있다", () => {
    render(<EyeWindow health={base} />);
    fireEvent.click(screen.getByRole("button", { name: "눈 창 접기" }));
    expect(screen.queryByAltText("폰 카메라 실시간 화면")).toBeNull();
    expect(screen.queryByRole("img", { name: "폰 접속 QR" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "눈 창 펴기" }));
    expect(screen.getByAltText("폰 카메라 실시간 화면")).toBeInTheDocument();
  });
});
