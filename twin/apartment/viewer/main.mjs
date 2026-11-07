// 아파트 트윈 뷰어: 두 방식으로 불러와 렌더하고, 가전 상태를 바꾸고, 가구를 하나씩 옮기고 돌린다.
//
// - scene.json + 개별 GLB: 종류마다 GLB를 한 번 받고, 배치마다 복제해 Group(이름 = id)에 넣는다.
//   scene.json 변환은 그 Group에 한 번만 넣는다(GLB 루트는 항등).
// - apartment_complete.glb: 'Apartment' 노드의 복제본. 인스턴스 이름 = id.
// - 화면에서 빼는 메시(낮춘 벽의 upper, 천장 객체, 숨길 장식)는 레이어 1로 옮긴다. 그 안의 빛은 레이어 0에 남아
//   상태대로 계속 비춘다. 상태 효과의 visible과도 섞이지 않는다.
// - URL ?scene=<경로>로 scene.json 위치를 바꾼다(기본 ../scene.json). GLB는 그 폴더 기준이다.
// - 실행 중 배치 보정(twin-home {type:"layout"})은 다시 빌드하지 않고 옮기고·더하고·뺀다. 에셋이 없으면 회색 상자.
//   클로이드의 초점({type:"focus"})은 대상 중심에 파란 고리를 그린다(layout.mjs).

import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { TransformControls } from "three/addons/controls/TransformControls.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { RectAreaLightUniformsLib } from "three/addons/lights/RectAreaLightUniformsLib.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { GTAOPass } from "three/addons/postprocessing/GTAOPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { CSS2DObject, CSS2DRenderer } from "three/addons/renderers/CSS2DRenderer.js";
import { fitOrtho, placementExport, roomBox } from "./plan.mjs";
import {
  applyTransform, assetRoot, baseUrlOf, completeCheckUrl, findPickable, groupByRoom, indexNodes, isIdentity, isPlaceholder,
  matrixDiff, maxDeviation, parseProp, statesOf, uniqueAssets,
} from "./scene.mjs";
import {
  activeDevices, applyAttr, applyState, attrLabel, attrValues, changeTone, collectTargets, createContext, defaultValue,
  nonDefault, ownMaterials, powerValues, stateText, tickSpins, valueKey, valueLabel, wiringStatus,
} from "./states.mjs";
import { cctvPose } from "./cctv.mjs";
import { cameraHeading, ceilingVisible, collectWalls, cutAction, focusVisible, openingRooms, wallVisibility } from "./walls.mjs";
import { startLive } from "./live.mjs";
import { eyeTransform } from "./eye.mjs";
import { boxSpec, focusExpiry, focusTargets, routeLayout } from "./layout.mjs";
import { planWallOf, snapToWall, touchMarkers, wallHint } from "./touch.mjs";

const SCENE_URL = new URLSearchParams(location.search).get("scene") ?? "../scene.json";
const BASE = baseUrlOf(SCENE_URL);
const COMPLETE = `${BASE}apartment_complete.glb`;
// 불러온 뒤 위치 대조는 ?debug=1 검사에서만(그 밖에는 null, 집 산출물에 없는 파일을 받지 않는다)
const CHECK_COMPLETE = completeCheckUrl(BASE, location.search);
const HIDDEN = 1; // 화면에서 뺀 메시의 레이어
const MAX_LIGHTS = 16;
const $ = (id) => document.getElementById(id);
const deg = THREE.MathUtils.degToRad;
const vec = (v) => new THREE.Vector3(...v);
// ?debug=1이면 내부 검사 칸(선택·검사), 불러오기, AO, 상태 줄을 보인다(style.css .debug-only)
document.body.classList.toggle("debug", new URLSearchParams(location.search).has("debug"));

// --- 렌더러·장면 ---------------------------------------------------------------------------
const canvas = $("view");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.toneMapping = THREE.AgXToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.localClippingEnabled = true; // 낮춘 벽의 문·창을 잘라 보기 높이에서 자른다
RectAreaLightUniformsLib.init();

const labels = new CSS2DRenderer();
labels.domElement.className = "labels";
canvas.after(labels.domElement); // 패널보다 아래에 깐다

const scene = new THREE.Scene();
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.45;
scene.add(new THREE.HemisphereLight(0xffffff, 0xd8d0c4, 0.5));

const sun = new THREE.DirectionalLight(0xffecd2, 2.6); // 방향은 scene.json stage.sun
sun.castShadow = true;
sun.shadow.mapSize.set(4096, 4096);
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.02;
sun.shadow.radius = 3;
scene.add(sun, sun.target);

const fill = new THREE.DirectionalLight(0xfff8f0, 1.1); // 앞쪽 위 채움 빛(아이소메트릭 방과 같은 방향)
scene.add(fill, fill.target);

const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 200);
const orbit = new OrbitControls(camera, canvas);
orbit.enableDamping = true;

const content = new THREE.Group();
scene.add(content);

const transform = new TransformControls(camera, canvas);
transform.setSpace("world");
scene.add(transform.getHelper());

const cutPlane = new THREE.Plane(new THREE.Vector3(0, -1, 0), 1.05); // y <= 잘라 보기 높이만 남긴다
const clippedMeshes = new Set();

// GTAOPass는 법선·깊이 버퍼를 scene.overrideMaterial 하나로 그려서 재질별 자르기 평면이 빠진다.
// 그러면 잘린 문·커튼 윗부분이 AO에 유령 테두리로 남으므로, 잘린 메시만 자르기 평면이 있는 법선 재질로 그린다.
class ClippedGTAOPass extends GTAOPass {
  _renderOverride(renderer, material, target, clearColor, clearAlpha) {
    if (material !== this.normalMaterial || !clippedMeshes.size) {
      super._renderOverride(renderer, material, target, clearColor, clearAlpha);
      return;
    }
    this.clippedNormal ??= Object.assign(material.clone(), { clippingPlanes: [cutPlane] });
    // 조작 손잡이는 그리는 중에 자기 재질 색을 읽으므로 재질을 바꾸지 않고 이 패스에서만 감춘다.
    const helper = transform.getHelper();
    const helperVisible = helper.visible;
    helper.visible = false;
    const saved = [];
    this.scene.traverseVisible((n) => {
      if (!n.isMesh || [n.material].flat().every((m) => !m.visible)) return;
      saved.push([n, n.material]);
      n.material = clippedMeshes.has(n) ? this.clippedNormal : material;
    });
    const color = renderer.getClearColor(new THREE.Color());
    const alpha = renderer.getClearAlpha();
    const autoClear = renderer.autoClear;
    renderer.setRenderTarget(target);
    renderer.autoClear = false;
    renderer.setClearColor(clearColor);
    renderer.setClearAlpha(clearAlpha ?? 0);
    renderer.clear();
    renderer.render(this.scene, this.camera);
    renderer.autoClear = autoClear;
    renderer.setClearColor(color);
    renderer.setClearAlpha(alpha);
    for (const [n, m] of saved) n.material = m;
    helper.visible = helperVisible;
  }
}

const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const gtao = new ClippedGTAOPass(scene, camera, 1, 1);
gtao.updateGtaoMaterial({ radius: 0.35, thickness: 1.0, distanceFallOff: 1.0 });
composer.addPass(gtao);
composer.addPass(new OutputPass());

// CCTV 보기: 방 천장 모서리의 원근 카메라. GTAOPass는 카메라 종류(정사영·원근)를 만들 때 정하므로 합성기를 따로 둔다.
const cctvCam = new THREE.PerspectiveCamera(70, 1, 0.05, 60);
const cctvComposer = new EffectComposer(renderer);
cctvComposer.addPass(new RenderPass(scene, cctvCam));
const cctvAO = new ClippedGTAOPass(scene, cctvCam, 1, 1);
cctvAO.updateGtaoMaterial({ radius: 0.25, thickness: 1.0, distanceFallOff: 1.0 });
cctvComposer.addPass(cctvAO);
cctvComposer.addPass(new OutputPass());
const CCTV_HFOV = 115; // 가로 화각(도). 넓은 감시 카메라처럼 방 모서리에서 방이 거의 다 들어온다(cctv.mjs와 같은 값)
const cctv = { room: null, pose: null, yaw0: 0, pitch0: 0, yaw: 0, pitch: 0, zoom: 1, clock: null };

// --- 불러오기 ---------------------------------------------------------------------------------
const failures = [];
const manager = new THREE.LoadingManager();
manager.onError = (url) => failures.push(url);
const loader = new GLTFLoader(manager);
const cache = new Map();
const load = (url) => {
  if (!cache.has(url)) cache.set(url, loader.loadAsync(url));
  return cache.get(url);
};

let data = null; // scene.json
let entries = new Map(); // id → scene.json 객체
let nodes = new Map(); // id → 인스턴스 노드(지금 불러온 방식)
let sceneRoot = null; // 지금 불러온 'Apartment' 노드(실행 중 더한 객체를 여기에 넣는다)
let items = new Map(); // id → {entry, node, states, attrs, targets, placeholder, wiring, badge} (상태 있는 것)
let walls = [];
let wallOf = new Map(); // 문·창 id → 벽 id
let stateCtx = createContext();
const stateStore = new Map(); // id → {attr: value}. 불러오기 방식을 바꿔도 유지한다.
let mode = "scene";
let loading = false;
let selected = null;
let token = 0;
let viewHeight = 10; // 전체 화면(zoom 1)의 정사영 세로 길이
let home = { target: [0, 0, 0] };
const view = { wallMode: "full", focus: null, showCeiling: false, isolate: true, badges: true, dirty: true, cctv: false };
// 폰 기준점 벽 고르기 중이면 대시보드가 준 콜백(startPick). 아래 '폰 기준점' 절과 CCTV가 같이 쓴다
let pickHandler = null;
let connects = new Map(); // 문·창 id → 맞닿은 방들(openingRooms)
const results = {};
let ready = Promise.resolve();
let liveHook = null; // ?live=: 사용자가 바꾼 상태를 twin-home으로 보낸다(live.mjs)

// 상태 빛 풀: 종류별 빛을 불러올 때 한 번 만들어 장면에 세기 0으로 두고, 켤 때 빌려 기준점 자리로 옮긴다.
// three.js는 장면의 빛 개수가 바뀌면 모든 재질의 셰이더를 다시 만들어 화면이 10초 넘게 멈춘다(실제 GPU에서도).
// 풀 크기는 종류마다 기준점 수와 상한 중 작은 값이다. 빛마다 픽셀 계산이 늘어서 상한을 둔다.
const POOL_CAP = { spot: 11, area: 6, point: 6 };
let lightPool = { free: new Map(), all: [] };
const poolKind = (spec) => (spec.kind === "spot" || spec.kind === "area" ? spec.kind : "point");
const AREA_FORWARD = new THREE.Vector3(0, 0, -1); // RectAreaLight는 -Z로 비춘다
const lightScale = new THREE.Vector3();

function newPoolLight(kind) {
  let light;
  if (kind === "spot") {
    light = new THREE.SpotLight(0xffffff, 0, 0, Math.PI / 6, 0.4, 2);
    light.add(light.target);
  } else if (kind === "area") {
    light = new THREE.RectAreaLight(0xffffff, 0, 0.5, 0.5);
  } else {
    light = new THREE.PointLight(0xffffff, 0, 0, 2);
  }
  light.name = "state_light";
  light.castShadow = false;
  light.userData.kind = kind;
  return light;
}

function buildLightPool() {
  for (const light of lightPool.all) {
    scene.remove(light);
    light.dispose?.();
  }
  const count = { spot: 0, area: 0, point: 0 };
  content.traverse((n) => {
    const spec = n.userData?.light ? parseProp(n.userData.light) : null;
    if (spec) count[poolKind(spec)] += 1;
  });
  lightPool = { free: new Map(), all: [] };
  for (const [kind, n] of Object.entries(count)) {
    const list = Array.from({ length: Math.min(n, POOL_CAP[kind]) }, () => newPoolLight(kind));
    for (const light of list) scene.add(light);
    lightPool.free.set(kind, list);
    lightPool.all.push(...list);
  }
}

function makeLight(spec) {
  const light = lightPool.free.get(poolKind(spec))?.pop();
  if (!light) return null;
  if (Array.isArray(spec.color)) light.color.setRGB(...spec.color);
  else light.color.set(spec.color ?? "#ffffff");
  const dir = vec(spec.direction ?? [0, -1, 0]).normalize();
  if (light.isSpotLight) {
    light.angle = Math.min(deg(spec.angle_deg ?? 60) / 2, Math.PI / 2); // angle_deg는 원뿔 전체 각(Blender 규칙)
    light.distance = spec.distance ?? 0;
    light.target.position.copy(dir);
  } else if (light.isRectAreaLight) {
    [light.width, light.height] = spec.size ?? [0.5, 0.5];
    light.userData.aim = new THREE.Quaternion().setFromUnitVectors(AREA_FORWARD, dir);
  } else {
    light.distance = spec.distance ?? 0;
  }
  return light;
}

// 빛을 기준점의 월드 자리·방향에 둔다. 문짝처럼 움직이는 기준점을 따라가도록 그릴 때마다 다시 부른다.
function placeLight(light, anchor) {
  anchor.updateWorldMatrix(true, false);
  anchor.matrixWorld.decompose(light.position, light.quaternion, lightScale);
  if (light.userData.aim) light.quaternion.multiply(light.userData.aim);
}

function releaseLight(light) {
  light.intensity = 0;
  lightPool.free.get(light.userData.kind).push(light);
}

function setupStage() {
  const { camera: cam = {}, sun: light = {}, background = "#E2E0DC" } = data.stage ?? {};
  cam.direction ??= [0.4545, 0.766, 0.4545];
  light.direction ??= [-0.5446, 0.4951, 0.6634];
  scene.background = new THREE.Color(background);
  const pts = data.plan.rooms.flatMap((r) => r.polygon);
  const min = [Math.min(...pts.map((p) => p[0])), Math.min(...pts.map((p) => p[1]))];
  const max = [Math.max(...pts.map((p) => p[0])), Math.max(...pts.map((p) => p[1]))];
  const center = [(min[0] + max[0]) / 2, 0, (min[1] + max[1]) / 2];
  const radius = Math.hypot(max[0] - min[0], max[1] - min[1]) / 2 + 1;
  home = { target: cam.target ?? center, dir: cam.direction, box: { min: [min[0], 0, min[1]], max: [max[0], ceiling(), max[1]] } };
  camera.position.copy(vec(home.target)).addScaledVector(vec(cam.direction).normalize(), 40);
  orbit.target.copy(vec(home.target));
  sun.position.copy(vec(center)).addScaledVector(vec(light.direction).normalize(), radius + 10);
  sun.target.position.copy(vec(center));
  Object.assign(sun.shadow.camera, { left: -radius, right: radius, top: radius, bottom: -radius, near: 0.5, far: 2 * radius + 20 });
  fill.position.copy(vec(center)).addScaledVector(new THREE.Vector3(0.41, 0.85, 0.34), 20);
  fill.target.position.copy(vec(center));
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(radius * 8, radius * 8).rotateX(-Math.PI / 2),
    new THREE.MeshStandardMaterial({ color: background, roughness: 1 }),
  );
  ground.position.set(center[0], -0.15, center[2]);
  ground.receiveShadow = true;
  scene.add(ground);

  const rooms = $("room");
  for (const r of data.plan.rooms) rooms.append(new Option(r.label ?? r.id, r.id));
  wallOf = new Map([...(data.plan.doors ?? []), ...(data.plan.windows ?? [])].map((d) => [d.id, d.wall]));
  connects = openingRooms(data.plan, data.objects);
  resize();
}

const ceiling = () => data.plan.ceiling_height ?? 2.3;
const cutHeight = () => data.plan.wall_cut_height ?? 1.05;

async function fromScene() {
  const urls = uniqueAssets(data.objects);
  const gltfs = new Map();
  await Promise.all(urls.map(async (u) => {
    try { gltfs.set(u, await load(BASE + u)); } catch { failures.push(BASE + u); }
  }));
  const roots = new Map(); // 에셋 경로 → 최상위 노드(이름이 다르면 오류 문자열)
  for (const [u, gltf] of gltfs) {
    try { roots.set(u, assetRoot(gltf.scene, u)); } catch (error) { roots.set(u, error.message); }
  }
  const root = new THREE.Group();
  root.name = "Apartment";
  for (const entry of data.objects) {
    const asset = roots.get(entry.asset);
    if (!asset || typeof asset === "string") continue;
    const holder = new THREE.Group();
    holder.name = entry.id;
    holder.userData = { ...entry };
    applyTransform(holder, entry);
    holder.add(asset.clone(true));
    root.add(holder);
  }
  return { root, gltfs, roots };
}

async function fromComplete() {
  // 원본 gltf.scene은 위치 대조에 그대로 두고, 화면에는 복제본(메시·재질 공유)을 쓴다.
  const gltf = await load(COMPLETE);
  const apt = gltf.scene.getObjectByName("Apartment");
  if (!apt) throw new Error("apartment_complete.glb에 Apartment 노드가 없습니다");
  const root = apt.clone(true);
  for (const [id, node] of indexNodes(root, data.objects)) {
    const entry = entries.get(id);
    if (!entry) continue;
    if (node.userData.id === undefined) node.userData.id = id;
    if (node.userData.interactive === undefined) node.userData.interactive = entry.interactive;
  }
  return { root, gltfs: new Map(), roots: new Map() };
}

function prepare(root) {
  root.traverse((node) => {
    if (!node.isMesh) return;
    const transparent = [node.material].flat().some((m) => m.transparent);
    node.castShadow = !transparent;
    node.receiveShadow = true;
    // 투명한 양면 재질(물·빗줄기)은 뒷면·앞면 두 번 그리는 셰이더 변형이 따로 생겨, 미리 만들기(compileAsync)를
    // 비켜 가고 처음 켤 때 화면을 멈춘다. 한 번에 그린다.
    for (const m of [node.material].flat()) if (m.transparent && m.side === THREE.DoubleSide) m.forceSinglePass = true;
  });
}

// 상태 있는 객체 하나를 items에 올리고 지금 상태를 그린다. 상태가 없으면 null.
function setupItem(entry) {
  const node = nodes.get(entry.id);
  const states = statesOf(entry, node);
  if (!Object.keys(states).length) return null;
  const attrs = entry.attrs ?? {};
  const targets = node ? collectTargets(node) : null;
  const placeholder = isPlaceholder(node);
  const wiring = node ? wiringStatus(states, targets, placeholder) : { status: "missing", missing: ["노드 없음"] };
  const item = { entry, node, states, attrs, targets, placeholder, wiring, badge: null };
  items.set(entry.id, item);
  if (!stateStore.has(entry.id)) {
    const initial = Object.fromEntries(Object.keys(states).map((a) => [a, defaultValue(states, attrs, a)]));
    stateStore.set(entry.id, { ...initial, ...(entry.state ?? {}) });
  }
  if (!node) return item;
  applyState(stateCtx, item.targets, states, attrs, stateStore.get(entry.id));
  item.badge = makeBadge(node);
  return item;
}

function setupStates() {
  buildLightPool();
  stateCtx = createContext({ makeLight, maxLights: MAX_LIGHTS, placeLight, releaseLight });
  items = new Map();
  content.updateMatrixWorld(true);
  for (const entry of data.objects) setupItem(entry);
  for (const id of items.keys()) updateBadge(id);
}

async function show(next) {
  const mine = ++token;
  mode = next;
  loading = true;
  $("mode").value = next;
  select(null);
  $("status").textContent = "불러오는 중…";
  for (const key of Object.keys(results)) delete results[key];
  let loaded;
  try {
    loaded = next === "complete" ? await fromComplete() : await fromScene();
  } catch (error) {
    if (mine !== token) return;
    loading = false;
    $("status").textContent = `불러오기 실패: ${error.message}`;
    $("report").replaceChildren(line(false, `불러오기 실패: ${error.message}`));
    Object.assign(results, { mode: next, error: String(error) });
    return;
  }
  if (mine !== token) return;
  for (const item of items.values()) item.badge?.element.remove(); // CSS2D 요소는 DOM에 남으므로 직접 지운다
  content.clear();
  clippedMeshes.clear();
  prepare(loaded.root);
  content.add(loaded.root);
  sceneRoot = loaded.root;
  nodes = indexNodes(loaded.root, data.objects);
  walls = collectWalls(loaded.root, data.plan.walls);
  wallCache.clear();
  objCache.clear();
  try {
    setupStates();
    buildDevicePanel();
    renderStatus();
    view.dirty = true;
    if (view.cctv) cctvView(cctv.room); // 불러오기 방식을 바꿔도 보던 CCTV를 다시 잡는다
    updateVisibility();
    // 꺼져 있어 숨은 효과 부품(바람·물·증기)의 셰이더도 미리 만든다. 안 그러면 처음 켤 때 화면이 몇 초 멈춘다.
    renderer.compileAsync(scene, camera).catch(() => {});
    await report(next, loaded.root, loaded.roots);
  } catch (error) {
    $("report").append(line(false, `검사 중 오류: ${error.message}`, "error"));
    Object.assign(results, { mode: next, error: String(error) });
    throw error;
  } finally {
    if (mine === token) loading = false;
  }
}

// --- 벽·천장·장식 보이기 ------------------------------------------------------------------------
const wallCache = new Map();
const objCache = new Map();
let lastHeading = [NaN, NaN];

function setHidden(root, hidden) {
  root.traverse((n) => {
    if (n.isMesh || n.isCSS2DObject) n.layers.set(hidden ? HIDDEN : 0);
  });
}

function setClipped(root, clipped) {
  root.traverse((n) => {
    if (!n.isMesh) return;
    for (const m of ownMaterials(stateCtx, n)) m.clippingPlanes = clipped ? [cutPlane] : null;
    if (clipped) clippedMeshes.add(n);
    else clippedMeshes.delete(n);
  });
}

function updateVisibility() {
  const heading = cameraHeading(camera.position.toArray(), orbit.target.toArray());
  const turned = Math.hypot(heading[0] - lastHeading[0], heading[1] - lastHeading[1]) > 1e-3;
  if (!view.dirty && !turned) return;
  view.dirty = false;
  lastHeading = heading;
  cutPlane.constant = cutHeight();
  // CCTV는 방 안에서 보므로 벽을 모두 세우고, 문 너머 옆방 가구와 천장 조명도 그대로 둔다
  const shown = view.cctv ? { ...view, isolate: false, showCeiling: true } : view;
  const upper = wallVisibility(walls, { mode: view.cctv ? "full" : view.wallMode, heading, focus: view.focus });
  for (const w of walls) {
    const shown = upper.get(w.id);
    if (!w.upper || wallCache.get(w.id) === shown) continue;
    wallCache.set(w.id, shown);
    setHidden(w.upper, !shown);
  }
  for (const entry of data.objects) {
    const node = nodes.get(entry.id);
    if (!node) continue;
    const item = items.get(entry.id);
    const action = cutAction(item ? { ...entry, states: item.states } : entry, upper, cutHeight(), wallOf);
    const hidden = !ceilingVisible(entry, shown) || action === "hide" || !focusVisible(entry, { ...shown, connects });
    const clipped = action === "clip";
    const prev = objCache.get(entry.id) ?? { hidden: false, clipped: false };
    if (prev.hidden !== hidden) setHidden(node, hidden);
    if (prev.clipped !== clipped) setClipped(node, clipped);
    objCache.set(entry.id, { hidden, clipped });
  }
}

// --- 카메라: 전체·방 초점 -----------------------------------------------------------------------
let anim = null;
const aspect = () => canvas.clientWidth / Math.max(canvas.clientHeight, 1);

// 화면 맞추기에 쓰는 비율: 넓은 화면에서는 양옆 패널이 가리는 폭을 뺀다(가운데 정렬은 그대로).
function frameAspect() {
  const w = canvas.clientWidth;
  if (window.innerWidth <= 760) return aspect();
  const covered = Math.max(...[...document.querySelectorAll(".panel")].map((p) => p.getBoundingClientRect().width + 12));
  return Math.max(w - 2 * covered, w * 0.4) / Math.max(canvas.clientHeight, 1);
}

function focusRoom(id, { instant = false } = {}) {
  if (view.cctv) { // CCTV를 보는 중이면 방을 고르는 것은 카메라를 바꾸는 것이고, 전체는 CCTV를 끄는 것이다
    if (!id) return exitCctv(null);
    cctvView(id);
    return Promise.resolve();
  }
  const room = id ? data.plan.rooms.find((r) => r.id === id) : null;
  if (id && !room) throw new Error(`방 ${id}이 평면도에 없습니다`);
  view.focus = room ? room.id : null;
  view.dirty = true;
  $("room").value = view.focus ?? "";
  const dir = camera.position.clone().sub(orbit.target).normalize();
  let target;
  let zoom = 1;
  if (room) {
    const fit = fitOrtho(roomBox(room, ceiling()), dir.toArray(), frameAspect(), 1.25);
    target = vec(fit.center);
    zoom = viewHeight / fit.height;
  } else {
    target = vec(home.target);
  }
  openRoomGroup(view.focus);
  const to = { target, zoom, dir };
  if (instant) {
    anim?.resolve();
    anim = null;
    placeCamera(to.target, to.zoom, dir);
    updateVisibility();
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    anim?.resolve();
    anim = { from: { target: orbit.target.clone(), zoom: camera.zoom }, to, t0: performance.now(), duration: 650, resolve };
  });
}

function placeCamera(target, zoom, dir) {
  orbit.target.copy(target);
  camera.position.copy(target).addScaledVector(dir, 40);
  camera.zoom = zoom;
  camera.updateProjectionMatrix();
  orbit.update();
}

function stepAnimation(now) {
  if (!anim) return;
  const t = Math.min(1, (now - anim.t0) / anim.duration);
  const e = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
  const target = anim.from.target.clone().lerp(anim.to.target, e);
  placeCamera(target, THREE.MathUtils.lerp(anim.from.zoom, anim.to.zoom, e), anim.to.dir);
  if (t >= 1) {
    const done = anim.resolve;
    anim = null;
    done();
  }
}

// --- CCTV: 방 천장 모서리 카메라 --------------------------------------------------------------------
// 실제 메시만으로 잰 상자(꺼진 바람·물 같은 효과 부품과 백스플래시처럼 크기에서 빠지는 부품은 뺀다)
const meshBox = new THREE.Box3();
function solidBox(node) {
  const box = new THREE.Box3();
  node.updateWorldMatrix(true, true);
  node.traverse((n) => {
    if (!n.isMesh) return;
    for (let a = n; a && a !== node; a = a.parent) if (a.userData?.effect || a.userData?.no_bounds) return;
    if (!n.geometry.boundingBox) n.geometry.computeBoundingBox();
    box.union(meshBox.copy(n.geometry.boundingBox).applyMatrix4(n.matrixWorld));
  });
  return box;
}

// 카메라를 둘 수 없거나 시선을 가리는 키 큰 가구(옷장·상부장·냉장고·커튼 등). 평면도 좌표 상자 + 윗면 높이
function cctvObstacles() {
  const out = [];
  for (const entry of data.objects) {
    if (entry.mount === "opening" || entry.mount === "ceiling" || entry.category === "structure") continue;
    const node = nodes.get(entry.id);
    if (!node) continue;
    const box = solidBox(node);
    if (box.isEmpty() || box.max.y < 1.6) continue;
    out.push({ min: [box.min.x, box.min.z], max: [box.max.x, box.max.z], top: box.max.y });
  }
  return out;
}

function aimCctv() {
  const yaw = cctv.yaw0 + cctv.yaw;
  const pitch = THREE.MathUtils.clamp(cctv.pitch0 + cctv.pitch, deg(-80), deg(-2));
  cctv.pitch = pitch - cctv.pitch0;
  const d = new THREE.Vector3(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch));
  cctvCam.lookAt(cctvCam.position.clone().add(d));
  cctvCam.aspect = aspect();
  // 가로 화각을 지키도록 세로 화각(three.js fov)을 화면 비율에 맞춘다. 휠로 당기면 화각을 줄인다.
  const h = deg(CCTV_HFOV) / cctv.zoom;
  cctvCam.fov = THREE.MathUtils.clamp(THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(h / 2) / cctvCam.aspect)), 18, 115);
  cctvCam.updateProjectionMatrix();
}

const roomLabel = (id) => data.plan.rooms.find((r) => r.id === id)?.label ?? id;

function nextRoom(step) {
  const ids = data.plan.rooms.map((r) => r.id);
  const i = ids.indexOf(cctv.room);
  return ids[(i + step + ids.length) % ids.length];
}

function cctvView(roomId) {
  const rooms = data.plan.rooms;
  const room = rooms.find((r) => r.id === roomId) ?? rooms.find((r) => r.id === "living_room") ?? rooms[0];
  // 이 방의 상태 있는 물건(천장·문·창 제외): 정면이 보이는 모서리를 고르게 한다
  const targets = [...items.values()]
    .filter((i) => i.entry.room === room.id && i.entry.plan?.position && !["ceiling", "opening"].includes(i.entry.mount))
    .map((i) => {
      const f = deg(i.entry.plan.facing_deg ?? 0);
      return { p: i.entry.plan.position, front: [Math.cos(f), Math.sin(f)] };
    });
  const pose = cctvPose(room, { ceiling: ceiling(), hfovDeg: CCTV_HFOV, obstacles: cctvObstacles(), targets });
  const d = vec(pose.target).sub(vec(pose.position)).normalize();
  Object.assign(cctv, { room: room.id, pose, yaw0: Math.atan2(d.x, d.z), pitch0: Math.asin(d.y), yaw: 0, pitch: 0, zoom: 1 });
  cctvCam.position.set(...pose.position);
  aimCctv();
  anim?.resolve();
  anim = null;
  if (pickHandler) finishPick(null); // CCTV에서는 누르기가 카메라 돌리기라 벽 고르기를 취소한다
  view.cctv = true;
  view.focus = room.id;
  view.dirty = true;
  orbit.enabled = false;
  select(null);
  $("room").value = room.id;
  $("cctv").setAttribute("aria-pressed", "true");
  $("cctv").textContent = "CCTV 끄기";
  document.body.classList.add("cctv-on");
  $("cctv-overlay").hidden = false;
  $("cctv-name").textContent = `CAM ${String(rooms.indexOf(room) + 1).padStart(2, "0")} · ${room.label ?? room.id}`;
  tickClock();
  cctv.clock ??= setInterval(tickClock, 1000);
  openRoomGroup(room.id);
  renderStatus();
  updateVisibility();
  return pose;
}

// CCTV를 끄고 위에서 보는 화면으로. room을 주면 그 방(null이면 전체), 안 주면 보던 방에 초점을 둔다.
function exitCctv(room = cctv.room) {
  if (!view.cctv) return Promise.resolve();
  view.cctv = false;
  view.dirty = true;
  orbit.enabled = true;
  clearInterval(cctv.clock);
  cctv.clock = null;
  $("cctv").setAttribute("aria-pressed", "false");
  $("cctv").textContent = "CCTV로 보기";
  document.body.classList.remove("cctv-on");
  $("cctv-overlay").hidden = true;
  return focusRoom(room, { instant: true });
}

function tickClock() {
  const t = new Date();
  const two = (v) => String(v).padStart(2, "0");
  $("cctv-time").textContent = `${t.getFullYear()}-${two(t.getMonth() + 1)}-${two(t.getDate())} ${two(t.getHours())}:${two(t.getMinutes())}:${two(t.getSeconds())}`;
}

// 끌어서 카메라 돌리기(잡아끄는 느낌: 오른쪽으로 끌면 장면이 오른쪽으로 간다), 휠로 확대
let ptz = null;
canvas.addEventListener("pointerdown", (event) => {
  if (!view.cctv) return;
  ptz = { x: event.clientX, y: event.clientY, yaw: cctv.yaw, pitch: cctv.pitch };
  canvas.setPointerCapture(event.pointerId);
});
canvas.addEventListener("pointermove", (event) => {
  if (!view.cctv || !ptz) return;
  cctv.yaw = THREE.MathUtils.clamp(ptz.yaw + (event.clientX - ptz.x) * 0.004, deg(-75), deg(75));
  cctv.pitch = ptz.pitch + (event.clientY - ptz.y) * 0.004;
  aimCctv();
});
canvas.addEventListener("pointerup", () => { ptz = null; });
canvas.addEventListener("wheel", (event) => {
  if (!view.cctv) return;
  event.preventDefault();
  cctv.zoom = THREE.MathUtils.clamp(cctv.zoom * (event.deltaY < 0 ? 1.1 : 1 / 1.1), 0.88, 3); // 0.88: 가로 약 130°까지 더 넓게
  aimCctv();
}, { passive: false });

// --- 상태 ----------------------------------------------------------------------------------------
function resolveValue(item, attr, value) {
  const values = attrValues(item.states, item.attrs, attr);
  return values.find((v) => valueKey(v) === valueKey(value) || valueKey(v) === String(value));
}

function setState(id, attr, value) {
  const item = items.get(id);
  if (!item || !item.states[attr]) throw new Error(`${id}: 상태 ${attr}이 없습니다`);
  const v = resolveValue(item, attr, value);
  if (v === undefined) throw new Error(`${id}.${attr}: 값 ${valueKey(value)}이 없습니다`);
  if (liveHook?.(id, attr, v) === false) { syncControls(id); return false; } // ?live: twin-home으로 보냄(live.mjs)
  const before = stateStore.get(id)[attr];
  stateStore.get(id)[attr] = v;
  if (valueKey(before) !== valueKey(v)) announce(id, attr, v);
  if (item.targets) applyAttr(stateCtx, item.targets, attr, item.states[attr], v);
  updateBadge(id);
  syncControls(id);
  scheduleStatus();
  return true;
}

const getState = (id) => ({ ...(stateStore.get(id) ?? {}) });

function setAllPower(on) {
  for (const [id, item] of items) {
    for (const attr of Object.keys(item.states)) {
      const p = powerValues(attrValues(item.states, item.attrs, attr));
      if (p) setState(id, attr, on ? p.on : p.off);
    }
  }
}

// 상태가 바뀐 기기 위에 말풍선을 잠깐 띄운다(채팅·실시간 연결로 무엇이 켜졌는지 바로 보이게).
// 한꺼번에 많이 바뀌면(모두 켜기, 연결 직후 스냅숏) 말풍선 대신 개수만 알린다. "상태 배지"를 끄면 띄우지 않는다.
const BUBBLE_MAX = 6;
const BUBBLE_MS = 3600;
const announced = [];
function announce(id, attr, value) {
  announced.push({ id, attr, value });
  if (announced.length === 1) queueMicrotask(flushAnnounced);
}

function flushAnnounced() {
  const list = announced.splice(0);
  if (!view.badges || !data) return;
  if (list.length > BUBBLE_MAX) {
    notify(`가전 ${new Set(list.map((c) => c.id)).size}개의 상태가 바뀌었어요`);
    return;
  }
  list.forEach((c, i) => popBubble(c, i));
}

// order: 한꺼번에 뜬 말풍선의 순서. 가까운 기기(TV와 천장등)의 말풍선이 겹치지 않게 위로 쌓는다.
function popBubble({ id, attr, value }, order = 0) {
  const item = items.get(id);
  if (!item?.node) return;
  const box = solidBox(item.node);
  if (box.isEmpty()) return;
  // CSS2DRenderer가 바깥 요소의 transform으로 자리를 잡으므로, 모양·애니메이션은 안쪽 요소에 준다
  const holder = document.createElement("div");
  const bubble = document.createElement("div");
  bubble.className = `bubble ${changeTone(item.states, item.attrs, attr, value)}`;
  bubble.style.marginBottom = `${10 + order * 34}px`;
  bubble.textContent = `${item.entry.name ?? id} ${stateText(attr, value)}`;
  holder.append(bubble);
  const label = new CSS2DObject(holder);
  label.position.copy(item.node.worldToLocal(new THREE.Vector3((box.min.x + box.max.x) / 2, box.max.y + 0.12, (box.min.z + box.max.z) / 2)));
  label.center.set(0.5, 1);
  item.node.add(label);
  setTimeout(() => item.node.remove(label), BUBBLE_MS); // CSS2DObject는 빠질 때 자기 요소를 DOM에서 지운다
}

function makeBadge(node) {
  const el = document.createElement("div");
  el.className = "badge";
  const badge = new CSS2DObject(el);
  const box = new THREE.Box3().setFromObject(node);
  if (box.isEmpty()) return null;
  const top = new THREE.Vector3((box.min.x + box.max.x) / 2, box.max.y + 0.08, (box.min.z + box.max.z) / 2);
  badge.position.copy(node.worldToLocal(top));
  badge.center.set(0.5, 1);
  node.add(badge);
  return badge;
}

function updateBadge(id) {
  const item = items.get(id);
  if (!item?.badge) return;
  const changed = nonDefault(item.states, item.attrs, stateStore.get(id));
  item.badge.element.textContent = `${item.entry.name ?? id} ${changed.map(([a, v]) => valueLabel(a, v)).join(" · ")}`;
  item.badge.visible = view.badges && changed.length > 0;
}

// --- 가전 패널 -------------------------------------------------------------------------------------
function controlFor(id, item, attr) {
  const values = attrValues(item.states, item.attrs, attr);
  const current = stateStore.get(id)[attr];
  const row = document.createElement("div");
  row.className = "control";
  row.dataset.id = id;
  row.dataset.attr = attr;
  if (values.length === 2) {
    const def = defaultValue(item.states, item.attrs, attr);
    const p = powerValues(values);
    const on = p ? p.on : values.find((v) => valueKey(v) !== valueKey(def));
    const off = values.find((v) => valueKey(v) !== valueKey(on));
    const label = document.createElement("label");
    label.className = "switch";
    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = valueKey(current) === valueKey(on);
    input.addEventListener("change", () => setState(id, attr, input.checked ? on : off));
    const text = document.createElement("span");
    label.append(input, text);
    row.append(`${attrLabel(attr)}`, label);
    row.sync = (v) => { input.checked = valueKey(v) === valueKey(on); text.textContent = valueLabel(attr, v); };
  } else {
    const sel = document.createElement("select");
    for (const v of values) sel.append(new Option(valueLabel(attr, v), valueKey(v)));
    sel.addEventListener("change", () => setState(id, attr, sel.value));
    row.append(`${attrLabel(attr)}`, sel);
    row.sync = (v) => { sel.value = valueKey(v); };
  }
  row.sync(current);
  return row;
}

function deviceRow(id, item) {
  const div = document.createElement("div");
  div.className = item.placeholder ? "device placeholder" : "device";
  div.dataset.id = id;
  const name = document.createElement("button");
  name.type = "button";
  name.className = "name";
  name.textContent = item.entry.name ?? id;
  name.title = `${id} (${item.entry.type ?? ""})${item.placeholder ? " · 회색 상자(빌더 없음)" : ""}`;
  name.addEventListener("click", () => {
    focusRoom(data.plan.rooms.some((r) => r.id === item.entry.room) ? item.entry.room : null);
    if (item.entry.interactive && item.node) select(item.node);
  });
  div.append(name, ...Object.keys(item.states).map((attr) => controlFor(id, item, attr)));
  div.classList.toggle("active", nonDefault(item.states, item.attrs, stateStore.get(id)).length > 0);
  return div;
}

function buildDevicePanel() {
  const list = $("devices");
  list.replaceChildren();
  const groups = groupByRoom([...items.values()].map((i) => i.entry), data.plan.rooms);
  for (const g of groups) {
    const details = document.createElement("details");
    details.dataset.room = g.id ?? "";
    details.open = groups.length <= 3 || g.id === view.focus;
    const summary = document.createElement("summary");
    const count = document.createElement("span");
    count.className = "count";
    count.textContent = `${g.items.length}`;
    summary.append(g.label, count);
    details.append(summary, ...g.items.map((e) => deviceRow(e.id, items.get(e.id))));
    list.append(details);
  }
}

function openRoomGroup(room) {
  for (const d of $("devices").querySelectorAll("details")) if (room && d.dataset.room === room) d.open = true;
}

function syncControls(id) {
  const item = items.get(id);
  const state = stateStore.get(id);
  for (const row of document.querySelectorAll(`.control[data-id="${CSS.escape(id)}"]`)) row.sync?.(state[row.dataset.attr]);
  for (const div of document.querySelectorAll(`.device[data-id="${CSS.escape(id)}"]`)) {
    div.classList.toggle("active", nonDefault(item.states, item.attrs, state).length > 0);
  }
}

// --- 가전 상태(오른쪽 패널, CCTV 화면) -----------------------------------------------------------------
// 상태가 한꺼번에 바뀌어도(모두 켜기, 실시간 연결 스냅숏) 한 번만 다시 그린다
let statusQueued = false;
function scheduleStatus() {
  if (statusQueued) return;
  statusQueued = true;
  queueMicrotask(() => {
    statusQueued = false;
    renderStatus();
  });
}

function stateLine(d, className) {
  const el = document.createElement(className === "active-item" ? "button" : "li");
  el.className = className;
  if (className === "active-item") el.type = "button";
  const name = document.createElement("span");
  name.className = "name";
  name.textContent = d.name;
  const what = document.createElement("span");
  what.className = "what";
  what.textContent = d.labels.join(" · ");
  el.append(name, what);
  return el;
}

function renderStatus() {
  if (!data) return;
  const active = activeDevices(items, (id) => stateStore.get(id));
  $("active-count").textContent = `켜짐 ${active.length} / ${items.size}`;
  const list = $("active-list");
  list.replaceChildren();
  if (!active.length) {
    const p = document.createElement("div");
    p.className = "muted";
    p.textContent = "모든 가전이 꺼져 있어요";
    list.append(p);
  }
  for (const g of groupByRoom(active, data.plan.rooms)) {
    const head = document.createElement("div");
    head.className = "active-room";
    head.textContent = g.label;
    list.append(head);
    for (const d of g.items) {
      const row = stateLine(d, "active-item");
      row.title = "이 방으로 가기";
      row.addEventListener("click", () => (view.cctv ? cctvView(d.room) : focusRoom(d.room ?? null)));
      list.append(row);
    }
  }
  if (view.cctv) {
    const here = active.filter((d) => d.room === cctv.room);
    const box = $("cctv-devices");
    box.replaceChildren(...here.map((d) => stateLine(d, "cctv-device")));
    if (!here.length) {
      const li = document.createElement("li");
      li.textContent = `${roomLabel(cctv.room)}: 켜진 가전 없음`;
      box.append(li);
    }
  }
}

let toastTimer = null;
function notify(text) {
  const el = $("toast");
  el.textContent = text;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 3000);
}

// --- 검사 -------------------------------------------------------------------------------------
function line(ok, text, key = "") {
  const li = document.createElement("li");
  li.className = ok ? "ok" : "bad";
  li.dataset.key = key;
  li.textContent = `${ok ? "✓" : "✗"} ${text}`;
  return li;
}

function textures(root) {
  const maps = new Set();
  root.traverse((node) => {
    if (!node.isMesh) return;
    for (const m of [node.material].flat()) {
      for (const key of ["map", "normalMap", "emissiveMap", "roughnessMap", "metalnessMap", "aoMap", "alphaMap"]) {
        if (m[key]) maps.add(m[key]);
      }
    }
  });
  const broken = [...maps].filter((t) => !t.image || !(t.image.width > 0));
  return { count: maps.size, broken };
}

async function deviation() {
  // apartment_complete.glb의 각 인스턴스 월드 행렬 vs scene.json 변환. ?debug=1이 아니면 대조하지 않는다(checked: false)
  if (!CHECK_COMPLETE) return { checked: false, loaded: false, max: Infinity, missing: [] };
  let complete;
  try {
    complete = (await load(CHECK_COMPLETE)).scene;
  } catch {
    return { checked: true, loaded: false, max: Infinity, missing: [] };
  }
  complete.updateMatrixWorld(true);
  const found = indexNodes(complete, data.objects);
  return { checked: true, loaded: true, ...maxDeviation(data.objects, (id) => found.get(id)?.matrixWorld.elements) };
}

function independence() {
  // 고를 수 있는 객체마다 옮기고 돌린 뒤, 다른 인스턴스의 월드 행렬이 그대로인지 본다.
  content.updateMatrixWorld(true);
  const all = [...nodes.values()];
  const before = new Map(all.map((n) => [n, n.matrixWorld.clone()]));
  const same = (n) => matrixDiff(n.matrixWorld.elements, before.get(n).elements) < 1e-9;
  const movable = all.filter((n) => n.userData.interactive);
  const failed = [];
  for (const node of movable) {
    const saved = { p: node.position.clone(), q: node.quaternion.clone() };
    node.position.x += 0.3;
    node.rotation.y += deg(30);
    content.updateMatrixWorld(true);
    if (same(node)) failed.push(`${node.userData.id}(안 움직임)`);
    for (const other of all) if (other !== node && !same(other)) failed.push(`${node.userData.id}→${other.userData.id ?? other.name}`);
    node.position.copy(saved.p);
    node.quaternion.copy(saved.q);
    content.updateMatrixWorld(true);
  }
  return { tested: movable.length, failed };
}

// 회색 상자(빌더 없음)는 효과 대상이 없는 것이 당연하므로 누락으로 세지 않고 따로 센다(apt-check 경고와 같다).
function stateWiring() {
  const missing = [];
  const noBuilder = [];
  let effects = 0;
  for (const [id, item] of items) {
    for (const spec of Object.values(item.states)) effects += Object.values(spec.effects ?? {}).flat().length;
    if (item.wiring.status === "no-builder") noBuilder.push(id);
    else if (item.wiring.status === "missing") missing.push(...item.wiring.missing.map((m) => `${id} ${m}`));
  }
  return { objects: items.size, effects, missing, noBuilder };
}

const frameTimes = [];
let lastFrame = 0;

function frameLine() {
  const avg = frameTimes.length ? frameTimes.reduce((a, b) => a + b, 0) / frameTimes.length : NaN;
  results.frameMs = Number.isFinite(avg) ? Math.round(avg * 10) / 10 : null;
  return line(Number.isFinite(avg), `프레임 시간 ${Number.isFinite(avg) ? avg.toFixed(1) : "-"} ms (최근 ${frameTimes.length}장 평균)`, "frame");
}

async function report(loadMode, root, roots) {
  const list = $("report");
  list.replaceChildren();
  const missingNodes = data.objects.filter((o) => !nodes.has(o.id)).map((o) => o.id);
  list.append(line(!missingNodes.length, `객체 ${nodes.size}/${data.objects.length}개 ${missingNodes.slice(0, 6).join(", ")}`, "objects"));

  let notIdentity = [];
  if (loadMode === "scene") {
    const bad = [...roots].filter(([, r]) => typeof r === "string").map(([, r]) => r);
    notIdentity = [...roots].filter(([, r]) => typeof r !== "string" && !isIdentity(r)).map(([path]) => path);
    const missingAssets = uniqueAssets(data.objects).filter((u) => !roots.has(u)).map((u) => `${u}(없음)`);
    const problems = [...notIdentity, ...bad, ...missingAssets];
    list.append(line(!problems.length, `개별 GLB ${roots.size}개, 최상위 노드 = 파일 이름·변환 항등 ${problems.slice(0, 4).join(", ")}`, "roots"));
  } else {
    const groups = root.children.filter((c) => !c.userData.id);
    notIdentity = [root, ...groups].filter((n) => !isIdentity(n)).map((n) => n.name);
    list.append(line(!notIdentity.length, `Apartment·분류 ${groups.length}개 변환 항등 ${notIdentity.join(", ")}`, "roots"));
  }

  const tex = textures(root);
  const imageFailures = failures.filter((u) => !u.endsWith(".glb")); // GLB 자체 실패는 객체·루트 줄에서 본다
  list.append(line(!tex.broken.length && !imageFailures.length,
    `텍스처 ${tex.count}개, 누락 ${tex.broken.length + imageFailures.length}개`, "textures"));

  const dev = await deviation();
  if (dev.checked) list.append(line(dev.loaded && dev.max < 1e-4 && !dev.missing.length, dev.loaded
    ? `apartment_complete.glb 위치 = scene.json (최대 차이 ${dev.max.toExponential(1)}) ${dev.missing.slice(0, 4).join(", ")}`
    : "apartment_complete.glb을 읽지 못해 위치를 대조하지 못했습니다", "deviation"));

  const ind = independence();
  list.append(line(ind.tested > 0 && !ind.failed.length, `독립 이동·회전 ${ind.tested}개 ${ind.failed.slice(0, 5).join(", ")}`, "independence"));

  const wiring = stateWiring();
  const ghosts = wiring.noBuilder.length ? `, 빌더 없음(회색 상자) ${wiring.noBuilder.length}개` : "";
  list.append(line(!wiring.missing.length,
    `상태 연결 ${wiring.objects}개 객체·효과 ${wiring.effects}개, 누락 ${wiring.missing.length}개${ghosts} ${wiring.missing.slice(0, 4).join(", ")}`, "states"));

  list.append(frameLine());

  let triangles = 0;
  root.traverse((n) => {
    if (n.isMesh) triangles += (n.geometry.index ? n.geometry.index.count : n.geometry.attributes.position.count) / 3;
  });
  Object.assign(results, {
    mode: loadMode, objects: nodes.size, expected: data.objects.length, missingNodes, notIdentity,
    textures: tex.count, brokenTextures: tex.broken.length, loadFailures: [...failures], deviation: dev.max,
    deviationMissing: dev.missing, completeLoaded: dev.loaded, independence: ind, stateObjects: wiring.objects,
    stateEffects: wiring.effects, stateMissing: wiring.missing, stateNoBuilder: wiring.noBuilder.reduce((n, id) => n + Object.keys(items.get(id)?.states ?? {}).length, 0),
    stateNoBuilderObjects: wiring.noBuilder, triangles,
  });
  updateStatus();
}

function updateStatus() {
  const label = mode === "scene" ? "scene.json + 개별 GLB" : "apartment_complete.glb";
  const skipped = stateCtx.skipped.size ? ` (최대 ${MAX_LIGHTS}개라 ${stateCtx.skipped.size}개 못 켬)` : "";
  $("status").textContent = `${label} · 삼각형 ${Math.round((results.triangles ?? 0) / 1000)}k · 상태 빛 ${stateCtx.lights.size}개${skipped}`;
}

// --- 고르기·조작 ----------------------------------------------------------------------------------
function describe() {
  const box = $("selected");
  const states = $("selected-states");
  states.replaceChildren();
  if (!selected) {
    box.className = "muted";
    box.textContent = "가구·가전·소품을 클릭하세요. 벽·바닥·문·창·천장 조명은 고정입니다.";
    return;
  }
  const e = entries.get(selected.userData.id);
  const p = selected.position;
  const yaw = THREE.MathUtils.radToDeg(2 * Math.atan2(selected.quaternion.y, selected.quaternion.w));
  box.className = "";
  box.replaceChildren();
  const rows = [
    ["id", e.id], ["이름", e.name], ["종류", e.type], ["방", data.plan.rooms.find((r) => r.id === e.room)?.label ?? e.room],
    ["위치", `${p.x.toFixed(2)}, ${p.y.toFixed(2)}, ${p.z.toFixed(2)}`], ["회전 Y", `${yaw.toFixed(1)}°`],
  ];
  for (const [k, v] of rows) {
    const div = document.createElement("div");
    const code = document.createElement("code");
    code.textContent = v ?? "";
    div.append(`${k}: `, code);
    box.append(div);
  }
  const item = items.get(e.id);
  if (item) states.append(...Object.keys(item.states).map((attr) => controlFor(e.id, item, attr)));
}

function select(node) {
  selected = node && node.userData.interactive ? node : null;
  if (selected) transform.attach(selected);
  else transform.detach();
  describe();
}

function setMode(next) {
  transform.setMode(next);
  transform.showX = next === "translate";
  transform.showY = next === "rotate";
  transform.showZ = next === "translate";
  $("translate").setAttribute("aria-pressed", String(next === "translate"));
  $("rotate").setAttribute("aria-pressed", String(next === "rotate"));
}

function exportPlacement({ download = true } = {}) {
  const poses = new Map();
  for (const [id, node] of nodes) {
    const p = node.getWorldPosition(new THREE.Vector3());
    const q = node.getWorldQuaternion(new THREE.Quaternion());
    poses.set(id, { position: p.toArray(), quaternion: q.toArray() });
  }
  const out = placementExport(data.objects, poses);
  if (download) {
    const blob = new Blob([`${JSON.stringify(out, null, 2)}\n`], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "placement_moved.json";
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    notify(out.items.length ? `옮긴 객체 ${out.items.length}개를 내보냈습니다` : "옮긴 객체가 없습니다");
  }
  return out;
}

transform.addEventListener("dragging-changed", (event) => { orbit.enabled = !event.value; });
transform.addEventListener("objectChange", describe);

const isShown = (obj) => {
  for (let n = obj; n; n = n.parent) if (!n.visible) return false;
  return true;
};

const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
let down = null;
canvas.addEventListener("pointerdown", (event) => { down = [event.clientX, event.clientY]; });
canvas.addEventListener("pointerup", (event) => {
  if (view.cctv) return; // CCTV에서는 드래그가 카메라 돌리기다
  if (!down || Math.hypot(event.clientX - down[0], event.clientY - down[1]) > 4 || transform.dragging) return;
  if (transform.axis) return; // 조작 손잡이를 누른 경우
  const rect = canvas.getBoundingClientRect();
  pointer.set(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
  raycaster.setFromCamera(pointer, camera);
  if (pickHandler) {
    // 폰 기준점 고르기: 물건은 고르지 않고, 벽을 못 맞혔으면 계속 기다린다
    const hit = pickWall();
    if (hit) finishPick(hit);
    return;
  }
  const hit = raycaster.intersectObject(content, true).filter((h) => isShown(h.object))
    .map((h) => findPickable(h.object)).find(Boolean);
  select(hit || null);
});

window.addEventListener("keydown", (event) => {
  if (event.target.closest("select, input")) return;
  if (event.key === "w" || event.key === "W") setMode("translate");
  if (event.key === "e" || event.key === "E") setMode("rotate");
  if (event.key === "Escape") {
    if (pickHandler) finishPick(null);
    else if (view.cctv) exitCctv();
    else select(null);
  }
});
$("translate").addEventListener("click", () => setMode("translate"));
$("rotate").addEventListener("click", () => setMode("rotate"));
$("reset").addEventListener("click", () => {
  if (!selected) return;
  applyTransform(selected, entries.get(selected.userData.id));
  describe();
});
$("export").addEventListener("click", () => exportPlacement());
$("mode").addEventListener("change", (event) => { ready = show(event.target.value); });
$("walls").addEventListener("change", (event) => setWallMode(event.target.value));
$("room").addEventListener("change", (event) => {
  if (view.cctv && event.target.value) cctvView(event.target.value);
  else if (view.cctv) exitCctv(null);
  else focusRoom(event.target.value || null);
});
$("cctv").addEventListener("click", () => (view.cctv ? exitCctv() : cctvView(view.focus)));
$("cctv-exit").addEventListener("click", () => exitCctv());
$("cctv-panel").addEventListener("click", (event) => {
  const hidden = document.body.classList.toggle("panel-hidden");
  event.currentTarget.setAttribute("aria-pressed", String(!hidden));
});
$("cctv-prev").addEventListener("click", () => cctvView(nextRoom(-1)));
$("cctv-next").addEventListener("click", () => cctvView(nextRoom(1)));
$("ceiling").addEventListener("change", (event) => setCeiling(event.target.checked));
$("isolate").addEventListener("change", (event) => setIsolate(event.target.checked));
$("badges").addEventListener("change", (event) => {
  view.badges = event.target.checked;
  for (const id of items.keys()) updateBadge(id);
});
$("ao").addEventListener("change", (event) => { gtao.enabled = event.target.checked; cctvAO.enabled = event.target.checked; });
$("all-on").addEventListener("click", () => { setAllPower(true); updateStatus(); });
$("all-off").addEventListener("click", () => { setAllPower(false); updateStatus(); });

function setCeiling(on) {
  view.showCeiling = Boolean(on);
  $("ceiling").checked = view.showCeiling;
  view.dirty = true;
  updateVisibility();
}

function setIsolate(on) {
  view.isolate = Boolean(on);
  $("isolate").checked = view.isolate;
  view.dirty = true;
  updateVisibility();
}

function setWallMode(next) {
  if (!["auto", "full", "low"].includes(next)) throw new Error(`벽 보기 ${next}: auto·full·low 중 하나`);
  view.wallMode = next;
  view.dirty = true;
  $("walls").value = next;
  updateVisibility();
}

// --- 크기·그리기 ---------------------------------------------------------------------------------
function resize() {
  const { clientWidth: w, clientHeight: h } = canvas;
  renderer.setSize(w, h, false);
  composer.setSize(w, h);
  cctvComposer.setSize(w, h);
  labels.setSize(w, h);
  if (view.cctv) aimCctv();
  // 창·패널 크기가 바뀌면 전체 집이 화면에 맞도록 다시 잰다(방 초점의 확대 배율은 이 높이를 기준으로 한다)
  if (home.box && w > 0 && h > 0) viewHeight = fitOrtho(home.box, home.dir, frameAspect(), 1.06).height;
  const a = aspect();
  Object.assign(camera, { left: (-viewHeight * a) / 2, right: (viewHeight * a) / 2, top: viewHeight / 2, bottom: -viewHeight / 2 });
  camera.updateProjectionMatrix();
}
window.addEventListener("resize", resize);

let paused = false;
let lastFrameLine = 0;

function renderNow({ advance = 0 } = {}) {
  if (advance) tickSpins(stateCtx, advance);
  for (const anchor of stateCtx.lit) placeLight(stateCtx.lightOf.get(anchor), anchor);
  updateVisibility();
  (view.cctv ? cctvComposer : composer).render();
  labels.render(scene, view.cctv ? cctvCam : camera);
}

const timer = new THREE.Timer();
renderer.setAnimationLoop((now) => {
  timer.update(now);
  const dt = Math.min(timer.getDelta(), 0.1);
  if (paused || !data) {
    lastFrame = 0; // 멈춘 시간이 프레임 시간에 섞이지 않게
    return;
  }
  if (lastFrame) {
    frameTimes.push(now - lastFrame);
    if (frameTimes.length > 60) frameTimes.shift();
  }
  lastFrame = now;
  if (anim) stepAnimation(now);
  else orbit.update();
  if (focusState) {
    const pulse = 1 + 0.12 * Math.sin(now / 180);
    for (const marker of focusGroup.children) marker.children[0].scale.setScalar(pulse);
  }
  tickSpins(stateCtx, dt);
  renderNow();
  if (now - lastFrameLine > 1000 && !loading && results.mode) {
    lastFrameLine = now;
    $("report").querySelector('[data-key="frame"]')?.replaceWith(frameLine());
  }
});

// --- 실행 중 배치 보정: twin-home {type:"layout"} (layout.mjs) ---------------------------------------
// scene.json 객체(entries)와 노드(nodes)를 함께 바꾼다. 확정(placement.json 반영)은 twin-studio apply-edits가 한다.
const placeholderMaterial = new THREE.MeshStandardMaterial({ color: 0xb8bcc2, roughness: 0.85 });

function placeholderBox(object) {
  const { size, center } = boxSpec(object);
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), placeholderMaterial);
  mesh.position.set(...center);
  mesh.name = `${object.type ?? object.id}_box`;
  const root = new THREE.Group();
  root.name = object.type ?? object.id;
  root.userData.placeholder = true; // isPlaceholder: 상태 연결 검사에서 회색 상자로 본다
  root.add(mesh);
  return root;
}

// 에셋(집 산출물 assets/… 또는 라이브러리 lib/assets/…)을 받아 복제한다. 없거나 못 읽으면 회색 상자.
async function assetFor(object) {
  if (!object.asset) return placeholderBox(object);
  try {
    const gltf = await load(BASE + object.asset);
    return assetRoot(gltf.scene, object.asset).clone(true);
  } catch {
    return placeholderBox(object);
  }
}

function moveObject(id, patch) {
  const entry = entries.get(id);
  if (!entry) return false;
  entry.position = [...patch.position];
  entry.rotation = [...(patch.rotation ?? entry.rotation)];
  if (patch.room !== undefined) entry.room = patch.room;
  if (patch.plan) entry.plan = { ...entry.plan, ...patch.plan };
  const node = nodes.get(id);
  if (node) {
    applyTransform(node, entry);
    node.userData = { ...node.userData, room: entry.room, plan: entry.plan };
    if (node === selected) describe();
  }
  objCache.delete(id);
  view.dirty = true;
  return true;
}

async function addObject(object) {
  if (entries.has(object.id)) return moveObject(object.id, object);
  if (!sceneRoot) return false;
  const asset = await assetFor(object);
  if (entries.has(object.id) || !sceneRoot) return false; // 받는 동안 같은 id가 생겼거나 다시 불러왔다
  const entry = { ...object };
  const holder = new THREE.Group();
  holder.name = entry.id;
  holder.userData = { ...entry };
  applyTransform(holder, entry);
  holder.add(asset);
  prepare(holder);
  sceneRoot.add(holder);
  holder.updateMatrixWorld(true);
  data.objects.push(entry);
  entries.set(entry.id, entry);
  nodes.set(entry.id, holder);
  if (setupItem(entry)) {
    updateBadge(entry.id);
    buildDevicePanel();
    renderStatus();
  }
  view.dirty = true;
  return true;
}

function removeObject(id) {
  if (!entries.has(id)) return false;
  const node = nodes.get(id);
  const item = items.get(id);
  if (item?.node) {
    // 켜져 있던 빛을 풀에 돌려준다(상태를 기본값으로 그린 뒤 뺀다)
    const defaults = Object.fromEntries(Object.keys(item.states).map((a) => [a, defaultValue(item.states, item.attrs, a)]));
    applyState(stateCtx, item.targets, item.states, item.attrs, defaults);
    item.badge?.element.remove(); // CSS2D 요소는 DOM에 남으므로 직접 지운다
  }
  if (node && node === selected) select(null);
  node?.removeFromParent();
  for (const map of [nodes, items, entries, stateStore, objCache]) map.delete(id);
  data.objects = data.objects.filter((o) => o.id !== id);
  if (item) {
    buildDevicePanel();
    renderStatus();
  }
  view.dirty = true;
  return true;
}

function applyLayout(msg) {
  return routeLayout(msg, { move: moveObject, add: addObject, remove: removeObject });
}

// --- 클로이드의 초점: twin-home {type:"focus"} ---------------------------------------------------------
// 대상 중심에 수평 고리와 이름표. 벽에 가려지지 않게 깊이 검사를 끄고, ttl_ms 뒤 지운다.
const focusMaterial = new THREE.MeshBasicMaterial({ color: 0x2f80ed, transparent: true, opacity: 0.9, depthTest: false });
const focusRing = new THREE.TorusGeometry(0.42, 0.035, 8, 48).rotateX(Math.PI / 2);
const focusGroup = new THREE.Group();
focusGroup.name = "cloid_focus";
scene.add(focusGroup);
let focusState = null;
let focusTimer = null;

function clearFocus() {
  clearTimeout(focusTimer);
  for (const marker of [...focusGroup.children]) {
    marker.traverse((n) => { if (n.isCSS2DObject) n.element.remove(); });
    marker.removeFromParent();
  }
  focusState = null;
}

function setFocus(focus) {
  clearFocus();
  const targets = focusTargets(focus);
  if (!targets.length) return false;
  const now = performance.now();
  for (const t of targets) {
    const marker = new THREE.Group();
    marker.name = `focus_${t.id}`;
    marker.position.set(...t.position);
    const ring = new THREE.Mesh(focusRing, focusMaterial);
    ring.renderOrder = 11;
    const el = document.createElement("div");
    el.className = "focus-label";
    el.textContent = `클로이드 주목 · ${t.label}`;
    const label = new CSS2DObject(el);
    label.position.set(0, 0.55, 0);
    label.center.set(0.5, 1);
    marker.add(ring, label);
    focusGroup.add(marker);
  }
  focusState = { targets, until: focusExpiry(focus, now) };
  focusTimer = setTimeout(clearFocus, focusState.until - now);
  return true;
}

// --- 클로이드의 눈: twin-home이 보낸 폰 AR 자세(표시 전용) -----------------------------------------
// 꼭짓점이 눈 위치이고 넓은 쪽이 보는 방향인 원뿔. 벽에 가려지지 않게 깊이 검사를 끈다.
const EYE_OK = 0xb9773f;
const EYE_LIMITED = 0x5f6368; // 흰 바닥·벽 위에서도 보이게 어두운 회색
const eyeMaterial = new THREE.MeshBasicMaterial({ color: EYE_OK, transparent: true, opacity: 0.8, depthTest: false, side: THREE.DoubleSide });
const eyeMarker = new THREE.Group();
eyeMarker.name = "cloid_eye";
{
  const cone = new THREE.ConeGeometry(0.32, 0.9, 24, 1, true);
  cone.rotateZ(Math.PI / 2); // 꼭짓점을 -X로
  cone.translate(0.45, 0, 0); // 꼭짓점이 원점, 넓은 쪽이 +X
  eyeMarker.add(new THREE.Mesh(cone, eyeMaterial), new THREE.Mesh(new THREE.SphereGeometry(0.11, 16, 12), eyeMaterial));
}
eyeMarker.renderOrder = 10;
eyeMarker.visible = false;
scene.add(eyeMarker);
let eyeState = null;
const X_AXIS = new THREE.Vector3(1, 0, 0);

function setEye(eye) {
  const t = eyeTransform(eye);
  if (!t) return false;
  eyeState = { ...eye };
  eyeMarker.position.set(...t.position);
  eyeMarker.quaternion.setFromUnitVectors(X_AXIS, vec(t.direction));
  eyeMaterial.color.set(t.limited ? EYE_LIMITED : EYE_OK);
  eyeMarker.visible = true;
  return true;
}

// --- 폰 기준점(twin-home 벽 대기 맞춤) --------------------------------------------------------------
// 대시보드가 startPick으로 벽 고르기를 켜면, 다음에 누른 벽을 평면도 벽의 방 쪽 면 위 점으로 돌려준다(touch.mjs).
// 가구·바닥은 뚫고 지나가 그 뒤의 벽·문·창을 잡는다. 저장된 A·B는 setTouchPoints로 눈높이 핀과 이름표로 보인다.
function wallIdOf(object) {
  for (let n = object; n; n = n.parent) {
    const wall = walls.find((w) => w.node === n);
    if (wall) return wall.id;
    if (n.userData?.id !== undefined) {
      const entry = entries.get(n.userData.id);
      return entry?.mount === "opening" ? entry.plan?.wall ?? null : null;
    }
  }
  return null;
}

function pickWall() {
  const heading = cameraHeading(camera.position.toArray(), orbit.target.toArray());
  for (const h of raycaster.intersectObject(content, true)) {
    if (!h.face || !isShown(h.object)) continue;
    const id = wallIdOf(h.object);
    const wall = id ? planWallOf(id, data?.plan?.walls) : null;
    if (!wall) continue;
    const normal = h.face.normal.clone().transformDirection(h.object.matrixWorld).toArray();
    const snapped = snapToWall([h.point.x, h.point.z], wall, wallHint(normal, heading));
    if (snapped) return { ...snapped, wall: wall.id, height_m: Math.round(h.point.y * 1000) / 1000 };
  }
  return null;
}

function finishPick(result) {
  const fn = pickHandler;
  pickHandler = null;
  canvas.style.cursor = "";
  fn?.(result);
}

function startPick(fn) {
  if (pickHandler) finishPick(null);
  if (typeof fn !== "function") return false;
  // CCTV에서는 누르기가 카메라 돌리기라 벽을 고를 수 없다: 위에서 보는 화면으로 돌아가서 고른다
  if (view.cctv) exitCctv();
  select(null);
  pickHandler = fn;
  canvas.style.cursor = "crosshair";
  return true;
}

const TOUCH_COLORS = { A: 0xe8590c, B: 0x1c7ed6 };
const TOUCH_EYE_M = 1.5;
const touchGroup = new THREE.Group();
touchGroup.name = "phone_touch_points";
scene.add(touchGroup);
let touchState = [];

function setTouchPoints(points) {
  for (const marker of [...touchGroup.children]) {
    marker.traverse((n) => { if (n.isCSS2DObject) n.element.remove(); });
    marker.removeFromParent();
  }
  touchState = touchMarkers(points);
  for (const t of touchState) {
    const marker = new THREE.Group();
    marker.name = `touch_${t.id}`;
    marker.position.set(t.position[0], 0, t.position[1]);
    const mat = new THREE.MeshBasicMaterial({ color: TOUCH_COLORS[t.id] ?? 0x2f80ed, transparent: true, opacity: 0.9, depthTest: false });
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, TOUCH_EYE_M, 12).translate(0, TOUCH_EYE_M / 2, 0), mat);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.09, 16, 12).translate(0, TOUCH_EYE_M, 0), mat);
    pole.renderOrder = head.renderOrder = 12;
    const el = document.createElement("div");
    el.className = "touch-label";
    el.style.background = `#${(TOUCH_COLORS[t.id] ?? 0x2f80ed).toString(16).padStart(6, "0")}`;
    el.textContent = t.text;
    const label = new CSS2DObject(el);
    label.position.set(0, TOUCH_EYE_M + 0.25, 0);
    label.center.set(0.5, 1);
    marker.add(pole, head, label);
    touchGroup.add(marker);
  }
  view.dirty = true;
  return touchState.length;
}

// 자동 검사용(브라우저 콘솔·테스트 도구)
window.aptViewer = {
  THREE, scene, camera, content, results, transform, orbit, renderer,
  get ready() { return ready; },
  get loading() { return loading; },
  get mode() { return mode; },
  get view() { return { ...view }; },
  show: (m) => { ready = show(m); return ready; },
  objects: () => data.objects.map((o) => {
    const item = items.get(o.id);
    return {
      id: o.id, name: o.name, type: o.type, category: o.category, mount: o.mount, room: o.room,
      interactive: Boolean(o.interactive), loaded: nodes.has(o.id),
      placeholder: isPlaceholder(nodes.get(o.id)), wiring: item?.wiring.status ?? null,
      attrs: item ? Object.fromEntries(Object.keys(item.states).map((a) => [a, attrValues(item.states, item.attrs, a)])) : {},
      defaults: item ? Object.fromEntries(Object.keys(item.states).map((a) => [a, defaultValue(item.states, item.attrs, a)])) : {},
    };
  }),
  node: (id) => nodes.get(id) ?? null,
  setState, getState, setAllPower,
  setEye, eye: () => eyeState,
  startPick, cancelPick: () => finishPick(null), picking: () => pickHandler !== null,
  setTouchPoints, touchPoints: () => touchState.map((t) => ({ ...t, position: [...t.position] })),
  applyLayout, moveObject, addObject, removeObject,
  setFocus, clearFocus, focus: () => (focusState ? { targets: focusState.targets.map((t) => ({ ...t })) } : null),
  focusRoom, setWallMode,
  setCeiling, setIsolate,
  cctv: (room) => cctvView(room), exitCctv, cctvPose: () => cctv.pose, cctvCamera: cctvCam,
  activeDevices: () => activeDevices(items, (id) => stateStore.get(id)),
  setBadges: (on) => { $("badges").checked = Boolean(on); $("badges").dispatchEvent(new Event("change")); },
  select: (id) => { select(nodes.get(id) ?? null); return selected !== null; },
  selected: () => selected,
  exportPlacement,
  wallsShown: () => Object.fromEntries(walls.map((w) => [w.id, w.upper ? w.upper.getObjectsByProperty("isMesh", true)
    .every((m) => m.layers.isEnabled(0)) : null])),
  hidden: (id) => {
    const n = nodes.get(id);
    return n ? n.getObjectsByProperty("isMesh", true).every((m) => !m.layers.isEnabled(0)) : null;
  },
  lights: () => stateCtx.lights.size,
  setPaused: (on) => { paused = Boolean(on); },
  renderNow,
};

try {
  const res = await fetch(SCENE_URL);
  if (!res.ok) throw new Error(`HTTP ${res.status} (python -m studio apartment로 먼저 만드세요)`);
  data = await res.json();
} catch (error) {
  $("status").textContent = `${SCENE_URL}을 읽지 못했습니다: ${error.message}`;
  results.error = String(error);
  throw error;
}
entries = new Map(data.objects.map((o) => [o.id, o]));
setupStage();
setMode("translate");
ready = show($("mode").value);
startLive({ viewer: window.aptViewer, hook: (fn) => { liveHook = fn; } });
await ready;
