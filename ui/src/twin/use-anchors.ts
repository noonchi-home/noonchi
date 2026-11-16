import { useEffect, useState } from "react";
import { deviceAnchor } from "./anchors";
import { screenPoints, type ScreenPoint } from "../lib/twin-project";
import { useViewer } from "../lib/twin-viewer";
import { hiddenByFocus } from "./visibility";

export type { ScreenPoint } from "../lib/twin-project";

/**
 * 매 프레임 기기 id들의 덮개 좌표. 방 초점(초점 방만)으로 숨은 다른 방 기기는 visible=false.
 * 천장 보기가 꺼져 숨은 천장 기기는 그대로 자리를 낸다. 바뀐 게 없으면 다시 그리지 않는다.
 */
export function useAnchors(ids: string[]) {
  const v = useViewer();
  const [points, setPoints] = useState<Map<string, ScreenPoint>>(() => new Map());
  const key = JSON.stringify(ids);
  useEffect(() => {
    if (!v) return;
    const world = new Map((JSON.parse(key) as string[]).map((id) => [id, deviceAnchor(v, id)] as const));
    const viewProj = new v.THREE.Matrix4();
    const objects = new Map(v.objects().map((o) => [o.id, o] as const));
    let raf = 0;
    let last = "";
    const tick = () => {
      const view = v.view;
      const hidden = (id: string) => hiddenByFocus(objects.get(id), view, () => v.hidden(id));
      const cam = view.cctv ? v.cctvCamera : v.camera;
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
