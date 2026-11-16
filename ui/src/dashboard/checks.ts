// 트윈 위 확인 목록 고르기(순수 함수, 시안 A 그대로). 지도 말풍선은 최근에 확인한 것만, 화면에서 겹치면 최신 것만 띄운다.
// 지도 표시는 상자 가장자리에 걸리면 흐리게 지운다.
import type { Check } from "./checks/checks";
import type { ScreenPoint } from "../twin";

export const thingId = (c: Check) => c.deviceId ?? c.objectId ?? "";

/** 확인 시각이 가장 늦은 groups개 무리. 최신 것이 먼저, 같은 때면 확인한 차례대로. */
export function recentChecks(checks: Check[], groups = 2): Check[] {
  const ats = [...new Set(checks.map((c) => c.at))].sort((a, b) => b - a).slice(0, groups);
  return checks.filter((c) => ats.includes(c.at)).sort((a, b) => b.at - a.at || a.order - b.order);
}

/** 확인 목록 전체를 최신 것부터. */
export const newestFirst = (checks: Check[]) => [...checks].sort((a, b) => b.at - a.at || a.order - b.order);

/** 겹치는 말풍선 빼기: 앞(최신)부터 두고, 이미 둔 것과 꼬리 끝이 가로 dx·세로 dy 안이면 뺀다. 자리가 없는 것도 뺀다. */
export function spread(checks: Check[], points: Map<string, ScreenPoint>, dx = 112, dy = 46): Check[] {
  const kept: { c: Check; p: ScreenPoint }[] = [];
  for (const c of checks) {
    const p = points.get(thingId(c));
    if (!p?.visible) continue;
    if (kept.some(({ p: q }) => Math.abs(q.x - p.x) < dx && Math.abs(q.y - p.y) < dy)) continue;
    kept.push({ c, p });
  }
  return kept.map((k) => k.c);
}

/** 큰 말풍선이 꼬리 끝 위로 차지하는 자리(px, 대략). */
export const BUBBLE_BOX = { w: 168, h: 72 };

/** 지도 표시(반지름 r px)의 진하기: 원이 상자 가장자리에 걸리면 0, 가장자리에서 band px 넘게 안쪽이면 1, 그 사이는 차츰. */
export function edgeFade(p: { x: number; y: number }, size: { width: number; height: number }, r: number, band = 16): number {
  const room = Math.min(p.x, p.y, size.width - p.x, size.height - p.y) - r;
  return Math.min(1, Math.max(0, room / band));
}
