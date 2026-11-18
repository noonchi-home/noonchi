// PAM(판단·반성, src/brain/pam/)·기록·반성(구현명세서 6.12·6.13)
// 다른 도메인은 이 입구로만 가져온다(도메인 나누기 설계 2.4).
export { Decider, decisionWorld } from "./decide.js";
export { type PamMemory, fsmRuleOf, isoWithOffset } from "./decision.js";
export { type GoalPick, goalAhead } from "./goal.js";
export { HISTORY_KINDS, HistoryDb, historyTzMinutes } from "./history/db.js";
export { FEEDBACK_TEXT, PHOTO_TEXT, REFLECT_TEXT } from "./history/labels.js";
export { type DeviceNote, attachRecorder, deviceRecorder, recordBrainLog, recordFeedback, topic } from "./history/recorder.js";
export { type ReflectResult, memoryForDay, loadReflectAt, runReflection, scheduleReflection } from "./history/reflect.js";
export { datasetWriter, loadRetention, sweep } from "./history/retention.js";
export { daySummary, isDay } from "./history/summary.js";
export { PamClient, pamSettings } from "./pam/index.js";
export { type ThoughtFeed, decisionLines, lastStoredThoughts, storeThought, thoughtFeed } from "./thought.js";
