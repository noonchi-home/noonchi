import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { useAnchors } from "../src/twin/use-anchors";
import { ViewerContext, type AptViewer } from "../src/lib/twin-viewer";

// 실제 THREE 대신 useAnchors·deviceAnchor가 쓰는 만큼만: 모든 기기는 원점, 행렬은 단위 행렬.
class Vector3 { x = 0; y = 0; z = 0; }
class Box3 {
  setFromObject() { return this; }
  isEmpty() { return false; }
  getCenter(v: Vector3) { return v; }
  max = { y: -0.08 };
}
class Matrix4 {
  elements = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  multiplyMatrices() { return this; }
}

function fakeViewer(view: Partial<AptViewer["view"]>, hiddenIds: string[]): AptViewer {
  const cam = { projectionMatrix: {}, matrixWorldInverse: {} };
  return {
    THREE: { Vector3, Box3, Matrix4 },
    camera: cam, cctvCamera: cam,
    renderer: { domElement: { getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }) } },
    view: { cctv: false, focus: null, isolate: true, showCeiling: false, wallMode: "low", ...view },
    objects: () => [
      { id: "light_living", room: "living_room", mount: "ceiling", category: "lighting" },
      { id: "light_bed", room: "bedroom", mount: "ceiling", category: "lighting" },
      { id: "ac_bed", room: "bedroom", mount: "wall", category: "appliances" },
    ],
    node: () => ({}),
    hidden: (id: string) => hiddenIds.includes(id),
  } as unknown as AptViewer;
}

const visibleOf = (v: AptViewer) => {
  const wrapper = ({ children }: { children: ReactNode }) => <ViewerContext.Provider value={v}>{children}</ViewerContext.Provider>;
  return renderHook(() => useAnchors(["light_living", "light_bed", "ac_bed"]), { wrapper });
};

describe("useAnchors", () => {
  it("천장 보기가 꺼져 숨은 천장 기기도 말풍선 자리를 낸다", async () => {
    const { result } = visibleOf(fakeViewer({ focus: null }, ["light_living", "light_bed"]));
    await waitFor(() => expect(result.current.size).toBe(3));
    expect([...result.current.values()].map((p) => p.visible)).toEqual([true, true, true]);
  });

  it("초점 방만이면 다른 방에서 숨은 기기는 말풍선 자리를 내지 않는다", async () => {
    const { result } = visibleOf(fakeViewer({ focus: "living_room" }, ["light_bed", "ac_bed"]));
    await waitFor(() => expect(result.current.size).toBe(3));
    expect(result.current.get("light_living")?.visible).toBe(true);
    expect(result.current.get("light_bed")?.visible).toBe(false);
    expect(result.current.get("ac_bed")?.visible).toBe(false);
  });
});
