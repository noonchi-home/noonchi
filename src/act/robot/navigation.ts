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
        // Locate the actual crossing on this measured segment, not just either endpoint.
        let lo = a,
          hi = b;
        for (let n = 0; n < 12; n++) {
          const mid: XZ = [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2];
          if (this.map.room(mid) === first.from_room) lo = mid;
          else hi = mid;
        }
        this.crossed = distance(hi, gate.point) <= this.map.doorRadius(gate);
      } else if (this.crossed && room === first.to_room && this.map.room(a) === room) {
        this.lastGate = first.id;
        this.advance();
      }
      this.offPath = !this.crossed && this.path.remaining[0] === first;
    } else if (room !== first.room) {
      this.path = null;
      this.crossed = false;
    } else if (first.kind === "via" && distance(b, [first.position[0], first.position[2]]) < 0.15) {
      this.advance();
    }
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
    if (!this.path) {
      if (map.room(a.position) !== map.room(b.position)) return empty();
      if (this.failed && distance(this.failed, b.position) < 0.12) return empty(true);
      this.path = map.plan(b.position, target, near, exact, hint);
      if (!this.path) {
        this.failed = b.position;
        return empty(true);
      }
      this.failed = null;
      this.path.revision = ++this.revision;
      this.path.pose_gen = this.gen;
    }
    const g = this.path,
      first = g.remaining[0],
      last = g.remaining[g.remaining.length - 1]!;
    const pos: XZ = [last.position[0], last.position[2]];
    const gate = first.kind === "portal" ? map.gate(first.id) : undefined;
    const previousGate = this.lastGate ? map.gate(this.lastGate) : undefined;
    const allowed = [gate, previousGate].filter((g) => g !== undefined);
    const inRoom = first.kind === "portal" ? (this.crossed ? first.to_room : first.from_room) : first.room;
    if (!map.isBearing(first) && !map.clear(b.position, [first.position[0], first.position[2]], inRoom, allowed)) {
      this.path = null;
      return empty();
    }
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
