// 누름·저장·쪽 넘김 움직임 값. 시스템의 동작 줄이기가 켜지면 크기·위치·서서히 바뀜 없이 바로 바뀐다.

/** 누르는 동안 0.97배로 줄고 조금 흐려진다. */
const PRESS = { scale: 0.97, opacity: 0.85, inMs: 90, outMs: 160 };
/** 저장 성공 표시: 나타나서 머물다 사라진다(합 1.2초). */
const SAVED = { inMs: 150, holdMs: 750, outMs: 300 };
const SLIDE_MS = 240;
/** 리모컨 단추를 기다리는 안내: 반 주기마다 흐려졌다 돌아온다. */
const PULSE = { low: 0.3, halfMs: 600 };

export function pressMotion(reduce: boolean) {
  return reduce ? { scale: 1, opacity: PRESS.opacity, inMs: 0, outMs: 0 } : PRESS;
}

export function savedMotion(reduce: boolean) {
  return reduce ? { inMs: 0, holdMs: SAVED.inMs + SAVED.holdMs + SAVED.outMs, outMs: 0 } : SAVED;
}

/** 설정 쪽: 열 때 오른쪽 끝에서 들어오고, 돌아갈 때 오른쪽으로 나간다. */
export function slideMotion(direction: "in" | "out", width: number, reduce: boolean) {
  if (reduce) return { from: 0, to: 0, ms: 0 };
  return direction === "in" ? { from: width, to: 0, ms: SLIDE_MS } : { from: 0, to: width, ms: SLIDE_MS };
}

/** 기다림 안내 깜빡임. 동작 줄이기가 켜지면 깜빡이지 않고 그대로 보인다. */
export function pulseMotion(reduce: boolean) {
  return reduce ? { low: 1, halfMs: 0 } : PULSE;
}

export type ReduceMotionSource = {
  isReduceMotionEnabled(): Promise<boolean>;
  addEventListener(event: "reduceMotionChanged", handler: (value: boolean) => void): { remove(): void };
};

/** 시스템 동작 줄이기 값을 구독자 모두가 하나의 리스너로 나눠 본다(useSyncExternalStore용). */
export function reduceMotionStore(source: ReduceMotionSource) {
  let value = false;
  let heard = false;
  let subscription: { remove(): void } | undefined;
  const listeners = new Set<() => void>();
  const set = (next: boolean) => {
    if (next === value) return;
    value = next;
    for (const listener of listeners) listener();
  };
  return {
    get: () => value,
    subscribe(listener: () => void) {
      listeners.add(listener);
      if (!subscription) {
        heard = false;
        subscription = source.addEventListener("reduceMotionChanged", next => { heard = true; set(next); });
        void source.isReduceMotionEnabled().then(next => { if (!heard) set(next); }, () => {});
      }
      return () => {
        listeners.delete(listener);
        if (listeners.size || !subscription) return;
        subscription.remove();
        subscription = undefined;
      };
    },
  };
}
