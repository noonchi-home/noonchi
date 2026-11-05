import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DeviceView } from "../../src/contract/events.ts";
import { useDevices } from "../src/lib/use-devices";

const lamp: DeviceView = {
  id: "lamp", label: "거실 조명", room: "living_room", roomLabel: "거실", twinType: "t", kind: "light", matterDeviceType: "x",
  capabilities: ["onoff"], sensors: [], twinAttrs: {}, state: { id: "lamp", online: true, twin: { power: "off" }, matter: {}, updatedAt: "t0" },
};

afterEach(() => { vi.unstubAllGlobals(); });

describe("useDevices", () => {
  it("GET /api/devices 배열로 시작하고 state 메시지로 갱신한다", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify([lamp]), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => useDevices());
    await waitFor(() => expect(result.current.devices.get("lamp")?.label).toBe("거실 조명"));
    expect(fetchMock).toHaveBeenCalledWith("/api/devices", undefined);
    act(() => result.current.apply({ type: "state", state: { id: "lamp", online: true, twin: { power: "on" }, matter: { onOff: true }, updatedAt: "t1" } }));
    expect(result.current.devices.get("lamp")?.state.twin.power).toBe("on");
    act(() => result.current.apply({ type: "state", state: { id: "ghost", online: true, twin: {}, matter: {}, updatedAt: "t1" } }));
    expect(result.current.devices.has("ghost")).toBe(false);
  });

  it("서버에 못 붙으면 빈 목록 그대로", async () => {
    const fetchMock = vi.fn(async () => { throw new TypeError("fetch failed"); });
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => useDevices());
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    await act(async () => {});
    expect(result.current.devices.size).toBe(0);
  });
});
