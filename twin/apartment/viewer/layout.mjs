// 실행 중 배치 보정(twin-home /events {type:"layout"})과 초점({type:"focus"}) 처리의 순수 함수.
// three.js·DOM 없이 node --test로 검사한다. 실제로 옮기고 그리는 일은 main.mjs가 한다.
//
// 메시지(twin-home docs/plan.md 계약 C):
//   move   {op:"move", id, room, plan:{position, facing_deg, elevation}, position:[x,h,y], rotation:[0,ry,0]}
//   add    {op:"add", object:<scene.json 객체 + footprint·height>}  asset이 null이면 회색 상자
//   remove {op:"remove", id}
//   focus  {targets:[{id, label, position:[x,h,y]}], at, ttl_ms}  targets가 비면 지운다

const finite = (v) => typeof v === "number" && Number.isFinite(v);
const isVec3 = (v) => Array.isArray(v) && v.length === 3 && v.every(finite);
const DEFAULT_TTL_MS = 8000;

/** 메시지를 ops.move(id, patch)·ops.add(object)·ops.remove(id)로 넘긴다. 돌려준 값은 그 함수의 결과(모르는 메시지는 null). */
export function routeLayout(msg, ops) {
  if (!msg || typeof msg !== "object") return null;
  if (msg.op === "move" && typeof msg.id === "string") {
    const patch = movePatch(msg);
    return patch ? ops.move(msg.id, patch) : null;
  }
  if (msg.op === "add" && msg.object && typeof msg.object.id === "string" && isVec3(msg.object.position)) {
    return ops.add(normalizeObject(msg.object));
  }
  if (msg.op === "remove" && typeof msg.id === "string") return ops.remove(msg.id);
  return null;
}

/** move 메시지 → scene.json 객체에 덮어쓸 값. 위치가 틀리면 null. */
export function movePatch(msg) {
  if (!isVec3(msg.position)) return null;
  const rotation = isVec3(msg.rotation) ? msg.rotation : [0, 0, 0];
  const patch = { position: [...msg.position], rotation: [...rotation] };
  if (typeof msg.room === "string") patch.room = msg.room;
  if (msg.plan && typeof msg.plan === "object") patch.plan = { ...msg.plan };
  return patch;
}

/** add 객체를 scene.json 모양으로 채운다(빠진 값은 기본값). */
export function normalizeObject(object) {
  return {
    name: object.id,
    category: "props",
    mount: "floor",
    rotation: [0, 0, 0],
    scale: [1, 1, 1],
    interactive: true,
    attrs: {},
    states: {},
    state: {},
    ...object,
    asset: typeof object.asset === "string" && object.asset ? object.asset : null,
  };
}

/**
 * 회색 상자 크기와 원점에서 상자 가운데까지의 거리(로컬, three.js 축). 에셋 정면은 로컬 +z다.
 * floor·surface: 바닥 가운데 원점, wall: 벽 접촉면 아래 가운데 원점(앞으로 깊이만큼), ceiling: 윗면 가운데 원점.
 */
export function boxSpec(object) {
  const [w, d] = Array.isArray(object.footprint) && object.footprint.every(finite) ? object.footprint : [0.4, 0.4];
  const h = finite(object.height) && object.height > 0 ? object.height : 0.4;
  const size = [Math.max(w, 0.05), Math.max(h, 0.02), Math.max(d, 0.05)];
  if (object.mount === "wall") return { size, center: [0, h / 2, d / 2] };
  if (object.mount === "ceiling") return { size, center: [0, -h / 2, 0] };
  return { size, center: [0, h / 2, 0] };
}

/** 초점 대상 중 위치가 맞는 것만. */
export function focusTargets(focus) {
  const list = Array.isArray(focus?.targets) ? focus.targets : [];
  return list.filter((t) => t && typeof t.id === "string" && isVec3(t.position))
    .map((t) => ({ id: t.id, label: typeof t.label === "string" && t.label ? t.label : t.id, position: [...t.position] }));
}

/** 받은 시각(now, ms) 기준 지울 시각. 컴퓨터 시계가 달라도 되게 at이 아니라 받은 때부터 ttl_ms를 센다. */
export function focusExpiry(focus, now) {
  const ttl = finite(focus?.ttl_ms) && focus.ttl_ms > 0 ? focus.ttl_ms : DEFAULT_TTL_MS;
  return now + ttl;
}
