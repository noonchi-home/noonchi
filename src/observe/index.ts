// 관찰 흐름(구현명세서 6.1)
// 다른 도메인은 이 입구로만 가져온다(도메인 나누기 설계 2.4).
export { LOOK_MARGIN, type LookSpot } from "./crop.js";
export { type LatestFrame, createPipeline, type ObservationPipeline, type PipelineInject } from "./pipeline.js";
