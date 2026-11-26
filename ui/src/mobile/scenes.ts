import { api } from "../lib/api";
import { house } from "./house";

const demoScenes = "https://home-shots.vercel.app/scenes/";
const sceneId = /^[A-Za-z0-9_-]+$/;
const viewLabels: Record<string, string> = {
  C: "정면", L30: "왼쪽 30°", R30: "오른쪽 30°", L60: "왼쪽 60°", R60: "오른쪽 60°", down: "아래 보기",
};

export interface ReferenceScene {
  id: string;
  name: string;
  direction: string;
  image: string;
  width: number;
  height: number;
  demo: boolean;
}

interface SceneRow {
  id: string;
  image_url?: string;
  file?: string;
  home?: string;
  spot_name?: string;
  station_name?: string;
  view?: string;
  width: number;
  height: number;
}

function references(rows: SceneRow[], home: string, demo: boolean): ReferenceScene[] {
  const scenes = new Map<string, ReferenceScene>();
  for (const row of rows) {
    if (!row || typeof row.id !== "string" || !sceneId.test(row.id) || scenes.has(row.id)) continue;
    if (row.home !== undefined && row.home !== home) continue;
    if (!Number.isInteger(row.width) || !Number.isInteger(row.height) || row.width < 1 || row.height < 1) continue;
    const image = demo ? demoScenes + row.id + ".jpg" : "/home-scenes/" + home + "/" + row.id + ".png";
    if (demo ? row.file !== row.id + ".jpg" : row.image_url !== image) continue;
    const name = row.spot_name || row.station_name || row.id;
    const view = row.view || row.id.split("_").at(-1) || "";
    scenes.set(row.id, { id: row.id, name, direction: viewLabels[view] ?? "", image,
      width: row.width, height: row.height, demo });
  }
  return [...scenes.values()];
}

export async function loadReferences(home: string): Promise<ReferenceScene[]> {
  const hub = await api<{ home: string; scenes: SceneRow[] }>("/api/homes/" + home + "/scenes");
  if (hub.ok && hub.json?.home === home && Array.isArray(hub.json.scenes)) {
    const scenes = references(hub.json.scenes, home, false);
    if (scenes.length) return scenes;
  } else if (hub.status !== 404) {
    throw new Error("허브의 기준 장면을 불러오지 못했습니다.");
  }
  if (home === house.id) {
    const result = await fetch(demoScenes + "manifest.json", { credentials: "omit", referrerPolicy: "no-referrer" });
    if (result.ok) {
      const rows = await result.json();
      if (Array.isArray(rows)) {
        const scenes = references(rows, home, true);
        if (scenes.length) return scenes;
      }
    }
  }
  throw new Error("이 집의 기준 장면이 없습니다.");
}
