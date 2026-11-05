/** 열 우선 4×4 viewProj로 월드 점을 화면 픽셀로. 카메라 뒤이거나 화면 밖(여유 5%)이면 visible=false. */
export function projectPoint(m: ArrayLike<number>, [x, y, z]: [number, number, number], w: number, h: number) {
  const cx = m[0] * x + m[4] * y + m[8] * z + m[12];
  const cy = m[1] * x + m[5] * y + m[9] * z + m[13];
  const cw = m[3] * x + m[7] * y + m[11] * z + m[15];
  if (cw <= 0) return { x: 0, y: 0, visible: false };
  const nx = cx / cw;
  const ny = cy / cw;
  const visible = Math.abs(nx) <= 1.05 && Math.abs(ny) <= 1.05;
  return { x: ((nx + 1) / 2) * w, y: ((1 - ny) / 2) * h, visible };
}

export type Vec3 = [number, number, number];
export type ScreenPoint = { x: number; y: number; visible: boolean };

/**
 * 한 프레임: 기기 id별 월드 앵커 → 덮개 좌표(정수 픽셀). rect는 iframe 안 캔버스 자리다.
 * iframe이 덮개와 같은 자리에 깔리므로 캔버스 위치(뷰어 위 막대 높이 등)만 더하면 된다.
 * 앵커가 없거나 노드가 숨었으면(방 초점 등) visible=false.
 */
export function screenPoints(
  viewProj: ArrayLike<number>,
  world: Map<string, Vec3 | null>,
  rect: { left: number; top: number; width: number; height: number },
  hidden: (id: string) => boolean | null,
): Map<string, ScreenPoint> {
  const out = new Map<string, ScreenPoint>();
  for (const [id, p] of world) {
    if (!p || hidden(id)) { out.set(id, { x: 0, y: 0, visible: false }); continue; }
    const s = projectPoint(viewProj, p, rect.width, rect.height);
    out.set(id, { x: Math.round(rect.left + s.x), y: Math.round(rect.top + s.y), visible: s.visible });
  }
  return out;
}
