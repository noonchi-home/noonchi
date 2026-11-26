import type { NavigationPose, TwinWalkGuide } from "../../contract/phone.js";
import type { XZ } from "../../contract/plan.js";
import type { WalkingMap } from "../../layout/index.js";
import { EYE_MS } from "./phone-line.js";

const distance = (a: XZ, b: XZ) => Math.hypot(a[0] - b[0], a[1] - b[1]);
type Fix = NavigationPose & { position: XZ };
const empty = (blocked = false) => ({
  blocked,
  guide: null,
  distance: null,
  arrived: false,
  within: (_m: number) => false,
});
export class Navigation {
  private last: Fix | null = null;
  private prev: Fix | null = null;
  private stamp = -Infinity;
  private gen = -1;
  private path: TwinWalkGuide | null = null;
  private map: WalkingMap | null = null;
  private key = "";
  private revision = 0;
  private crossed = false;
  private offPath = false;
  private failed: XZ | null = null;
  private lastGate: string | null = null;
  missing(at: number) {
    this.pose({ observed_ms: at, pose_gen: this.gen, quality: "unavailable", position: null });
  }
  pose(p: NavigationPose) {
    if (p.pose_gen < this.gen || (p.pose_gen === this.gen && p.observed_ms <= this.stamp)) return;
    const continuity = p.pose_gen === this.gen && p.observed_ms - this.stamp <= EYE_MS;
    this.gen = p.pose_gen;
    this.stamp = p.observed_ms;
    this.prev = continuity ? this.last : null;
    this.last = p.quality === "usable" && p.position ? { ...p, position: p.position } : null;
    if (
      !this.prev ||
      !this.last ||
      distance(this.prev.position, this.last.position) >
        Math.min(1, 0.12 + (2 * (p.observed_ms - this.prev.observed_ms)) / 1000)
    ) {
      this.prev = null;
      this.failed = null;
      this.lastGate = null;
      this.path = null;
      this.crossed = false;
      this.offPath = false;
      return;
    }
    if (!this.map || !this.path) return;
    const first = this.path.remaining[0];
    const a = this.prev.position,
      b = this.last.position,
      room = this.map.room(b);
    if (first.kind === "portal") {
      if (room === first.from_room) {
        this.crossed = false;
        this.offPath = false;
        return;
      }
      const gate = this.map.gate(first.id);
      if (gate && room === first.to_room && this.map.room(a) === first.from_room) {
        this.crossed = this.throughOpening(this.map, a, b, first.from_room, gate);
      } else if (this.crossed && room === first.to_room && this.map.room(a) === room) {
        this.lastGate = first.id;
        this.advance();
      }
      this.offPath = !this.crossed && this.path.remaining[0] === first;
    } else if (room !== first.room) {
      // 경유점으로 가다가 방이 바뀌었다(격자 안내는 문 앞에 경유점이 있다): 남은 길의 첫 문을 그 문 개구부로 건넜으면 그 문 뒤 길로 넘기고,
      // 문에서 먼 곳(벽)으로 건넜으면 길을 벗어난 것으로 본다. 그 밖(길에 없는 방으로 감)은 길을 버리고 다시 짠다.
      // 벽으로 건너 길을 벗어난 채면 경유점 방으로 돌아올 때까지 길을 둔다(문이 첫 점일 때 from_room으로 돌아오면 푸는 것과 같다)
      if (this.offPath) return;
      const at = this.path.remaining.findIndex((p) => p.kind === "portal");
      const portal = at >= 0 ? this.path.remaining[at] : undefined;
      const gate = portal?.kind === "portal" ? this.map.gate(portal.id) : undefined;
      if (portal?.kind === "portal" && gate && room === portal.to_room && this.map.room(a) === portal.from_room &&
        this.path.remaining.slice(0, at).every((p) => p.kind === "via" && p.room === portal.from_room)) {
        if (this.throughOpening(this.map, a, b, portal.from_room, gate)) {
          this.path = { ...this.path, remaining: this.path.remaining.slice(at) as TwinWalkGuide["remaining"], revision: ++this.revision };
          this.crossed = true;
        } else this.offPath = true;
      } else {
        this.path = null;
        this.crossed = false;
      }
    } else if (first.kind === "via") {
      this.offPath = false;
      // 경유점 0.15m 안에 왔거나, 경유점보다 다음 점에 더 가까이 와 있으면(격자 꺾인 점을 조금 질러 감) 다음 점이 곧게 보일 때 넘긴다
      const next = this.path.remaining[1];
      const via: XZ = [first.position[0], first.position[2]];
      const ahead = next ? ([next.position[0], next.position[2]] as XZ) : null;
      const passed = ahead !== null && distance(b, ahead) < distance(via, ahead);
      // 질러 가서 넘길 때는 다음 점이 bearing(벽만 보는 길의 점)이어도 곧은 선이 벽을 지나지 않는지 본다(경유점은 벽 모서리를 돌려고 둔 점이다)
      if (next && ((distance(b, via) < 0.15 && this.clearTo(this.map, b, next, first.room)) || (passed && this.clearTo(this.map, b, next, first.room, true))))
        this.advance();
    }
  }
  /** a→b가 from 방을 나간 점(이 측정 구간 위에서 이분법으로 찾음)이 그 문의 실제 개구부 안인가: 문 점에서 개구부 절반 폭 안.
   *  걷기 여유 0.18m를 뺀 문 반경(doorRadius)이 아니라 개구부 절반 폭으로 본다: 개구부 가장자리 쪽으로 지난 걸음도 문으로 지난 것이다. */
  private throughOpening(map: WalkingMap, a: XZ, b: XZ, from: string, gate: NonNullable<ReturnType<WalkingMap["gate"]>>) {
    let lo = a,
      hi = b;
    for (let n = 0; n < 12; n++) {
      const mid: XZ = [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2];
      if (map.room(mid) === from) lo = mid;
      else hi = mid;
    }
    return distance(hi, gate.point) <= map.openingHalf(gate);
  }
  /** walls: bearing이어도 곧은 선이 벽·방 밖을 지나지 않는지 본다(bearing은 가구를 지날 수 있어 가구는 보지 않는다). 아니면 bearing은 늘 통과. */
  private clearTo(map: WalkingMap, from: XZ, point: TwinWalkGuide["remaining"][number], room: string, walls = false) {
    const bearing = map.isBearing(point);
    if (bearing && !walls) return true;
    const gate = point.kind === "portal" ? map.gate(point.id) : undefined;
    const previous = this.lastGate ? map.gate(this.lastGate) : undefined;
    return map.clear(from, [point.position[0], point.position[2]], room, [gate, previous].filter(g => g !== undefined), !bearing);
  }
  private advance() {
    if (this.path && this.path.remaining.length > 1) {
      const [, next, ...rest] = this.path.remaining;
      this.path = { ...this.path, remaining: [next!, ...rest], revision: ++this.revision };
    }
    this.crossed = false;
    this.offPath = false;
  }
  read(id: string, map: WalkingMap | null, target: XZ, near: number, exact: boolean, now: number, hint?: XZ[]) {
    const key = JSON.stringify([id, target, near, exact]);
    if (this.map !== map || this.key !== key) {
      this.map = map;
      this.key = key;
      this.failed = null;
      this.lastGate = null;
      this.path = null;
      this.crossed = false;
      this.offPath = false;
    }
    const a = this.prev,
      b = this.last;
    if (
      !map ||
      !a ||
      !b ||
      a.observed_ms > now ||
      b.observed_ms > now ||
      now - a.observed_ms > EYE_MS ||
      Math.max(a.error_m ?? 0, b.error_m ?? 0) >= near / 2 ||
      this.offPath
    )
      return empty();
    // 남은 길의 다음 점이 지금 자리에서 곧게 갈 수 없으면(넓은 열린 문을 문 점에서 떨어져 지난 때 등) 이 읽기에서 바로 새로 짠다. 새로 짠 길도 막히면 빈 읽기.
    for (let fresh = false; ; ) {
      if (!this.path) {
        if (fresh || map.room(a.position) !== map.room(b.position)) return empty();
        if (this.failed && distance(this.failed, b.position) < 0.12) return empty(true);
        fresh = true;
        this.path = map.plan(b.position, target, near, exact, hint);
        if (!this.path) {
          this.failed = b.position;
          return empty(true);
        }
        this.failed = null;
        this.path.revision = ++this.revision;
        this.path.pose_gen = this.gen;
      }
      const first = this.path.remaining[0];
      const inRoom = first.kind === "portal" ? (this.crossed ? first.to_room : first.from_room) : first.room;
      if (this.clearTo(map, b.position, first, inRoom)) break;
      this.path = null;
      this.crossed = false;
    }
    const g = this.path,
      first = g.remaining[0],
      last = g.remaining[g.remaining.length - 1]!;
    const pos: XZ = [last.position[0], last.position[2]];
    const within = (m: number) =>
      first.kind === "stand" &&
      [a, b].every(
        (f) =>
          map.room(f.position) === first.room &&
          distance(f.position, pos) + (f.error_m ?? 0) <= Math.min(m, near) &&
          map.clear(f.position, pos, first.room)
      );
    return { blocked: false, guide: g, distance: distance(b.position, pos), arrived: within(near), within };
  }
}
