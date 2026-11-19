// 배치 저장소(트윈 공간)(구현명세서 3.1·9)
// 다른 도메인은 이 입구로만 가져온다.
export { findTypes, type TypeInfo } from "./catalog.js";
export { type LayoutEditor, LayoutError, type SceneObject, type To } from "./editor.js";
export { type FloorPlan } from "./floor.js";
export { FOCUS_TTL_MS, focusFromActions, type Focus } from "./focus.js";
export { DEFAULT_EYE_HEIGHT_M, inBounds, insidePolygon, type Bounds, roomFaces, type HomePlan, eyeHeightOf, floorLookup, homeBounds, readScenePlan } from "./home-plan.js";
export { listHomes } from "./homes.js";
export { loadLayout } from "./load.js";
export { placeName, type PlaceNames } from "./names.js";
export { detectRooms, resolveRoom } from "./rooms.js";
export { roomAt, floorPlanFrom, roomNamedAt } from "./route.js";
export { loadScene } from "./scene.js";
export { loadTwin, type TwinData, resolveTwinStudioDir } from "./twin-files.js";
