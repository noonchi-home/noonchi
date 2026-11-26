// 대시보드 트윈 엔진 한 덩어리: 구운 GLB(r2b)를 고정 정사영 카메라(구운 보기)로 그린다. 카메라는 확대·이동만 하고, 바뀔 때만 그린다.
// 불러오기 차례: 톤 → 렌더러 → 장면·자산 받기 → 구운 재질 → 빛 → 기본 보기 벽 → 땅 그림자 → 상태 → 정적 합치기 → 첫 그림.
// 가전 상태(states)·배치 보정(layout)은 live.ts attachLive가 /events 메시지로 바꾼다.
// 맞춘 눈(보는 방향 원뿔, eye.ts)은 집을 그린 뒤 깊이를 보지 않고 따로 그린다: 벽·가구에 가리지 않는다. 대시보드가 setEye로 넣는다.
// 원뿔은 방 안·벽에서 떨어진 자리에 서고 새 자리까지 문을 지나 걸어간다(walk.ts, 그리는 자리만). 걷는 동안 그림마다 다시 그린다.
// 색은 토큰(scene3d)만 쓴다.
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import type { EyeEvent, Plan2 } from "../../../../src/contract/events.ts";
import { scene3d } from "../../../../src/design/tokens.ts";
import { applyDefaultView, viewHeading, type SceneData } from "./cutaway";
import { CONE, createEyeCone, type EyeCone } from "./eye";
import { bakedGround } from "./ground";
import { HOME_LIGHTS, addLights } from "./light";
import { LayoutOps } from "./live";
import { asLightmap, bakeMaterials, type Lightmaps, type Manifest } from "./materials";
import { StaticMerge } from "./merge";
import { BAKE_VIEWS, type OrthoCamera } from "./projection";
import { RenderLoop } from "./schedule";
import { TwinStates } from "./states";
import { installAgxHighContrast } from "./tone";
import { walkGuide, type WalkGuide } from "./walk";
import { between, ease, placeCamera, viewTarget, type Box, type MapCamera } from "./view";

/** 구운 자산 주소. 서버는 /twin/<경로>를 지금 집 폴더에서 찾는다. */
const BAKE = "/twin/bake/";
const ANISO = 16;

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} ${res.status}`);
  return (await res.json()) as T;
}

/** 집 전체가 상자를 꽉 채우는 지도 카메라(그림 가운데, cover 배율). */
export const wholeCamera = (v: OrthoCamera, box: Box): MapCamera => ({ cx: v.width / 2, cy: v.height / 2, scale: Math.max(box.width / v.width, box.height / v.height) });

interface Loaded { data: SceneData; manifest: Manifest; gltf: { scene: THREE.Group }; ground: THREE.Texture | null; maps: Lightmaps }

export class TwinEngine {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.OrthographicCamera();
  readonly root: THREE.Group;
  readonly states: TwinStates;
  readonly merge: StaticMerge;
  /** 배치 보정(옮기기·더하기·빼기). */
  readonly layout: LayoutOps;
  readonly info: { raised: string[]; actions: Record<string, number>; materials: Record<string, number>; merged: { before: number; after: number } };
  /** 맞춘 눈 층(원뿔). 집 그림 위에 그린다. */
  private readonly eyeLayer = new THREE.Scene();
  private readonly eye: EyeCone;
  private readonly guide: WalkGuide;
  private readonly loop: RenderLoop;
  private readonly views = new Set<(c: MapCamera) => void>();
  private readonly anchors = new Map<string, [number, number, number] | null>();
  private box: Box;
  private cur: MapCamera;
  private sent: MapCamera | null = null;
  private anim: { from: MapCamera; to: MapCamera; t0: number; ms: number } | null = null;
  private last = 0;
  private renders = 0;
  private disposed = false;

  static async load(o: { canvas: HTMLCanvasElement; home: string; box: Box; dpr: number }): Promise<TwinEngine> {
    const view = BAKE_VIEWS[o.home];
    const light = HOME_LIGHTS[o.home];
    if (!view || !light) throw new Error(`no baked view for ${o.home}`);
    installAgxHighContrast();
    const renderer = new THREE.WebGLRenderer({ canvas: o.canvas, antialias: true, stencil: true, preserveDrawingBuffer: false });
    try {
      renderer.setPixelRatio(Math.min(o.dpr, 2));
      renderer.setSize(o.box.width, o.box.height, false);
      renderer.toneMapping = THREE.CustomToneMapping;
      renderer.toneMappingExposure = 1;
      renderer.shadowMap.enabled = false;
      renderer.localClippingEnabled = true;
      // 한 그림에 두 번(집, 맞춘 눈) 그리니 그림마다 직접 센다
      renderer.info.autoReset = false;
      const [{ scene: data }, manifest] = await Promise.all([getJson<{ scene: SceneData }>("/api/scene"), getJson<Manifest>(`${BAKE}manifest.json`)]);
      const tex = new THREE.TextureLoader();
      const [gltf, ground, ...lms] = await Promise.all([
        new GLTFLoader().loadAsync(BAKE + manifest.glb),
        manifest.ground ? tex.loadAsync(BAKE + manifest.ground.file) : Promise.resolve(null),
        ...manifest.lightmaps.map((lm) => tex.loadAsync(BAKE + lm.webp)),
      ]);
      const maps: Lightmaps = Object.fromEntries(manifest.lightmaps.map((lm, i) => [lm.name, { tex: asLightmap(lms[i]!, manifest.channel, lm.name), intensity: lm.intensity }]));
      const engine = new TwinEngine(renderer, view, light, o.box, { data, manifest, gltf, ground, maps });
      await renderer.compileAsync(engine.scene, engine.camera);
      // 눈이 처음 올 때 셰이더를 만들며 끊기지 않게 숨은 원뿔 재질도 미리 만든다
      await renderer.compileAsync(engine.eyeLayer, engine.camera);
      engine.draw(performance.now());
      return engine;
    } catch (e) {
      renderer.dispose();
      throw e;
    }
  }

  private constructor(
    readonly renderer: THREE.WebGLRenderer,
    readonly view: OrthoCamera,
    light: (typeof HOME_LIGHTS)[string],
    box: Box,
    { data, manifest, gltf, ground, maps }: Loaded,
  ) {
    this.box = { width: box.width, height: box.height };
    this.cur = wholeCamera(view, this.box);
    placeCamera(this.camera, view, this.cur, this.box);
    this.scene.background = new THREE.Color(scene3d.background);
    this.root = gltf.scene;
    this.scene.add(this.root);
    this.root.updateMatrixWorld(true);
    const aniso = Math.min(ANISO, renderer.capabilities.getMaxAnisotropy());
    const materials = bakeMaterials(this.root, manifest, maps, { aniso });
    const target = viewTarget(view);
    addLights(this.scene, { light, sun: manifest.light.sun, target });
    const cut = data.plan.wall_cut_height ?? manifest.light.occluders.cut ?? 1.05;
    const find = (id: string) => this.find(id);
    const shown = applyDefaultView({ root: this.root, scene: this.scene, data, view: manifest.view, dashboardFurniture: true, heading: viewHeading(view), cut, target, find });
    if (ground && manifest.ground) this.scene.add(bakedGround(manifest.ground, ground));
    this.states = new TwinStates(this.scene, this.root);
    for (const e of data.objects) {
      const node = this.find(e.id);
      if (node) this.states.add(e.id, node, e);
    }
    this.root.updateMatrixWorld(true);
    // 정적 합치기: 움직이는 것(위쪽 벽·난간·벽걸이·문·창·키 큰 가구·가전)과 지금 숨은 것은 뺀다
    const movable = new Set<THREE.Object3D>();
    const hold = (n: THREE.Object3D | null) => n?.traverse((x) => { movable.add(x); });
    for (const n of [...shown.uppers, ...shown.rails]) hold(n);
    const clip = new Set(manifest.view.clip);
    const dynamic = new Set(Object.keys(manifest.dynamic ?? {}));
    const owner = new Map<THREE.Object3D, string>();
    for (const e of data.objects) {
      const node = this.find(e.id);
      if (!node) continue;
      node.traverse((x) => { if (!owner.has(x)) owner.set(x, e.id); });
      if (e.mount === "wall" || e.mount === "opening" || clip.has(e.id) || dynamic.has(e.id)) hold(node);
    }
    const statics: THREE.Mesh[] = [];
    this.root.traverse((n) => { if (n instanceof THREE.Mesh && n.userData.baked && !movable.has(n) && shownInTree(n)) statics.push(n); });
    this.merge = new StaticMerge(this.scene, statics, (m) => owner.get(m) ?? null);
    const merged = this.merge.build();
    // 맞춘 눈: 합치기 뒤 따로 둔 층이라 합쳐지지 않는다. 벽에서는 꼭짓점 공 반지름만큼 띄운다
    this.guide = walkGuide(data, CONE.apex);
    this.eye = createEyeCone({ guide: this.guide });
    this.eyeLayer.add(this.eye.group);
    this.info = { raised: shown.raised, actions: shown.actions, materials: { ...materials }, merged };
    const entries = new Map(data.objects.map((e) => [e.id, e]));
    this.layout = new LayoutOps(this, { entry: (id) => entries.get(id) });
    this.loop = new RenderLoop((now) => this.draw(now));
  }

  /** 지도 카메라를 c로 ms 동안 옮긴다(0이면 바로). 움직이는 중에 다시 부르면 지금 자리에서 이어 간다. */
  setView(c: MapCamera, ms: number): void {
    if (this.disposed) return;
    const to = { cx: c.cx, cy: c.cy, scale: c.scale };
    if (ms > 0) {
      const goal = this.anim?.to ?? this.cur;
      if (goal.cx === to.cx && goal.cy === to.cy && goal.scale === to.scale) return;
      this.anim = { from: this.cur, to, t0: performance.now(), ms };
    } else { this.anim = null; this.cur = to; }
    this.loop.request();
  }

  /** 그릴 때마다 그 그림의 지도 카메라를 받는다. 돌려준 함수로 그만 받는다. */
  onView(cb: (c: MapCamera) => void): () => void {
    this.views.add(cb);
    return () => { this.views.delete(cb); };
  }

  /** 물건 노드 상자 가운데 x·z와 윗면 높이(three 좌표). 없는 물건·뺀 물건이면 null. */
  anchor(id: string): [number, number, number] | null {
    if (this.layout.isRemoved(id)) return null;
    if (!this.anchors.has(id)) {
      const node = this.find(id);
      let at: [number, number, number] | null = null;
      if (node) {
        const b = new THREE.Box3().setFromObject(node);
        if (!b.isEmpty()) at = [(b.min.x + b.max.x) / 2, b.max.y, (b.min.z + b.max.z) / 2];
      }
      this.anchors.set(id, at);
    }
    return this.anchors.get(id)!;
  }

  /** 배치가 바뀌면 그 물건(없으면 전부)의 자리를 다시 셈하게 한다. */
  forgetAnchor(id?: string): void {
    if (id === undefined) this.anchors.clear();
    else this.anchors.delete(id);
  }

  find(id: string): THREE.Object3D | null {
    return this.root.getObjectByName(id) ?? this.root.getObjectByName(`drawn_${id}`) ?? null;
  }

  /** 상자 크기가 실제로 바뀔 때만 그림 크기를 바꾼다. */
  resize(box: Box): void {
    if (this.disposed || (box.width === this.box.width && box.height === this.box.height) || !box.width || !box.height) return;
    this.box = { width: box.width, height: box.height };
    this.renderer.setSize(box.width, box.height, false);
    this.sent = null;
    this.loop.request();
  }

  requestRender(): void {
    if (!this.disposed) this.loop.request();
  }

  /** 맞춘 눈을 원뿔로 보인다(null·추정 눈이면 숨김). 보이는 모양이 바뀔 때만 다시 그린다. */
  setEye(eye: EyeEvent | null): void {
    if (!this.disposed && this.eye.setEye(eye)) this.requestRender();
  }

  /** 원뿔을 그리는 자리: 눈 자리를 방 안·벽에서 떨어진 자리로 옮긴 것. 화면 표시(말풍선·이름표가 비킬 자리)에만 쓴다. */
  stand(p: Plan2): Plan2 {
    return this.guide.stand(p);
  }

  /** 지금 지도 카메라. */
  current(): MapCamera {
    return { ...this.cur };
  }

  stats(): { calls: number; triangles: number; renders: number; merged: { before: number; after: number } } {
    const r = this.renderer.info.render;
    return { calls: r.calls, triangles: r.triangles, renders: this.renders, merged: { ...this.info.merged } };
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.loop.stop();
    this.views.clear();
    this.layout.dispose();
    this.states.dispose();
    const textures = new Set<THREE.Texture>();
    for (const s of [this.scene, this.eyeLayer]) s.traverse((n) => {
      if (!(n instanceof THREE.Mesh)) return;
      n.geometry?.dispose();
      for (const m of [n.material].flat() as (THREE.Material & Record<string, unknown>)[]) {
        for (const v of Object.values(m)) if (v instanceof THREE.Texture) textures.add(v);
        m.dispose();
      }
    });
    for (const t of textures) t.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
  }

  private draw(now: number): boolean {
    if (this.disposed) return false;
    const dt = this.last ? (now - this.last) / 1000 : 0;
    this.last = now;
    let moving = false;
    if (this.anim) {
      const t = (now - this.anim.t0) / this.anim.ms;
      if (t >= 1) { this.cur = this.anim.to; this.anim = null; }
      else { this.cur = between(this.anim.from, this.anim.to, this.box, ease(t)); moving = true; }
    }
    placeCamera(this.camera, this.view, this.cur, this.box);
    this.states.beforeDraw(Math.min(dt, 0.1));
    const walking = this.eye.tick(now);
    this.renderer.info.reset();
    this.renderer.render(this.scene, this.camera);
    if (this.eye.group.visible) {
      // 맞춘 눈은 집 위에: 그림을 지우지 않고 같은 카메라로 그린다
      this.renderer.autoClear = false;
      this.renderer.render(this.eyeLayer, this.camera);
      this.renderer.autoClear = true;
    }
    this.renders++;
    if (this.sent !== this.cur) {
      this.sent = this.cur;
      for (const cb of this.views) cb({ ...this.cur });
    }
    const more = moving || walking || this.states.spinning();
    if (!more) this.last = 0;
    return more;
  }
}

/** 노드와 그 위 부모가 모두 보이는가. */
function shownInTree(n: THREE.Object3D): boolean {
  for (let x: THREE.Object3D | null = n; x; x = x.parent) if (!x.visible) return false;
  return true;
}
