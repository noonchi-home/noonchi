// 엔진 프레임(분석용) 보내기 차례. 서버가 상태 메시지 engine_ms(기본 100ms)로 간격을 알려 준다. 초점 고리를 그리지 않는다.
// 차례는 밀리지 않게 잡고(앞 차례 + 간격), 앞 엔진 프레임이 아직 인코딩 중이거나 보낼 것이 쌓여 있으면 그 차례는 건너뛴다(쌓지 않는다).

/** 앞 차례에서 간격이 지났는가(처음이면 참). */
export function engineDue(lastMs, nowMs, intervalMs) {
  return lastMs === null || nowMs - lastMs >= intervalMs;
}

/** 때가 됐으면 이번 차례의 기준 시각, 아니면 null. 기준은 앞 차례 + 간격이라 그림 틀이 16.7ms마다 와도 간격이 늘지 않는다.
 *  한 간격 넘게 밀렸으면(탭 전환) 지금을 기준으로 삼아 밀린 차례를 몰아서 보내지 않는다. */
export function engineSlot(lastMs, nowMs, intervalMs) {
  if (lastMs === null) return nowMs;
  if (nowMs - lastMs < intervalMs) return null;
  const next = lastMs + intervalMs;
  return nowMs - next >= intervalMs ? nowMs : next;
}

/** 이번 그림 틀의 엔진 프레임. action: wait 때가 아님 · send 보낸다 · encoding 앞 엔진 프레임이 인코딩 중이라 건너뜀 · buffer 보낼 것이 쌓여 건너뜀.
 *  last는 다음에 넘길 기준 시각이다(건너뛴 차례도 지나간다). */
export function engineStep({ last, now, intervalMs, canStart, buffered, maxBuffered }) {
  const slot = intervalMs > 0 ? engineSlot(last, now, intervalMs) : null;
  if (slot === null) return { last, action: "wait" };
  if (!canStart) return { last: slot, action: "encoding" };
  if (buffered > maxBuffered) return { last: slot, action: "buffer" };
  return { last: slot, action: "send" };
}

/** 한 그림 틀에서 보낼 사진들의 픽셀(wants와 같은 차례, 안 보낼 자리는 null). 앞에서 잡은 것과 크기가 같으면 다시 잡지 않고 복사본을 준다:
 *  픽셀 버퍼는 인코딩 워커로 넘어가 다시 쓸 수 없다. readMs는 잡는 데 걸린 시간(복사본은 0). */
export function grabOnce(grab, wants, now = () => performance.now()) {
  const taken = [];
  return wants.map((want) => {
    if (!want) return null;
    const same = taken.find((t) => t.width === want.width && t.height === want.height);
    if (same) return { pixels: same.pixels.slice(), readMs: 0 };
    const t0 = now();
    const pixels = grab(want.width, want.height);
    taken.push({ width: want.width, height: want.height, pixels });
    return { pixels, readMs: now() - t0 };
  });
}
