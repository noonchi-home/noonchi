// video-math.js의 형.
export type Quat = [number, number, number, number];
export function projectionFromFov(vfovDeg: number, aspect: number): number[];
export function pitchQuat(pitchDeg: number): Quat;
export function viewMatrix(position: ArrayLike<number>, orientation: ArrayLike<number>): number[];
export function coverMap(frameW: number, frameH: number, screenW: number, screenH: number): (u: number, v: number) => [number, number];
