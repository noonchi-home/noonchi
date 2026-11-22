// /events 가전 상태·배치 보정 → 구운 트윈 엔진. 상태는 트윈 뷰어 createLiveSync(live.mjs) 규칙 그대로(바뀐 값만, 모르는 기기·값은 건너뜀),
// 배치는 routeLayout(layout.mjs)으로 LayoutOps에 넘긴다. 바뀌면 엔진에 한 번 그리게 한다.
// 구운 GLB 물건 노드의 변환은 scene.json position·rotation과 같고 부모(Apartment·furniture·…)는 항등이라, 메시지 값을 노드에 그대로 넣는다.
// 배치를 바꾸면 다시 굽기 전까지 옛 자리 그림자가 남고 새 물건은 그림자가 없다.
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { boxSpec, routeLayout, type MovePatch } from "@viewer/layout.mjs";
import { createLiveSync } from "@viewer/live.mjs";
import { assetRoot } from "@viewer/scene.mjs";
import type { ServerMessage } from "../../../../src/contract/events.ts";
import { scene3d } from "../../../../src/design/tokens.ts";

/** 물건의 상태 칸(scene.json attrs·state·states). */
export type StateEntry = { attrs?: Record<string, unknown[]>; state?: Record<string, unknown>; states?: unknown };

/** 실시간 연결이 쓰는 가전 상태 저장소(TwinStates). */
export interface LiveStates {
  getState(id: string): Record<string, unknown>;
  getAttrs(id: string): Record<string, unknown[]> | null;
  setState(id: string, attr: string, value: unknown): unknown;
}

/** 트윈 상태 저장소를 트윈 뷰어 createLiveSync의 viewer 모양으로. */
export function liveViewer(states: LiveStates): { getState(id: string): Record<string, unknown>; getAttrs(id: string): Record<string, unknown[]> | null; setState(id: string, attr: string, value: unknown): void } {
  return {
    getState: (id) => states.getState(id),
    getAttrs: (id) => states.getAttrs(id),
    setState: (id, attr, value) => { states.setState(id, attr, value); },
  };
}

/** 배치 바꾸기가 쓰는 엔진 부분(TwinEngine). */
export interface LayoutHost {
  /** 새 물건을 넣는 곳(구운 GLB 뿌리, 항등). */
  readonly root: THREE.Object3D;
  readonly merge: { detach(id: string): number; mergedOf(id: string): THREE.Mesh | null };
  readonly states: { add(id: string, node: THREE.Object3D, entry: StateEntry): boolean; remove(id: string): boolean };
  find(id: string): THREE.Object3D | null;
  forgetAnchor(id?: string): void;
}

/** add 메시지의 물건(normalizeObject로 채운 scene.json 물건). */
type AddObject = Record<string, unknown> & { id: string; position: [number, number, number]; rotation?: unknown; scale?: unknown; asset?: unknown };

/** scene.json 물건에서 상태 칸만(attrs·state·states). */
const stateEntry = (o: AddObject): StateEntry => ({ attrs: o.attrs as StateEntry["attrs"], state: o.state as StateEntry["state"], states: o.states });

const isVec3 = (v: unknown): v is [number, number, number] => Array.isArray(v) && v.length === 3 && v.every((x) => typeof x === "number" && Number.isFinite(x));

function place(node: THREE.Object3D, o: { position: [number, number, number]; rotation?: unknown }): void {
  node.position.fromArray(o.position);
  if (isVec3(o.rotation)) node.rotation.set(o.rotation[0], o.rotation[1], o.rotation[2], "XYZ");
  node.updateMatrixWorld(true);
}

function noShadow(node: THREE.Object3D): void {
  node.traverse((n) => { if (n instanceof THREE.Mesh) { n.castShadow = false; n.receiveShadow = false; } });
}

/** 배치 보정(옮기기·더하기·빼기)을 엔진 장면에 바로 넣는다. 정적(합친) 물건은 합친 메시에서 뗀 뒤 바꾼다. 다시 접속하면 restore로 원래 장면에 돌린다. */
export class LayoutOps {
  /** 뺀 물건 id → 빼기 전 보이기(다시 더하면 되돌린다). 노드는 장면에 숨겨 둔다. */
  private readonly removed = new Map<string, boolean>();
  /** 장면 원래 물건 id → 처음 옮기기 전 변환(원래 자리). */
  private readonly origin = new Map<string, { position: THREE.Vector3; quaternion: THREE.Quaternion }>();
  /** 더한 물건 id → 그 노드(장면 원래 물건이 아님). */
  private readonly added = new Map<string, THREE.Object3D>();
  private readonly entry: (id: string) => StateEntry | undefined;
  /** 물건 그림을 받는 중인 더하기. 그동안 온 옮기기는 여기에 넣고, 빼기는 지운다. */
  private readonly pending = new Map<string, { object: AddObject }>();
  private readonly assets = new Map<string, Promise<THREE.Object3D>>();
  private readonly load: (url: string) => Promise<THREE.Object3D>;
  private boxMaterial: THREE.Material | null = null;
  private closed = false;

  /** entry: 장면 원래 물건의 상태 칸(/api/scene 물건). 뺀 물건을 restore로 다시 보일 때 상태를 다시 잇는다. */
  constructor(private readonly host: LayoutHost, o: { load?: (url: string) => Promise<THREE.Object3D>; entry?: (id: string) => StateEntry | undefined } = {}) {
    this.load = o.load ?? ((url) => new GLTFLoader().loadAsync(url).then((g) => g.scene));
    this.entry = o.entry ?? (() => undefined);
  }

  /** 뺀 물건인가(기준점이 없다). */
  isRemoved(id: string): boolean {
    return this.removed.has(id);
  }

  /** 물건을 메시지 자리로 옮긴다. 정적 물건은 합친 메시에서 먼저 뗀다. 장면이 바뀌면 true. */
  move(id: string, patch: MovePatch): boolean {
    if (this.closed) return false;
    const wait = this.pending.get(id);
    if (wait) { wait.object = { ...wait.object, position: patch.position, rotation: patch.rotation }; return false; }
    const node = this.host.find(id);
    if (!node || this.removed.has(id)) return false;
    if (this.host.merge.mergedOf(id)) this.host.merge.detach(id);
    this.keep(id, node);
    place(node, patch);
    this.host.forgetAnchor(id);
    return true;
  }

  /** 물건을 더한다: 뺀 물건이면 그 노드를 다시 보이고, 있는 물건이면 옮기고, 새 물건이면 asset(/twin/<asset>)을 실시간 재질로, 없으면 회색 상자. 그림자 없음. */
  async add(object: AddObject): Promise<boolean> {
    if (this.closed) return false;
    const id = object.id;
    const shown = this.removed.get(id);
    const node = this.host.find(id);
    if (shown !== undefined && node) {
      this.removed.delete(id);
      node.visible = shown;
      this.keep(id, node);
      place(node, object);
      this.host.states.add(id, node, stateEntry(object));
      this.host.forgetAnchor(id);
      return true;
    }
    const wait = this.pending.get(id);
    if (wait) { wait.object = { ...object }; return false; }
    if (node) return this.move(id, { position: object.position, rotation: isVec3(object.rotation) ? object.rotation : [0, 0, 0] });
    const ticket = { object: { ...object } };
    this.pending.set(id, ticket);
    const body = await this.body(object);
    if (this.closed || this.pending.get(id) !== ticket) return false;
    this.pending.delete(id);
    const holder = new THREE.Group();
    holder.name = id;
    holder.visible = ticket.object.type !== "dining_chair";
    holder.userData = { id, added: true };
    if (isVec3(ticket.object.scale)) holder.scale.fromArray(ticket.object.scale);
    holder.add(body);
    noShadow(holder);
    this.host.root.add(holder);
    this.added.set(id, holder);
    place(holder, ticket.object);
    this.host.states.add(id, holder, stateEntry(ticket.object));
    this.host.forgetAnchor(id);
    return true;
  }

  /** 물건을 뺀다: 정적 물건은 합친 메시에서 뗀 뒤 숨기고, 상태 연결(켠 빛)을 돌려준다. */
  remove(id: string): boolean {
    if (this.closed) return false;
    if (this.pending.delete(id) || this.removed.has(id)) return false;
    const node = this.host.find(id);
    if (!node) return false;
    if (this.host.merge.mergedOf(id)) this.host.merge.detach(id);
    this.host.states.remove(id);
    this.removed.set(id, node.visible);
    node.visible = false;
    this.host.forgetAnchor(id);
    return true;
  }

  /**
   * 다시 접속할 때(hello): 바꾼 배치를 원래 장면으로 돌린다. 서버의 맞추기 메시지는 원래 장면과의 차이만 보내기 때문이다.
   * 받는 중인 더하기는 버리고, 더한 물건은 지우고, 뺀 물건은 다시 보이며 상태를 다시 잇고, 옮긴 물건은 원래 자리로. 장면이 바뀌면 true.
   */
  restore(): boolean {
    if (this.closed) return false;
    this.pending.clear();
    let changed = false;
    for (const [id, node] of this.added) {
      this.host.states.remove(id);
      this.removed.delete(id);
      node.removeFromParent();
      node.traverse((n) => { if (n instanceof THREE.Mesh && n.material === this.boxMaterial) n.geometry.dispose(); });
      changed = true;
    }
    this.added.clear();
    for (const [id, shown] of this.removed) {
      const node = this.host.find(id);
      if (!node) continue;
      node.visible = shown;
      const e = this.entry(id);
      if (e) this.host.states.add(id, node, e);
      changed = true;
    }
    this.removed.clear();
    for (const [id, t] of this.origin) {
      const node = this.host.find(id);
      if (!node) continue;
      node.position.copy(t.position);
      node.quaternion.copy(t.quaternion);
      node.updateMatrixWorld(true);
      changed = true;
    }
    this.origin.clear();
    if (changed) this.host.forgetAnchor();
    return changed;
  }

  /** 엔진을 버릴 때: 받는 중인 더하기를 버린다. */
  dispose(): void {
    this.closed = true;
    this.pending.clear();
  }

  /** 장면 원래 물건을 처음 옮기기 전에 그 자리를 적어 둔다. */
  private keep(id: string, node: THREE.Object3D): void {
    if (this.added.has(id) || this.origin.has(id)) return;
    this.origin.set(id, { position: node.position.clone(), quaternion: node.quaternion.clone() });
  }

  private async body(o: AddObject): Promise<THREE.Object3D> {
    const asset = typeof o.asset === "string" && o.asset ? o.asset : null;
    if (asset) {
      let got = this.assets.get(asset);
      if (!got) { got = this.load(`/twin/${asset}`); this.assets.set(asset, got); }
      try {
        return assetRoot(await got, asset).clone(true);
      } catch {
        this.assets.delete(asset); // 못 읽으면 회색 상자, 다음에 다시 받아 본다
      }
    }
    const { size, center } = boxSpec(o);
    this.boxMaterial ??= new THREE.MeshStandardMaterial({ name: "layout_box", color: scene3d.placeholder, roughness: 0.85 });
    const box = new THREE.Mesh(new THREE.BoxGeometry(...size), this.boxMaterial);
    box.position.fromArray(center);
    box.name = `${typeof o.type === "string" ? o.type : o.id}_box`;
    return box;
  }
}

/** attachLive가 쓰는 엔진 부분(TwinEngine). */
export interface LiveEngine {
  readonly states: LiveStates;
  readonly layout: LayoutOps;
  requestRender(): void;
}

/** 엔진에 /events 메시지를 잇는다. 상태·배치가 바뀌면 그리게 한다. hello(다시 접속)면 배치를 원래 장면으로 돌린다: 뒤따르는 맞추기 메시지가 지금 배치를 다시 넣는다.
 *  기기마다 마지막 상태를 둔다: 서버는 접속 때 state를 layout add보다 먼저 보내고, 더하는 물건(모델을 받는 동안)은 그때 아직 없어 상태를 건너뛴다.
 *  더하기가 끝나면 그 기기의 마지막 상태를 다시 넣는다(닫은 커튼·켠 조명이 기본값으로 보이지 않게). hello면 앞 접속의 상태는 버린다.
 *  대시보드는 기기를 바꾸지 않으므로 보내기는 없다. */
export function attachLive(engine: LiveEngine): { handle(m: ServerMessage): void; dispose(): void } {
  let off = false;
  let dirty = false;
  const last = new Map<string, Extract<ServerMessage, { type: "state" }>>();
  const base = liveViewer(engine.states);
  const apply = (m: ServerMessage) => {
    dirty = false;
    sync.handleMessage(m);
    if (dirty) engine.requestRender();
  };
  const done = (changed: unknown, added: string | null) => {
    if (off) return;
    if (changed === true) engine.requestRender();
    const s = added ? last.get(added) : undefined;
    if (changed === true && s) apply(s);
  };
  const sync = createLiveSync({
    viewer: { ...base, setState: (id, attr, value) => { base.setState(id, attr, value); dirty = true; } },
    send: async () => ({ ok: false }),
    onLayout: (m) => {
      const add = m as { op?: unknown; object?: { id?: unknown } } | null;
      const added = add?.op === "add" && typeof add.object?.id === "string" ? add.object.id : null;
      const r = routeLayout(m, engine.layout);
      if (r instanceof Promise) r.then((c) => done(c, added), (e: unknown) => console.warn("[twin3d] 배치 반영 실패", e));
      else done(r, added);
    },
  });
  return {
    handle(m) {
      if (off) return;
      if (m.type === "hello") {
        last.clear();
        if (engine.layout.restore()) engine.requestRender();
        return;
      }
      if (m.type === "state") last.set(m.state.id, m);
      apply(m);
    },
    dispose() { off = true; },
  };
}

/** 엔진이 뜨기 전(GLB 약 1초)에 온 메시지. state는 기기마다 마지막 하나, layout은 온 차례. hello가 오면 layout을 비운다(서버가 접속 때 맞추기 메시지를 다시 보냄). */
export class LiveQueue {
  private readonly states = new Map<string, ServerMessage>();
  private layouts: ServerMessage[] = [];

  push(m: ServerMessage): void {
    if (m.type === "hello") this.layouts = [];
    else if (m.type === "state") { this.states.delete(m.state.id); this.states.set(m.state.id, m); }
    else if (m.type === "layout") this.layouts.push(m);
  }

  /** 모은 것을 state 다음 layout 차례로 돌려주고 비운다. */
  drain(): ServerMessage[] {
    const out = [...this.states.values(), ...this.layouts];
    this.states.clear();
    this.layouts = [];
    return out;
  }
}
