// 서버가 읽는 집 장면: scene.json(twin-studio 결과) + 도면 설비(집 data의 drawn_fixtures.json) + 시연용으로 더하는 가전(집 data의 added_devices.json).
// 계획 평면도·배치 편집기·/api/scene·기기 목록(src/layout/twin-files.ts loadFromScene)이 같은 것을 쓴다.
// 더한 가전은 구운 3D에 없어 배치 편집기가 연결 때 add로 보낸다(src/layout/editor.ts unbaked, 더한 id 목록 added).
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { SceneJson, SceneObject } from "./editor.js";
import { profileAttrs } from "../devices/browser.js";
import { withDrawn, type DrawnFixture } from "./drawn.js";
import type { Home } from "./homes.js";

const read = (p: string) => JSON.parse(readFileSync(p, "utf8").replace(/^﻿/, "")) as unknown;

/** 시연용으로 더하는 가전 한 줄(added_devices.json items). 자리는 평면 [x, y], 높이는 놓는 면 윗면(m).
 *  landmark: AR 위치 맞추기 기준점으로 쓰는가. 실제 자리를 확인한 뒤 true로 적을 때만 쓴다(기본 빼기).
 *  footprint·height: 바닥 넓이 [폭, 깊이]·높이(m). 없으면 카탈로그 값, 카탈로그도 없으면 대시보드 트윈 상자 기본값. */
export interface AddedDevice {
  id: string; type: string; label: string; room: string; position: [number, number]; facing_deg: number; elevation: number; landmark?: boolean;
  footprint?: [number, number]; height?: number;
}

const round = (v: number, digits = 6) => Math.round(v * 10 ** digits) / 10 ** digits + 0;
/** 배치 물건 방향 → 장면 yaw(rad). 배치 편집기(src/layout/editor.ts yawOf)와 같다. */
const yawOf = (facing: number) => round((-(facing - 90) * Math.PI) / 180);

/** 종류 카탈로그: 집 카탈로그(data/homes/<집>/catalog), 없으면 공용 카탈로그(data/catalog). */
function catalogEntry(dataDir: string, type: string): Record<string, unknown> | null {
  for (const dir of [join(dataDir, "catalog"), join(dataDir, "..", "..", "catalog")]) {
    const file = join(dir, `${type}.json`);
    if (existsSync(file)) return read(file) as Record<string, unknown>;
  }
  return null;
}

type SceneHome = Pick<Home, "scenePath" | "dataDir"> & Partial<Pick<Home, "libraryDir">>;

/** 더하는 가전 → scene.json 물건 모양. 모델은 집 산출물 assets에 있으면 그것, 없으면 공용 라이브러리(/twin/lib/)의 같은 종류 GLB, 둘 다 없으면 null
 *  (대시보드 트윈이 그 자리에 회색 상자로 그린다). 카탈로그가 없는 종류는 등록부 프로필의 제어·센서 attr을 쓴다(src/devices/mapping.ts profileAttrs). */
function addedObject(d: AddedDevice, home: SceneHome): SceneObject {
  const c = catalogEntry(home.dataDir, d.type) ?? {};
  const category = typeof c.category === "string" ? c.category : "appliances";
  const rel = `assets/${category}/${d.type}.glb`;
  const asset = existsSync(join(dirname(home.scenePath), rel)) ? rel : home.libraryDir && existsSync(join(home.libraryDir, rel)) ? `lib/${rel}` : null;
  const footprint = d.footprint ?? (Array.isArray(c.footprint) ? c.footprint as [number, number] : undefined);
  const height = d.height ?? (typeof c.height === "number" ? c.height : undefined);
  const [x, y] = d.position;
  return {
    id: d.id, name: d.label, type: d.type, asset, category, mount: typeof c.mount === "string" ? c.mount : "surface", node_type: c.node_type ?? "device", room: d.room,
    plan: { position: [x, y], facing_deg: d.facing_deg, elevation: d.elevation, on: null, surface: null, wall: null },
    position: [x, d.elevation, y], rotation: [0, yawOf(d.facing_deg), 0], scale: [1, 1, 1],
    interactive: true, attrs: (c.attrs as Record<string, unknown>) ?? profileAttrs(d.type), states: (c.states as Record<string, unknown>) ?? {}, state: {}, landmark: d.landmark === true,
    ...(footprint ? { footprint } : {}), ...(height !== undefined ? { height } : {}),
    provenance: { origin: "added_devices", size: "catalog", facing: "added_devices", height: "added_devices", model: "catalog", builder: "added_devices" },
  };
}

/** scene.json이 없으면(빌드 전) null. 도면 설비·더하는 가전 파일이 없으면 그만큼 scene.json 그대로.
 *  더하는 가전은 같은 id가 이미 있으면 더하지 않고, 더한 id 목록을 added로 준다(더한 것이 없으면 칸이 없다). */
export function loadScene(home: SceneHome): (SceneJson & { added?: string[] }) | null {
  if (!existsSync(home.scenePath)) return null;
  let scene = read(home.scenePath) as SceneJson;
  const drawn = join(home.dataDir, "drawn_fixtures.json");
  if (existsSync(drawn)) scene = withDrawn(scene, ((read(drawn) as { items?: DrawnFixture[] }).items ?? []));
  const addedFile = join(home.dataDir, "added_devices.json");
  if (!existsSync(addedFile)) return scene;
  const have = new Set(scene.objects.map((o) => (o as { id?: string }).id));
  const add = ((read(addedFile) as { items?: AddedDevice[] }).items ?? []).filter((d) => !have.has(d.id)).map((d) => addedObject(d, home));
  return add.length ? { ...scene, objects: [...scene.objects, ...add], added: add.map((o) => o.id) } : scene;
}
