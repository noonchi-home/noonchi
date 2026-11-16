// 배치 저장소(트윈 공간) 브라우저 입구(구현명세서 3.1·9)
// 화면과 화면 시험(jsdom)이 node 모듈 없이 읽는 경로 찾기만 낸다(도메인 나누기 2.1·2.4). 장면 읽기·배치 편집기는 index.ts에만 있다.
export { approach, floorPlanFrom, roomAt, route } from "./route.js";
