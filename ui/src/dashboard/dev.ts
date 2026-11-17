// 개발용 보기(주소 옵션): ?scores=1이면 대시보드 폰 칸 이름표와 트윈 식탁 이름표에 감지 확신 숫자(YOLO 글)를 보인다. 기본은 숫자 없이 로봇이 믿는 상태다.
export const SHOW_SCORES = typeof location !== "undefined" && new URLSearchParams(location.search).get("scores") === "1";
