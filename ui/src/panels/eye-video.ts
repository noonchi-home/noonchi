// 클로이드의 눈 표시 영상(H.264): GET /api/eye/video 스트림을 읽어 VideoDecoder로 canvas에 그린다(서버 src/phone/video.ts).
// web/eye-video.js(루트 시험이 쓰는 같은 파서)를 타입만 붙여 옮겼다. 디코드·그리기는 일꾼(eye-video-worker.ts)에서 한다.
// 영상이 3초 넘게 안 그려지면(미지원 브라우저·코덱, 폰이 H.264를 못 보냄, 스트림 끊김) MJPEG <img>를 보인다.

const MAX_HEADER_BYTES = 4096;

export type EyeMode = "video" | "jpeg";
export type StreamHeader = { type?: string; codec?: string; width?: number; height?: number; key?: boolean; ts?: number };
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
  statsMs?: number;
  retryMs?: number;
}

/** 스트림을 읽어 canvas(HTMLCanvasElement 또는 일꾼의 OffscreenCanvas)에 그린다. DOM을 쓰지 않아 일꾼에서도 돈다.
 *  onMode: 보일 화면이 바뀔 때. onStats: statsMs마다 그린 장 수·디코더 대기·크기. */
export function runDecoder({ canvas, url, onMode = () => {}, onStats = () => {}, statsMs = 500, retryMs = RETRY_MS }: RunDecoderOptions) {
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

  const open = () => {
    const d = new VideoDecoder({
      output(frame) {
        // 비율은 코딩된 크기 그대로, 칸 안에서는 CSS object-fit: contain
        if (canvas.width !== frame.displayWidth || canvas.height !== frame.displayHeight) {
          canvas.width = frame.displayWidth;
          canvas.height = frame.displayHeight;
        }
        ctx?.drawImage(frame, 0, 0, canvas.width, canvas.height);
        frame.close();
        drawn += 1;
        display.frame();
        report();
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
    try {
      d.decode(new EncodedVideoChunk({ type: header.key ? "key" : "delta", timestamp: header.ts ?? 0, data: body }));
    } catch (error) {
      // 깨진 키프레임 등은 decode가 바로 던진다(DataError). 그 청크만 버리고 다음 키프레임부터
      console.warn("[eye-video] 청크를 풀지 못해 다음 키프레임을 기다려요:", reasonOf(error));
      gate.reset();
    }
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
      if (decoder && decoder.state !== "closed") decoder.close();
    },
  };
}

export interface EyeVideo {
  readonly mode: EyeMode;
  close(): void;
}

/** 대시보드: canvas에 영상을 그린다. onMode로 영상/JPEG 중 보일 것을 알린다(처음은 JPEG).
 *  디코드·그리기는 일꾼(OffscreenCanvas)에서 한다. 같은 출처 3D 트윈 iframe이 메인 스레드를 몇 초씩 막아도 영상이 끊기지 않게.
 *  일꾼을 못 쓰면 메인 스레드에서 그린다. canvas는 한 번만 넘길 수 있으니 부를 때마다 새 canvas를 준다. */
export function attachEyeVideo({ canvas, onMode, url = "/api/eye/video" }: { canvas: HTMLCanvasElement; onMode: (mode: EyeMode) => void; url?: string }): EyeVideo {
  let mode: EyeMode = "jpeg";
  let last: EyeVideoStats = { drawn: 0, queue: 0, codec: null, width: 0, height: 0 };
  // 측정용(콘솔·헤드리스 확인): 그린 장 수·디코더 대기·크기
  (canvas as HTMLCanvasElement & { eyeVideoStats?: () => unknown }).eyeVideoStats = () => ({ ...last, mode });
  const setMode = (m: EyeMode) => { mode = m; onMode(m); };
  const onStats = (s: EyeVideoStats) => { last = s; };
  const absolute = new URL(url, location.href).href;
  if (typeof Worker === "function" && typeof canvas.transferControlToOffscreen === "function") {
    const worker = new Worker(new URL("./eye-video-worker.ts", import.meta.url), { type: "module" });
    worker.onmessage = ({ data }: MessageEvent<{ type: "mode"; mode: EyeMode } | { type: "stats"; stats: EyeVideoStats }>) => {
      if (data.type === "mode") setMode(data.mode);
      else if (data.type === "stats") onStats(data.stats);
    };
    // 일꾼을 못 띄우면 canvas는 이미 넘겨서 쓸 수 없다. MJPEG 그대로 둔다
    worker.onerror = (event) => console.warn("[eye-video] 일꾼 오류, MJPEG로 보여요:", event.message);
    const offscreen = canvas.transferControlToOffscreen();
    worker.postMessage({ type: "start", canvas: offscreen, url: absolute }, [offscreen]);
    return { get mode() { return mode; }, close() { worker.terminate(); } };
  }
  if (typeof VideoDecoder !== "function" || typeof EncodedVideoChunk !== "function") return { get mode() { return "jpeg" as const; }, close() {} };
  const decoder = runDecoder({ canvas, url: absolute, onMode: setMode, onStats });
  return { get mode() { return mode; }, close: () => decoder.close() };
}
