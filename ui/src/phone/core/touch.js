// 벽 대기 기록: '기록'을 누른 뒤 0.5초 동안의 폰 위치(viewer pose)를 모아 평균을 낸다.
// 그동안 추적이 약했거나, 자세가 끊겼거나, 폰이 움직였으면 버리고 다시 누르게 한다.
// 바닥 조준점(hit-test)이 닿은 순간이 있으면 그 평균도 준다(서버가 바닥 높이를 잴 때 쓴다).

const mean = (list) => list[0].map((_, i) => list.reduce((sum, v) => sum + v[i], 0) / list.length);
const round = (v) => Math.round(v * 10000) / 10000;

/** start: 버튼을 누른 시각(ms). 반환값의 result(now)는 sampling | done(point, floor) | failed(reason). */
export function createTouchSampler({ start, windowMs = 500, minSamples = 10, maxGapMs = 150, maxSpreadM = 0.03 }) {
  const samples = [];
  let limited = false;
  return {
    add(time, position, tracking, floor) {
      if (time < start) return;
      if (tracking !== "ok") limited = true;
      samples.push({ time, position, floor });
    },
    result(now) {
      if (now - start < windowMs) return { state: "sampling" };
      if (limited) return { state: "failed", reason: "추적이 약했어요. 밝은 곳에서 벽에 대고 가만히 있다가 다시 눌러 주세요" };
      if (samples.length < minSamples) return { state: "failed", reason: "폰 위치가 충분히 오지 않았어요. 다시 눌러 주세요" };
      const times = [start, ...samples.map((s) => s.time), now];
      for (let i = 1; i < times.length; i++) {
        if (times[i] - times[i - 1] > maxGapMs) return { state: "failed", reason: "폰 위치가 중간에 끊겼어요. 다시 눌러 주세요" };
      }
      const range = [0, 1, 2].map((i) => {
        const vs = samples.map((s) => s.position[i]);
        return Math.max(...vs) - Math.min(...vs);
      });
      if (Math.hypot(...range) > maxSpreadM) return { state: "failed", reason: "기록하는 동안 폰이 움직였어요. 벽에 대고 가만히 있다가 다시 눌러 주세요" };
      const floors = samples.map((s) => s.floor).filter(Boolean);
      return {
        state: "done",
        point: mean(samples.map((s) => s.position)).map(round),
        floor: floors.length ? mean(floors).map(round) : null,
      };
    },
  };
}

/** 바닥 높이를 잴 조준점인지: 위를 보는 수평면(면 법선 y > 0.9)이고 폰보다 0.9m 이상 아래여야 한다.
 *  Hit Test는 벽·탁자도 돌려주므로, 탁자 윗면을 바닥으로 잡지 않게 거른다. 아니면 null. */
export const FLOOR_MIN_DROP_M = 0.9;
export function floorCandidate(position, orientation, viewer) {
  if (!position || !orientation || !viewer) return null;
  const [x, , z] = orientation;
  // 쿼터니언으로 돌린 +Y(면 법선)의 y 성분
  const upY = 1 - 2 * (x * x + z * z);
  if (upY <= 0.9) return null;
  return viewer[1] - position[1] >= FLOOR_MIN_DROP_M ? position : null;
}

// 어림 바닥: hit-test는 ARCore가 면을 찾은 뒤에만 점을 준다(민무늬·반짝이는 바닥, 폰을 덜 움직였을 때는 하나도 없다).
// 그때는 화면 가운데 시선이 어림 바닥 면과 만나는 점을 조준점으로 쓰고 어림이라고 표시한다.
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

/** 조준점: hit-test 점이 있으면 그 점, 없으면 시선과 어림 바닥이 만나는 점(estimated, 면은 위를 본다). 둘 다 없으면 null. */
export function aimPoint({ hit, hitOrientation, viewer, viewerOrientation, localFloorY }) {
  if (hit) return { point: hit, orientation: hitOrientation, estimated: false };
  if (!viewer || !viewerOrientation) return null;
  const point = floorRayPoint(viewer, viewerOrientation, floorPlaneY(viewer[1], localFloorY));
  return point ? { point, orientation: [0, 0, 0, 1], estimated: true } : null;
}
