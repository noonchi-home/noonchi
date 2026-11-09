// 클로이드의 눈 마커(SSOT 12절): twin-home이 보낸 눈 자세(평면 좌표)를 three.js 위치·보는 방향으로 바꾼다.
// 평면 (x, y)·높이 h → three (x, h, y). yaw 0 = +x, 90 = +y(three +z). pitch는 아래가 음수.
// DOM·three 없이 node --test로 검사한다.

const finite = (v) => typeof v === "number" && Number.isFinite(v);

/** 쓸 수 없는 값이면 null. direction은 길이 1. */
export function eyeTransform(eye) {
  if (!eye || !Array.isArray(eye.position) || eye.position.length < 2) return null;
  const [x, y] = eye.position;
  const { height_m: h, yaw_deg: yaw, pitch_deg: pitch } = eye;
  if (![x, y, h, yaw, pitch].every(finite)) return null;
  const a = (yaw * Math.PI) / 180;
  const b = (pitch * Math.PI) / 180;
  return {
    position: [x, h, y],
    direction: [Math.cos(a) * Math.cos(b), Math.sin(b), Math.sin(a) * Math.cos(b)],
    limited: eye.tracking === "limited",
  };
}
