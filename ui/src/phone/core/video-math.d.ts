// video-math.js의 형.
export type Quat = [number, number, number, number];
export function projectionFromFov(vfovDeg: number, aspect: number): number[];
export function pitchQuat(pitchDeg: number): Quat;
export function viewMatrix(position: ArrayLike<number>, orientation: ArrayLike<number>): number[];
export function coverMap(frameW: number, frameH: number, screenW: number, screenH: number): (u: number, v: number) => [number, number];
/** 숙인 자세(pitch, 도)를 AR +y축으로 yaw(라디안)만큼 돌린 자세. yaw 0이면 −z를 본다. */
export function yawPitchQuat(yawRad: number, pitchDeg: number): Quat;
/** from에서 target 쪽으로 바닥 평면을 걸어 target stopM 앞에서 멈출 자리(높이는 from 그대로)와 target을 보는 yaw. 이미 그 안이면 null. */
export function walkGoal(from: ArrayLike<number>, target: ArrayLike<number>, stopM: number): { goal: [number, number, number]; yaw: number } | null;
