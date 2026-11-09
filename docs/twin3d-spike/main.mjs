// 빛 굽기 스파이크(three r187): 구운 빛 GLB를 실시간 트윈으로 그린다.
// 정적 메시 = MeshBasicMaterial(색·그림 × 빛 지도, uv 채널 1). 동적 메시 = 원래 재질 + 반구광 + 해 하나(그림자 지도 없음).
// 벽 보기·상태는 오늘 뷰어 모듈(/viewer/walls.mjs, states.mjs)을 그대로 쓴다.
//
// ?walls=auto|full|low  벽 보기(기본 auto = 앞쪽 낮춤)
// ?demo=1               냉장고 문 열기, TV 켜기, 클로이드 예상 경로 띠
// ?zoom=&fx=&fy=        화면 (fx, fy)(왼쪽 위 0,0)를 가운데로 zoom배
// ?set=d32|d48          굽기 결과 폴더(../bake/<set>/)
// ?merge=1              움직이지 않는 정적 메시를 재질별로 합친다(그리기 호출 비교)
// ?light=only           구운 빛만(회색 알베도)
// ?look=base|high       AgX 기본 | AgX High Contrast 흉내(그림과 같은 톤, 기본)
// ?leaves=hide|clip     낮춘 벽의 문짝: 숨김(그림과 같음, 기본) | 1.05 m에서 자름(오늘 뷰어)
// ?ground=baked|canvas  땅 그림자: 구운 그림(manifest.ground, 기본) | 벽을 민 손그림(1회차)
// ?inside=              자른 가구 속(뒷면) 밝기 배수
// ?w=&h=                화면 크기
// 기본 보기 목록(manifest.view, 없으면 그림 .plan.json): clip = 1.05 m에서 자르는 키 큰 가구(속이 보이는 열린 상자),
// hide = 낮춘 벽에 높이 걸린 물건(숨김), rails = 낮춘 벽의 창 → 그 자리 낮은 유리 난간(창은 '벽 온전히'에서만).
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { HDRLoader } from "three/addons/loaders/HDRLoader.js";
import { RectAreaLightUniformsLib } from "three/addons/lights/RectAreaLightUniformsLib.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { cameraHeading, collectWalls, cutAction, upperVisible } from "/viewer/walls.mjs";
import { applyAttr, applyState, collectTargets, createContext } from "/viewer/states.mjs";
import { parseProp, statesOf } from "/viewer/scene.mjs";

const q = new URLSearchParams(location.search);
const num = (k, d) => (q.has(k) ? Number(q.get(k)) : d);
const SET = q.get("set") ?? "d32";
const W = num("w", 1920);
const H = num("h", 1536);
const WALLS = q.get("walls") ?? "auto";
const DEMO = q.get("demo") === "1";
const MERGE = q.get("merge") === "1";
const LIGHT_ONLY = q.get("light") === "only";
const LOOK = q.get("look") ?? "high";
const BG = "#BDBDBD";
const CAP = q.get("cap") ?? "#4E4B48"; // 벽 윗면·자른 단면 색(그림의 해 받은 벽 윗면 밝기)
const HEMI = num("hemi", 1); // 반구광 배수
const HEMI_GROUND = num("hemiground", 0.35); // ?hemiground=: 반구광 아래 = 하늘 × 이 값(없으면 하늘 사진의 수평 조도로 정함)
const SHADOW = num("shadow", 0.29); // 손그림 땅 그림자 가장 진한 곳 불투명도(그림: 바탕 189 → 벽 앞 135, 꼬리 약 170)
const GROUND = q.get("ground") ?? "baked";
const INSIDE = num("inside", 0.62); // 자른 가구 속(뒷면) = 몸통 색 × 이 값(구운 빛 없이 그늘 정도)
window.__spike = { ready: false };
const fail = (e) => { window.__spike = { ready: false, error: String(e?.stack ?? e) }; console.error("EXC", e); };
window.addEventListener("error", (e) => fail(e.error ?? e.message));
window.addEventListener("unhandledrejection", (e) => fail(e.reason));

// --- 톤: Blender AgX High Contrast 흉내(AgX 로그 공간에서 대비 1.4·채도 0.95, 중간 회색 기준) --------------
if (LOOK === "high") {
  THREE.ShaderChunk.tonemapping_pars_fragment = THREE.ShaderChunk.tonemapping_pars_fragment.replace(
    "vec3 CustomToneMapping( vec3 color ) { return color; }",
    `vec3 CustomToneMapping( vec3 color ) {
      const mat3 AgXInsetMatrix = mat3(
        vec3( 0.856627153315983, 0.137318972929847, 0.11189821299995 ),
        vec3( 0.0951212405381588, 0.761241990602591, 0.0767994186031903 ),
        vec3( 0.0482516061458583, 0.101439036467562, 0.811302368396859 ) );
      const mat3 AgXOutsetMatrix = mat3(
        vec3( 1.1271005818144368, - 0.1413297634984383, - 0.14132976349843826 ),
        vec3( - 0.11060664309660323, 1.157823702216272, - 0.11060664309660294 ),
        vec3( - 0.016493938717834573, - 0.016493938717834257, 1.2519364065950405 ) );
      const float AgxMinEv = - 12.47393;
      const float AgxMaxEv = 4.026069;
      color *= toneMappingExposure;
      color = LINEAR_SRGB_TO_LINEAR_REC2020 * color;
      color = AgXInsetMatrix * color;
      color = max( color, 1e-10 );
      color = log2( color );
      color = ( color - AgxMinEv ) / ( AgxMaxEv - AgxMinEv );
      float pivot = ( log2( 0.18 ) - AgxMinEv ) / ( AgxMaxEv - AgxMinEv );
      color = ( color - pivot ) * 1.4 + pivot;
      float luma = dot( color, vec3( 0.2126, 0.7152, 0.0722 ) );
      color = mix( vec3( luma ), color, 0.95 );
      color = clamp( color, 0.0, 1.0 );
      color = agxDefaultContrastApprox( color );
      color = AgXOutsetMatrix * color;
      color = pow( max( vec3( 0.0 ), color ), vec3( 2.2 ) );
      color = LINEAR_REC2020_TO_LINEAR_SRGB * color;
      return clamp( color, 0.0, 1.0 );
    }`);
}

const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true, stencil: true });
renderer.setPixelRatio(1);
renderer.setSize(W, H);
renderer.toneMapping = LOOK === "high" ? THREE.CustomToneMapping : THREE.AgXToneMapping;
renderer.toneMappingExposure = num("exposure", 1); // 그림은 -0.05 EV. 0으로 두면 바닥·흰 면 중앙값이 그림과 맞는다
renderer.shadowMap.enabled = false;
renderer.localClippingEnabled = true;
document.body.append(renderer.domElement);
RectAreaLightUniformsLib.init();

const scene = new THREE.Scene();
scene.background = new THREE.Color(BG);
const json = async (u) => { const r = await fetch(u); if (!r.ok) throw new Error(`${u} ${r.status}`); return r.json(); };
const [plan, data, man] = await Promise.all([
  json("../ref/mokryeon_180b_fact.plan.json"), json("/home/scene.json"), json(`../bake/${SET}/manifest.json`)]);
const b2t = ([x, y, z]) => new THREE.Vector3(x, z, -y); // Blender → three
const cut = data.plan.wall_cut_height ?? 1.05;
const floorY = 0;

// --- 카메라: 그림 계획(.plan.json) 그대로. 정사영, 방위 -45°, 고도 45°, 화면 이동(shift) -------------------
const target = b2t(plan.camera.target);
const camera = (() => {
  const c = plan.camera;
  const a = (c.azimuth * Math.PI) / 180;
  const e = (c.elevation * Math.PI) / 180;
  const s = c.ortho_scale;
  const r = H / W;
  const zoom = num("zoom", 1);
  const fx = num("fx", 0.5);
  const fy = num("fy", 0.5);
  const cx = c.shift_x * s + (fx - 0.5) * s;
  const cy = c.shift_y * s + (0.5 - fy) * s * r;
  const cam = new THREE.OrthographicCamera(cx - s / 2 / zoom, cx + s / 2 / zoom,
    cy + (s * r) / 2 / zoom, cy - (s * r) / 2 / zoom, 1, 200);
  cam.position.copy(target).add(b2t([Math.cos(a) * Math.cos(e), Math.sin(a) * Math.cos(e), Math.sin(e)]).multiplyScalar(60));
  cam.up.set(0, 1, 0);
  cam.lookAt(target);
  cam.updateMatrixWorld();
  return cam;
})();

// --- 불러오기 ---------------------------------------------------------------------------------------
const t0 = performance.now();
const loader = new GLTFLoader();
const [gltf, tvGltf] = await Promise.all([
  loader.loadAsync(`../bake/${SET}/${man.glb}`), DEMO ? loader.loadAsync("./assets/tv.glb") : null]);
const root = gltf.scene;
scene.add(root);
root.updateMatrixWorld(true);
const texLoader = new THREE.TextureLoader();
const maps = {};
await Promise.all(man.lightmaps.map(async (lm) => {
  const t = await texLoader.loadAsync(`../bake/${SET}/${q.get("lm") === "webp" ? lm.webp : lm.file}`);
  Object.assign(t, { flipY: false, colorSpace: THREE.SRGBColorSpace, channel: man.channel, generateMipmaps: false,
    minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, name: lm.name });
  maps[lm.name] = { tex: t, intensity: lm.intensity };
}));
const loadMs = performance.now() - t0;
const ANISO = Math.min(num("aniso", 16), renderer.capabilities.getMaxAnisotropy());

// --- 재질: 정적 = 구운 빛, 벽 윗면 = 어두운 단색, 나머지 = 실시간 -------------------------------------------
const nodes = new Map(Object.entries(man.nodes));
const glass = new Set(man.transparent);
const capMat = new THREE.MeshBasicMaterial({ name: "cap", color: CAP, toneMapped: false });
const isCap = (m) => m.name === "wall_cap" || m.name === "solid_core";
const grey = new THREE.Color(0.75, 0.75, 0.75);
const bakedMats = new Map();
const bakedMat = (own, atlas) => {
  const key = `${own.uuid}|${atlas}`;
  if (!bakedMats.has(key)) {
    const lm = maps[atlas];
    bakedMats.set(key, new THREE.MeshBasicMaterial({
      name: `${own.name}@${atlas}`, color: LIGHT_ONLY ? grey : own.color, map: LIGHT_ONLY ? null : own.map,
      lightMap: lm.tex, lightMapIntensity: lm.intensity, side: own.side, alphaTest: own.alphaTest,
    }));
  }
  return bakedMats.get(key);
};
// 창 유리: 그림에서는 밝은 스튜디오 빛을 비춰 흰 판(약 208)으로 보인다. 환경 지도 없이 밝은 반투명 단색으로 흉내 낸다
const windowGlass = new THREE.MeshBasicMaterial({ name: "window_glass", color: "#D0D1D1", transparent: true, opacity: 0.88,
  depthWrite: false, toneMapped: false, side: THREE.DoubleSide });
const railGlass = new THREE.MeshBasicMaterial({ name: "rail_glass", color: "#E4EAEC", transparent: true, opacity: 0.22,
  depthWrite: false, toneMapped: false, side: THREE.DoubleSide });
const glowing = (m) => m.emissive && m.emissiveIntensity > 0 && (m.emissive.r + m.emissive.g + m.emissive.b > 0 || m.emissiveMap);
const count = { baked: 0, cap: 0, live: 0, glass: 0, glow: 0 };
const staticMeshes = [];
root.traverse((n) => {
  if (!n.isMesh) return;
  const atlas = nodes.get(n.name) ?? (n.parent && !n.parent.isMesh ? nodes.get(n.parent.name) : undefined);
  const own = [n.material].flat()[0];
  n.userData.atlas = atlas ?? null;
  if (atlas && isCap(own)) { n.material = capMat; count.cap++; staticMeshes.push(n); return; }
  if (atlas && n.geometry.attributes.uv1 && !own.transparent && !glass.has(n.name) && !glass.has(n.parent?.name)) {
    if (glowing(own)) { count.glow++; return; } // 발광 재질은 그대로(빛 지도 없이도 밝다)
    n.material = bakedMat(own, atlas);
    count.baked++;
    staticMeshes.push(n);
    return;
  }
  if (own.name === "pre_rail_glass") { n.material = railGlass; count.glass++; return; }
  if (glass.has(n.name) || glass.has(n.parent?.name)) { n.material = windowGlass; count.glass++; return; }
  if (own.transparent) count.glass++;
  else count.live++;
});

// 재질 그림(나무결·타일)은 비등방 거르기(45° 내려다보기에서 결이 흐려지지 않게). 빛 지도는 밉맵 없는 선형 그대로
root.traverse((n) => {
  if (!n.isMesh) return;
  for (const m of [n.material].flat()) if (m.map && m.map.anisotropy !== ANISO) { m.map.anisotropy = ANISO; m.map.needsUpdate = true; }
});

// --- 실시간 빛: 반구광 + 해 하나(그림자 지도 없음). 정적 메시는 MeshBasic이라 이 빛을 받지 않는다 ----------------
const hdr = await new HDRLoader().setDataType(THREE.FloatType).loadAsync(`../bake/hdri/${man.light.environment.hdri}.hdr`);
const irradiance = (() => { // 하늘 사진의 방향별 조도(코사인 가중): 위, 아래, 수평 4방향 평균
  const { data: px, width: w, height: h } = hdr.image;
  const dirs = { up: [0, 1, 0], down: [0, -1, 0], px: [1, 0, 0], nx: [-1, 0, 0], pz: [0, 0, 1], nz: [0, 0, -1] };
  const acc = Object.fromEntries(Object.keys(dirs).map((k) => [k, [0, 0, 0]]));
  for (let j = 0; j < h; j++) {
    const lat = Math.PI / 2 - (Math.PI * (j + 0.5)) / h;
    const dw = Math.cos(lat) * (2 * Math.PI / w) * (Math.PI / h);
    for (let i = 0; i < w; i++) {
      const phi = ((i + 0.5) / w) * 2 * Math.PI - Math.PI;
      const d = [Math.cos(lat) * Math.cos(phi), Math.sin(lat), Math.cos(lat) * Math.sin(phi)];
      const k = (j * w + i) * 4;
      for (const [name, n] of Object.entries(dirs)) {
        const c = Math.max(0, n[0] * d[0] + n[1] * d[1] + n[2] * d[2]) * dw;
        if (c > 0) for (let ch = 0; ch < 3; ch++) acc[name][ch] += px[k + ch] * c;
      }
    }
  }
  const horiz = [0, 1, 2].map((ch) => (acc.px[ch] + acc.nx[ch] + acc.pz[ch] + acc.nz[ch]) / 4);
  return { up: acc.up, down: acc.down, horiz };
})();
hdr.dispose();
const envK = man.light.environment.intensity;
const sky = new THREE.Color(...irradiance.up.map((v) => v * envK * HEMI));
// 반구광은 수평 면에 (위 + 아래) / 2를 준다. 이 하늘 사진은 수평이 위보다 밝아(스튜디오 조명) 아래 색을 2·수평 − 위로 둔다.
const groundCol = q.has("hemiground")
  ? new THREE.Color(...irradiance.up.map((v) => v * envK * HEMI * HEMI_GROUND))
  : new THREE.Color(...irradiance.horiz.map((v, i) => Math.max(0, 2 * v - irradiance.up[i]) * envK * HEMI));
const hemi = new THREE.HemisphereLight(sky, groundCol, 1);
scene.add(hemi);
const s = man.light.sun;
const sun = new THREE.DirectionalLight(new THREE.Color(...s.color), s.intensity);
sun.castShadow = false;
sun.position.copy(target).addScaledVector(new THREE.Vector3(...s.direction).normalize(), 25);
sun.target.position.copy(target);
scene.add(sun, sun.target);

// --- 땅 그림자: 그림자 지도 없이, 벽 바닥 사각형을 해 반대쪽으로 민 2D 그림(캔버스)을 땅에 깐다 ---------------------
const zMin = data.plan.z_min ?? 0;
const groundShadow = (() => {
  const pts = data.plan.rooms.flatMap((r) => r.polygon);
  const pad = 3;
  const min = [Math.min(...pts.map((p) => p[0])) - pad, Math.min(...pts.map((p) => p[1])) - pad];
  const max = [Math.max(...pts.map((p) => p[0])) + pad, Math.max(...pts.map((p) => p[1])) + pad];
  const ppm = 64;
  const cw = Math.ceil((max[0] - min[0]) * ppm);
  const ch = Math.ceil((max[1] - min[1]) * ppm);
  const X = (x) => (x - min[0]) * ppm;
  const Y = (y) => (y - min[1]) * ppm;
  const sd = new THREE.Vector3(...s.direction).normalize();
  const horiz = Math.hypot(sd.x, sd.z);
  const away = horiz > 1e-6 ? [-sd.x / horiz, -sd.z / horiz] : [0, 0]; // 그림자가 늘어나는 쪽(평면도 x, y = three x, z)
  const cot = horiz / sd.y;
  const hull = (p) => { // 볼록 껍질(모노톤 체인)
    const a = [...p].sort((u, v) => u[0] - v[0] || u[1] - v[1]);
    const cross = (o, u, v) => (u[0] - o[0]) * (v[1] - o[1]) - (u[1] - o[1]) * (v[0] - o[0]);
    const lo = []; const hi = [];
    for (const v of a) { while (lo.length >= 2 && cross(lo.at(-2), lo.at(-1), v) <= 0) lo.pop(); lo.push(v); }
    for (const v of a.reverse()) { while (hi.length >= 2 && cross(hi.at(-2), hi.at(-1), v) <= 0) hi.pop(); hi.push(v); }
    return lo.slice(0, -1).concat(hi.slice(0, -1));
  };
  // 벽 바닥 사각형을 해 반대쪽으로 민 모양(길이 배수 k). 그림의 땅 그림자는 벽 가까이 짧고 진한 부분 + 길고 옅은 꼬리다
  const sweepCanvas = (k) => {
    const c = document.createElement("canvas");
    c.width = cw; c.height = ch;
    const g = c.getContext("2d");
    g.fillStyle = "#fff";
    const poly = (pts) => { g.beginPath(); pts.forEach(([x, y], i) => (i ? g.lineTo(X(x), Y(y)) : g.moveTo(X(x), Y(y)))); g.closePath(); g.fill(); };
    for (const w of data.plan.walls) {
      if (!w.a || !w.b) continue;
      const h = (upperByWall.get(w.id) !== false ? data.plan.ceiling_height : cut) - zMin;
      const [ax, ay] = w.a; const [bx, by] = w.b;
      const len = Math.hypot(bx - ax, by - ay) || 1;
      const nx = (-(by - ay) / len) * (w.thickness / 2); const ny = ((bx - ax) / len) * (w.thickness / 2);
      const rect = [[ax + nx, ay + ny], [bx + nx, by + ny], [bx - nx, by - ny], [ax - nx, ay - ny]];
      const off = [away[0] * h * cot * k, away[1] * h * cot * k];
      poly(hull([...rect, ...rect.map(([x, y]) => [x + off[0], y + off[1]])]));
    }
    for (const r of data.plan.rooms) poly(r.polygon); // 집 바닥(슬래브) 자체
    return c;
  };
  const out = document.createElement("canvas");
  out.width = cw; out.height = ch;
  const o = out.getContext("2d");
  o.fillStyle = "#000";
  o.fillRect(0, 0, cw, ch);
  o.globalCompositeOperation = "lighten"; // 층마다 더 진한 쪽을 남긴다
  for (const [k, blur, alpha] of [[0, 0.8, 0.12], [1.25, 0.12, 0.38], [0.45, 0.04, 1]]) { // 하늘빛 가림, 옅은 꼬리, 진한 끝
    o.filter = `blur(${Math.max(1, Math.round(blur * ppm))}px)`;
    o.globalAlpha = alpha;
    o.drawImage(sweepCanvas(k), 0, 0);
  }
  const tex = new THREE.CanvasTexture(out);
  tex.colorSpace = THREE.NoColorSpace;
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(max[0] - min[0], max[1] - min[1]).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: 0x000000, alphaMap: tex, transparent: true, opacity: SHADOW, depthWrite: false, toneMapped: false }));
  mesh.position.set((min[0] + max[0]) / 2, zMin - 0.002, (min[1] + max[1]) / 2);
  mesh.renderOrder = -1;
  mesh.name = "ground_shadow";
  return { mesh, tex, size: [cw, ch] };
});

// --- 벽 보기(뷰어 walls.mjs 규칙) + 자르기: 낮춘 벽의 문·창, 그림의 키 큰 가구를 1.05 m에서 자르고 단면을 어둡게 -------
const walls = collectWalls(root, data.plan.walls);
const wallOf = new Map([...(data.plan.doors ?? []), ...(data.plan.windows ?? [])].map((d) => [d.id, d.wall]));
const cutPlane = new THREE.Plane(new THREE.Vector3(0, -1, 0), cut);
// 단면 뚜껑(스텐실): 자른 메시의 뒷면 +1·앞면 -1을 세고, 자르기 높이의 큰 판을 0이 아닌 곳에만 어두운 색으로 그린다.
// 닫힌 메시 안쪽이 자르기 면에 드러난 곳만 칠해진다(three.js clipping stencil 예제와 같은 방식).
const stencilMat = (side, op) => new THREE.MeshBasicMaterial({
  side, clippingPlanes: [cutPlane], colorWrite: false, depthWrite: false, depthTest: false,
  stencilWrite: true, stencilFunc: THREE.AlwaysStencilFunc, stencilFail: op, stencilZFail: op, stencilZPass: op });
const stencilBack = stencilMat(THREE.BackSide, THREE.IncrementWrapStencilOp);
const stencilFront = stencilMat(THREE.FrontSide, THREE.DecrementWrapStencilOp);
const capPlane = new THREE.Mesh(new THREE.PlaneGeometry(400, 400).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({
  name: "cap_plane", color: CAP, toneMapped: false, stencilWrite: true, stencilRef: 0, stencilFunc: THREE.NotEqualStencilFunc,
  stencilFail: THREE.ReplaceStencilOp, stencilZFail: THREE.ReplaceStencilOp, stencilZPass: THREE.ReplaceStencilOp }));
capPlane.position.set(target.x, cut, target.z);
capPlane.renderOrder = 2;
capPlane.name = "cap_plane";
scene.add(capPlane);
const clipState = new Map(); // mesh → {orig, clipped, marks}
function setClipped(node, on, stencil = true) {
  node.traverse((m) => {
    if (!m.isMesh || m.userData.isStencil) return;
    let st = clipState.get(m);
    if (!st && !on) return;
    if (!st) {
      const orig = m.material;
      const clipped = [orig].flat().map((x) => Object.assign(x.clone(), { clippingPlanes: [cutPlane] }));
      const solid = stencil && ![orig].flat().some((x) => x.transparent);
      const marks = solid ? [stencilBack, stencilFront].map((mat) => {
        const s = new THREE.Mesh(m.geometry, mat);
        s.userData.isStencil = true;
        s.renderOrder = 1;
        s.name = `${m.name}_stencil`;
        m.add(s);
        return s;
      }) : [];
      st = { orig, clipped: Array.isArray(orig) ? clipped : clipped[0], marks };
      clipState.set(m, st);
    }
    m.material = on ? st.clipped : st.orig;
    for (const s of st.marks) s.visible = on;
  });
}
const entries = new Map(data.objects.map((e) => [e.id, e]));
const view = man.view ?? { clip: plan.clip ?? [], hide: plan.hide ?? [], rails: {} };
const tallClip = new Set(view.clip);
const hideIds = new Set(view.hide);
const railOf = new Map(Object.entries(view.rails ?? {}).map(([win, name]) => [win, root.getObjectByName(name)]).filter(([, n]) => n));
const LEAVES = q.get("leaves") ?? "hide";
const doorPart = new Map((data.plan.doors ?? []).map((d) => [d.id, d.kind === "swing" ? "leaf" : "panel"]));
// 자른 키 큰 가구는 그림처럼 속이 보이는 열린 상자: 뒷면을 몸통 색(그늘 정도로 어둡게)으로 그린다
const insideMats = new Map();
const insideOf = (m) => {
  if (!insideMats.has(m.uuid)) {
    insideMats.set(m.uuid, new THREE.MeshBasicMaterial({ name: `${m.name}_inside`, color: (m.color ?? new THREE.Color(1, 1, 1)).clone().multiplyScalar(INSIDE),
      map: m.map ?? null, side: THREE.BackSide, clippingPlanes: [cutPlane] }));
  }
  return insideMats.get(m.uuid);
};
const insides = new Map();
function setInside(node, on) {
  node.traverse((m) => {
    if (!m.isMesh || m.userData.isStencil || m.userData.isInside) return;
    if (!insides.has(m) && on) {
      const mats = [m.material].flat();
      if (mats.some((x) => x.transparent)) return;
      const inner = new THREE.Mesh(m.geometry, Array.isArray(m.material) ? mats.map(insideOf) : insideOf(mats[0]));
      inner.userData.isInside = true;
      inner.name = `${m.name}_inside`;
      m.add(inner);
      insides.set(m, inner);
    }
    if (insides.has(m)) insides.get(m).visible = on;
  });
}
let upperByWall = new Map();
function setWalls(mode) {
  const heading = cameraHeading(camera.position.toArray(), target.toArray());
  upperByWall = new Map(walls.map((w) => [w.id, upperVisible(w, { mode, heading })]));
  for (const w of walls) if (w.upper) w.upper.visible = upperByWall.get(w.id);
  const actions = {};
  for (const e of data.objects) {
    const node = root.getObjectByName(e.id);
    if (!node) continue;
    let act = cutAction(e, upperByWall, cut, wallOf);
    if (tallClip.has(e.id) && mode !== "full") act = "clip";
    if (hideIds.has(e.id) && e.plan?.wall && upperByWall.get(e.plan.wall) === false) act = "hide"; // 낮춘 벽에 높이 걸린 가전도
    const rail = railOf.get(e.id);
    if (rail) { // 낮춘 벽의 창: 그림처럼 창을 숨기고 그 자리 낮은 유리 난간
      rail.visible = act === "clip";
      if (act === "clip") act = "rail";
    }
    node.visible = act !== "hide" && act !== "rail";
    if (tallClip.has(e.id)) { // 키 큰 가구(clip 목록): 속이 빈 장이라 스텐실 단면 대신 열린 상자
      setClipped(node, act === "clip", false);
      setInside(node, act === "clip");
    } else setClipped(node, act === "clip");
    // 낮춘 벽의 문짝(여닫이 leaf·미닫이 panel)은 그림처럼 숨긴다(?leaves=clip이면 뷰어처럼 잘라 보인다). 문틀은 남는다
    const part = doorPart.get(e.id);
    if (part) node.traverse((n) => { if (n.userData?.part === part) n.visible = !(act === "clip" && LEAVES === "hide"); });
    actions[act] = (actions[act] ?? 0) + 1;
  }
  return { raised: walls.filter((w) => upperByWall.get(w.id)).map((w) => w.id).sort(), actions };
}
const wallInfo = setWalls(WALLS);
const gs = GROUND === "baked" && man.ground ? await bakedGround(man.ground) : groundShadow();
scene.add(gs.mesh);

// 구운 땅 그림자(studio.bake.ground): 그림자 세기 그림을 검은 판의 alphaMap으로. 화면 = 배경 × (1 − 세기 × strength)
async function bakedGround(g) {
  const tex = await texLoader.loadAsync(`../bake/${SET}/${g.file}`);
  tex.colorSpace = THREE.NoColorSpace;
  tex.flipY = g.flipY;
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(g.x[1] - g.x[0], g.z[1] - g.z[0]).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: 0x000000, alphaMap: tex, transparent: true, opacity: g.strength, depthWrite: false, toneMapped: false }));
  mesh.position.set((g.x[0] + g.x[1]) / 2, g.y - 0.002, (g.z[0] + g.z[1]) / 2);
  mesh.renderOrder = -1;
  mesh.name = "ground_shadow";
  return { mesh, tex, size: [g.size, g.size], kind: "baked" };
}

// --- 상태(뷰어 states.mjs): 지금 상태(scene.json)를 먼저 넣는다. 구운 GLB는 쉴 때 자세·최대 발광이라서다 -------------
const AREA_FORWARD = new THREE.Vector3(0, 0, -1);
function makeLight(spec) {
  const color = new THREE.Color(spec.color ?? "#ffffff");
  const dir = new THREE.Vector3(...(spec.direction ?? [0, -1, 0])).normalize();
  let light;
  if (spec.kind === "area") {
    light = new THREE.RectAreaLight(color, 0, ...(spec.size ?? [0.5, 0.5]));
    light.quaternion.setFromUnitVectors(AREA_FORWARD, dir);
  } else if (spec.kind === "spot") {
    light = new THREE.SpotLight(color, 0, spec.distance ?? 0, Math.min(((spec.angle_deg ?? 60) * Math.PI) / 360, Math.PI / 2), 0.4, 2);
    light.target.position.copy(dir);
    light.add(light.target);
  } else {
    light = new THREE.PointLight(color, 0, spec.distance ?? 0, 2);
  }
  return light;
}
const stateCtx = createContext({ makeLight, maxLights: 8 });
const items = new Map();
for (const e of data.objects) {
  const node = root.getObjectByName(e.id);
  if (!node) continue;
  const states = statesOf(e, node);
  if (!Object.keys(states).length) continue;
  const item = { node, states, attrs: e.attrs ?? {}, targets: collectTargets(node), state: { ...(e.state ?? {}) } };
  applyState(stateCtx, item.targets, item.states, item.attrs, item.state);
  items.set(e.id, item);
}
function setState(id, attr, value) {
  const it = items.get(id);
  if (!it) throw new Error(`상태 없는 객체 ${id}`);
  it.state[attr] = value;
  return applyAttr(stateCtx, it.targets, attr, it.states[attr], value);
}

// --- 데모: 냉장고 문 열기, TV(실행 중 더한 물건) 켜기, 거실 → 주방 개수대 경로 띠 -----------------------------------
const demo = {};
const VIZ = { planned: "#4FB3A5", active: "#2F80ED", width: 0.14, y: 0.03 }; // twin3d 계획 VIZ.path와 같은 값
if (DEMO) {
  demo.fridge = setState("fridge_bbc363a3", "door", "open");
  // TV: 실행 중 배치 더하기처럼 TV장 위에 올린다(기본: 침실 2, 화면이 카메라 쪽). 굽기에 없던 물건이라 그림자는 없다
  const standId = q.get("tv") ?? "tv_stand_4136aadf";
  const stand = root.getObjectByName(standId);
  const box = new THREE.Box3().setFromObject(stand);
  const tvRoot = tvGltf.scene.children.find((c) => c.name === "tv") ?? tvGltf.scene;
  const tv = new THREE.Group();
  tv.name = "tv_demo";
  tv.position.set((box.min.x + box.max.x) / 2, box.max.y, (box.min.z + box.max.z) / 2);
  tv.rotation.y = entries.get(standId).rotation[1];
  tv.add(tvRoot);
  scene.add(tv);
  tv.updateMatrixWorld(true);
  const tvItem = { node: tv, states: statesOf({}, tvRoot), attrs: {}, targets: collectTargets(tv), state: {} };
  applyState(stateCtx, tvItem.targets, tvItem.states, tvItem.attrs, tvItem.state);
  items.set("tv_demo", tvItem);
  demo.tv = setState("tv_demo", "power", "on");
  const path = route();
  demo.route = { points: path.points.length, length: Number(path.length.toFixed(2)), ms: path.ms, start: path.start, goal: path.goal };
  scene.add(pathLayer(path.smooth));
}

// 바닥 격자 A*: 방 다각형 안, 벽에서 로봇 반지름만큼 떨어진 곳, 바닥에 닿는 물건 상자 밖. 문 폭은 지나갈 수 있다.
function route() {
  const t = performance.now();
  const R = 0.25;
  const cell = 0.05;
  const pts = data.plan.rooms.flatMap((r) => r.polygon);
  const x0 = Math.min(...pts.map((p) => p[0])) - 0.5;
  const y0 = Math.min(...pts.map((p) => p[1])) - 0.5;
  const nx = Math.ceil((Math.max(...pts.map((p) => p[0])) + 0.5 - x0) / cell);
  const ny = Math.ceil((Math.max(...pts.map((p) => p[1])) + 0.5 - y0) / cell);
  const inside = ([x, y], poly) => {
    let k = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const [xi, yi] = poly[i]; const [xj, yj] = poly[j];
      if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) k = !k;
    }
    return k;
  };
  const segDist = ([px, py], [ax, ay], [bx, by]) => {
    const dx = bx - ax; const dy = by - ay;
    const tt = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy || 1)));
    return Math.hypot(px - (ax + tt * dx), py - (ay + tt * dy));
  };
  const doors = data.plan.doors ?? [];
  const boxes = [];
  const skip = new Set(["walls", "floors"]);
  const opening = new Set(data.objects.filter((e) => e.mount === "opening" || e.mount === "wall" || e.mount === "ceiling").map((e) => e.id));
  for (const groupName of ["appliances", "furniture", "fixtures", "props", "drawn"]) { // drawn = 그림의 도면 설비(개수대 등)
    const group = root.getObjectByName(groupName);
    if (!group) continue;
    const byKey = new Map();
    for (const c of group.children) {
      if (opening.has(c.name) || skip.has(c.name) || !c.visible) continue;
      const fixture = (plan.fixtures ?? []).find((f) => c.name.startsWith(`${f.id}_`));
      const key = fixture ? fixture.id : c.name;
      const b = new THREE.Box3().setFromObject(c);
      if (b.isEmpty()) continue;
      byKey.set(key, byKey.has(key) ? byKey.get(key).union(b) : b);
    }
    for (const b of byKey.values()) if (b.min.y < 0.3 && b.max.y > 0.03) boxes.push(b);
  }
  const free = new Uint8Array(nx * ny);
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const p = [x0 + (i + 0.5) * cell, y0 + (j + 0.5) * cell];
      const nearDoor = doors.some((d) => Math.hypot(p[0] - d.position[0], p[1] - d.position[1]) < d.width / 2 - 0.05);
      if (!nearDoor && !data.plan.rooms.some((r) => inside(p, r.polygon))) continue;
      if (!nearDoor && data.plan.walls.some((w) => w.a && w.b && segDist(p, w.a, w.b) < w.thickness / 2 + R)) continue;
      if (boxes.some((b) => p[0] > b.min.x - R && p[0] < b.max.x + R && p[1] > b.min.z - R && p[1] < b.max.z + R)) continue;
      free[j * nx + i] = 1;
    }
  }
  const idx = ([x, y]) => [Math.floor((x - x0) / cell), Math.floor((y - y0) / cell)];
  const nearestFree = (p) => {
    const [ci, cj] = idx(p);
    let best = null; let bd = Infinity;
    for (let j = Math.max(0, cj - 60); j < Math.min(ny, cj + 60); j++) {
      for (let i = Math.max(0, ci - 60); i < Math.min(nx, ci + 60); i++) {
        if (!free[j * nx + i]) continue;
        const d = Math.hypot(i - ci, j - cj);
        if (d < bd) { bd = d; best = [i, j]; }
      }
    }
    return best;
  };
  const basin = new THREE.Box3().setFromObject(root.getObjectByName("sink_counter_kitchen_basin"));
  const startP = (q.get("from") ?? "10.35,11.2").split(",").map(Number);
  const goalP = [(basin.min.x + basin.max.x) / 2, (basin.min.z + basin.max.z) / 2];
  const s0 = nearestFree(startP);
  const g0 = nearestFree(goalP);
  // A* (8방향)
  const N = nx * ny;
  const gScore = new Float32Array(N).fill(Infinity);
  const prev = new Int32Array(N).fill(-1);
  const closed = new Uint8Array(N);
  const open = [[0, s0[1] * nx + s0[0]]];
  gScore[s0[1] * nx + s0[0]] = 0;
  const goal = g0[1] * nx + g0[0];
  const hh = (k) => Math.hypot((k % nx) - g0[0], Math.floor(k / nx) - g0[1]);
  const push = (item) => { open.push(item); let i = open.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (open[p][0] <= open[i][0]) break; [open[p], open[i]] = [open[i], open[p]]; i = p; } };
  const pop = () => { const top = open[0]; const last = open.pop(); if (open.length) { open[0] = last; let i = 0; for (;;) { const l = 2 * i + 1; const r = l + 1; let m = i; if (l < open.length && open[l][0] < open[m][0]) m = l; if (r < open.length && open[r][0] < open[m][0]) m = r; if (m === i) break; [open[m], open[i]] = [open[i], open[m]]; i = m; } } return top; };
  while (open.length) {
    const [, k] = pop();
    if (closed[k]) continue;
    closed[k] = 1;
    if (k === goal) break;
    const ci = k % nx; const cj = Math.floor(k / nx);
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      if (!di && !dj) continue;
      const i = ci + di; const j = cj + dj;
      if (i < 0 || j < 0 || i >= nx || j >= ny) continue;
      const n = j * nx + i;
      if (!free[n] || closed[n]) continue;
      if (di && dj && (!free[cj * nx + i] || !free[j * nx + ci])) continue;
      const gNew = gScore[k] + Math.hypot(di, dj);
      if (gNew < gScore[n]) { gScore[n] = gNew; prev[n] = k; push([gNew + hh(n), n]); }
    }
  }
  if (prev[goal] < 0) throw new Error("경로를 못 찾았어요");
  const cells = [];
  for (let k = goal; k >= 0; k = prev[k]) cells.unshift(k);
  const xy = (k) => [x0 + ((k % nx) + 0.5) * cell, y0 + (Math.floor(k / nx) + 0.5) * cell];
  const los = (a, b) => { // 두 칸 사이가 모두 빈 칸인가
    const [ax, ay] = [a % nx, Math.floor(a / nx)]; const [bx, by] = [b % nx, Math.floor(b / nx)];
    const n = Math.ceil(Math.hypot(bx - ax, by - ay) * 2);
    for (let i = 0; i <= n; i++) {
      const x = Math.round(ax + ((bx - ax) * i) / n); const y = Math.round(ay + ((by - ay) * i) / n);
      if (!free[y * nx + x]) return false;
    }
    return true;
  };
  const keep = [cells[0]];
  for (let i = 1; i < cells.length; i++) if (!los(keep.at(-1), cells[i])) keep.push(cells[i - 1]);
  keep.push(cells.at(-1));
  const corners = keep.map(xy);
  // 모서리 둥글리기(2차 베지에, 반지름 최대 0.6 m)
  const smooth = [corners[0]];
  for (let i = 1; i < corners.length - 1; i++) {
    const [a, b, c] = [corners[i - 1], corners[i], corners[i + 1]];
    const lab = Math.hypot(b[0] - a[0], b[1] - a[1]); const lbc = Math.hypot(c[0] - b[0], c[1] - b[1]);
    const r = Math.min(0.6, lab / 2, lbc / 2);
    const p0 = [b[0] + ((a[0] - b[0]) * r) / lab, b[1] + ((a[1] - b[1]) * r) / lab];
    const p2 = [b[0] + ((c[0] - b[0]) * r) / lbc, b[1] + ((c[1] - b[1]) * r) / lbc];
    for (let k = 0; k <= 8; k++) {
      const u = k / 8;
      smooth.push([(1 - u) ** 2 * p0[0] + 2 * (1 - u) * u * b[0] + u * u * p2[0], (1 - u) ** 2 * p0[1] + 2 * (1 - u) * u * b[1] + u * u * p2[1]]);
    }
  }
  smooth.push(corners.at(-1));
  let length = 0;
  for (let i = 1; i < smooth.length; i++) length += Math.hypot(smooth[i][0] - smooth[i - 1][0], smooth[i][1] - smooth[i - 1][1]);
  const r2 = (p) => p.map((v) => Number(v.toFixed(2)));
  return { smooth, points: corners, length, ms: Math.round(performance.now() - t), start: r2(xy(cells[0])), goal: r2(xy(goal)) };
}

// 경로 띠(twin3d 계획 AgentLayer와 같은 모양): 바닥 위 0.03 m 띠, 방향 갈매기표, 시작 점, 목적지 고리, 지금 위치 점
function pathLayer(path) {
  const group = new THREE.Group();
  group.name = "route";
  const y = floorY + VIZ.y;
  const pos = [];
  const half = VIZ.width / 2;
  const normalAt = (i) => {
    const a = path[Math.max(0, i - 1)]; const b = path[Math.min(path.length - 1, i + 1)];
    const dx = b[0] - a[0]; const dz = b[1] - a[1]; const l = Math.hypot(dx, dz) || 1;
    return [-dz / l, dx / l];
  };
  for (let i = 0; i < path.length - 1; i++) {
    const [a, b] = [path[i], path[i + 1]];
    const [na, nb] = [normalAt(i), normalAt(i + 1)];
    const A1 = [a[0] + na[0] * half, y, a[1] + na[1] * half]; const A2 = [a[0] - na[0] * half, y, a[1] - na[1] * half];
    const B1 = [b[0] + nb[0] * half, y, b[1] + nb[1] * half]; const B2 = [b[0] - nb[0] * half, y, b[1] - nb[1] * half];
    pos.push(...A1, ...A2, ...B1, ...B1, ...A2, ...B2);
  }
  const flat = (color, opacity = 1) => new THREE.MeshBasicMaterial({ color, transparent: opacity < 1, opacity, depthWrite: false, toneMapped: false, side: THREE.DoubleSide });
  const ribbon = new THREE.Mesh(new THREE.BufferGeometry().setAttribute("position", new THREE.Float32BufferAttribute(pos, 3)), flat(VIZ.planned, 0.85));
  ribbon.renderOrder = 2;
  group.add(ribbon);
  // 갈매기표: 0.7 m마다
  const chev = [];
  let acc = 0.35;
  for (let i = 1; i < path.length; i++) {
    const [a, b] = [path[i - 1], path[i]];
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]);
    while (acc <= l) {
      const u = acc / l;
      const p = [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u];
      const d = [(b[0] - a[0]) / l, (b[1] - a[1]) / l];
      const n = [-d[1], d[0]];
      const s1 = 0.045; const s2 = 0.05;
      const tip = [p[0] + d[0] * s2, p[1] + d[1] * s2];
      const l1 = [p[0] - d[0] * s2 + n[0] * s1, p[1] - d[1] * s2 + n[1] * s1];
      const l2 = [p[0] - d[0] * s2 - n[0] * s1, p[1] - d[1] * s2 - n[1] * s1];
      chev.push(l1[0], y + 0.002, l1[1], tip[0], y + 0.002, tip[1], l2[0], y + 0.002, l2[1]);
      acc += 0.7;
    }
    acc -= l;
  }
  const arrows = new THREE.Mesh(new THREE.BufferGeometry().setAttribute("position", new THREE.Float32BufferAttribute(chev, 3)), flat("#FFFFFF", 0.95));
  arrows.renderOrder = 3;
  group.add(arrows);
  const start = new THREE.Mesh(new THREE.CircleGeometry(0.08, 32).rotateX(-Math.PI / 2), flat(VIZ.planned));
  start.position.set(path[0][0], y + 0.003, path[0][1]);
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.22, 0.3, 48).rotateX(-Math.PI / 2), flat(VIZ.active));
  ring.position.set(path.at(-1)[0], y + 0.003, path.at(-1)[1]);
  // 지금 위치 점(경로 35% 지점)
  let total = 0;
  for (let i = 1; i < path.length; i++) total += Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]);
  let want = total * 0.35; let at = path[0];
  for (let i = 1; i < path.length; i++) {
    const l = Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]);
    if (want <= l) { const u = want / l; at = [path[i - 1][0] + (path[i][0] - path[i - 1][0]) * u, path[i - 1][1] + (path[i][1] - path[i - 1][1]) * u]; break; }
    want -= l;
  }
  const dot = new THREE.Mesh(new THREE.CircleGeometry(0.11, 32).rotateX(-Math.PI / 2), flat(VIZ.active));
  dot.position.set(at[0], y + 0.004, at[1]);
  for (const m of [start, ring, dot]) { m.renderOrder = 4; group.add(m); }
  return group;
}

// --- 합치기(선택): 벽 보기·자르기와 상관없는 정적 메시만 재질별로 하나로 -----------------------------------------
const mergeInfo = { before: staticMeshes.length };
if (MERGE) {
  const movable = new Set();
  for (const w of walls) if (w.upper) w.upper.traverse((n) => movable.add(n));
  for (const rail of railOf.values()) rail.traverse((n) => movable.add(n)); // 난간은 벽 보기에 따라 켜고 끈다
  for (const e of data.objects) {
    if (e.mount === "wall" || e.mount === "opening" || tallClip.has(e.id)) root.getObjectByName(e.id)?.traverse((n) => movable.add(n));
  }
  const groups = new Map();
  for (const m of staticMeshes) {
    if (movable.has(m)) continue;
    const mat = m.material;
    const keys = ["position", ...(mat.map ? ["uv"] : []), ...(mat.lightMap ? ["uv1"] : [])];
    if (keys.some((k) => !m.geometry.attributes[k])) { movable.add(m); continue; }
    const key = `${mat.uuid}|${keys.join(",")}`;
    if (!groups.has(key)) groups.set(key, { mat, keys, list: [] });
    groups.get(key).list.push(m);
  }
  let merged = 0;
  for (const { mat, keys, list } of groups.values()) {
    const geos = list.map((m) => {
      const g = new THREE.BufferGeometry();
      for (const k of keys) g.setAttribute(k, m.geometry.attributes[k].clone());
      g.setIndex(m.geometry.index ? m.geometry.index.clone() : [...Array(m.geometry.attributes.position.count).keys()]);
      return g.applyMatrix4(m.matrixWorld);
    });
    const geo = mergeGeometries(geos, false);
    if (!geo) continue;
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = `merged_${mat.name}`;
    scene.add(mesh);
    for (const m of list) m.visible = false;
    merged++;
  }
  mergeInfo.after = merged + staticMeshes.filter((m) => movable.has(m)).length;
}

// --- 그리기·기록 -----------------------------------------------------------------------------------------
function textureBytes() {
  const seen = new Set();
  let bytes = 0;
  const add = (t) => {
    if (!t || seen.has(t)) return;
    seen.add(t);
    const img = t.image;
    const w = img?.width ?? 0; const h = img?.height ?? 0;
    const bpp = t.type === THREE.FloatType ? 16 : t.type === THREE.HalfFloatType ? 8 : 4;
    const mip = t.generateMipmaps && t.minFilter !== THREE.LinearFilter && t.minFilter !== THREE.NearestFilter ? 4 / 3 : 1;
    bytes += w * h * bpp * mip;
  };
  scene.traverseVisible((n) => {
    if (!n.material) return;
    for (const m of [n.material].flat()) for (const k of ["map", "lightMap", "alphaMap", "emissiveMap", "normalMap", "roughnessMap", "metalnessMap", "aoMap", "envMap"]) add(m[k]);
  });
  return { count: seen.size, mb: Number((bytes / 2 ** 20).toFixed(1)) };
}
const r0 = performance.now();
renderer.render(scene, camera);
renderer.render(scene, camera);
const renderMs = Math.round((performance.now() - r0) / 2);
const stats = {
  page: "baked", set: SET, walls: WALLS, demoOn: DEMO, merge: MERGE, look: LOOK, three: THREE.REVISION,
  loadMs: Math.round(loadMs), renderMs, calls: renderer.info.render.calls, triangles: renderer.info.render.triangles,
  texturesGpu: renderer.info.memory.textures, geometries: renderer.info.memory.geometries, programs: renderer.info.programs?.length,
  textures: textureBytes(), meshes: count, raised: wallInfo.raised, cutActions: wallInfo.actions, mergeInfo,
  lights: { hemiSky: sky.toArray().map((v) => Number(v.toFixed(3))), hemiGround: groundCol.toArray().map((v) => Number(v.toFixed(3))), sun: s.intensity },
  groundShadow: { size: gs.size, kind: gs.kind ?? "canvas" }, anisotropy: ANISO, view: { clip: [...tallClip], hide: [...hideIds], rails: railOf.size },
  lightmaps: man.lightmaps.map((l) => `${l.name} ${l.size}² ×${l.intensity.toFixed(3)}`), demo: demoInfo(),
};
function demoInfo() { return DEMO ? { fridge: demo.fridge, tv: demo.tv, route: demo.route, lights: stateCtx.lights.size } : null; }
window.spike = { THREE, scene, camera, renderer, setWalls, setState, render: () => renderer.render(scene, camera) };
window.__spike = { ready: true, ...stats };
console.log("spike", JSON.stringify(stats));
