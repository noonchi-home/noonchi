// 화면 가운데 조준점: hit-test 점이 있으면 그 점, 없으면 시선이 어림 바닥과 만나는 점이다.
// hit-test는 ARCore가 면을 찾은 뒤에만 점을 준다(민무늬·반짝이는 바닥, 폰을 덜 움직였을 때는 하나도 없다).
// 조준점은 「물건 자리 맞추기」(「여기」 말하기)와 서버 위치 맞추기(실제 hit 점의 면 법선, 어림 바닥 높이)가 쓴다.

/** local-floor 바닥은 폰보다 이만큼 아래부터 믿는다(탁자 윗면을 바닥으로 잡지 않게). */
export const FLOOR_MIN_DROP_M = 0.9;
/** 어림 바닥: 폰을 든 높이. 서버 PHONE_EYE_HEIGHT_M 기본값과 같다. */
export const HOLD_HEIGHT_M = 1.5;
/** local-floor 바닥은 폰보다 이만큼 아래까지만 믿는다(더 멀면 폰 높이로 어림). */
export const FLOOR_MAX_DROP_M = 2.5;
/** 어림 조준점은 폰에서 이 거리(시선 길이) 안만 쓴다. */
export const AIM_MAX_M = 6;

/** 시선(폰 -z)이 높이 floorY 수평면과 만나는 점. 수평·위를 보거나, 면이 폰보다 위거나, maxM보다 멀면 null. */
export function floorRayPoint(viewer, orientation, floorY, maxM = AIM_MAX_M) {
  const [x, y, z, w] = orientation;
  // 쿼터니언으로 돌린 -Z(시선 방향, 길이 1)
  const dir = [-2 * (x * z + w * y), 2 * (w * x - y * z), -(1 - 2 * (x * x + y * y))];
  const drop = viewer[1] - floorY;
  if (dir[1] >= 0 || drop <= 0) return null;
  const t = drop / -dir[1];
  if (t > maxM) return null;
  return [viewer[0] + t * dir[0], floorY, viewer[2] + t * dir[2]];
}

/** 어림 바닥 높이: local-floor 바닥이 폰보다 0.9m~2.5m 아래면 그 높이, 없거나 벗어나면 폰보다 1.5m 아래. */
export function floorPlaneY(viewerY, localFloorY) {
  const drop = localFloorY === null || localFloorY === undefined ? null : viewerY - localFloorY;
  return drop !== null && drop >= FLOOR_MIN_DROP_M && drop <= FLOOR_MAX_DROP_M ? localFloorY : viewerY - HOLD_HEIGHT_M;
}

/** hit 자세 쿼터니언의 +Y(면 법선, 길이 1). 서버 위치 맞추기가 벽 점(법선 수평)·바닥 점(법선 위)을 가른다. */
export function planeNormal(orientation) {
  const [x, y, z, w] = orientation;
  const r = (v) => Math.round(v * 10000) / 10000 + 0;
  return [r(2 * (x * y - w * z)), r(1 - 2 * (x * x + z * z)), r(2 * (y * z + w * x))];
}

/** 조준점: hit-test 점이 있으면 그 점, 없으면 시선과 어림 바닥이 만나는 점(estimated, 면은 위를 본다). 둘 다 없으면 null. */
export function aimPoint({ hit, hitOrientation, viewer, viewerOrientation, localFloorY }) {
  if (hit) return { point: hit, orientation: hitOrientation, estimated: false };
  if (!viewer || !viewerOrientation) return null;
  const point = floorRayPoint(viewer, viewerOrientation, floorPlaneY(viewer[1], localFloorY));
  return point ? { point, orientation: [0, 0, 0, 1], estimated: true } : null;
}
