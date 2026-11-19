// 클로이드의 눈 표시 영상(H.264): GET /api/eye/video 스트림을 읽어 VideoDecoder로 canvas에 그린다(서버 src/phone/video.ts).
// web/eye-video.js(루트 시험이 쓰는 같은 파서)를 타입만 붙여 옮겼다. 디코드·그리기는 일꾼(eye-video-worker.ts)에서 한다.
// 영상이 3초 넘게 안 그려지면(미지원 브라우저·코덱, 폰이 H.264를 못 보냄, 스트림 끊김) MJPEG <img>를 보인다.
// H.264가 없을 때(영상 모드) 서버가 같은 스트림에 싣는 화면 프레임(jpeg 메시지)도 같은 canvas에 그린다.
// 장면은 서버 시계 촬영 시각(at)과 함께 지연 줄(createDelayLine)에 넣어 setDelay만큼 들고 있다가 그린다: 대시보드가 그 시각의 마스크를 얹는다(scene-sync.ts).
// onFrame(at)은 장면이 왔을 때, onShown(at)은 그 장면을 그렸을 때 부른다(시각이 없는 장면이면 null).

const MAX_HEADER_BYTES = 4096;
/** H.264 장면이 이만큼 안에 왔으면 화면 프레임(jpeg 메시지)은 그리지 않는다(ms). */
const VIDEO_FIRST_MS = 1000;

export type EyeMode = "video" | "jpeg";
/** at: 장면 촬영 시각(서버 시계 ms, 청크·jpeg 메시지). */
export type StreamHeader = { type?: string; codec?: string; width?: number; height?: number; key?: boolean; ts?: number; at?: number };
export type EyeVideoStats = { drawn: number; queue: number; codec: string | null; width: number; height: number };

/** [헤더 길이 u32][본문 길이 u32][JSON 헤더][본문]이 이어진 바이트를 메시지로 자른다. 잘려 오거나 붙어 와도 된다. */
export function createStreamParser({ maxMessageBytes = 8 << 20 } = {}) {
  let buf = new Uint8Array(64 * 1024);
  let len = 0;
  const text = new TextDecoder();
  return {
    push(bytes: Uint8Array): { header: StreamHeader; body: Uint8Array }[] {
      if (len + bytes.length > buf.length) {
        const bigger = new Uint8Array(Math.max(buf.length * 2, len + bytes.length));
        bigger.set(buf.subarray(0, len));
        buf = bigger;
      }
      buf.set(bytes, len);
      len += bytes.length;
      const out: { header: StreamHeader; body: Uint8Array }[] = [];
      let at = 0;
      while (len - at >= 8) {
        const view = new DataView(buf.buffer, buf.byteOffset + at, 8);
        const headLen = view.getUint32(0);
        const bodyLen = view.getUint32(4);
        if (headLen > MAX_HEADER_BYTES || bodyLen > maxMessageBytes) throw new Error(`영상 스트림 길이가 맞지 않아요(${headLen}/${bodyLen})`);
        const end = at + 8 + headLen + bodyLen;
        if (end > len) break;
        const header = JSON.parse(text.decode(buf.subarray(at + 8, at + 8 + headLen))) as StreamHeader;
        out.push({ header, body: buf.slice(at + 8 + headLen, end) });
        at = end;
      }
      if (at > 0) {
        buf.copyWithin(0, at, len);
        len -= at;
      }
      return out;
    },
  };
}

/** 영상과 JPEG 중 무엇을 보일지: 최근 staleMs 안에 영상 프레임을 그렸으면 영상. */
export function createDisplayMode({ staleMs = 3000, now = () => performance.now() } = {}) {
  let last: number | null = null;
  return {
    frame() { last = now(); },
    reset() { last = null; },
    get mode(): EyeMode { return last !== null && now() - last < staleMs ? "video" : "jpeg"; },
  };
}

/** 디코더에 넣을지: 처음·다시 설정한 뒤·건너뛴 뒤에는 키프레임부터. 디코더가 밀리면(maxQueue) 다음 키프레임까지 건너뛴다. */
export function createDecodeGate({ maxQueue = 30 } = {}) {
  let waitKey = true;
  return {
    accept(key: boolean, queueSize = 0) {
      if (!key && waitKey) return false;
      if (queueSize > maxQueue) {
        waitKey = true;
        return false;
      }
      waitKey = false;
      return true;
    },
    reset() { waitKey = true; },
  };
}

/** 장면 지연 줄: 장면마다 받은 때 + 지연(setDelay)에 그린다. 한꺼번에 때가 되면 가장 새 장면만 그리고 앞 장면은 버린다.
 *  그린 장면도 그린 뒤 놓는다(drop: ImageBitmap close). 들고 있는 장면이 max를 넘으면 가장 오래된 장면부터 버린다. */
export function createDelayLine<I>({ draw, drop, now = () => performance.now(), max = 90 }: {
  draw: (image: I, at: number | null) => void; drop: (image: I) => void; now?: () => number; max?: number;
}) {
  let delay = 0;
  let items: { at: number | null; image: I; arrived: number }[] = [];
  let timer: ReturnType<typeof setTimeout> | null = null;
  const schedule = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
    const first = items[0];
    if (first) timer = setTimeout(tick, Math.max(0, first.arrived + delay - now()));
  };
  function tick() {
    timer = null;
    const t = now();
    let due = 0;
    while (due < items.length && items[due]!.arrived + delay <= t) due++;
    if (due > 0) {
      const ready = items.slice(0, due);
      items = items.slice(due);
      for (const x of ready.slice(0, -1)) drop(x.image);
      const last = ready.at(-1)!;
      draw(last.image, last.at);
      drop(last.image);
    }
    schedule();
  }
  return {
    push(at: number | null, image: I) {
      items.push({ at, image, arrived: now() });
      while (items.length > max) drop(items.shift()!.image);
      // 늦추지 않으면 받은 장면마다 바로 그린다
      if (delay === 0) tick();
      else schedule();
    },
    setDelay(ms: number) {
      delay = Math.max(0, ms);
      tick();
    },
    get size() { return items.length; },
    close() {
      if (timer !== null) clearTimeout(timer);
      timer = null;
      for (const x of items) drop(x.image);
      items = [];
    },
  };
}

const RETRY_MS = 1500;
const hex = (bytes: Uint8Array | undefined) => Array.from(bytes ?? [], (b) => b.toString(16).padStart(2, "0")).join("");
const reasonOf = (e: unknown) => (e as Error)?.message ?? e;

type Drawable = Pick<HTMLCanvasElement | OffscreenCanvas, "width" | "height"> & {
  getContext(id: "2d"): { drawImage(image: CanvasImageSource, x: number, y: number, w: number, h: number): void } | null;
};

export interface RunDecoderOptions {
  canvas: Drawable;
  url: string;
  onMode?: (mode: EyeMode) => void;
  onStats?: (stats: EyeVideoStats) => void;
  /** 장면이 왔을 때(그리기 전)·그렸을 때. at: 촬영 시각(서버 시계 ms), 없으면 null. */
  onFrame?: (at: number | null) => void;
  onShown?: (at: number | null) => void;
  statsMs?: number;
  retryMs?: number;
}

/** 지연 줄에 든 장면 한 장. */
type Shot = { image: CanvasImageSource & { close(): void }; width: number; height: number };

/** 스트림을 읽어 canvas(HTMLCanvasElement 또는 일꾼의 OffscreenCanvas)에 그린다. DOM을 쓰지 않아 일꾼에서도 돈다.
 *  onMode: 보일 화면이 바뀔 때. onStats: statsMs마다 그린 장 수·디코더 대기·크기. setDelay(ms): 장면을 들고 있다가 그릴 시간. */
export function runDecoder({ canvas, url, onMode = () => {}, onStats = () => {}, onFrame = () => {}, onShown = () => {}, statsMs = 500, retryMs = RETRY_MS }: RunDecoderOptions) {
  const ctx = canvas.getContext("2d");
  const display = createDisplayMode();
  const gate = createDecodeGate();
  let decoder: VideoDecoder | null = null;
  let config: VideoDecoderConfig | null = null; // 지원 확인된 설정
  let configId = "";
  let stopped = false;
  let abort: AbortController | null = null;
  let drawn = 0;
  let shown: EyeMode = "jpeg";
  // 청크 timestamp(µs) → 촬영 시각: at이 붙은 청크는 timestamp를 at × 1000으로 넣는다
  const stamps = new Map<number, number | null>();
  let lastVideoAt = Number.NEGATIVE_INFINITY;
  const bitmaps = typeof createImageBitmap === "function";

  const report = () => {
    if (display.mode !== shown) {
      shown = display.mode;
      onMode(shown);
    }
  };
  const timer = setInterval(() => {
    report();
    onStats({ drawn, queue: decoder?.decodeQueueSize ?? 0, codec: config?.codec ?? null, width: canvas.width, height: canvas.height });
  }, statsMs);

  // 비율은 코딩된 크기 그대로, 칸 안에서는 CSS object-fit: contain
  const paint = (image: CanvasImageSource, width: number, height: number, at: number | null) => {
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    ctx?.drawImage(image, 0, 0, canvas.width, canvas.height);
    drawn += 1;
    display.frame();
    report();
    onShown(at);
  };
  const line = createDelayLine<Shot>({ draw: (s, at) => paint(s.image, s.width, s.height, at), drop: (s) => s.image.close() });
  // 장면을 받은 차례대로 그림(ImageBitmap)으로 바꿔 지연 줄에 넣는다. 못 바꾼 장면(깨진 JPEG)은 건너뛴다
  let order: Promise<void> = Promise.resolve();
  const hold = (at: number | null, make: () => Promise<Shot>) => {
    order = order.then(make).then((s) => {
      if (stopped) return s.image.close();
      onFrame(at);
      line.push(at, s);
    }).catch(() => {});
  };

  const open = () => {
    const d = new VideoDecoder({
      output(frame) {
        const at = stamps.get(frame.timestamp) ?? null;
        stamps.delete(frame.timestamp);
        lastVideoAt = performance.now();
        if (!bitmaps) {
          paint(frame, frame.displayWidth, frame.displayHeight, at);
          frame.close();
          return;
        }
        // 디코더 프레임은 오래 들고 있으면 디코더가 멈출 수 있어 그림으로 옮기고 바로 놓는다
        hold(at, async () => {
          try {
            return { image: await createImageBitmap(frame), width: frame.displayWidth, height: frame.displayHeight };
          } finally {
            frame.close();
          }
        });
      },
      error(error) {
        console.warn("[eye-video] 디코더 오류, 다음 키프레임부터 다시 해요:", reasonOf(error));
        decoder = null;
        gate.reset();
      },
    });
    d.configure(config!);
    decoder = d;
    gate.reset();
    return d;
  };

  async function onConfig(header: StreamHeader, body: Uint8Array) {
    if (typeof VideoDecoder !== "function") return; // 화면 프레임(jpeg 메시지)만 그린다
    const id = `${header.codec}/${header.width}x${header.height}/${hex(body)}`;
    if (id === configId && decoder?.state === "configured") {
      gate.reset();
      return;
    }
    const wanted: VideoDecoderConfig = {
      codec: header.codec ?? "", codedWidth: header.width, codedHeight: header.height, optimizeForLatency: true,
      ...(body.length ? { description: body } : {}),
    };
    const support = await VideoDecoder.isConfigSupported(wanted).catch(() => ({ supported: false }));
    configId = id;
    if (!support.supported) {
      console.warn(`[eye-video] 이 브라우저는 ${header.codec}를 풀지 못해요. MJPEG로 보여요`);
      config = null;
      decoder?.close();
      decoder = null;
      return;
    }
    config = wanted;
    if (decoder && decoder.state !== "closed") {
      decoder.configure(config);
      gate.reset();
    } else open();
  }

  function onChunk(header: StreamHeader, body: Uint8Array) {
    if (!config) return;
    const d = !decoder || decoder.state === "closed" ? open() : decoder;
    if (!gate.accept(!!header.key, d.decodeQueueSize)) return;
    const at = typeof header.at === "number" && Number.isFinite(header.at) ? header.at : null;
    const timestamp = at !== null ? Math.round(at * 1000) : header.ts ?? 0;
    if (stamps.size > 240) stamps.clear(); // 풀리지 않고 남은 것(디코더 오류·건너뜀)
    stamps.set(timestamp, at);
    try {
      d.decode(new EncodedVideoChunk({ type: header.key ? "key" : "delta", timestamp, data: body }));
    } catch (error) {
      // 깨진 키프레임 등은 decode가 바로 던진다(DataError). 그 청크만 버리고 다음 키프레임부터
      console.warn("[eye-video] 청크를 풀지 못해 다음 키프레임을 기다려요:", reasonOf(error));
      gate.reset();
    }
  }

  /** H.264가 없을 때 서버가 싣는 화면 프레임(JPEG). H.264 장면이 막 왔으면 그리지 않는다. */
  function onJpeg(header: StreamHeader, body: Uint8Array) {
    if (!bitmaps || performance.now() - lastVideoAt < VIDEO_FIRST_MS) return;
    const at = typeof header.at === "number" && Number.isFinite(header.at) ? header.at : null;
    const blob = new Blob([body as BlobPart], { type: "image/jpeg" });
    hold(at, async () => {
      const image = await createImageBitmap(blob);
      return { image, width: image.width, height: image.height };
    });
  }

  async function run() {
    while (!stopped) {
      const controller = new AbortController();
      abort = controller;
      let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
      try {
        const res = await fetch(`${url}?t=${Date.now()}`, { cache: "no-store", signal: controller.signal });
        if (res.ok && res.body) {
          const parser = createStreamParser();
          reader = res.body.getReader();
          gate.reset();
          for (;;) {
            const { value, done } = await reader.read();
            if (done) break;
            for (const { header, body } of parser.push(value)) {
              if (header.type === "config") await onConfig(header, body);
              else if (header.type === "chunk") onChunk(header, body);
              else if (header.type === "jpeg") onJpeg(header, body);
              else if (header.type === "end") {
                display.reset();
                gate.reset();
                report();
              }
            }
          }
        }
      } catch (error) {
        if (!stopped) console.warn("[eye-video] 영상 스트림이 끊겼어요, 다시 붙어요:", reasonOf(error));
      } finally {
        // 예외로 나와도 이 연결은 끝낸다(안 그러면 서버가 열린 스트림에 계속 쓴다)
        controller.abort();
        reader?.cancel().catch(() => {});
      }
      if (!stopped) await new Promise((r) => setTimeout(r, retryMs));
    }
  }
  void run();

  return {
    close() {
      stopped = true;
      clearInterval(timer);
      abort?.abort();
      line.close();
      if (decoder && decoder.state !== "closed") decoder.close();
    },
    /** 장면을 들고 있다가 그릴 시간(ms). */
    setDelay: (ms: number) => line.setDelay(ms),
  };
}

/** 일꾼 → 메인 메시지. */
export type EyeWorkerMessage =
  | { type: "mode"; mode: EyeMode }
  | { type: "stats"; stats: EyeVideoStats }
  | { type: "frame"; at: number | null }
  | { type: "shown"; at: number | null };

export interface EyeVideo {
  readonly mode: EyeMode;
  close(): void;
  /** 장면을 들고 있다가 그릴 시간(ms, 마스크 지연만큼). */
  setDelay(ms: number): void;
}

/** 대시보드: canvas에 영상을 그린다. onMode로 영상/JPEG 중 보일 것을 알린다(처음은 JPEG).
 *  디코드·그리기는 일꾼(OffscreenCanvas)에서 한다. 같은 출처 3D 트윈 iframe이 메인 스레드를 몇 초씩 막아도 영상이 끊기지 않게.
 *  일꾼을 못 쓰면 메인 스레드에서 그린다. canvas는 한 번만 넘길 수 있으니 부를 때마다 새 canvas를 준다. */
export function attachEyeVideo({ canvas, onMode, onSize, onFrame, onShown, url = "/api/eye/video" }: {
  canvas: HTMLCanvasElement; onMode: (mode: EyeMode) => void;
  /** 그리는 영상 크기가 생기거나 바뀌면(폰을 돌림) 알린다. */
  onSize?: (size: { width: number; height: number }) => void;
  /** 장면이 왔을 때·그렸을 때(촬영 시각, 없으면 null). */
  onFrame?: (at: number | null) => void; onShown?: (at: number | null) => void;
  url?: string;
}): EyeVideo {
  let mode: EyeMode = "jpeg";
  let last: EyeVideoStats = { drawn: 0, queue: 0, codec: null, width: 0, height: 0 };
  // 측정용(콘솔·헤드리스 확인): 그린 장 수·디코더 대기·크기
  (canvas as HTMLCanvasElement & { eyeVideoStats?: () => unknown }).eyeVideoStats = () => ({ ...last, mode });
  const setMode = (m: EyeMode) => { mode = m; onMode(m); };
  const onStats = (s: EyeVideoStats) => {
    if (s.width > 0 && s.height > 0 && (s.width !== last.width || s.height !== last.height)) onSize?.({ width: s.width, height: s.height });
    last = s;
  };
  const absolute = new URL(url, location.href).href;
  if (typeof Worker === "function" && typeof canvas.transferControlToOffscreen === "function") {
    const worker = new Worker(new URL("./eye-video-worker.ts", import.meta.url), { type: "module" });
    worker.onmessage = ({ data }: MessageEvent<EyeWorkerMessage>) => {
      if (data.type === "mode") setMode(data.mode);
      else if (data.type === "stats") onStats(data.stats);
      else if (data.type === "frame") onFrame?.(data.at);
      else if (data.type === "shown") onShown?.(data.at);
    };
    // 일꾼을 못 띄우면 canvas는 이미 넘겨서 쓸 수 없다. MJPEG 그대로 둔다
    worker.onerror = (event) => console.warn("[eye-video] 일꾼 오류, MJPEG로 보여요:", event.message);
    const offscreen = canvas.transferControlToOffscreen();
    worker.postMessage({ type: "start", canvas: offscreen, url: absolute }, [offscreen]);
    return { get mode() { return mode; }, close() { worker.terminate(); }, setDelay: (ms) => worker.postMessage({ type: "delay", ms }) };
  }
  if ((typeof VideoDecoder !== "function" || typeof EncodedVideoChunk !== "function") && typeof createImageBitmap !== "function") {
    return { get mode() { return "jpeg" as const; }, close() {}, setDelay() {} };
  }
  const decoder = runDecoder({ canvas, url: absolute, onMode: setMode, onStats, onFrame, onShown });
  return { get mode() { return mode; }, close: () => decoder.close(), setDelay: (ms) => decoder.setDelay(ms) };
}
