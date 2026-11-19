// 장면·마스크 짝 맞추기: 대시보드 폰 칸은 마스크(seen)를 그 마스크의 촬영 시각과 같은 장면(표시 영상 프레임) 위에만 그린다.
// YOLO 마스크는 엔진 프레임보다 늦게 와서(장당 0.15~0.22초 + 전송) 가장 새 마스크를 지금 장면에 얹으면 카메라가 움직일 때 밀려 보인다.
// 그래서 영상 일꾼(panels/eye-video.ts createDelayLine)이 장면을 마스크 지연만큼 들고 있다가 그리고, 그린 장면마다 그 촬영 시각의 마스크를 고른다.
// 시각은 모두 서버 시계 촬영 시각(ms): 장면은 H.264 청크·화면 프레임의 at, 마스크는 seen.captured_at_ms(src/shared/capture-time.ts 같은 규칙).
// 그 장면을 이미 그린 뒤에 온 마스크(늦은 마스크)는 그리지 않고, 마스크가 없는 장면은 앞 마스크를 holdMs 안에서만 쓴다(어긋나게 그리지 않는다).
// 시각이 붙은 장면을 그리기 전·시각 없는 장면(옛 폰·MJPEG <img>)·끊긴 뒤에는 서버 마지막 seen을 그대로 보인다.
import type { SeenEvent } from "../../../src/contract/events.ts";
import type { SeenStore } from "./masks";

/** 마스크 층이 듣는 부분(get·subscribe). */
export type SeenView = Pick<SeenStore, "get" | "subscribe">;

/** tolMs: 장면과 같은 때로 보는 차(ms, 같은 폰 프레임이 아니어도 20ms 안이면 그 장면의 마스크). holdMs: 마스크가 없는 장면에 앞 마스크를 쓰는 가장 큰 차.
 *  marginMs: 지연에 더하는 여유. maxDelayMs: 영상을 늦추는 가장 긴 시간(이보다 늦은 마스크는 세지 않고 그리지도 못한다). lags: 지연을 정할 때 보는 최근 마스크 수. */
export const SCENE_SYNC = { tolMs: 20, holdMs: 250, marginMs: 50, maxDelayMs: 800, lags: 20 } as const;
export type SceneSyncOptions = typeof SCENE_SYNC;

/** 장면 시각 sceneAt에 그릴 마스크: 촬영 시각이 sceneAt + tolMs 이하인 것 가운데 가장 늦은 것. 그 차가 holdMs를 넘으면 없음. masks는 촬영 시각 순. */
export function maskFor<T extends { captured_at_ms: number }>(sceneAt: number, masks: readonly T[], o: Pick<SceneSyncOptions, "tolMs" | "holdMs"> = SCENE_SYNC): T | null {
  for (let i = masks.length - 1; i >= 0; i--) {
    const m = masks[i]!;
    if (m.captured_at_ms > sceneAt + o.tolMs) continue;
    return sceneAt - m.captured_at_ms <= o.holdMs ? m : null;
  }
  return null;
}

export interface SceneSync {
  /** 마스크 층이 듣는다: 짝 맞춘 장면을 그리는 동안은 그 장면의 마스크, 아니면 서버 마지막 seen. */
  readonly store: SeenView;
  /** 장면 하나가 왔다(그리기 전, 촬영 시각). */
  frame(at: number): void;
  /** 마스크 하나가 왔다. 그 장면을 이미 그렸으면(늦음) 버리고 false. */
  mask(e: SeenEvent): boolean;
  /** 장면 하나를 그렸다(촬영 시각, 시각 없는 장면이면 null). */
  shown(at: number | null): void;
  /** 짝 맞춘 영상이 끊김(MJPEG로 돌아감): 기다리던 마스크를 버리고 서버 마지막 seen을 보인다. */
  reset(): void;
  /** 영상을 늦출 시간(ms). */
  delayMs(): number;
  /** 늦출 시간이 바뀌면 부른다. 끊는 함수를 돌려준다. */
  onDelay(listener: (ms: number) => void): () => void;
}

/** raw: 서버 seen 저장소(masks.ts createSeenStore). 마스크는 mask()로 넣는다. */
export function createSceneSync(raw: SeenView, o: SceneSyncOptions = SCENE_SYNC): SceneSync {
  let masks: SeenEvent[] = [];
  let newest: number | null = null;
  let lastShown: number | null = null;
  let lags: number[] = [];
  let delay = 0;
  let active = false;
  let picked: SeenEvent | null = null;
  const listeners = new Set<() => void>();
  const delayListeners = new Set<(ms: number) => void>();
  const visible = () => (active ? picked : raw.get());
  const change = (fn: () => void) => {
    const before = visible();
    fn();
    if (visible() !== before) for (const l of [...listeners]) l();
  };
  const setDelay = (ms: number) => {
    if (ms === delay) return;
    delay = ms;
    for (const l of [...delayListeners]) l(ms);
  };
  return {
    store: {
      get: visible,
      subscribe(listener) {
        listeners.add(listener);
        const off = raw.subscribe(listener);
        return () => { listeners.delete(listener); off(); };
      },
    },
    frame(at) {
      if (newest === null || at > newest) newest = at;
    },
    mask(e) {
      const at = e.captured_at_ms;
      // 맞출 수 없는 지연(maxDelayMs 넘음: 다시 붙을 때 다시 보낸 옛 seen, YOLO가 잠깐 멈춤)은 세지 않는다
      if (newest !== null && newest - at <= o.maxDelayMs) {
        lags = [...lags, newest - at].slice(-o.lags);
        setDelay(Math.round(Math.min(o.maxDelayMs, Math.max(0, Math.max(...lags) + o.marginMs))));
      }
      if (lastShown !== null && at < lastShown - o.tolMs) return false;
      let i = masks.length;
      while (i > 0 && masks[i - 1]!.captured_at_ms > at) i--;
      masks = [...masks.slice(0, i), e, ...masks.slice(i)];
      return true;
    },
    shown(at) {
      change(() => {
        if (at === null) {
          active = false;
          return;
        }
        active = true;
        lastShown = at;
        picked = maskFor(at, masks, o);
        // 지난 마스크는 버린다: 고른 것보다 앞이거나, 앞으로 올 장면에도 holdMs를 넘는 것
        masks = masks.filter((m) => (picked ? m.captured_at_ms >= picked.captured_at_ms : at - m.captured_at_ms <= o.holdMs));
      });
    },
    reset() {
      change(() => {
        active = false;
        picked = null;
        masks = [];
        newest = null;
        lastShown = null;
      });
    },
    delayMs: () => delay,
    onDelay(listener) {
      delayListeners.add(listener);
      return () => { delayListeners.delete(listener); };
    },
  };
}
