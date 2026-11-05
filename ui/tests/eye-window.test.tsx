import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { HealthView } from "../../src/contract/events.ts";
import { EyeWindow } from "../src/panels/EyeWindow";

const base: HealthView = {
  ok: true, devices: 1, hub: "memory", transport: null, provider: null, model: null, twin: true, eye: true,
  home: null, phone_urls: [], brain: false,
};
const stats = (fps: number) => new Response(JSON.stringify({ ok: true, fps, frames: 3, kb_per_frame: 41, display: { codec: null, fps: 0 } }));

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("EyeWindow", () => {
  it("폰 서버가 없으면 꺼져 있다고 알린다", () => {
    render(<EyeWindow health={{ ...base, eye: false }} />);
    expect(screen.getByText("폰 서버가 꺼져 있어요.")).toBeInTheDocument();
    expect(screen.queryByRole("img")).toBeNull();
  });

  it("폰이 없으면 집 공유기 주소로 여는 법을 알리고, JPEG 스트림을 붙여 둔다", () => {
    vi.stubGlobal("fetch", vi.fn(async () => stats(0)));
    render(<EyeWindow health={{ ...base, phone_urls: ["http://100.1.2.3:8210/phone/", "http://192.168.0.7:8210/phone/"] }} />);
    expect(screen.getByText("폰이 연결되지 않았어요.")).toBeInTheDocument();
    expect(screen.getByText("http://192.168.0.7:8210/phone/")).toBeInTheDocument();
    const img = screen.getByAltText("클로이드의 눈 실시간 화면") as HTMLImageElement;
    expect(img.getAttribute("src")).toMatch(/^\/api\/eye\/stream\?t=\d+$/);
    expect(img.closest("figure")).not.toBeVisible();
  });

  it("주소를 모르면 AR만 시작하라고 한다", () => {
    vi.stubGlobal("fetch", vi.fn(async () => stats(0)));
    render(<EyeWindow health={base} />);
    expect(screen.getByText("폰에서 AR을 시작하세요.")).toBeInTheDocument();
  });

  it("첫 장이 오면 화면을 보이고 안내를 감춘다", () => {
    vi.stubGlobal("fetch", vi.fn(async () => stats(0)));
    render(<EyeWindow health={base} />);
    const img = screen.getByAltText("클로이드의 눈 실시간 화면");
    fireEvent.load(img);
    expect(img.closest("figure")).toBeVisible();
    expect(screen.queryByText("폰이 연결되지 않았어요.")).toBeNull();
  });

  it("2초마다 받은 장 수로 캡션을 바꾸고, 초점이 오면 잠시 주목 대상을 보인다", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "setTimeout", "clearInterval", "clearTimeout"] });
    const fetchMock = vi.fn(async () => stats(12));
    vi.stubGlobal("fetch", fetchMock);
    const { rerender } = render(<EyeWindow health={base} />);
    expect(screen.getByText("클로이드의 눈 · 실시간")).toBeInTheDocument();
    await act(async () => { vi.advanceTimersByTime(2000); });
    vi.useRealTimers();
    await waitFor(() => expect(screen.getByText("클로이드의 눈 · 실시간 12 fps · 41KB")).toBeInTheDocument());
    expect(fetchMock).toHaveBeenCalledWith("/api/eye/stats", undefined);
    rerender(<EyeWindow health={base} focus={{ targets: [{ id: "ac", label: "거실 에어컨", position: [0, 0, 0] }], at: "t", ttl_ms: 8000 }} />);
    expect(screen.getByText("클로이드 주목 · 거실 에어컨")).toBeInTheDocument();
  });

  it("접으면 화면을 내리고 다시 펼 수 있다", () => {
    vi.stubGlobal("fetch", vi.fn(async () => stats(0)));
    render(<EyeWindow health={base} />);
    fireEvent.click(screen.getByRole("button", { name: "눈 창 접기" }));
    expect(screen.queryByAltText("클로이드의 눈 실시간 화면")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "눈 창 펴기" }));
    expect(screen.getByAltText("클로이드의 눈 실시간 화면")).toBeInTheDocument();
  });
});
