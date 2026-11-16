// 배치 저장소(트윈 공간)(구현명세서 3.1·9)
// 다른 도메인은 이 입구로만 가져온다(도메인 나누기 설계 2.4).
export { type LayoutEditor } from "./editor.js";
export { type FloorPlan } from "./floor.js";
export { FOCUS_TTL_MS, focusFromActions, type Focus } from "./focus.js";
export { DEFAULT_EYE_HEIGHT_M, inBounds, insidePolygon, type Bounds, roomFaces, type HomePlan, eyeHeightOf, floorLookup, homeBounds, readScenePlan } from "./home-plan.js";
export { listHomes } from "./homes.js";
export { loadLayout } from "./load.js";
export { placeName, type PlaceNames } from "./names.js";
export { roomAt, floorPlanFrom, roomNamedAt } from "./route.js";
export { loadScene } from "./scene.js";
