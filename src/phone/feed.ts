// 클로이드의 눈 화면: 폰이 보낸 최신 카메라 프레임을 MJPEG로 흘리고, '사진 찍기' 사진을 눈 자세와 함께 저장한다.
// 폰이 따로 보내는 표시 영상(H.264)은 video(src/phone/video.ts)가 중계한다.
// 실시간 화면은 표시 전용이다(엔진 입력 아님, SSOT 12절). 본 서버가 /api/eye/*를 handle()로 넘긴다.
//
//   GET /api/eye/frame.jpg            최신 프레임(없으면 404)
//   GET /api/eye/stream               multipart/x-mixed-replace(MJPEG). <img src>로 바로 보인다
//   GET /api/eye/video                표시 영상(H.264) 메시지 스트림. 대시보드가 VideoDecoder로 그린다(ui/src/panels/eye-video.ts)
//   GET /api/eye/photos/<id>.jpg      저장한 사진
//   GET /api/eye/stats                받은 프레임 통계(최근 2초 fps·장당 크기·마지막 크기)와 표시 영상 통계(display)

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { join } from "node:path";
import type { PhotoRecord } from "../contract/events.js";
import type { EyeEvent } from "./session.js";
import { VideoRelay, type DisplayStats } from "./video.js";

export type { PhotoRecord } from "../contract/events.js";

const BOUNDARY = "eyeframe";
/** 느린 화면에는 프레임을 쌓지 않고 건너뛴다. */
const MAX_BUFFERED = 1 << 20;
const STATS_WINDOW_MS = 2000;

export interface FeedStats {
  fps: number;
  frames: number;
  kb_per_frame: number | null;
  width: number | null;
  height: number | null;
  last_frame_age_ms: number | null;
}

/** /api/eye/stats: JPEG 프레임 통계 + 표시 영상(H.264) 통계. */
export interface EyeStats extends FeedStats {
  display: DisplayStats;
}

export interface EyeFeedOptions {
  photoDir: string;
  broadcast: (msg: unknown) => void;
  now?: () => Date;
  /** 사진 찍기 사진을 저장한 뒤(보관 기간 표에 적는다, src/history/retention.ts). */
  onSaved?: (p: { id: string; atMs: number; path: string }) => void;
}

export class EyeFeed {
  private latest: Buffer | null = null;
  private recent: { at: number; bytes: number }[] = [];
  private lastSize: { width: number; height: number; at: number } | null = null;
  private readonly streams = new Set<ServerResponse>();
  private seq = 0;
  private readonly now: () => Date;
  /** 표시 영상 중계. 폰 서버가 영상 패킷을 넘긴다. */
  readonly video: VideoRelay;

  constructor(private readonly opts: EyeFeedOptions) {
    this.now = opts.now ?? (() => new Date());
    this.video = new VideoRelay({ now: () => this.now().getTime() });
  }

  pushFrame(jpeg: Buffer, width: number, height: number): void {
    this.latest = jpeg;
    const at = this.now().getTime();
    this.recent.push({ at, bytes: jpeg.length });
    this.recent = this.recent.filter((f) => f.at > at - STATS_WINDOW_MS);
    this.lastSize = { width, height, at };
    for (const res of this.streams) {
      if (res.writableLength > MAX_BUFFERED) continue;
      writePart(res, jpeg);
    }
  }

  /** 최근 2초 동안 받은 프레임 통계와 표시 영상 통계. */
  stats(): EyeStats {
    const now = this.now().getTime();
    const frames = this.recent.filter((f) => f.at > now - STATS_WINDOW_MS);
    const bytes = frames.reduce((a, f) => a + f.bytes, 0);
    return {
      fps: Math.round((frames.length / (STATS_WINDOW_MS / 1000)) * 10) / 10,
      frames: frames.length,
      kb_per_frame: frames.length ? Math.round((bytes / frames.length / 1024) * 10) / 10 : null,
      width: this.lastSize?.width ?? null,
      height: this.lastSize?.height ?? null,
      last_frame_age_ms: this.lastSize ? now - this.lastSize.at : null,
      display: this.video.stats(),
    };
  }

  savePhoto(jpeg: Buffer, width: number, height: number, eye: EyeEvent | null): PhotoRecord {
    const at = this.now().toISOString();
    const id = `${at.slice(0, 19).replace(/[-:]/g, "")}-${++this.seq}`;
    const record: PhotoRecord = {
      id, at, url: `/api/eye/photos/${id}.jpg`, width, height, measured_pose: eye,
      ...(eye ? {} : { pose_note: "not_aligned" as const }),
    };
    mkdirSync(this.opts.photoDir, { recursive: true });
    const path = join(this.opts.photoDir, `${id}.jpg`);
    writeFileSync(path, jpeg);
    writeFileSync(join(this.opts.photoDir, `${id}.json`), JSON.stringify(record, null, 2));
    this.opts.onSaved?.({ id, atMs: Date.parse(at), path });
    this.opts.broadcast({ type: "photo", photo: record });
    return record;
  }

  /** /api/eye/* GET이면 응답하고 true. */
  handle(req: IncomingMessage, res: ServerResponse, path: string): boolean {
    if (req.method !== "GET" && req.method !== "HEAD") return false;
    if (path === "/api/eye/frame.jpg") {
      if (!this.latest) return notFound(res, "아직 받은 프레임이 없습니다");
      res.writeHead(200, { "content-type": "image/jpeg", "content-length": this.latest.length, "cache-control": "no-store" });
      res.end(req.method === "HEAD" ? undefined : this.latest);
      return true;
    }
    if (path === "/api/eye/stream") {
      res.writeHead(200, { "content-type": `multipart/x-mixed-replace; boundary=${BOUNDARY}`, "cache-control": "no-store", connection: "close" });
      // 본문을 쓰기 전까지 Node는 헤더를 보내지 않는다. 첫 프레임 전에도 화면이 연결을 끝내도록 바로 보낸다
      res.flushHeaders();
      if (req.method === "HEAD") {
        res.end();
        return true;
      }
      this.streams.add(res);
      res.on("close", () => this.streams.delete(res));
      if (this.latest) writePart(res, this.latest);
      return true;
    }
    if (path === "/api/eye/video") {
      res.writeHead(200, { "content-type": "application/octet-stream", "cache-control": "no-store", "x-content-type-options": "nosniff", connection: "close" });
      res.flushHeaders();
      if (req.method === "HEAD") {
        res.end();
        return true;
      }
      res.socket?.setNoDelay(true);
      this.video.attach(res);
      return true;
    }
    if (path === "/api/eye/stats") {
      res.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
      res.end(req.method === "HEAD" ? undefined : JSON.stringify({ ok: true, ...this.stats() }));
      return true;
    }
    const m = /^\/api\/eye\/photos\/([\w-]+)\.jpg$/.exec(path);
    if (m) {
      const file = join(this.opts.photoDir, `${m[1]}.jpg`);
      if (!existsSync(file)) return notFound(res, "사진이 없습니다");
      const body = readFileSync(file);
      res.writeHead(200, { "content-type": "image/jpeg", "content-length": body.length, "cache-control": "no-cache" });
      res.end(req.method === "HEAD" ? undefined : body);
      return true;
    }
    if (path.startsWith("/api/eye/")) return notFound(res, `없는 경로입니다: ${path}`);
    return false;
  }

  close(): void {
    for (const res of this.streams) res.end();
    this.streams.clear();
    this.video.close();
  }
}

function writePart(res: ServerResponse, jpeg: Buffer): void {
  res.write(`--${BOUNDARY}\r\nContent-Type: image/jpeg\r\nContent-Length: ${jpeg.length}\r\n\r\n`);
  res.write(jpeg);
  res.write("\r\n");
}

function notFound(res: ServerResponse, error: string): true {
  res.writeHead(404, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify({ ok: false, error }));
  return true;
}
