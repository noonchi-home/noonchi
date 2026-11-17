// 내용물 질문 명령의 단계 id(src/act/track/contents.ts). 명령 id는 그 계획 id(계획 밖 질문이면 ask:<번호>)다.
// 컵 id·내용물 세대·물을 때마다 오르는 번호를 실어, 다른 컵·지난 세대·앞 질문에 온 늦은 답을 가른다.
// 소리 등급(src/act/talk-grade.ts)과 말풍선 카드(src/act/say.ts)가 이 모양으로 내용물 질문을 가른다.
export const contentsStep = (id: string, objectId: string, gen: number, seq: number): string => `${id}:contents:${objectId}:${gen}:${seq}`;
export const isContentsStep = (step: string): boolean => /:contents:[^:]+:\d+:\d+$/.test(step);
