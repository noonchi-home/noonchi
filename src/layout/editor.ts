// 배치 편집기(docs/plan.md "배치 보정"): twin-studio scene.json 위에 실행 중 보정(옮기기·더하기·빼기)을 얹는다.
// 원본 파일은 바꾸지 않는다. 바뀐 것은 layout 메시지(계약 C)로 뷰어에 보내고, 저장하면 edits.json(계약 B)으로 쓴다.
// 평면도 좌표: x 오른쪽(동), y 아래쪽(남), facing_deg 0 = +x, 90 = +y. three.js 회전 y = -(facing_deg - 90)°.

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { josa } from "../shared/korean.js";
import { detectRooms } from "./rooms.js";
import { compact, stripParticle } from "../shared/korean.js";
import type { TypeInfo } from "./catalog.js";

// 장면·배치 메시지 타입은 계약(src/contract/layout.ts)에 있다. 다른 파일이 이 파일에서 가져가던 이름을 그대로 내보낸다.
import type { LayoutMessage, SceneJson, SceneObject, SceneRoom, SceneWall, Vec2, Vec3 } from "../contract/layout.js";
export type { LayoutMessage, SceneJson, SceneObject, ScenePlace, SceneRoom, SceneWall, Vec2, Vec3 } from "../contract/layout.js";

/** "여기": 폰 조준점의 평면도 점과(있으면) 그때 폰 위치. 모르면 이유. */
export type HerePoint = { position: Vec2; from?: Vec2 } | { error: string };
export type HereResolver = () => HerePoint;
export type To = { x: number; y: number } | { dx: number; dy: number } | "here";

export type Edit =
  | { op: "move"; id: string; position: Vec2; facing_deg: number; room: string | null }
  | { op: "add"; id: string; type: string; label: string; room: string | null; position: Vec2; facing_deg: number; elevation?: number }
  | { op: "remove"; id: string };

export interface EditResult {
  object: SceneObject;
  /** 같이 바뀐 물건 id(받침과 위 물건) */
  changed: string[];
  message: string;
}

export interface LayoutStatus {
  home: string;
  edits: number;
  dirty: boolean;
  savePath: string;
  savedAt: string | null;
}

export interface LayoutEditorOptions {
  homeId: string;
  scene: SceneJson;
  catalog: Map<string, TypeInfo>;
  /** 저장 파일(runtime/homes/<id>/edits.json) */
  savePath: string;
  /** 집 산출물 폴더(assets/가 있으면 새 물건의 GLB로 쓴다) */
  outDir?: string;
  /** 라이브러리 폴더(/twin/lib/) */
  libraryDir?: string;
  here?: HereResolver;
  /** 구운 장면에 없는 기본 물건(시연용으로 더한 가전, src/layout/scene.ts added). 연결 때 지금 자리로 add를 보낸다. */
  unbaked?: readonly string[];
}

export class LayoutError extends Error {}

const WALL_HEIGHT = 1.2;
const AC_WALL_HEIGHT = 1.95;
const EDGE_TOL = 0.05;
const STOPWORDS = new Set(["좀", "거", "것", "방", "집", "우리", "있는", "그", "저", "이"]);

const clean = (v: number, digits = 3) => Math.round(v * 10 ** digits) / 10 ** digits + 0;
const normDeg = (d: number) => clean(((d % 360) + 360) % 360, 1) % 360;
const yawOf = (facing: number) => clean((-(facing - 90) * Math.PI) / 180, 6);
const clone = <T>(v: T): T => structuredClone(v);

function rotate([x, y]: Vec2, deg: number): Vec2 {
  const r = (deg * Math.PI) / 180;
  return [x * Math.cos(r) - y * Math.sin(r), x * Math.sin(r) + y * Math.cos(r)];
}

function inside(p: Vec2, poly: Vec2[]): boolean {
  let hit = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i]!;
    const [xj, yj] = poly[j]!;
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}

function nearestOnSegment(p: Vec2, a: Vec2, b: Vec2): { q: Vec2; d: number } {
  const ab: Vec2 = [b[0] - a[0], b[1] - a[1]];
  const len2 = ab[0] ** 2 + ab[1] ** 2;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * ab[0] + (p[1] - a[1]) * ab[1]) / len2));
  const q: Vec2 = [a[0] + t * ab[0], a[1] + t * ab[1]];
  return { q, d: Math.hypot(p[0] - q[0], p[1] - q[1]) };
}

function asObject(raw: unknown): SceneObject | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const o = raw as SceneObject;
  if (typeof o.id !== "string" || !o.plan || !Array.isArray(o.position)) return undefined;
  return clone(o);
}

export class LayoutEditor {
  readonly homeId: string;
  readonly savePath: string;
  private readonly catalog: Map<string, TypeInfo>;
  private readonly rooms: SceneRoom[];
  private readonly walls: SceneWall[];
  private readonly ceiling: number;
  private readonly outDir?: string;
  private readonly libraryDir?: string;
  private here?: HereResolver;
  private readonly base = new Map<string, SceneObject>();
  private readonly unbaked: ReadonlySet<string>;
  private current = new Map<string, SceneObject>();
  private readonly everAdded = new Set<string>();
  private readonly listeners = new Set<(m: LayoutMessage) => void>();
  private saved = "[]";
  private savedAt: string | null = null;
  private closed = false;

  constructor(opts: LayoutEditorOptions) {
    this.homeId = opts.homeId;
    this.savePath = opts.savePath;
    this.catalog = opts.catalog;
    this.rooms = (opts.scene.plan.rooms ?? []).filter((r) => Array.isArray(r.polygon) && r.polygon.length >= 3);
    this.walls = opts.scene.plan.walls ?? [];
    this.ceiling = opts.scene.plan.ceiling_height ?? 2.3;
    this.outDir = opts.outDir;
    this.libraryDir = opts.libraryDir;
    this.here = opts.here;
    this.unbaked = new Set(opts.unbaked ?? []);
    for (const raw of opts.scene.objects) {
      const o = asObject(raw);
      if (o && !this.base.has(o.id)) this.base.set(o.id, o);
    }
    this.current = new Map([...this.base].map(([id, o]) => [id, clone(o)]));
  }

  /** 폰 조준점 읽기를 나중에 잇는다(폰 서버가 늦게 뜰 때). */
  setHere(fn: HereResolver | undefined): void {
    this.here = fn;
  }

  subscribe(cb: (m: LayoutMessage) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  /** 집을 바꿀 때 닫는다. 늦게 도착한 에이전트 도구가 이전 집 배치를 바꾸거나 저장하지 못하게 한다. */
  close(): void {
    this.closed = true;
    this.listeners.clear();
  }

  private ensureOpen(): void {
    if (this.closed) throw new LayoutError("집을 바꿔서 이 배치는 더 바꾸지 않아요.");
  }

  object(id: string): SceneObject | undefined {
    const o = this.current.get(id);
    return o ? clone(o) : undefined;
  }

  objects(): SceneObject[] {
    return [...this.current.values()].map(clone);
  }

  roomLabel(id: string | null): string {
    return this.rooms.find((r) => r.id === id)?.label ?? id ?? "";
  }

  /** 이름·종류·방으로 물건을 찾는다(구조물 제외). 낱말마다 조사를 떼고 모두 맞는 것. */
  find(query: string): SceneObject[] {
    const roomSpecs = this.rooms.map((r) => ({ id: r.id, label: r.label ?? r.id }));
    const { rooms, rest } = detectRooms(query, roomSpecs);
    const tokens = rest.split(/\s+/).map((t) => compact(t)).filter((t) => t && !STOPWORDS.has(t));
    const pool = [...this.current.values()].filter((o) => o.category !== "structure" && (rooms.length === 0 || rooms.some((r) => r.id === o.room)));
    const hay = (o: SceneObject) => `${compact(o.name)} ${compact(this.catalog.get(o.type)?.label ?? "")} ${o.type.toLowerCase()} ${o.id.toLowerCase()}`;
    const hit = (o: SceneObject, t: string) => hay(o).includes(t) || hay(o).includes(stripParticle(t));
    return pool.filter((o) => tokens.length > 0 && tokens.every((t) => hit(o, t))).map(clone);
  }

  /** 초점 표시용 물건 가운데(바닥 h + 키/2, 천장 물건은 h - 키/2). */
  /** 카탈로그 종류 이름(예: bookcase → 책장). 카탈로그에 없으면 undefined. */
  typeLabel(type: string): string | undefined {
    return this.catalog.get(type)?.label;
  }

  /** 카탈로그 종류 정보(바닥 크기·높이·면). 카탈로그에 없으면 undefined. */
  typeInfo(type: string): TypeInfo | undefined {
    const info = this.catalog.get(type);
    return info ? clone(info) : undefined;
  }

  center(id: string): { id: string; label: string; position: Vec3 } | undefined {
    const o = this.current.get(id);
    if (!o) return undefined;
    const height = o.height ?? this.catalog.get(o.type)?.height ?? 0;
    const [x, h, y] = o.position;
    return { id, label: o.name, position: [x, clean(o.mount === "ceiling" ? h - height / 2 : h + height / 2), y] };
  }

  // ── 바꾸기 ─────────────────────────────────────────────

  move(id: string, to?: To, opts: { facing_deg?: number; turn_deg?: number } = {}): EditResult {
    this.ensureOpen();
    const o = this.require(id);
    if (!this.editable(o)) throw new LayoutError(`${o.name}: 옮길 수 없는 물건이에요(벽·바닥·문·창·천장 고정 설비).`);
    const parent = o.mount === "surface" && o.plan.on ? this.current.get(o.plan.on) : undefined;
    if (parent && this.editable(parent)) {
      // 위에 놓인 물건을 옮기라고 하면 받침째 옮긴다(물건만 허공에 뜨지 않게)
      const target = to === undefined ? o.plan.position : this.resolve(to, o.plan.position).position;
      const delta: Vec2 = [target[0] - o.plan.position[0], target[1] - o.plan.position[1]];
      const turn = opts.facing_deg !== undefined ? opts.facing_deg - o.plan.facing_deg : opts.turn_deg ?? 0;
      const r = this.moveGroup(parent, [parent.plan.position[0] + delta[0], parent.plan.position[1] + delta[1]], normDeg(parent.plan.facing_deg + turn));
      return { object: this.object(id)!, changed: r, message: `${josa(o.name, "을/를")} ${josa(parent.name, "과/와")} 함께 옮겼어요.` };
    }
    let target = o.plan.position;
    let facing = o.plan.facing_deg;
    if (to !== undefined) {
      const r = this.resolve(to, o.plan.position);
      target = r.position;
      if (to === "here" && r.from && o.mount === "floor") facing = this.toward(target, r.from);
    }
    if (opts.facing_deg !== undefined) facing = normDeg(opts.facing_deg);
    else if (opts.turn_deg !== undefined) facing = normDeg(o.plan.facing_deg + opts.turn_deg);
    if (o.mount === "wall") ({ position: target, facing } = this.snapToWall(target, facing));
    const changed = this.moveGroup(o, target, facing);
    return { object: this.object(id)!, changed, message: `${josa(o.name, "을/를")} ${josa(this.roomLabel(this.current.get(id)!.room), "으로/로")} 옮겼어요.` };
  }

  add(type: string, to: To, opts: { label?: string; facing_deg?: number } = {}): EditResult {
    this.ensureOpen();
    const info = this.catalog.get(type);
    if (!info) throw new LayoutError(`모르는 종류입니다: ${type} (find_object_types로 종류를 찾으세요)`);
    if (info.mount === "opening" || info.category === "structure") throw new LayoutError(`${info.label}: 더할 수 없는 종류예요(문·창·벽).`);
    if (info.mount === "surface") throw new LayoutError(`${info.label}처럼 다른 물건 위에 올려놓는 종류는 아직 더할 수 없어요.`);
    if (typeof to === "object" && "dx" in to) throw new LayoutError("더할 때는 x·y나 here로 자리를 주세요.");
    const r = this.resolve(to, [0, 0]);
    let position = r.position;
    let facing = opts.facing_deg !== undefined ? normDeg(opts.facing_deg) : r.from && info.mount === "floor" ? this.toward(position, r.from) : 90;
    if (info.mount === "wall") ({ position, facing } = this.snapToWall(position, facing));
    const room = this.roomAt(position);
    const h = info.mount === "wall" ? (/(^|_)ac(_|$)/.test(type) ? AC_WALL_HEIGHT : WALL_HEIGHT)
      : info.mount === "ceiling" ? this.ceiling
      : this.floorZ(room);
    const object = this.create(info, this.newId(type), opts.label?.trim() || info.label, position, facing, h, room);
    return { object: clone(object), changed: [object.id], message: `${josa(object.name, "을/를")} ${this.roomLabel(room)}에 더했어요.` };
  }

  /** 저장해 둔 수정본(재시작 전)을 다시 적용한다. 이미 원본에 반영된 것은 건너뛴다. 바뀐 건수. */
  applyEdits(edits: Edit[]): number {
    this.ensureOpen();
    let applied = 0;
    for (const e of edits) {
      if (e.op === "move") {
        const o = this.current.get(e.id);
        if (!o || !this.editable(o)) continue;
        const before = clone(o);
        if (!this.roomAt(e.position)) continue;
        this.moveGroup(o, [clean(e.position[0]), clean(e.position[1])], normDeg(e.facing_deg));
        if (this.changed(before, this.current.get(e.id)!)) applied++;
      } else if (e.op === "add") {
        const info = this.catalog.get(e.type);
        if (!info || this.current.has(e.id) || info.mount === "surface" || info.mount === "opening") continue;
        const room = this.roomAt(e.position) ?? e.room;
        const h = info.mount === "wall" ? e.elevation ?? WALL_HEIGHT : info.mount === "ceiling" ? this.ceiling : this.floorZ(room);
        this.create(info, e.id, e.label || info.label, [clean(e.position[0]), clean(e.position[1])], normDeg(e.facing_deg), h, room);
        applied++;
      } else {
        const o = this.current.get(e.id);
        if (!o || !this.editable(o)) continue;
        this.current.delete(e.id);
        this.emit({ type: "layout", op: "remove", id: e.id });
        applied++;
      }
    }
    this.saved = JSON.stringify(this.edits());
    return applied;
  }

  remove(id: string): EditResult {
    this.ensureOpen();
    const o = this.require(id);
    if (!this.editable(o)) throw new LayoutError(`${o.name}: 뺄 수 없는 물건이에요(벽·바닥·문·창·천장 고정 설비).`);
    const children = [...this.current.values()].filter((c) => c.plan.on === id);
    for (const c of children) {
      this.current.delete(c.id);
      this.emit({ type: "layout", op: "remove", id: c.id });
    }
    this.current.delete(id);
    this.emit({ type: "layout", op: "remove", id });
    const also = children.length ? ` 위에 있던 ${children.map((c) => c.name).join(", ")}도 같이 뺐어요.` : "";
    return { object: clone(o), changed: [...children.map((c) => c.id), id], message: `${josa(o.name, "을/를")} 뺐어요.${also}` };
  }

  /** 보정을 모두 버리고 원래 배치로. 뷰어를 되돌리는 메시지를 보낸다. */
  reset(): LayoutMessage[] {
    this.ensureOpen();
    const out: LayoutMessage[] = [];
    for (const [id, b] of this.base) {
      const c = this.current.get(id);
      if (!c) out.push({ type: "layout", op: "add", object: clone(b) });
      else if (this.changed(b, c)) out.push(this.moveMessage(b));
    }
    for (const id of this.current.keys()) if (!this.base.has(id)) out.push({ type: "layout", op: "remove", id });
    this.current = new Map([...this.base].map(([k, o]) => [k, clone(o)]));
    for (const m of out) this.emit(m);
    return out;
  }

  /** 원래 scene.json을 불러온 뷰어를 지금 상태로 맞추는 메시지(연결 때 보낸다). 구운 장면에 없는 기본 물건(unbaked)은 지금 자리로 add(지웠으면 보내지 않는다). */
  syncMessages(): LayoutMessage[] {
    const out: LayoutMessage[] = [];
    for (const [id, b] of this.base) {
      const c = this.current.get(id);
      if (this.unbaked.has(id)) {
        if (c) out.push({ type: "layout", op: "add", object: clone(c) });
        continue;
      }
      if (!c) out.push({ type: "layout", op: "remove", id });
      else if (this.changed(b, c)) out.push(this.moveMessage(c));
    }
    for (const [id, c] of this.current) if (!this.base.has(id)) out.push({ type: "layout", op: "add", object: clone(c) });
    return out;
  }

  /** 계약 B: id마다 최종 결과 하나. */
  edits(): Edit[] {
    const out: Edit[] = [];
    for (const [id, b] of this.base) {
      const c = this.current.get(id);
      if (!c) out.push({ op: "remove", id });
      else if (this.changed(b, c)) out.push({ op: "move", id, position: [...c.plan.position], facing_deg: c.plan.facing_deg, room: c.room });
    }
    for (const [id, c] of this.current) {
      if (this.base.has(id)) continue;
      const e: Edit = { op: "add", id, type: c.type, label: c.name, room: c.room, position: [...c.plan.position], facing_deg: c.plan.facing_deg };
      if (c.mount === "wall") e.elevation = c.plan.elevation;
      out.push(e);
    }
    return out;
  }

  status(): LayoutStatus {
    const edits = this.edits();
    return { home: this.homeId, edits: edits.length, dirty: JSON.stringify(edits) !== this.saved, savePath: this.savePath, savedAt: this.savedAt };
  }

  save(): { path: string; count: number; saved_at: string } {
    this.ensureOpen();
    const edits = this.edits();
    const savedAt = new Date().toISOString();
    mkdirSync(dirname(this.savePath), { recursive: true });
    writeFileSync(this.savePath, `${JSON.stringify({ version: 1, home: this.homeId, saved_at: savedAt, edits }, null, 2)}\n`, "utf8");
    this.saved = JSON.stringify(edits);
    this.savedAt = savedAt;
    return { path: this.savePath, count: edits.length, saved_at: savedAt };
  }

  // ── 내부 ────────────────────────────────────────────────

  private require(id: string): SceneObject {
    const o = this.current.get(id) ?? [...this.current.values()].find((x) => x.name === id);
    if (!o) throw new LayoutError(`물건을 찾을 수 없습니다: ${id} (find_objects로 id를 확인하세요)`);
    return o;
  }

  private editable(o: SceneObject): boolean {
    return (o.interactive === true || this.everAdded.has(o.id)) && o.mount !== "opening" && o.category !== "structure";
  }

  private resolve(to: To, from: Vec2): { position: Vec2; from?: Vec2 } {
    let p: Vec2;
    let eye: Vec2 | undefined;
    if (to === "here") {
      if (!this.here) throw new LayoutError("폰 AR이 연결되지 않아 '여기'를 알 수 없어요. 좌표로 말하거나 폰으로 기준점을 맞춰 주세요.");
      const h = this.here();
      if ("error" in h) throw new LayoutError(h.error);
      p = h.position;
      eye = h.from;
    } else if ("dx" in to) {
      p = [from[0] + to.dx, from[1] + to.dy];
    } else {
      p = [to.x, to.y];
    }
    p = [clean(p[0]), clean(p[1])];
    if (!this.roomAt(p)) throw new LayoutError(`(${p[0]}, ${p[1]})은 집 밖이에요. 방 안의 자리를 주세요.`);
    return { position: p, from: eye };
  }

  private roomAt(p: Vec2): string | null {
    const found = this.rooms.find((r) => inside(p, r.polygon!));
    if (found) return found.id;
    for (const r of this.rooms) {
      const poly = r.polygon!;
      for (let i = 0; i < poly.length; i++) if (nearestOnSegment(p, poly[i]!, poly[(i + 1) % poly.length]!).d <= EDGE_TOL) return r.id;
    }
    return null;
  }

  private floorZ(room: string | null): number {
    return this.rooms.find((r) => r.id === room)?.floor_z ?? 0;
  }

  /** 물건 앞이 폰(사람) 쪽을 보게 하는 방향. */
  private toward(p: Vec2, from: Vec2): number {
    const dx = from[0] - p[0];
    const dy = from[1] - p[1];
    return Math.hypot(dx, dy) < 1e-6 ? 90 : normDeg((Math.atan2(dy, dx) * 180) / Math.PI);
  }

  /** 가장 가까운 선 벽 면에 붙이고 벽을 등지게 한다(선 벽이 없으면 그대로). 끝점 없는 고체(샤프트·기둥)는 붙일 면으로 보지 않는다. */
  private snapToWall(p: Vec2, facing: number): { position: Vec2; facing: number } {
    let best: { a: Vec2; b: Vec2; thickness: number | null | undefined; q: Vec2; d: number } | undefined;
    for (const { a, b, thickness } of this.walls) {
      if (!a || !b) continue;
      const r = nearestOnSegment(p, a, b);
      if (!best || r.d < best.d) best = { a, b, thickness, ...r };
    }
    if (!best) return { position: p, facing };
    const { a, b, q } = best;
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    let n: Vec2 = [-(b[1] - a[1]) / len, (b[0] - a[0]) / len];
    const side = n[0] * (p[0] - q[0]) + n[1] * (p[1] - q[1]);
    if (side < 0 || (side === 0 && !this.roomAt([q[0] + n[0] * 0.2, q[1] + n[1] * 0.2]))) n = [-n[0], -n[1]];
    const half = (best.thickness ?? 0.2) / 2;
    return { position: [clean(q[0] + n[0] * half), clean(q[1] + n[1] * half)], facing: normDeg((Math.atan2(n[1], n[0]) * 180) / Math.PI) };
  }

  /** 받침과 그 위 물건을 함께 옮기고 돌린다. 바뀐 id 목록. */
  private moveGroup(o: SceneObject, target: Vec2, facing: number): string[] {
    const room = this.roomAt(target);
    if (!room) throw new LayoutError(`(${target[0]}, ${target[1]})은 집 밖이에요. 방 안의 자리를 주세요.`);
    const oldPos = o.plan.position;
    const turn = facing - o.plan.facing_deg;
    const h = o.mount === "floor" ? this.floorZ(room) : o.position[1];
    const dh = h - o.position[1];
    const children = [...this.current.values()].filter((c) => c.plan.on === o.id);
    this.place(o, target, facing, h, room);
    for (const c of children) {
      const rel = rotate([c.plan.position[0] - oldPos[0], c.plan.position[1] - oldPos[1]], turn);
      const p: Vec2 = [clean(target[0] + rel[0]), clean(target[1] + rel[1])];
      this.place(c, p, normDeg(c.plan.facing_deg + turn), c.position[1] + dh, this.roomAt(p) ?? room);
    }
    return [o.id, ...children.map((c) => c.id)];
  }

  private place(o: SceneObject, p: Vec2, facing: number, h: number, room: string | null): void {
    const f = normDeg(facing);
    const z = clean(h);
    o.plan = { ...o.plan, position: [clean(p[0]), clean(p[1])], facing_deg: f, elevation: z };
    o.position = [o.plan.position[0], z, o.plan.position[1]];
    o.rotation = [0, yawOf(f), 0];
    o.room = room;
    this.emit(this.moveMessage(o));
  }

  private moveMessage(o: SceneObject): LayoutMessage {
    return {
      type: "layout", op: "move", id: o.id, room: o.room,
      plan: { position: [...o.plan.position], facing_deg: o.plan.facing_deg, elevation: o.plan.elevation },
      position: [...o.position], rotation: [...o.rotation],
    };
  }

  private changed(a: SceneObject, b: SceneObject): boolean {
    return Math.abs(a.plan.position[0] - b.plan.position[0]) > 1e-4 || Math.abs(a.plan.position[1] - b.plan.position[1]) > 1e-4
      || Math.abs(normDeg(a.plan.facing_deg) - normDeg(b.plan.facing_deg)) > 0.05 || a.room !== b.room;
  }

  private create(info: TypeInfo, id: string, label: string, position: Vec2, facing: number, h: number, room: string | null): SceneObject {
    const object: SceneObject = {
      id, name: label, type: info.type, asset: this.assetFor(info), category: info.category, mount: info.mount,
      node_type: info.nodeType, room,
      plan: { position, facing_deg: facing, elevation: clean(h), on: null, surface: null, wall: null },
      position: [position[0], clean(h), position[1]], rotation: [0, yawOf(facing), 0], scale: [1, 1, 1],
      interactive: true, attrs: clone(info.attrs), states: clone(info.states), state: {}, footprint: [...info.footprint], height: info.height,
    };
    this.current.set(id, object);
    this.everAdded.add(id);
    this.emit({ type: "layout", op: "add", object: clone(object) });
    return object;
  }

  private newId(type: string): string {
    for (let n = 1; ; n++) {
      const id = `${type}_${n}`;
      if (!this.base.has(id) && !this.current.has(id) && !this.everAdded.has(id)) return id;
    }
  }

  private assetFor(info: TypeInfo): string | null {
    const rel = join("assets", info.category, `${info.type}.glb`);
    const posix = `assets/${info.category}/${info.type}.glb`;
    if (this.outDir && existsSync(join(this.outDir, rel))) return posix;
    if (this.libraryDir && existsSync(join(this.libraryDir, rel))) return `lib/${posix}`;
    return null;
  }

  geometryRevision = 0;
  private emit(m: LayoutMessage): void {
    this.geometryRevision++;
    for (const cb of [...this.listeners]) {
      try {
        cb(m);
      } catch {
        // 구독자 오류는 무시
      }
    }
  }
}
