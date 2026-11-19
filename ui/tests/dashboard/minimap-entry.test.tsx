// 대시보드 입구(main.tsx): 주소 ?view=minimap이면 비전 미니맵만(MinimapView) 그리고 트윈 칸·엔진은 띄우지 않는다.
import { screen, waitFor } from "@testing-library/react";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { TwinEngine } from "../../src/twin/3d/engine";

class FakeSocket {
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  send() {}
  close() {}
}

describe("대시보드 입구 ?view=minimap", () => {
  const load = vi.spyOn(TwinEngine, "load");
  beforeAll(() => {
    vi.stubGlobal("WebSocket", FakeSocket);
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 404 })));
    history.replaceState(null, "", "/?view=minimap");
    document.body.innerHTML = '<div id="root"></div>';
  });
  afterAll(() => {
    load.mockRestore();
    vi.unstubAllGlobals();
    history.replaceState(null, "", "/");
  });

  it("폰 카메라 칸만 있고 트윈 칸·마스코트가 없으며 트윈 엔진을 부르지 않는다", async () => {
    await import("../../src/dashboard/main");
    await waitFor(() => expect(screen.getByRole("region", { name: "폰 카메라" })).toBeInTheDocument());
    expect(document.querySelector('[aria-label="트윈"], [aria-label="3D 트윈"]')).toBeNull();
    expect(screen.queryByRole("region", { name: "마스코트" })).toBeNull();
    expect(load).not.toHaveBeenCalled();
  }, 60_000);
});
