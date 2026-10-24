// 고른 집의 배치 편집기 만들기: scene.json + 카탈로그 + (있으면) 저장해 둔 수정본(runtime/homes/<id>/edits.json).

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Home } from "../model/homes.js";
import { loadCatalog, type TypeInfo } from "./catalog.js";
import { LayoutEditor, type Edit, type SceneJson } from "./editor.js";

export interface LoadedLayout {
  editor: LayoutEditor;
  catalog: Map<string, TypeInfo>;
}

/** scene.json이 없으면(빌드 전) undefined. */
export function loadLayout(home: Home, opts: { runtimeDir: string; log: (line: string) => void }): LoadedLayout | undefined {
  if (!existsSync(home.scenePath)) return undefined;
  const scene = JSON.parse(readFileSync(home.scenePath, "utf8").replace(/^﻿/, "")) as SceneJson;
  const catalog = loadCatalog(home.catalogDir);
  const savePath = join(opts.runtimeDir, "homes", home.id, "edits.json");
  const editor = new LayoutEditor({ homeId: home.id, scene, catalog, savePath, outDir: home.outDir, libraryDir: home.libraryDir });
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
