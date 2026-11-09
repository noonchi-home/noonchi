import { act, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { HealthView } from "../../src/contract/events.ts";
import { Dashboard } from "../src/dashboard/Dashboard";

/** /api/health는 집 id, /twin/bake/manifest.json은 manifest 상태로 답한다. 나머지는 404. */
function stubHealth(home: string, manifest: number) {
  const health: HealthView = {
    ok: true, devices: 0, hub: "memory", transport: null, provider: "openai", model: "m", twin: true, eye: false,
    home: { id: home, name: "우리 집" }, phone_urls: [], brain: false, mode: "test",
    ready: { ok: false, inference_mode: "mock", vlm: { base_url: "", model: "", key: false, reachable: false }, pam: { url: "", reachable: false, llm: null },
      agent: { provider: "openai", base_url: "", model: "", key: false, reachable: false }, db: false },
  };
  vi.stubGlobal("fetch", vi.fn(async (path: string) => {
    if (path === "/api/health") return Response.json(health);
    if (path === "/twin/bake/manifest.json") return new Response(null, { status: manifest });
    return new Response("{}", { status: 404 });
  }));
}

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

  it("health 전에는 트윈 칸 지도 자리에 3D 트윈 틀만 있고 iframe·캔버스는 없다", () => {
    const { container } = render(<Dashboard />);
    const map = container.querySelector<HTMLElement>('section[aria-label="트윈"] [data-map]')!;
    expect(within(map).getByLabelText("3D 트윈")).toBeInTheDocument();
    expect(map.querySelector("iframe")).toBeNull();
    expect(map.querySelector("canvas")).toBeNull();
  });

  it("구운 3D가 없는 집은 트윈 칸 지도 자리에 3D 트윈(iframe)이 있다", async () => {
    stubHealth("h", 200);
    const { container } = render(<Dashboard />);
    const map = container.querySelector<HTMLElement>('section[aria-label="트윈"] [data-map]')!;
    await waitFor(() => expect(map.querySelector("iframe")).not.toBeNull());
    expect(within(map).getByLabelText("3D 트윈")).toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalledWith("/twin/bake/manifest.json", expect.anything());
  });

  it("한양목련처럼 구운 3D가 있는 집은 /twin/bake/manifest.json이 있으면 지도 자리에 iframe을 띄우지 않는다", async () => {
    stubHealth("mokryeon_180b", 200);
    const { container } = render(<Dashboard />);
    const map = container.querySelector<HTMLElement>('section[aria-label="트윈"] [data-map]')!;
    await waitFor(() => expect(fetch).toHaveBeenCalledWith("/twin/bake/manifest.json", { method: "HEAD" }));
    await act(async () => { await Promise.resolve(); });
    expect(within(map).getByLabelText("3D 트윈")).toBeInTheDocument();
    expect(map.querySelector("iframe")).toBeNull();
  });

  it("구운 보기가 있는 집이어도 /twin/bake/manifest.json이 없으면 iframe이다", async () => {
    stubHealth("mokryeon_180b", 404);
    const { container } = render(<Dashboard />);
    const map = container.querySelector<HTMLElement>('section[aria-label="트윈"] [data-map]')!;
    await waitFor(() => expect(map.querySelector("iframe")).not.toBeNull());
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
