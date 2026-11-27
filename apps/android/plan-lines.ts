import type { SceneJson, Vec2 } from "../../src/contract/layout";

export type Segment = [Vec2, Vec2];
export type PlanFrame = { left: number; top: number; spanX: number; spanY: number };

export function segments(points: Vec2[], closed = false): Segment[] {
  return points.slice(1).map((point, index) => [points[index], point] as Segment)
    .concat(closed && points.length > 2 ? [[points[points.length - 1], points[0]]] : []);
}

/** 도면에 그릴 선: 방 외곽선, 끝점이 있는 벽, 끝점 없이 polygon만 있는 고체(샤프트·기둥)의 닫힌 외곽선. */
export function planLines(scene?: SceneJson): Segment[] {
  const rooms = scene?.plan.rooms ?? [];
  const walls = scene?.plan.walls ?? [];
  return rooms.flatMap(room => segments(room.polygon ?? [], true))
    .concat(walls.flatMap((wall): Segment[] => wall.a && wall.b ? [[wall.a, wall.b]] : segments(wall.polygon ?? [], true)));
}

/** 폰 카메라의 가로 시야각(도). 영상 AR의 세로 시야각 40°(ui/src/phone/core/video-ar.js CAMERA.fovDeg)를 가로 16:9 화면으로 바꾼 값. */
export const VIEW_FOV_DEG = 66;

/** 서 있는 자리 at에서 yawDeg(도면 x축에서 잰 각도) 쪽으로 fovDeg만큼 벌어진 부채꼴. 첫 점이 at이고 나머지는 반지름 length의 호 위 점이다. */
export function viewCone(at: Vec2, yawDeg: number, fovDeg = VIEW_FOV_DEG, length = 1.5, steps = 12): Vec2[] {
  const arc = Array.from({ length: steps + 1 }, (_, index): Vec2 => {
    const radians = (yawDeg - fovDeg / 2 + fovDeg * index / steps) * Math.PI / 180;
    return [at[0] + Math.cos(radians) * length, at[1] + Math.sin(radians) * length];
  });
  return [at, ...arc];
}

/** 선들을 모두 담는 범위. 선이 없으면 null. */
export function planFrame(lines: Segment[]): PlanFrame | null {
  const points = lines.flat();
  if (!points.length) return null;
  const xs = points.map(([x]) => x);
  const ys = points.map(([, y]) => y);
  const left = Math.min(...xs);
  const top = Math.min(...ys);
  return { left, top, spanX: Math.max(1, Math.max(...xs) - left), spanY: Math.max(1, Math.max(...ys) - top) };
}
