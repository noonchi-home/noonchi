// 닫힌 계획의 끄기 안내·보이게 해 달라는 부탁 명령의 단계 id(src/act/track/safety.ts queueOff). 명령 id는 그 닫힌 계획 id다(답·command_clear가 그 id로 간다).
// 회차는 그 가전의 켜기 회차(Cycle.cycle). 말풍선 카드(src/act/say.ts)와 영상 판정(scripts/video-check.ts plannedClicks)이 이 모양으로 끄기 안내를 가른다.
export const offStep = (planId: string, deviceId: string, cycle: number): string => `off:${planId}:${deviceId}:${cycle}`;
export const isOffStep = (step: string): boolean => step.startsWith("off:");
