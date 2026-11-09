// 엔진 프레임(분석용) 보내기 간격. 서버가 상태 메시지 engine_ms로 알려 준다. 초점 고리를 그리지 않는다.
export function engineDue(lastMs, nowMs, intervalMs) {
  return lastMs === null || nowMs - lastMs >= intervalMs;
}
