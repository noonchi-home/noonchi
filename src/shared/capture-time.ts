// 촬영 시각 정하기(엔진 프레임·표시 장면이 같은 규칙을 쓴다: 같은 폰 프레임이면 같은 값). 폰 도메인(표시 영상 중계)과 관찰 흐름이 함께 쓴다.

/** 촬영 시각 범위: 동기 정보가 있으면 [captured_at − 오차, captured_at + 오차], 없으면 받은 시각 하나. 받은 시각보다 늦을 수 없다.
 *  폰이 NTP식 clock 핑으로 서버 시계에 맞춘 captured_at과 오차 time_err_ms를 보낸다. atMs(이른 쪽)를 촬영 시각으로 쓴다. */
export function captureTime(meta: { receivedAtMs: number; capturedAt?: number; timeErrMs?: number }): { atMs: number; latestMs: number; source: "phone" | "received" } {
  const { capturedAt, timeErrMs } = meta;
  if (typeof capturedAt === "number" && Number.isFinite(capturedAt) && typeof timeErrMs === "number" && Number.isFinite(timeErrMs) && timeErrMs >= 0) {
    const latestMs = Math.min(meta.receivedAtMs, Math.round(capturedAt + timeErrMs));
    return { atMs: Math.min(latestMs, Math.round(capturedAt - timeErrMs)), latestMs, source: "phone" };
  }
  return { atMs: meta.receivedAtMs, latestMs: meta.receivedAtMs, source: "received" };
}
