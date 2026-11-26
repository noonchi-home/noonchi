// 맞춘 눈 표시(원뿔)를 그릴 자리 보정(그리는 자리만, 눈 자세 값은 그대로): 평면 점을 방 안·벽에서 떨어진 자리로 옮기고(stand),
// 두 자리 사이는 계획 선·폰 안내와 같은 이동 가능 점 격자 길로 잇는다(path, src/layout/walk-grid.ts gridRoute). 0.6m 안 한 방 안 움직임은 곧은 선이다. 격자가 없는 곳(욕실 등)은 길이 없다.
import type { Plan2 } from "../../../../src/contract/events.ts";
import type { SceneJson } from "../../../../src/contract/layout.ts";
import { WALK_STEP, floorPlanFrom, furnitureBodies, gridRoute, roomAt, walkGrid, walkingGeometry } from "../../../../src/layout/browser.ts";

export interface WalkGuide {
  /** 그릴 자리: 방 안이고 벽에서 벽 반 두께 + 표시 반지름만큼 떨어진 가장 가까운 자리. 방이 없는 장면이면 그대로. */
  stand(p: Plan2): Plan2;
  /** from에서 to까지 길: 0.6m 안이고 선 위가 모두 한 방 안이면 곧은 선(가구 여유 안 자리에서 조금 움직여도 격자 점까지 나갔다 오지 않는다),
   *  아니면 격자 길(0.6m 안은 곧은 선, 그보다 멀면 x·z 축과 나란하게 꺾인다). 못 찾으면 null. */
  path(from: Plan2, to: Plan2): Plan2[] | null;
}

interface Wall { a?: Plan2; b?: Plan2; thickness?: number }
interface WalkScene { plan?: { walls?: Wall[] } }

/** 배치가 바뀌면 다시 받은 장면으로 격자를 새로 만드는 걷기 길. */
export interface LiveWalkGuide extends WalkGuide {
  /** 배치가 바뀌었다: RELOAD_MS 동안 모은 뒤 장면을 한 번 다시 받아 격자를 새로 만든다(나중에 받은 것이 이긴다). 다 만들면 풀린다. */
  reload(): Promise<void>;
}

/** 배치 메시지를 모으는 시간(ms): 접속 때 맞추기 메시지가 여럿 와도 장면은 한 번 받는다. */
const RELOAD_MS = 150;

/** walkGuide와 같고, reload로 서버 장면(load, /api/scene: 고친 배치)을 다시 받아 서버 계획 선과 같은 격자를 쓴다. */
export function liveWalkGuide(scene: unknown, reach: number, load: () => Promise<unknown>): LiveWalkGuide {
  let inner = walkGuide(scene, reach);
  let waiting: Promise<void> | null = null;
  let latest = 0;
  return {
    stand: (p) => inner.stand(p),
    path: (from, to) => inner.path(from, to),
    reload() {
      waiting ??= new Promise<void>((done) => {
        setTimeout(() => {
          waiting = null;
          const mine = ++latest;
          load().then((next) => { if (mine === latest) inner = walkGuide(next, reach); }, (e: unknown) => console.warn("[twin3d] 장면을 다시 받지 못했어요", e)).finally(done);
        }, RELOAD_MS);
      });
      return waiting;
    },
  };
}

/** 벽 선 위 점을 방 안으로 들이는 거리(m). */
const NUDGE = 0.01;
/** 이만큼 안이면 벽 선 위로 본다(m). */
const ON_LINE = 1e-6;
/** 이보다 가까운 두 자리는 곧은 선으로 잇는다(m, 격자 자리 붙이기 거리와 같다). */
const STRAIGHT_M = 0.6;
/** 곧은 선이 한 방 안인지 볼 간격(m). */
const SAMPLE_M = 0.05;

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
  const inRoom = (p: Plan2) => roomAt(fp, p) !== null;
  // 계획 선·폰 안내와 같은 격자(/api/scene은 고친 배치를 주고 바닥 물건에 카탈로그 footprint가 실려 서버와 같은 격자가 된다. 배치가 바뀌면 liveWalkGuide가 다시 받는다)
  const geometry = fp.rooms.length ? walkingGeometry(scene as SceneJson) : null;
  const grid = geometry ? walkGrid(geometry, WALK_STEP, furnitureBodies(scene as SceneJson)) : null;

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
      if (!geometry || !grid) return null;
      const near = dist(from, to) <= STRAIGHT_M;
      if (near) {
        const room = roomAt(fp, from);
        const n = Math.max(1, Math.ceil(dist(from, to) / SAMPLE_M));
        if (room && Array.from({ length: n + 1 }, (_, k) => roomAt(fp, [from[0] + ((to[0] - from[0]) * k) / n, from[1] + ((to[1] - from[1]) * k) / n])).every((r) => r === room)) return [from, to];
      }
      return gridRoute(grid, geometry, from, to, { square: !near });
    },
  };
}
