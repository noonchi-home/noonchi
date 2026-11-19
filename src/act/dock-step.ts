// 계획이 끝난 뒤 충전 자리로 돌아가는 명령(src/act/robot/dock.ts)의 명령 id·단계 id: 명령 id dock:<번호>, 단계 id dock:<번호>:1.
// 영상 판정(scripts/video-check.ts plannedClicks)이 이 모양으로 충전 자리 명령을 가른다(누르지 않고, 계획이 끝나면 판정을 끝낸다).
export const dockId = (n: number): string => `dock:${n}`;
export const isDockStep = (step: string): boolean => step.startsWith("dock:");
