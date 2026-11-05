// 클로이드의 눈 표시 영상(H.264) 중계. 폰이 인코딩한 설정·청크를 판단 없이 대시보드로 흘린다(SSOT 2.2). 표시 전용이다.
// 늦게 붙은 화면이 바로 그리도록 마지막 설정과 마지막 키프레임부터의 청크 묶음(GOP)을 캐시한다.
// 느린 화면에는 쌓지 않는다: 버퍼가 넘치면 그 화면은 다음 키프레임까지 건너뛴다(델타만 받으면 풀 수 없다).
// 설정은 건너뛸 수 없어 그때 버퍼가 넘친 화면은 끊는다(다시 붙으면 설정·GOP부터). GOP도 화면 버퍼 한도 안일 때만 한꺼번에 보낸다.
//
// 화면 스트림(GET /api/eye/video): [헤더 길이 u32][본문 길이 u32][JSON 헤더][본문]이 이어진다.
//   {type:"config", codec, width, height} + avcC description
//   {type:"chunk", key, ts} + 청크
//   {type:"end"}                         폰 영상이 끝남(화면은 JPEG로 돌아간다)

export interface VideoConfig {
  codec: string;
  width: number;
  height: number;
  description: Buffer;
}

export interface VideoChunk {
  key: boolean;
  ts: number;
  width: number;
  height: number;
  data: Buffer;
}

/** 화면 스트림을 받는 곳(ServerResponse 모양). */
export interface VideoSink {
  readonly writableLength: number;
  write(chunk: Buffer): unknown;
  end(): unknown;
  once(event: "close", fn: () => void): unknown;
}

export interface DisplayStats {
  codec: string | null;
  width: number | null;
  height: number | null;
  fps: number;
  kbps: number;
  key_age_ms: number | null;
  viewers: number;
}

export interface VideoRelayOptions {
  now?: () => number;
  /** 화면 하나에 쌓일 수 있는 바이트. 넘으면 다음 키프레임까지 건너뛴다. */
  maxBuffered?: number;
  /** GOP 캐시 한도. 넘으면 버리고 다음 키프레임부터 다시 모은다. */
  maxGopBytes?: number;
}

const STATS_WINDOW_MS = 2000;

export function encodeStreamMessage(header: object, body: Uint8Array): Buffer {
  const head = Buffer.from(JSON.stringify(header), "utf8");
  const lens = Buffer.alloc(8);
  lens.writeUInt32BE(head.length, 0);
  lens.writeUInt32BE(body.length, 4);
  return Buffer.concat([lens, head, Buffer.from(body.buffer, body.byteOffset, body.byteLength)]);
}

const chunkMessage = (c: VideoChunk) => encodeStreamMessage({ type: "chunk", key: c.key, ts: c.ts }, c.data);

interface Viewer {
  sink: VideoSink;
  /** 델타를 풀 수 없는 상태(처음·건너뛴 뒤): 다음 키프레임까지 델타를 보내지 않는다. */
  waitKey: boolean;
}

export class VideoRelay {
  private source: number | null = null;
  private cfg: VideoConfig | null = null;
  private cfgMessage: Buffer | null = null;
  private gop: Buffer[] = [];
  private gopBytes = 0;
  private lastKeyAt: number | null = null;
  private recent: { at: number; bytes: number }[] = [];
  private readonly viewers = new Set<Viewer>();
  private readonly now: () => number;
  private readonly maxBuffered: number;
  private readonly maxGopBytes: number;

  constructor(opts: VideoRelayOptions = {}) {
    this.now = opts.now ?? Date.now;
    this.maxBuffered = opts.maxBuffered ?? 1 << 20;
    this.maxGopBytes = opts.maxGopBytes ?? 8 << 20;
  }

  /** 폰 연결 source의 새 디코더 설정. 그 연결의 영상만 받는다(마지막에 설정을 보낸 연결). */
  config(source: number, cfg: VideoConfig): void {
    this.source = source;
    this.cfg = cfg;
    this.cfgMessage = encodeStreamMessage({ type: "config", codec: cfg.codec, width: cfg.width, height: cfg.height }, cfg.description);
    this.resetGop();
    for (const v of this.viewers) {
      if (v.sink.writableLength > this.maxBuffered) {
        this.viewers.delete(v);
        v.sink.end();
        continue;
      }
      v.sink.write(this.cfgMessage);
      v.waitKey = true;
    }
  }

  chunk(source: number, c: VideoChunk): void {
    if (source !== this.source || !this.cfg) return;
    const at = this.now();
    this.recent.push({ at, bytes: c.data.length });
    this.recent = this.recent.filter((f) => f.at > at - STATS_WINDOW_MS);
    const message = chunkMessage(c);
    if (c.key) {
      this.lastKeyAt = at;
      this.gop = [message];
      this.gopBytes = message.length;
    } else if (this.gop.length > 0) {
      this.gopBytes += message.length;
      if (this.gopBytes > this.maxGopBytes) this.resetGop();
      else this.gop.push(message);
    }
    for (const v of this.viewers) {
      if (v.waitKey && !c.key) continue;
      if (v.sink.writableLength > this.maxBuffered) {
        v.waitKey = true;
        continue;
      }
      v.sink.write(message);
      v.waitKey = false;
    }
  }

  /** 폰 연결이 끊김. 지금 영상의 연결이면 캐시를 비우고 화면에 end를 보낸다. */
  endSource(source: number): void {
    if (source !== this.source) return;
    this.source = null;
    this.cfg = null;
    this.cfgMessage = null;
    this.resetGop();
    this.lastKeyAt = null;
    this.recent = [];
    const end = encodeStreamMessage({ type: "end" }, new Uint8Array(0));
    for (const v of this.viewers) {
      v.sink.write(end);
      v.waitKey = true;
    }
  }

  /** 화면 하나를 붙인다: 설정 → 캐시한 GOP → 실시간. */
  attach(sink: VideoSink): void {
    const viewer: Viewer = { sink, waitKey: true };
    this.viewers.add(viewer);
    sink.once("close", () => this.viewers.delete(viewer));
    if (!this.cfgMessage) return;
    sink.write(this.cfgMessage);
    if (this.gop.length === 0 || this.gopBytes > this.maxBuffered) return;
    for (const m of this.gop) sink.write(m);
    viewer.waitKey = false;
  }

  stats(): DisplayStats {
    const now = this.now();
    const frames = this.recent.filter((f) => f.at > now - STATS_WINDOW_MS);
    const bytes = frames.reduce((a, f) => a + f.bytes, 0);
    const sec = STATS_WINDOW_MS / 1000;
    return {
      codec: this.cfg?.codec ?? null,
      width: this.cfg?.width ?? null,
      height: this.cfg?.height ?? null,
      fps: Math.round((frames.length / sec) * 10) / 10,
      kbps: Math.round((bytes * 8) / 1000 / sec),
      key_age_ms: this.lastKeyAt === null ? null : Math.round(now - this.lastKeyAt),
      viewers: this.viewers.size,
    };
  }

  close(): void {
    for (const v of this.viewers) v.sink.end();
    this.viewers.clear();
  }

  private resetGop(): void {
    this.gop = [];
    this.gopBytes = 0;
  }
}
