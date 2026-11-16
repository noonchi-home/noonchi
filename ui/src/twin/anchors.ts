import type { Vec3 } from "../lib/twin-project";
import type { AptViewer } from "../lib/twin-viewer";

/** 기기 노드 경계 상자의 위쪽 가운데 + 0.08m(말풍선 꼬리가 닿는 곳). 노드가 없거나 비었으면 null. */
export function deviceAnchor(v: AptViewer, id: string): Vec3 | null {
  const node = v.node(id);
  if (!node) return null;
  const box = new v.THREE.Box3().setFromObject(node);
  if (box.isEmpty()) return null;
  const c = box.getCenter(new v.THREE.Vector3());
  return [c.x, box.max.y + 0.08, c.z];
}
