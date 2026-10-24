// 폰 AR을 트윈에 맞출 바닥 기준점 두 곳(SSOT 9.6).
// 순서: scene.json plan.ar_anchors → 집 data의 floorplan.json ar_anchors → 예전 방식(scene 객체 dock·door_main의 평면 위치).
// ar_anchors는 평면도에 지정한 방 모서리 두 곳(실내 벽면이 만나는 바닥 점)이다: [{ id, label, position: [x, y] }].

import { existsSync, readFileSync } from "node:fs";
import type { Plan2 } from "./align.js";

export interface AnchorTarget {
  id: string;
  label: string;
  plan: Plan2;
}

/** ar_anchors가 없는 예전 집: 도크에서 시작하고 현관문 문턱 가운데로 방향을 맞춘다. */
export const DEFAULT_ANCHORS: readonly { id: string; label: string }[] = [
  { id: "dock", label: "도크" },
  { id: "door_main", label: "현관문 문턱 가운데" },
];

interface RawAnchor {
  id?: unknown;
  label?: unknown;
  position?: unknown;
}

function readJson(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path, "utf8").replace(/^﻿/, "")) as Record<string, unknown>;
}

function fromList(list: unknown, source: string): AnchorTarget[] | undefined {
  if (list === undefined || list === null) return undefined;
  if (!Array.isArray(list) || list.length !== 2) throw new Error(`${source}의 ar_anchors는 두 곳이어야 합니다`);
  return (list as RawAnchor[]).map((a) => {
    const p = a.position;
    if (typeof a.id !== "string" || !a.id || !Array.isArray(p) || typeof p[0] !== "number" || typeof p[1] !== "number") {
      throw new Error(`${source}의 ar_anchors 항목이 올바르지 않습니다: ${JSON.stringify(a)}`);
    }
    return { id: a.id, label: typeof a.label === "string" && a.label ? a.label : a.id, plan: [p[0], p[1]] };
  });
}

export function loadAnchorTargets(scenePath: string, floorplanPath?: string): AnchorTarget[] {
  const scene = readJson(scenePath) as { plan?: { ar_anchors?: unknown }; objects?: { id: string; plan?: { position?: unknown[] } }[] };
  const fromScene = fromList(scene.plan?.ar_anchors, scenePath);
  if (fromScene) return fromScene;
  if (floorplanPath && existsSync(floorplanPath)) {
    const fromPlan = fromList(readJson(floorplanPath).ar_anchors, floorplanPath);
    if (fromPlan) return fromPlan;
  }
  return DEFAULT_ANCHORS.map(({ id, label }) => {
    const p = scene.objects?.find((o) => o.id === id)?.plan?.position;
    if (!Array.isArray(p) || typeof p[0] !== "number" || typeof p[1] !== "number") {
      throw new Error(`기준점이 없습니다: ${scenePath}에 plan.ar_anchors도, 예전 기준점 ${id}의 평면 위치도 없습니다`);
    }
    return { id, label, plan: [p[0], p[1]] };
  });
}
