// 고른 집의 배치 편집기 만들기: 서버 장면(scene.json + 도면 설비 drawn_fixtures.json, src/model/scene.ts) + 카탈로그
// + (있으면) 저장해 둔 수정본(runtime/homes/<id>/edits.json). 도면 설비는 고정 설비라 옮길 수 없다.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Home } from "../model/homes.js";
import { loadScene } from "../model/scene.js";
import { loadCatalog, type TypeInfo } from "./catalog.js";
import { LayoutEditor, type Edit } from "./editor.js";

export interface LoadedLayout {
  editor: LayoutEditor;
  catalog: Map<string, TypeInfo>;
}

/** scene.json이 없으면(빌드 전) undefined. */
export function loadLayout(home: Home, opts: { runtimeDir: string; log: (line: string) => void }): LoadedLayout | undefined {
  const scene = loadScene(home);
  if (!scene) return undefined;
  const catalog = loadCatalog(home.catalogDir);
  const savePath = join(opts.runtimeDir, "homes", home.id, "edits.json");
  // 시연용으로 더한 가전(scene.added)은 구운 장면에 없어 연결 때 add로 보낸다
  const editor = new LayoutEditor({ homeId: home.id, scene, catalog, savePath, outDir: home.outDir, libraryDir: home.libraryDir, unbaked: scene.added });
  if (existsSync(savePath)) {
    try {
      const saved = JSON.parse(readFileSync(savePath, "utf8")) as { home?: string; edits?: Edit[] };
      if (saved.home === home.id && Array.isArray(saved.edits)) {
        const n = editor.applyEdits(saved.edits);
        opts.log(`배치 보정: 저장해 둔 수정본 ${saved.edits.length}건 중 ${n}건을 다시 적용했어요 (${savePath})`);
      }
    } catch (e) {
      opts.log(`[경고] 저장한 배치 수정본을 읽지 못했습니다: ${savePath} (${(e as Error).message})`);
    }
  }
  return { editor, catalog };
}
