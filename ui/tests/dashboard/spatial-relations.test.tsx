import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { twinFrame } from "../../src/dashboard/frame";
import { MapOverlay } from "../../src/dashboard/MapOverlay";
import { planToPixel } from "../../src/twin/3d/projection";
import { anchorOf, CAM, HOME, IMAGE, moment, SINK } from "./cup-run";

const sink = { id: "destination", label: "싱크대", target: { objectId: SINK } };
const missing = { id: "unknown", label: "위치 모름", target: { room: "kitchen" } };
const [x, height, z] = anchorOf(SINK)!;
const px = planToPixel(CAM, [x, z], height);
const size = { width: 620, height: 410 };
const frameAt = (n: number) => twinFrame({
  ...moment(n), checks: [], anchor: anchorOf, home: HOME, cam: CAM, anchors: [sink, missing],
});
const overlay = (n: number, cx = px[0]) => <MapOverlay frame={frameAt(n)} image={IMAGE}
  size={size} cam={{ cx, cy: px[1], scale: 1 }} engine={null} checks={[]} shapes={[]}
  roomSets={[]} devices={new Map()} objects={new Map()} moveMs={0} blocked={[]} />;

describe("공간 판단 표시", () => {
  it("기준 카메라에서 실좌표와 높이를 투영하고 방만 알면 자리를 짐작하지 않는다", () => {
    expect(frameAt(0).relations).toEqual([{ id: "destination", label: "싱크대", px }]);
  });
  it("화면 안에 있는 대상만 한 번 보여 주고 같은 목적지가 현재 단계 이름에 있으면 이름표를 겹치지 않는다", () => {
    const { container, rerender } = render(overlay(0));
    expect(container.querySelector("[data-relation-label]")?.textContent).toBe("싱크대");
    rerender(overlay(0, px[0] + size.width));
    expect(container.querySelector("[data-relation-label]")).toBeNull();
    rerender(overlay(3));
    expect(container.querySelector("[data-step-tag]")?.textContent).toContain("싱크대");
    expect(container.querySelector("[data-relation-label]")).toBeNull();
  });
});
