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
/** from에서 target을 보는 yaw(walkGoal과 같은 규칙)와 숙인 각(도, 아래가 음수, ±89°까지). 수평 1cm 안이거나 수가 아닌 값이면 null. */
export function lookAt(from: ArrayLike<number>, target: ArrayLike<number>): { yaw: number; pitchDeg: number } | null;
/** 위에서 비추기 자세: target에서 from 쪽으로 수평 backM, 높이 target + upM에 서서 target을 내려다보는 자리와 yaw·숙인 각.
 *  from이 target 바로 위면 지금 보는 쪽(yaw)의 반대로 물러난다. 수가 아닌 값이면 null. */
export function aboveGoal(from: ArrayLike<number>, target: ArrayLike<number>, backM: number, upM: number, yaw?: number): { goal: [number, number, number]; yaw: number; pitchDeg: number } | null;
/** 자세가 보는 쪽(−z)의 yaw(yawPitchQuat과 같은 규칙). */
export function yawOf(q: ArrayLike<number>): number;
