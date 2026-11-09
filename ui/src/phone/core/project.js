// 초점 고리: AR 공간의 점을 XR 화면 좌표(u, v: 0~1, 왼쪽 위가 0)로 투영한다. DOM·WebGL 없이 계산만 한다.
// projection은 XRView.projectionMatrix, view는 XRView.transform.inverse.matrix(둘 다 열 우선 4×4).
// 카메라 이미지도 같은 투영이라고 보고 프레임에 그릴 때 같은 u, v를 쓴다(실제 폰에서 확인 필요).

function mul(m, v) {
  return [0, 1, 2, 3].map((i) => m[i] * v[0] + m[4 + i] * v[1] + m[8 + i] * v[2] + m[12 + i] * v[3]);
}

export function project(point, projection, view) {
  const c = mul(projection, mul(view, [point[0], point[1], point[2], 1]));
  const behind = c[3] <= 1e-6;
  // 뒤에 있으면 w가 음수라 좌우가 뒤집히므로 |w|로 나눠 방향만 남긴다
  const w = behind ? Math.max(Math.abs(c[3]), 1e-6) : c[3];
  const u = (c[0] / w + 1) / 2;
  const v = (1 - c[1] / w) / 2;
  return { u, v, behind, inside: !behind && u >= 0 && u <= 1 && v >= 0 && v <= 1 };
}

/** 화면 밖 점을 가장자리 안쪽(margin)으로 끌어오고, 그쪽을 가리키는 각도(도, 0 = 오른쪽, 90 = 아래)를 준다. */
export function toEdge({ u, v }, margin = 0.08) {
  let dx = u - 0.5;
  let dy = v - 0.5;
  if (dx === 0 && dy === 0) dy = 0.5;
  const k = (0.5 - margin) / Math.max(Math.abs(dx), Math.abs(dy));
  return { u: 0.5 + dx * k, v: 0.5 + dy * k, angle: (Math.atan2(dy, dx) * 180) / Math.PI };
}

/** 초점 대상들 → 그릴 표시: 화면 안이면 그 자리(off false), 밖이면 가장자리(off true, angle). */
export function focusMarks(targets, projection, view) {
  return targets.map((t) => {
    const p = project(t.ar, projection, view);
    if (p.inside) return { id: t.id, label: t.label, u: p.u, v: p.v, off: false, angle: 0 };
    const e = toEdge(p);
    return { id: t.id, label: t.label, u: e.u, v: e.v, off: true, angle: e.angle };
  });
}
