// 가전 상태(스파이크 docs/twin3d-spike/main.mjs 403~438줄, 트윈 뷰어 states.mjs): 지금 상태(장면의 state)를 먼저 넣는다. 구운 GLB는 쉴 때 자세·최대 발광이라서다.
// 빛은 트윈 뷰어 main.mjs의 빛 풀처럼 종류마다 미리 만들어 세기 0으로 장면에 두고, 켤 때 빌려 기준점 자리로 옮긴다.
// three는 장면의 빛 개수가 바뀌면 모든 재질의 셰이더를 다시 만들어 화면이 멈추기 때문이다.
// 풀은 구운 장면의 빛 기준점 수로 만들고, 나중에 더한 물건(연결 때 layout add: 목련 거실등·현관등)을 이을 때 그 빛 기준점만큼 늘린다(켤 때가 아니라 더할 때 한 번).
// 더한 물건의 빛은 기기 id마다 센다: 다시 접속할 때마다 모델을 새로 복제해 다시 이어도 그 id의 셈을 다시 쓰고, 뺄 때 셈을 풀어 풀이 쌓이지 않는다.
import * as THREE from "three";
import { RectAreaLightUniformsLib } from "three/addons/lights/RectAreaLightUniformsLib.js";
import { parseProp, statesOf } from "@viewer/scene.mjs";
import { applyAttr, applyState, attrValues, collectTargets, createContext, defaultValue, tickSpins, type StateContext } from "@viewer/states.mjs";
import { scene3d } from "../../../../src/design/tokens.ts";

/** 종류마다 미리 만드는 빛 수 상한(트윈 뷰어와 같음). 빛마다 픽셀 셈이 늘어서 둔다. */
const POOL_CAP = { spot: 11, area: 6, point: 6 } as const;
const MAX_LIGHTS = 16;
type Kind = keyof typeof POOL_CAP;
type Spec = { kind?: string; color?: string | [number, number, number]; direction?: [number, number, number]; angle_deg?: number; distance?: number; size?: [number, number] };
const kindOf = (spec: Spec): Kind => (spec.kind === "spot" || spec.kind === "area" ? spec.kind : "point");
const AREA_FORWARD = new THREE.Vector3(0, 0, -1); // RectAreaLight는 -Z로 비춘다
const lightScale = new THREE.Vector3();
let areaReady = false;

interface Item {
  node: THREE.Object3D;
  states: Record<string, { default?: unknown; effects?: Record<string, unknown[]> }>;
  attrs: Record<string, unknown[]>;
  targets: unknown;
  state: Record<string, unknown>;
}

/** node 아래 빛 기준점과 그 종류. */
function lightAnchors(node: THREE.Object3D): [THREE.Object3D, Kind][] {
  const out: [THREE.Object3D, Kind][] = [];
  node.traverse((n) => {
    const spec = n.userData?.light !== undefined ? (parseProp(n.userData.light) as Spec | null) : null;
    if (spec) out.push([n, kindOf(spec)]);
  });
  return out;
}

export class TwinStates {
  readonly ctx: StateContext;
  private readonly items = new Map<string, Item>();
  private readonly free = new Map<Kind, THREE.Light[]>([["spot", []], ["area", []], ["point", []]]);
  private readonly all: THREE.Light[] = [];
  /** 구운 장면의 빛 기준점과 종류마다 그 수, 더한 물건(기기 id)마다 그 빛 기준점 수, 종류마다 만든 풀 빛 수. */
  private readonly baked = new WeakSet<THREE.Object3D>();
  private readonly bakedCount: Record<Kind, number> = { spot: 0, area: 0, point: 0 };
  private readonly reserved = new Map<string, Record<Kind, number>>();
  private readonly made: Record<Kind, number> = { spot: 0, area: 0, point: 0 };

  constructor(private readonly scene: THREE.Object3D, root: THREE.Object3D) {
    for (const [anchor, kind] of lightAnchors(root)) {
      this.baked.add(anchor);
      this.bakedCount[kind] += 1;
    }
    this.grow();
    this.ctx = createContext({
      maxLights: MAX_LIGHTS,
      makeLight: (spec) => this.makeLight(spec as Spec),
      placeLight: (light, anchor) => this.placeLight(light as THREE.Light, anchor as THREE.Object3D),
      releaseLight: (light) => this.releaseLight(light as THREE.Light),
    });
  }

  /** 상태가 있는 물건을 넣고 지금 상태(entry.state, 없으면 기본값)를 적용한다. 상태가 없으면 넣지 않는다. */
  add(id: string, node: THREE.Object3D, entry: { attrs?: Record<string, unknown[]>; state?: Record<string, unknown>; states?: unknown }): boolean {
    const states = statesOf(entry, node);
    if (!Object.keys(states).length) return false;
    this.reserve(id, node);
    const attrs = entry.attrs ?? {};
    const initial = Object.fromEntries(Object.keys(states).map((a) => [a, defaultValue(states, attrs, a)]));
    const item: Item = { node, states, attrs, targets: collectTargets(node), state: { ...initial, ...(entry.state ?? {}) } };
    applyState(this.ctx, item.targets, item.states, item.attrs, item.state);
    this.items.set(id, item);
    return true;
  }

  has(id: string): boolean { return this.items.has(id); }
  ids(): string[] { return [...this.items.keys()]; }

  getState(id: string): Record<string, unknown> {
    return { ...(this.items.get(id)?.state ?? {}) };
  }

  /** 상태마다 받을 수 있는 값. 상태 없는 물건이면 null. */
  getAttrs(id: string): Record<string, unknown[]> | null {
    const it = this.items.get(id);
    return it ? Object.fromEntries(Object.keys(it.states).map((a) => [a, attrValues(it.states, it.attrs, a)])) : null;
  }

  setState(id: string, attr: string, value: unknown): { missing: string[] } {
    const it = this.items.get(id);
    if (!it) throw new Error(`no states: ${id}`);
    it.state[attr] = value;
    return applyAttr(this.ctx, it.targets, attr, it.states[attr], value);
  }

  /** 물건을 뺄 때: 기본값으로 되돌려 켠 빛을 풀에 돌려주고 상태 연결을 끊는다. 상태 없는 물건이면 false. */
  remove(id: string): boolean {
    const it = this.items.get(id);
    if (!it) return false;
    const defaults = Object.fromEntries(Object.keys(it.states).map((a) => [a, defaultValue(it.states, it.attrs, a)]));
    applyState(this.ctx, it.targets, it.states, it.attrs, defaults);
    this.items.delete(id);
    this.reserved.delete(id);
    return true;
  }

  /** 도는 드럼이 있다(이어 그려야 한다). */
  spinning(): boolean { return this.ctx.spins.size > 0; }

  /** 그리기 전: 도는 것을 dt초만큼 돌리고, 켠 빛을 기준점 자리(문짝처럼 움직이는 것 포함)로 옮긴다. */
  beforeDraw(dt: number): void {
    if (dt > 0 && this.spinning()) tickSpins(this.ctx, dt);
    for (const anchor of this.ctx.lit) this.placeLight(this.ctx.lightOf.get(anchor as object) as THREE.Light, anchor as THREE.Object3D);
  }

  dispose(): void {
    for (const light of this.all) { light.removeFromParent(); light.dispose(); }
  }

  /** 기기 id의 빛 기준점(구운 장면 것은 빼고)을 종류마다 세어 그 id의 셈으로 다시 쓰고 풀을 늘린다. */
  private reserve(id: string, node: THREE.Object3D): void {
    const count: Record<Kind, number> = { spot: 0, area: 0, point: 0 };
    for (const [anchor, kind] of lightAnchors(node)) if (!this.baked.has(anchor)) count[kind] += 1;
    if (count.spot || count.area || count.point) this.reserved.set(id, count);
    else this.reserved.delete(id);
    this.grow();
  }

  /** 종류마다 풀을 구운 빛 수 + 더한 물건 빛 수(상한 POOL_CAP)까지 늘린다. 늘린 빛은 세기 0으로 장면에 둔다. 줄이지는 않는다(빛 수가 바뀌면 셰이더를 다시 만든다). */
  private grow(): void {
    for (const kind of Object.keys(this.made) as Kind[]) {
      let total = this.bakedCount[kind];
      for (const c of this.reserved.values()) total += c[kind];
      const want = Math.min(total, POOL_CAP[kind]);
      if (kind === "area" && want > this.made.area && !areaReady) { RectAreaLightUniformsLib.init(); areaReady = true; }
      while (this.made[kind] < want) {
        const light = this.poolLight(kind);
        this.scene.add(light);
        this.free.get(kind)!.push(light);
        this.all.push(light);
        this.made[kind] += 1;
      }
    }
  }

  private poolLight(kind: Kind): THREE.Light {
    let light: THREE.Light;
    if (kind === "spot") {
      const spot = new THREE.SpotLight(scene3d.light, 0, 0, Math.PI / 6, 0.4, 2);
      spot.add(spot.target);
      light = spot;
    } else if (kind === "area") light = new THREE.RectAreaLight(scene3d.light, 0, 0.5, 0.5);
    else light = new THREE.PointLight(scene3d.light, 0, 0, 2);
    light.name = "state_light";
    light.castShadow = false;
    light.userData.kind = kind;
    return light;
  }

  private makeLight(spec: Spec): THREE.Light | null {
    const light = this.free.get(kindOf(spec))?.pop();
    if (!light) return null;
    if (Array.isArray(spec.color)) light.color.setRGB(...spec.color);
    else light.color.set(spec.color ?? scene3d.light);
    const dir = new THREE.Vector3(...(spec.direction ?? [0, -1, 0])).normalize();
    if (light instanceof THREE.SpotLight) {
      light.angle = Math.min(((spec.angle_deg ?? 60) * Math.PI) / 360, Math.PI / 2); // angle_deg는 원뿔 전체 각(Blender 규칙)
      light.distance = spec.distance ?? 0;
      light.target.position.copy(dir);
    } else if (light instanceof THREE.RectAreaLight) {
      [light.width, light.height] = spec.size ?? [0.5, 0.5];
      light.userData.aim = new THREE.Quaternion().setFromUnitVectors(AREA_FORWARD, dir);
    } else if (light instanceof THREE.PointLight) {
      light.distance = spec.distance ?? 0;
    }
    return light;
  }

  private placeLight(light: THREE.Light, anchor: THREE.Object3D): void {
    anchor.updateWorldMatrix(true, false);
    anchor.matrixWorld.decompose(light.position, light.quaternion, lightScale);
    if (light.userData.aim) light.quaternion.multiply(light.userData.aim as THREE.Quaternion);
  }

  private releaseLight(light: THREE.Light): void {
    light.intensity = 0;
    this.free.get(light.userData.kind as Kind)!.push(light);
  }
}
