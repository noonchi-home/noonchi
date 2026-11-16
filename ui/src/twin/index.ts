// 트윈 화면(3D)(구현명세서 10)
// 다른 화면은 이 입구로만 가져온다(도메인 나누기 설계 2.4).
export { Twin3D, useLayoutBox } from "./3d/Twin3D";
export { type TwinEngine } from "./3d/engine";
export { conePixelBox } from "./3d/eye";
export { LiveQueue, attachLive } from "./3d/live";
export { BAKE_VIEWS, planDirToScreen, planToPixel, screenAngle, type OrthoCamera, pathOf, polygonToPixels } from "./3d/projection";
export { plateTransform, type MapCamera } from "./3d/view";
export { TwinStage } from "./TwinStage";
export { useAnchors, type ScreenPoint } from "./use-anchors";
