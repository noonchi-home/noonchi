// 서버가 읽는 집 장면: scene.json(twin-studio 결과) + 도면 설비(집 data의 drawn_fixtures.json). 계획 평면도·배치 편집기·/api/scene이 같은 것을 쓴다.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { SceneJson } from "../layout/editor.js";
import { withDrawn, type DrawnFixture } from "./drawn.js";
import type { Home } from "./homes.js";

const read = (p: string) => JSON.parse(readFileSync(p, "utf8").replace(/^﻿/, "")) as unknown;

/** scene.json이 없으면(빌드 전) null. 도면 설비 파일이 없으면 scene.json 그대로. */
export function loadScene(home: Pick<Home, "scenePath" | "dataDir">): SceneJson | null {
  if (!existsSync(home.scenePath)) return null;
  const scene = read(home.scenePath) as SceneJson;
  const file = join(home.dataDir, "drawn_fixtures.json");
  if (!existsSync(file)) return scene;
  return withDrawn(scene, ((read(file) as { items?: DrawnFixture[] }).items ?? []));
}
