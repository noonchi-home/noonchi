import { describe, expect, it } from "vitest";
import type { DeviceView } from "../../src/contract/events.ts";
import { deviceSummary } from "../src/bubbles/summary";

const base: Omit<DeviceView, "state"> = {
  id: "ac", label: "거실 에어컨", room: "living_room", roomLabel: "거실", twinType: "wall_ac", kind: "aircon",
  matterDeviceType: "RoomAirConditionerDevice", capabilities: ["onoff", "climate"], sensors: [], twinAttrs: {},
};
const st = (twin: Record<string, unknown>, matter: Record<string, unknown> = {}, extra: Partial<DeviceView["state"]> = {}): DeviceView =>
  ({ ...base, state: { id: "ac", online: true, twin, matter, updatedAt: "t", ...extra } });

describe("deviceSummary", () => {
  it("켜진 에어컨: 모드와 온도", () => {
    expect(deviceSummary(st({ power: "on" }, { onOff: true, systemMode: "cool", setpointC: 24 }))).toEqual({ title: "거실 에어컨", line: "켜짐 · 냉방 · 24°C", tone: "on" });
  });
  it("꺼짐", () => {
    expect(deviceSummary(st({ power: "off" }))).toMatchObject({ line: "꺼짐", tone: "off" });
  });
  it("문 열림은 경고", () => {
    expect(deviceSummary({ ...st({ door: "open" }), kind: "contact" })).toMatchObject({ line: "문 열림", tone: "alert" });
  });
  it("잠금 해제는 경고", () => {
    expect(deviceSummary({ ...st({ lock: "unlocked" }), kind: "lock" })).toMatchObject({ line: "잠금 해제", tone: "alert" });
  });
  it("신호 없음은 모름", () => {
    expect(deviceSummary(st({}, {}, { signal: "none" }))).toMatchObject({ line: "모름", tone: "unknown" });
  });
  it("오프라인은 경고", () => {
    expect(deviceSummary(st({ power: "on" }, {}, { online: false }))).toMatchObject({ line: "켜짐 · 오프라인", tone: "alert" });
  });
  it("켜진 조명은 밝기", () => {
    expect(deviceSummary({ ...st({ power: "on" }, { onOff: true, level: 60 }), kind: "light" })).toMatchObject({ line: "켜짐 · 밝기 60%", tone: "on" });
  });
  it("닫힌 커튼은 켜짐으로 치지 않는다", () => {
    expect(deviceSummary({ ...st({ curtain: "closed" }), kind: "covering" })).toMatchObject({ line: "닫힘", tone: "off" });
  });
  it("모르는 상태 이름은 글로 내지 않는다", () => {
    expect(deviceSummary(st({ mystery: 3 }))).toMatchObject({ line: "꺼짐", tone: "off" });
  });
});
