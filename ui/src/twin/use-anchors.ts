import { useEffect, useState } from "react";
import { deviceAnchor } from "./anchors";
import { screenPoints, type ScreenPoint } from "./project";
import { useViewer } from "./viewer";

export type { ScreenPoint } from "./project";

/** 매 프레임 기기 id들의 덮개 좌표. 숨겨진 노드(방 초점 등)는 visible=false. 바뀐 게 없으면 다시 그리지 않는다. */
export function useAnchors(ids: string[]) {
  const v = useViewer();
  const [points, setPoints] = useState<Map<string, ScreenPoint>>(() => new Map());
  const key = JSON.stringify(ids);
  useEffect(() => {
    if (!v) return;
    const world = new Map((JSON.parse(key) as string[]).map((id) => [id, deviceAnchor(v, id)] as const));
    const viewProj = new v.THREE.Matrix4();
    const hidden = (id: string) => v.hidden(id);
    let raf = 0;
    let last = "";
    const tick = () => {
      const cam = v.view.cctv ? v.cctvCamera : v.camera;
      viewProj.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
      const next = screenPoints(viewProj.elements, world, v.renderer.domElement.getBoundingClientRect(), hidden);
      const k = JSON.stringify([...next]);
      if (k !== last) { last = k; setPoints(next); }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [v, key]);
  return points;
}
