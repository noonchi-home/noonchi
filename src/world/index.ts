// World State와 PAM 관찰 텍스트(구현명세서 6.2)
// 다른 도메인은 이 입구로만 가져온다(도메인 나누기 설계 2.4).
export { ConditionWatch, type Condition, type ConditionContext, CONDITION_KINDS, ConditionSchema, checkCondition, type ConditionHome } from "./conditions.js";
export { inView, pixelOf, rayDir, restsFromLayout, surfacesFromLayout, cupInside, topBox, topView, TOP_BOX_M, TOP_CUP_FALLBACK, TOP_VIEW, type CupInside, type PlaneSurface, type RestSpot } from "./place.js";
export { TOP_CONFIRM, topPairOf } from "./state/contents.js";
export { becameKey, deviceText } from "./relations.js";
export { WorldState, CLOSER_NEW_FRAMES, type CloserPass } from "./state/world.js";
export { textFromWorld, collapseLines, PAM_TEXT_MAX } from "./text.js";
export { Trigger, type TriggerPause, loadTriggerConfig } from "./trigger.js";
export { loadFallConfig, FALL_DEFAULTS, type FallConfig } from "./fall.js";
