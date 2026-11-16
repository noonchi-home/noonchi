// 맞춘 눈 표시(원뿔)를 그릴 자리 보정(그리는 자리만, 눈 자세 값은 그대로): 평면 점을 방 안·벽에서 떨어진 자리로 옮기고(stand),
// 두 자리 사이는 서버 경로 찾기(src/layout/route.ts)와 같은 방 다각형·문·트인 경계로 잇는다(path). 사람이 든 폰이라 모든 방을 지날 수 있다.
import type { Plan2 } from "../../../src/contract/events.ts";
import { floorPlanFrom, roomAt, route } from "../../../src/layout/browser.ts";

export interface WalkGuide {
  /** 그릴 자리: 방 안이고 벽에서 벽 반 두께 + 표시 반지름만큼 떨어진 가장 가까운 자리. 방이 없는 장면이면 그대로. */
  stand(p: Plan2): Plan2;
  /** from에서 to까지 바닥 길(문·트인 경계를 지난다). 못 찾으면 null. */
  path(from: Plan2, to: Plan2): Plan2[] | null;
}

interface Wall { a?: Plan2; b?: Plan2; thickness?: number }
interface WalkScene { plan?: { walls?: Wall[] } }

/** 벽 선 위 점을 방 안으로 들이는 거리(m). */
const NUDGE = 0.01;
/** 이만큼 안이면 벽 선 위로 본다(m). */
const ON_LINE = 1e-6;
/** 문·트인 경계를 건널 때 테두리에서 표시 반지름에 더 떨어지는 거리(m, 안벽 반 두께). */
const GATE_KEEP = 0.06;

/** 선분 ab에서 p와 가장 가까운 점. */
function closest(p: Plan2, a: Plan2, b: Plan2): Plan2 {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  const t = len2 > 0 ? Math.min(1, Math.max(0, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2)) : 0;
  return [a[0] + dx * t, a[1] + dy * t];
}
const push = (c: Plan2, n: Plan2, m: number): Plan2 => [c[0] + n[0] * m, c[1] + n[1] * m];
/** 선분 ab 위 점 c에서 선분 양옆으로 m만큼 떨어진 두 점. */
function sides(c: Plan2, a: Plan2, b: Plan2, m: number): Plan2[] {
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  if (len <= 0) return [];
  const n: Plan2 = [-(b[1] - a[1]) / len, (b[0] - a[0]) / len];
  return [push(c, n, m), push(c, n, -m)];
}
const dist = (a: Plan2, b: Plan2) => Math.hypot(a[0] - b[0], a[1] - b[1]);

/** reach: 그리는 표시가 벽에서 떨어질 반지름(m). 원뿔은 꼭짓점 공 반지름(eye.ts CONE.apex)을 준다. */
export function walkGuide(scene: unknown, reach: number): WalkGuide {
  const fp = floorPlanFrom(scene);
  const plan = (scene as WalkScene).plan ?? {};
  const walls = (plan.walls ?? []).flatMap((w) => (w.a && w.b ? [{ a: w.a, b: w.b, keep: (w.thickness ?? 0) / 2 + reach }] : []));
  const open = { ...fp, robot: { ...fp.robot, reachable: fp.rooms.map((r) => r.id) } };
  const inRoom = (p: Plan2) => roomAt(fp, p) !== null;

  /** 점이 놓인 방 테두리 변(문·트인 경계 점). 없으면 null. */
  const edgeAt = (p: Plan2): [Plan2, Plan2] | null => {
    for (const r of fp.rooms) {
      for (let i = 0; i < r.polygon.length; i++) {
        const a = r.polygon[i]!, b = r.polygon[(i + 1) % r.polygon.length]!;
        if (dist(a, b) > 0 && dist(p, closest(p, a, b)) < NUDGE) return [a, b];
      }
    }
    return null;
  };

  /** 방 밖 점에서 가장 가까운 방 안 자리(방 테두리에서 안쪽으로 NUDGE). */
  const inside = (p: Plan2): Plan2 | null => {
    let best: { d: number; at: Plan2 } | null = null;
    for (const r of fp.rooms) {
      for (let i = 0; i < r.polygon.length; i++) {
        const a = r.polygon[i]!, b = r.polygon[(i + 1) % r.polygon.length]!;
        const c = closest(p, a, b);
        const d = dist(p, c);
        if (best && d >= best.d) continue;
        const len = dist(a, b);
        if (len <= 0) continue;
        const n: Plan2 = [(-(b[1] - a[1]) / len) * NUDGE, ((b[0] - a[0]) / len) * NUDGE];
        const at = ([[c[0] + n[0], c[1] + n[1]], [c[0] - n[0], c[1] - n[1]]] as Plan2[]).find((q) => roomAt(fp, q) === r.id);
        if (at) best = { d, at };
      }
    }
    return best?.at ?? null;
  };

  return {
    stand(p) {
      if (!fp.rooms.length || !p.every(Number.isFinite)) return p;
      const start = inRoom(p) ? p : inside(p);
      if (!start) return p;
      let q: Plan2 = [start[0], start[1]];
      for (let pass = 0; pass < 4; pass++) {
        let moved = false;
        for (const w of walls) {
          const c = closest(q, w.a, w.b);
          const d = dist(q, c);
          if (d >= w.keep - 1e-9) continue;
          const to = d > ON_LINE ? [push(c, [(q[0] - c[0]) / d, (q[1] - c[1]) / d], w.keep)] : sides(c, w.a, w.b, w.keep);
          const next = to.find(inRoom);
          if (!next) continue;
          q = next;
          moved = true;
        }
        if (!moved) break;
      }
      return inRoom(q) ? q : start;
    },
    path(from, to) {
      const way = route(open, from, to);
      if (!way) return null;
      // 문·트인 경계 점은 방 테두리 위다: 그 앞뒤로 테두리에서 떨어진 점을 두어 테두리(벽 선)를 따라가지 않고 곧게 건넌다
      const out: Plan2[] = [way[0]!];
      for (const gate of way.slice(1, -1)) {
        const edge = edgeAt(gate);
        if (!edge) { out.push(gate); continue; }
        const from2 = roomAt(fp, out[out.length - 1]!);
        const [near, far] = sides(gate, edge[0], edge[1], GATE_KEEP + reach);
        const first = roomAt(fp, near!) === from2 ? [near!, far!] : [far!, near!];
        out.push(first[0]!, gate, first[1]!);
      }
      out.push(way[way.length - 1]!);
      return out;
    },
  };
}
