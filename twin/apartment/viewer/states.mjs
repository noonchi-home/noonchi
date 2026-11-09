// 가전 상태 효과(계약 4절)를 적용하고 되돌리는 순수 함수. three.js를 가져오지 않는다.
//
// - 부품은 노드의 userData.part(GLB extras)로, 빛 기준점은 userData.light(JSON 문자열)로 찾는다.
// - 효과는 모두 '쉴 때 모습'(GLB 그대로) 기준의 절대값이다. 노드마다 처음 건드릴 때 쉴 때 모습을 저장하고,
//   상태마다 기여분을 따로 두었다가 다시 합친다. 그래서 같은 값을 두 번 넣어도 같고(멱등),
//   A → B → A로 가면 A의 모습으로 정확히 돌아온다.
// - 한 상태 안에서 값의 효과 목록에 없는 대상은 기본값의 효과를, 그것도 없으면 쉴 때 모습을 쓴다.
// - 여러 상태가 같은 대상을 건드리면 이동은 더하고, 회전·크기·발광·빛 세기는 곱하고, 보이기는 모두 참일 때만 보인다.
// - three.js 빛은 createContext({makeLight})로 받은 함수가 만든다(켜질 때만, 동시 최대 maxLights개).
//   placeLight·releaseLight를 함께 주면 미리 만든 풀에서 빌려 쓴다(createContext 설명).

import { parseProp } from "./scene.mjs";

// 효과 키: 문자열 값은 그대로("on"), 나머지는 JSON 문자열(true → "true", 1 → "1")
export const valueKey = (v) => (typeof v === "string" ? v : JSON.stringify(v));

export function parseValueKey(key) {
  if (/^(true|false|null|-?\d+(\.\d+)?)$/.test(key)) return JSON.parse(key);
  return key;
}

export function attrValues(states, attrs, attr) {
  if (Array.isArray(attrs?.[attr]) && attrs[attr].length) return attrs[attr];
  return Object.keys(states?.[attr]?.effects ?? {}).map(parseValueKey);
}

export function defaultValue(states, attrs, attr) {
  const spec = states?.[attr];
  if (spec && spec.default !== undefined) return spec.default;
  return attrValues(states, attrs, attr)[0];
}

// '모두 켜기/끄기' 대상: 켬/끔(on/off) 또는 동작(true/false) 두 값짜리 상태
export function powerValues(values) {
  if (values.length !== 2) return null;
  if (values.includes("on") && values.includes("off")) return { on: "on", off: "off" };
  if (values.includes(true) && values.includes(false)) return { on: true, off: false };
  return null;
}

export function nonDefault(states, attrs, state) {
  return Object.keys(states ?? {})
    .map((attr) => [attr, state?.[attr] ?? defaultValue(states, attrs, attr)])
    .filter(([attr, v]) => valueKey(v) !== valueKey(defaultValue(states, attrs, attr)));
}

const ATTR_LABELS = {
  power: "전원", running: "동작", door: "문", heating: "난방", screen: "화면", curtain: "커튼",
  blind: "블라인드", lock: "잠금", light: "조명", mode: "모드", fan: "바람", charging: "충전",
  faucet: "수전", water: "물",
};
const VALUE_LABELS = {
  on: "켜짐", off: "꺼짐", true: "동작 중", false: "멈춤", open: "열림", closed: "닫힘",
  locked: "잠김", unlocked: "풀림", active: "활동", sleep: "대기",
};
export const attrLabel = (attr) => ATTR_LABELS[attr] ?? attr;
export const valueLabel = (attr, value) => VALUE_LABELS[valueKey(value)] ?? valueKey(value);

// 상태 한 줄 글: 전원·동작은 값만("켜짐", "동작 중"), 나머지는 무엇인지 붙인다("문 열림", "잠금 풀림").
export const stateText = (attr, value) =>
  (attr === "power" || attr === "running" ? valueLabel(attr, value) : `${attrLabel(attr)} ${valueLabel(attr, value)}`);

// 상태가 바뀔 때 말풍선 색: 기본값(꺼짐·닫힘·잠김)에서 벗어나면 on, 기본값으로 돌아오면 off
export const changeTone = (states, attrs, attr, value) =>
  (valueKey(value) === valueKey(defaultValue(states, attrs, attr)) ? "off" : "on");

// 기본값이 아닌 상태가 있는 가전(가전 상태 패널·CCTV 화면용). items: id → {entry, states, attrs}, stateOf(id) → 상태
export function activeDevices(items, stateOf) {
  const out = [];
  for (const [id, item] of items) {
    const changed = nonDefault(item.states, item.attrs, stateOf(id));
    if (!changed.length) continue;
    out.push({ id, name: item.entry.name ?? id, room: item.entry.room ?? null, labels: changed.map(([a, v]) => stateText(a, v)) });
  }
  return out;
}

// --- 대상 찾기 ------------------------------------------------------------------------------------
function* walk(node) {
  yield node;
  for (const child of node.children ?? []) yield* walk(child);
}

const push = (map, key, value) => {
  if (!map.has(key)) map.set(key, []);
  map.get(key).push(value);
};

export function collectTargets(root) {
  const parts = new Map();
  const lights = new Map();
  for (const node of walk(root)) {
    const label = node.userData?.part;
    if (label !== undefined) push(parts, label, node);
    if (node.userData?.light !== undefined) push(lights, label ?? node.name, node);
  }
  return { parts, lights };
}

const KINDS = ["emissive", "visible", "rotate", "translate", "scale", "spin"];
const kindsOf = (effect) => ("light" in effect ? ["light"] : KINDS.filter((k) => k in effect));
const labelOf = (effect) => ("light" in effect ? effect.light : effect.part);
const nodesFor = (targets, kind, label) => (kind === "light" ? targets.lights : targets.parts).get(label) ?? [];
const describeTarget = (kind, label) => `${kind === "light" ? "light" : "part"} ${label}`;

export function missingTargets(states, targets) {
  const missing = [];
  for (const [attr, spec] of Object.entries(states ?? {})) {
    for (const [key, effects] of Object.entries(spec.effects ?? {})) {
      for (const effect of effects) {
        const kind = kindsOf(effect)[0] ?? "part";
        if (!nodesFor(targets, kind, labelOf(effect)).length) missing.push(`${attr}=${key}: ${describeTarget(kind, labelOf(effect))}`);
      }
    }
  }
  return missing;
}

// 상태 연결 판정: ok(모든 대상 있음) | no-builder(회색 상자라 대상이 없음. 빌더가 생기면 채워진다) | missing(누락)
export function wiringStatus(states, targets, placeholder = false) {
  const missing = missingTargets(states, targets);
  if (!missing.length) return { status: "ok", missing };
  return { status: placeholder ? "no-builder" : "missing", missing };
}

// --- 쿼터니언(three.js와 같은 규칙, [x, y, z, w]) ------------------------------------------------------
export function quatFromEulerXYZ([a, b, c]) {
  const [c1, c2, c3] = [Math.cos(a / 2), Math.cos(b / 2), Math.cos(c / 2)];
  const [s1, s2, s3] = [Math.sin(a / 2), Math.sin(b / 2), Math.sin(c / 2)];
  return [
    s1 * c2 * c3 + c1 * s2 * s3,
    c1 * s2 * c3 - s1 * c2 * s3,
    c1 * c2 * s3 + s1 * s2 * c3,
    c1 * c2 * c3 - s1 * s2 * s3,
  ];
}

export function quatMultiply([ax, ay, az, aw], [bx, by, bz, bw]) {
  return [
    ax * bw + aw * bx + ay * bz - az * by,
    ay * bw + aw * by + az * bx - ax * bz,
    az * bw + aw * bz + ax * by - ay * bx,
    aw * bw - ax * bx - ay * by - az * bz,
  ];
}

const DEG = Math.PI / 180;

// --- 적용 ---------------------------------------------------------------------------------------
// placeLight·releaseLight를 주면 빛을 기준점의 자식으로 붙였다 떼지 않고, 미리 만든 풀에서 빌렸다 돌려준다.
// three.js는 장면의 빛 개수가 바뀔 때마다 모든 재질의 셰이더를 다시 만들어 화면이 몇 초씩 멈추기 때문이다.
// 풀이 비면 makeLight가 null을 돌려주고, 그 기준점은 못 켠 것(skipped)으로 남는다.
export function createContext({ makeLight = null, maxLights = 16, placeLight = null, releaseLight = null } = {}) {
  return {
    makeLight, maxLights, placeLight, releaseLight,
    rest: new WeakMap(), // 노드 → 쉴 때 모습
    contrib: new WeakMap(), // 노드 → kind → (출처 → 값)
    baseEmissive: new WeakMap(), // 복제한 재질 → 원래 emissiveIntensity
    owned: new WeakSet(), // 재질을 복제해 가진 메시
    lightOf: new WeakMap(), // 기준점 → three.js 빛
    lights: new Set(), // 지금 켜진 빛
    lit: new Set(), // 지금 빛이 붙은 기준점
    skipped: new Set(), // 최대 개수를 넘어 못 켠 기준점
    want: new Map(), // 기준점 → 켜 달라는 세기 배수(못 켠 빛을 자리가 나면 켜려고)
    spins: new Map(), // 노드 → {rate, angle, base}
  };
}

// 메시 재질을 인스턴스 전용으로 한 번만 복제한다(같은 종류 인스턴스가 재질을 공유하므로).
export function ownMaterials(ctx, mesh) {
  if (ctx.owned.has(mesh)) return [mesh.material].flat();
  const clone = (m) => {
    const c = m.clone();
    ctx.baseEmissive.set(c, m.emissiveIntensity ?? 1);
    return c;
  };
  mesh.material = Array.isArray(mesh.material) ? mesh.material.map(clone) : clone(mesh.material);
  ctx.owned.add(mesh);
  return [mesh.material].flat();
}

function restOf(ctx, node) {
  if (!ctx.rest.has(node)) {
    const { position: p, quaternion: q, scale: s } = node;
    ctx.rest.set(node, { p: [p.x, p.y, p.z], q: [q.x, q.y, q.z, q.w], s: [s.x, s.y, s.z], visible: node.visible });
  }
  return ctx.rest.get(node);
}

function setContribution(ctx, node, kind, source, value) {
  restOf(ctx, node);
  if (!ctx.contrib.has(node)) ctx.contrib.set(node, new Map());
  const kinds = ctx.contrib.get(node);
  if (!kinds.has(kind)) kinds.set(kind, new Map());
  if (value === undefined) kinds.get(kind).delete(source);
  else kinds.get(kind).set(source, value);
}

const values = (kinds, kind) => [...(kinds.get(kind)?.values() ?? [])];

// 빛 자리 우선순위: 천장 조명(방을 밝히는 빛)이 먼저, 그다음 와트가 큰 순서.
function wattsOf(anchor) {
  let mount;
  for (let n = anchor; n && mount === undefined; n = n.parent) mount = n.userData?.mount;
  return (mount === "ceiling" ? 1e4 : 0) + (parseProp(anchor.userData.light)?.watts ?? 0);
}

// 가장 앞선(우선순위가 큰) 기준점. 같으면 먼저 들어온 것.
function strongest(anchors) {
  let best = null;
  for (const a of anchors) if (!best || wattsOf(a) > wattsOf(best)) best = a;
  return best;
}

function weakestLit(ctx) {
  let worst = null;
  for (const a of ctx.lit) if (!worst || wattsOf(a) < wattsOf(worst)) worst = a;
  return worst;
}

function dropLight(ctx, anchor) {
  const light = ctx.lightOf.get(anchor);
  if (ctx.releaseLight) ctx.releaseLight(light);
  else {
    anchor.remove(light);
    light.dispose?.();
  }
  ctx.lightOf.delete(anchor);
  ctx.lights.delete(light);
  ctx.lit.delete(anchor);
}

// 빛 개수에는 상한(maxLights)이 있다. 꽉 차면 우선순위가 큰 빛(천장 조명, 큰 와트)이 작은 표시등 자리를
// 가져가고, 밀린 빛은 skipped에 남았다가 자리가 나면 앞선 것부터 다시 켠다.
function refreshLight(ctx, anchor, k) {
  if (k > 0) ctx.want.set(anchor, k);
  else {
    ctx.want.delete(anchor);
    ctx.skipped.delete(anchor);
  }
  let light = ctx.lightOf.get(anchor);
  const spec = parseProp(anchor.userData.light) ?? {};
  if (k > 0 && !light && ctx.makeLight) {
    if (ctx.lights.size >= ctx.maxLights) {
      const weakest = weakestLit(ctx);
      if (!weakest || wattsOf(weakest) >= wattsOf(anchor)) {
        ctx.skipped.add(anchor);
        return;
      }
      dropLight(ctx, weakest);
      ctx.skipped.add(weakest);
    }
    light = ctx.makeLight(spec);
    if (!light) {
      ctx.skipped.add(anchor);
      return;
    }
    if (ctx.placeLight) ctx.placeLight(light, anchor);
    else anchor.add(light);
    ctx.lightOf.set(anchor, light);
    ctx.lights.add(light);
    ctx.lit.add(anchor);
  }
  if (!light) return;
  if (k > 0) {
    light.intensity = (spec.three_intensity ?? 1) * k;
    ctx.skipped.delete(anchor);
    return;
  }
  dropLight(ctx, anchor);
  // 자리가 났다: 못 켰던 빛 가운데 가장 센 것을 켠다.
  const next = strongest(ctx.skipped);
  if (next) {
    ctx.skipped.delete(next);
    refreshLight(ctx, next, ctx.want.get(next));
  }
}

function refresh(ctx, node) {
  const rest = restOf(ctx, node);
  const kinds = ctx.contrib.get(node) ?? new Map();
  const translate = values(kinds, "translate");
  const rotate = values(kinds, "rotate");
  const scale = values(kinds, "scale");
  const p = translate.reduce((acc, t) => acc.map((v, i) => v + t[i]), rest.p);
  const q = rotate.reduce((acc, r) => quatMultiply(acc, quatFromEulerXYZ(r.map((d) => d * DEG))), rest.q);
  const s = scale.reduce((acc, f) => acc.map((v, i) => v * f[i]), rest.s);
  node.position.set(...p);
  node.quaternion.set(...q);
  node.scale.set(...s);

  const visible = values(kinds, "visible");
  node.visible = visible.length ? visible.every(Boolean) : rest.visible;

  const spin = values(kinds, "spin").reduce((acc, r) => acc.map((v, i) => v + r[i]), [0, 0, 0]);
  if (spin.some((v) => v !== 0)) {
    const prev = ctx.spins.get(node);
    ctx.spins.set(node, { rate: spin, angle: prev?.angle ?? [0, 0, 0], base: q });
    applySpin(node, ctx.spins.get(node));
  } else {
    ctx.spins.delete(node);
  }

  const emissive = values(kinds, "emissive");
  if (node.isMesh && kinds.has("emissive")) {
    const k = emissive.reduce((acc, v) => acc * v, 1);
    for (const m of ownMaterials(ctx, node)) m.emissiveIntensity = ctx.baseEmissive.get(m) * k;
  }

  if (kinds.has("light")) {
    // 쉴 때 모습에는 three.js 빛이 없다: 기여가 하나도 없으면 끈다.
    const light = values(kinds, "light");
    refreshLight(ctx, node, light.length ? light.reduce((acc, v) => acc * v, 1) : 0);
  }
}

function applySpin(node, spin) {
  if (spin.angle.every((a) => a === 0)) node.quaternion.set(...spin.base);
  else node.quaternion.set(...quatMultiply(spin.base, quatFromEulerXYZ(spin.angle)));
}

// 돌기(spin) 효과: 초당 회전수 × dt만큼 돌린다. 화면 그리기 전에 매 프레임 부른다.
export function tickSpins(ctx, dt) {
  for (const [node, spin] of ctx.spins) {
    spin.angle = spin.angle.map((a, i) => (a + spin.rate[i] * 2 * Math.PI * dt) % (2 * Math.PI));
    applySpin(node, spin);
  }
}

const effectValue = (effect, kind) => (kind === "light" ? effect.intensity : effect[kind]);

// 한 상태(attr)의 값을 적용한다. targets = collectTargets(인스턴스 노드).
export function applyAttr(ctx, targets, attr, spec, value) {
  const effects = spec?.effects ?? {};
  const pick = (key) => {
    const chosen = new Map();
    for (const e of effects[key] ?? []) for (const kind of kindsOf(e)) chosen.set(`${kind}|${labelOf(e)}`, effectValue(e, kind));
    return chosen;
  };
  const current = pick(valueKey(value));
  const fallback = pick(valueKey(spec?.default));
  const touched = new Set();
  for (const key of Object.keys(effects)) for (const k of pick(key).keys()) touched.add(k);

  const missing = [];
  const dirty = new Set();
  for (const id of touched) {
    const [kind, label] = [id.slice(0, id.indexOf("|")), id.slice(id.indexOf("|") + 1)];
    const v = current.has(id) ? current.get(id) : fallback.get(id);
    const nodes = nodesFor(targets, kind, label);
    if (!nodes.length) {
      if (current.has(id)) missing.push(describeTarget(kind, label));
      continue;
    }
    const source = `${attr}|${label}`;
    for (const node of nodes) {
      if (kind === "emissive") {
        for (const m of walk(node)) {
          if (!m.isMesh) continue;
          setContribution(ctx, m, kind, source, v);
          dirty.add(m);
        }
      } else {
        setContribution(ctx, node, kind, source, v);
        dirty.add(node);
      }
    }
  }
  for (const node of dirty) refresh(ctx, node);
  return { missing };
}

// 객체의 모든 상태를 적용한다. state에 없는 상태는 기본값.
export function applyState(ctx, targets, states, attrs, state) {
  const missing = [];
  for (const [attr, spec] of Object.entries(states ?? {})) {
    const value = state?.[attr] ?? defaultValue(states, attrs, attr);
    missing.push(...applyAttr(ctx, targets, attr, spec, value).missing.map((m) => `${attr}: ${m}`));
  }
  return { missing };
}
