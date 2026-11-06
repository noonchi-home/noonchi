import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { DeviceView } from "../../src/contract/events.ts";
import { BubbleLayer } from "../src/bubbles/BubbleLayer";
import type { Check } from "../src/checks/checks";

const dev = (id: string, label: string, power: string): [string, DeviceView] => [id, {
  id, label, room: "r", roomLabel: "거실", twinType: "t", kind: "light", matterDeviceType: "x", capabilities: [], sensors: [], twinAttrs: {},
  state: { id, online: true, twin: { power }, matter: {}, updatedAt: "t" },
}];
const checked = (deviceId: string, order: number, verb: Check["verb"] = "바꿈"): Check => ({ key: `device:${deviceId}`, order, source: "agent", deviceId, verb, at: 0 });
const table: Check = { key: "brain", order: 1, source: "brain", objectId: "table_1", verb: "지켜봄", note: "사람 있음 · 컵 없음", at: 0 };
const at = (ids: string[], p = { x: 10, y: 20, visible: true }) => new Map(ids.map((id) => [id, p]));
const bubbleOf = (label: string) => screen.getByText(label).closest("[data-check]") as HTMLElement;

describe("BubbleLayer", () => {
  it("확인 목록에 없는 기기는 그리지 않는다", () => {
    const devices = new Map([dev("a", "거실 조명", "on"), dev("b", "안방 조명", "off")]);
    render(<BubbleLayer checks={[checked("a", 1)]} devices={devices} points={at(["a", "b"])} />);
    expect(screen.getByText("거실 조명")).toBeInTheDocument();
    expect(screen.queryByText("안방 조명")).toBeNull();
  });

  it("확인한 것이 없으면 말풍선이 하나도 없다", () => {
    const devices = new Map([dev("a", "거실 조명", "on"), dev("b", "안방 조명", "off")]);
    render(<BubbleLayer checks={[]} devices={devices} points={at(["a", "b"])} />);
    expect(document.querySelectorAll("[data-check]")).toHaveLength(0);
  });

  it("말풍선 = 번호 + 이름 + verb + 지금 상태 한 줄. 꺼진 기기도 상태가 늘 보인다", () => {
    const devices = new Map([dev("a", "거실 조명", "on"), dev("b", "안방 조명", "off")]);
    render(<BubbleLayer checks={[checked("a", 1), checked("b", 2, "확인")]} devices={devices} points={at(["a", "b"])} />);
    const a = bubbleOf("거실 조명");
    expect(a.querySelector("[data-order]")).toHaveTextContent("1");
    expect(a).toHaveTextContent("바꿈");
    expect(a).toHaveTextContent("켜짐");
    const b = bubbleOf("안방 조명");
    expect(b.querySelector("[data-order]")).toHaveTextContent("2");
    expect(b).toHaveTextContent("확인");
    expect(screen.getByText("꺼짐")).not.toHaveClass("hidden");
  });

  it("안 보이는 자리의 기기는 확인했어도 그리지 않는다", () => {
    render(<BubbleLayer checks={[checked("a", 1)]} devices={new Map([dev("a", "거실 조명", "on")])} points={at(["a"], { x: 0, y: 0, visible: false })} />);
    expect(screen.queryByText("거실 조명")).toBeNull();
  });

  it("식탁은 이름 + 지켜봄 + 판정 요약, 번호는 없다", () => {
    render(<BubbleLayer checks={[table]} devices={new Map()} objects={new Map([["table_1", "식탁"]])} points={at(["table_1"])} />);
    const t = bubbleOf("식탁");
    expect(t).toHaveTextContent("지켜봄");
    expect(t).toHaveTextContent("사람 있음 · 컵 없음");
    expect(t.querySelector("[data-order]")).toBeNull();
  });

  it("말풍선 꼬리 끝이 기기 자리에 온다", () => {
    render(<BubbleLayer checks={[checked("a", 1)]} devices={new Map([dev("a", "거실 조명", "on")])} points={at(["a"])} />);
    const bubble = bubbleOf("거실 조명");
    expect(bubble.dataset.check).toBe("a");
    expect(bubble.style.left).toBe("10px");
    expect(bubble.style.top).toBe("20px");
  });

  it("꼬리는 밝은 바닥·어두운 바닥 모두에서 보이게 밝은 심에 어두운 테두리를 두른다", () => {
    render(<BubbleLayer checks={[checked("a", 1)]} devices={new Map([dev("a", "거실 조명", "on")])} points={at(["a"])} />);
    const tail = bubbleOf("거실 조명").lastElementChild;
    expect(tail).toHaveClass("bg-white", "ring-1");
    expect(tail).not.toHaveClass("w-px");
  });

  it("말풍선은 보기만 한다: 마우스·끌기가 3D 트윈으로 간다", () => {
    const devices = new Map([dev("a", "거실 조명", "on")]);
    render(<BubbleLayer checks={[checked("a", 1), table]} devices={devices} objects={new Map([["table_1", "식탁"]])} points={at(["a", "table_1"])} />);
    const bubbles = [...document.querySelectorAll<HTMLElement>("[data-check]")];
    expect(bubbles).toHaveLength(2);
    for (const b of bubbles) expect(b).toHaveClass("pointer-events-none");
    expect(document.querySelector("[aria-label='확인한 것'] .pointer-events-auto")).toBeNull();
  });

  it("말풍선은 흰 카드다. 모름도 점선 테두리를 쓰지 않는다", () => {
    const unknown: [string, DeviceView] = ["u", { ...dev("u", "후드", "off")[1], state: { id: "u", online: true, twin: {}, matter: {}, updatedAt: "t", signal: "none" } }];
    const devices = new Map([dev("a", "거실 조명", "on"), unknown]);
    const checks = [checked("a", 1), checked("u", 2, "확인")];
    const points = new Map([["a", { x: 10, y: 20, visible: true }], ["u", { x: 50, y: 20, visible: true }]]);
    render(<BubbleLayer checks={checks} devices={devices} points={points} />);
    expect(bubbleOf("거실 조명").querySelector(".bg-surface.shadow-card")).not.toBeNull();
    expect(bubbleOf("후드").querySelector(".bg-surface.shadow-card")).not.toBeNull();
    expect(document.querySelector(".border-dashed")).toBeNull();
  });

  it("방금 다룬 기기는 크게", () => {
    const devices = new Map([dev("a", "거실 조명", "off"), dev("b", "안방 조명", "off")]);
    render(<BubbleLayer checks={[checked("a", 1), checked("b", 2)]} devices={devices} points={at(["a", "b"])} focusId="b" />);
    expect(bubbleOf("안방 조명")).toHaveAttribute("data-focus", "true");
    expect(bubbleOf("거실 조명")).not.toHaveAttribute("data-focus");
  });

  it("겹치면 모름 < 꺼짐·켜짐 < 경고 < 방금 다룬 기기 순으로 위에 온다", () => {
    const unknown: [string, DeviceView] = ["u", { ...dev("u", "후드", "off")[1], state: { id: "u", online: true, twin: {}, matter: {}, updatedAt: "t", signal: "none" } }];
    const alert: [string, DeviceView] = ["x", { ...dev("x", "현관문", "on")[1], kind: "contact", state: { id: "x", online: true, twin: { door: "open" }, matter: {}, updatedAt: "t" } }];
    const devices = new Map([unknown, dev("a", "거실 조명", "on"), alert, dev("f", "안방 조명", "off")]);
    const checks = ["u", "a", "x", "f"].map((id, i) => checked(id, i + 1));
    render(<BubbleLayer checks={checks} devices={devices} points={at(["u", "a", "x", "f"])} focusId="f" />);
    const z = (label: string) => bubbleOf(label).className.split(" ").find((c) => /^z-\d+$/.test(c))?.slice(2);
    expect(Number(z("후드"))).toBeLessThan(Number(z("거실 조명")));
    expect(Number(z("거실 조명"))).toBeLessThan(Number(z("현관문")));
    expect(Number(z("현관문"))).toBeLessThan(Number(z("안방 조명")));
  });

  it("층 자체는 크기가 없어 3D 조작을 막지 않는다", () => {
    render(<BubbleLayer checks={[]} devices={new Map()} points={new Map()} />);
    expect(screen.getByLabelText("확인한 것")).toHaveClass("w-0", "h-0");
  });
});
