// 영상 입력 모드의 계산(DOM 없음): 고정 카메라의 투영·자세·view 행렬과 화면 덮기(object-fit cover) 자리 바꾸기.
// 행렬은 XRView와 같이 열 우선 4×4다. 카메라는 -Z를 보고 Y가 위다(WebXR과 같다).

const NEAR = 0.1;
const FAR = 100;

/** 세로 시야각(도)과 비율(가로/세로) → 원근 투영 행렬(16개, 열 우선, near 0.1, far 100). */
export function projectionFromFov(vfovDeg, aspect) {
  const f = 1 / Math.tan((vfovDeg * Math.PI) / 360);
  const nf = 1 / (NEAR - FAR);
  return [f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (FAR + NEAR) * nf, -1, 0, 0, 2 * FAR * NEAR * nf, 0];
}

/** 위아래로 숙인 자세(x축 회전). 음수면 아래를 본다. [x, y, z, w]. */
export function pitchQuat(pitchDeg) {
  const h = (pitchDeg * Math.PI) / 360;
  return [Math.sin(h), 0, 0, Math.cos(h)];
}

/** 카메라 자리·자세 → view 행렬(세계 → 카메라, XRView.transform.inverse.matrix와 같은 뜻). */
export function viewMatrix(position, orientation) {
  const [x, y, z, w] = orientation;
  // 회전 행렬 R(행 우선 r[행][열])
  const r = [
    [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
    [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
    [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)],
  ];
  const m = new Array(16).fill(0);
  // 역행렬 = [Rᵀ | -Rᵀp]. 열 우선이라 m[열*4+행]
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) m[j * 4 + i] = r[j][i];
    m[12 + i] = -(r[0][i] * position[0] + r[1][i] * position[1] + r[2][i] * position[2]);
  }
  m[15] = 1;
  return m;
}

/** 영상 프레임 자리(u, v: 0~1, 왼쪽 위 0) → 화면 자리. 영상이 화면을 덮도록(cover) 가운데 맞춰 키우고 넘치는 쪽은 잘린다. */
export function coverMap(frameW, frameH, screenW, screenH) {
  const scale = Math.max(screenW / frameW, screenH / frameH);
  const sx = (frameW * scale) / screenW;
  const sy = (frameH * scale) / screenH;
  return (u, v) => [0.5 + (u - 0.5) * sx, 0.5 + (v - 0.5) * sy];
}
