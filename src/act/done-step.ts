// 계획을 마친 완료 문장(src/act/track/phone-line.ts noticeTick)의 명령 id·단계 id: 명령 id done:<계획 id>, 단계 id done:<계획 id>:1.
// 영상 판정(scripts/video-check.ts)이 이 모양으로 완료 문장을 가른다(누르지 않고, 보인 뒤 2초까지 녹화한다).
export const doneId = (planId: string): string => `done:${planId}`;
export const isDoneStep = (step: string): boolean => step.startsWith("done:");
