import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { DeviceView } from "../../src/contract/events.ts";
import { BubbleLayer } from "../src/bubbles/BubbleLayer";

const dev = (id: string, label: string, power: string): [string, DeviceView] => [id, {
  id, label, room: "r", roomLabel: "거실", twinType: "t", kind: "light", matterDeviceType: "x", capabilities: [], sensors: [], twinAttrs: {},
  state: { id, online: true, twin: { power }, matter: {}, updatedAt: "t" },
}];

describe("BubbleLayer", () => {
  it("보이는 기기마다 말풍선, 안 보이면 없음", () => {
    const devices = new Map([dev("a", "거실 조명", "on"), dev("b", "안방 조명", "off")]);
    const points = new Map([["a", { x: 10, y: 20, visible: true }], ["b", { x: 0, y: 0, visible: false }]]);
    render(<BubbleLayer devices={devices} points={points} />);
    expect(screen.getByText("거실 조명")).toBeInTheDocument();
    expect(screen.getByText("켜짐")).toBeInTheDocument();
    expect(screen.queryByText("안방 조명")).toBeNull();
  });

  it("말풍선 꼬리 끝이 기기 자리에 온다", () => {
    const devices = new Map([dev("a", "거실 조명", "on")]);
    render(<BubbleLayer devices={devices} points={new Map([["a", { x: 10, y: 20, visible: true }]])} />);
    const bubble = screen.getByText("거실 조명").closest("[data-device]") as HTMLElement;
    expect(bubble.dataset.device).toBe("a");
    expect(bubble.style.left).toBe("10px");
    expect(bubble.style.top).toBe("20px");
  });

  it("꺼진 기기는 이름만 보이고, 방금 다룬 기기는 상태까지 크게", () => {
    const devices = new Map([dev("a", "거실 조명", "off"), dev("b", "안방 조명", "off")]);
    const points = new Map([["a", { x: 10, y: 20, visible: true }], ["b", { x: 50, y: 20, visible: true }]]);
    render(<BubbleLayer devices={devices} points={points} focusId="b" />);
    const [a, b] = screen.getAllByText("꺼짐");
    expect(a).toHaveClass("hidden");
    expect(b).not.toHaveClass("hidden");
    expect(b.closest("[data-device]")).toHaveAttribute("data-focus", "true");
  });

  it("겹치면 모름 < 꺼짐·켜짐 < 경고 < 방금 다룬 기기 순으로 위에 온다", () => {
    const unknown: [string, DeviceView] = ["u", { ...dev("u", "후드", "off")[1], state: { id: "u", online: true, twin: {}, matter: {}, updatedAt: "t", signal: "none" } }];
    const alert: [string, DeviceView] = ["x", { ...dev("x", "현관문", "on")[1], kind: "contact", state: { id: "x", online: true, twin: { door: "open" }, matter: {}, updatedAt: "t" } }];
    const devices = new Map([unknown, dev("a", "거실 조명", "on"), alert, dev("f", "안방 조명", "off")]);
    const at = { x: 10, y: 20, visible: true };
    render(<BubbleLayer devices={devices} points={new Map(["u", "a", "x", "f"].map((id) => [id, at]))} focusId="f" />);
    const z = (label: string) => (screen.getByText(label).closest("[data-device]") as HTMLElement).className.split(" ").find((c) => /^z-\d+$/.test(c))?.slice(2);
    expect(Number(z("후드"))).toBeLessThan(Number(z("거실 조명")));
    expect(Number(z("거실 조명"))).toBeLessThan(Number(z("현관문")));
    expect(Number(z("현관문"))).toBeLessThan(Number(z("안방 조명")));
  });

  it("층 자체는 크기가 없어 3D 조작을 막지 않는다", () => {
    render(<BubbleLayer devices={new Map()} points={new Map()} />);
    expect(screen.getByLabelText("가전 상태")).toHaveClass("w-0", "h-0");
  });
});
