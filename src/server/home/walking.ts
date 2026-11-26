// 걷기 지도(폰 안내, walkingMap)와 걷기 길 자료(계획 선, walkWay) 캐시: 지금 배치(배치 편집기 물건)와 자리 지도(stations)로 만든다.
// 장면 객체가 바뀌거나, 배치를 고치거나(editor.geometryRevision), 설정 화면에서 자리 지도를 저장할 때(core.stationsRevision) 다시 만든다.
import { floorPlanFrom, walkWay, walkingMap, type WalkWay } from "../../layout/index.js";
import type { HomeCore } from "./core.js";

export interface WalkingCache {
  /** 폰 걷기 안내 지도. 장면이 없으면 null. */
  map(): ReturnType<typeof walkingMap> | null;
  /** 계획 선 걷기 길 자료. 장면이 없으면 null. */
  way(): WalkWay | null;
}

export function walkingCache(core: Pick<HomeCore, "scene" | "layout" | "stationsRevision">): WalkingCache {
  let key: readonly unknown[] | null = null;
  let map: ReturnType<typeof walkingMap> | null = null;
  let way: WalkWay | null = null;
  const fresh = (): boolean => {
    const scene = core.scene, layout = core.layout, editor = layout?.editor;
    if (!scene) return false;
    const next = [scene, editor?.geometryRevision ?? 0, core.stationsRevision];
    if (!key || next.some((v, i) => v !== key![i])) {
      key = next;
      const current = editor ? { ...scene, objects: editor.objects() } : scene;
      const footprint = (type: string) => layout?.catalog.get(type)?.footprint;
      map = walkingMap(floorPlanFrom(current), current, footprint);
      way = walkWay(current, footprint);
    }
    return true;
  };
  return { map: () => (fresh() ? map : null), way: () => (fresh() ? way : null) };
}
