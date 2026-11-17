import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { EventEmitter } from "node:events";
import { createServer, get, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { EyeFeed } from "../src/phone/feed.js";
import { fetchRetry, listenRetry } from "../src/shared/net.js";
import type { EyeEvent } from "../src/phone/session.js";
import { readVideo } from "./helpers/video.js";

const JPEG_A = Buffer.from([0xff, 0xd8, 0xaa, 0xaa, 0xff, 0xd9]);
const JPEG_B = Buffer.from([0xff, 0xd8, 0xbb, 0xbb, 0xbb, 0xff, 0xd9]);
const JPEG_C = Buffer.from([0xff, 0xd8, 0xcc, 0xff, 0xd9]);
const EYE: EyeEvent = { position: [3.9, 5], height_m: 1.4, yaw_deg: 270, pitch_deg: -20, tracking: "ok", at: "2026-10-24T10:15:00.000Z" };

const cleanups: (() => void | Promise<void>)[] = [];
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()!();
});

/** 서버 없이 쓰는 EyeFeed. */
function plainFeed() {
  const photoDir = mkdtempSync(join(tmpdir(), "eye-photos-"));
  const feed = new EyeFeed({ photoDir, broadcast: () => {} });
  cleanups.push(() => { feed.close(); rmSync(photoDir, { recursive: true, force: true }); });
  return { feed };
}

/** 쓰기만 흉내 내는 응답: write는 늘 true를 돌려주지만(쓰기 버퍼 한도 아래) 쓴 조각은 flush를 부를 때까지 보내지 않은 것으로 남는다(write 콜백을 미룬다).
 *  frames: 쓴 JPEG들. */
function fakeStream() {
  const out: Buffer[] = [];
  let pending: (() => void)[] = [];
  const res = Object.assign(new EventEmitter(), {
    writeHead: () => res, flushHeaders: () => {}, end: () => { res.writableEnded = true; }, destroyed: false, writableEnded: false,
    /** 끝낸 뒤에 쓴 횟수(실제 응답이면 ERR_STREAM_WRITE_AFTER_END). */
    afterEnd: 0,
    write: (c: string | Buffer, cb?: () => void) => { if (res.writableEnded) res.afterEnd++; out.push(Buffer.from(c)); if (cb) pending.push(cb); return true; },
    /** 쓴 조각을 다 보냈다(write 콜백을 부른다). */
    flush: () => { const cbs = pending; pending = []; for (const cb of cbs) cb(); },
    frames: () => out.filter((c) => c[0] === 0xff && c[1] === 0xd8),
  });
  return res;
}

async function setup() {
  const photoDir = mkdtempSync(join(tmpdir(), "eye-photos-"));
  const sent: any[] = [];
  const feed = new EyeFeed({ photoDir, broadcast: (m) => sent.push(m), now: () => new Date("2026-10-24T10:15:00Z") });
  const server: Server = createServer((req, res) => {
    const path = new URL(req.url ?? "/", "http://localhost").pathname;
    if (!feed.handle(req, res, path)) {
      res.writeHead(404);
      res.end();
    }
  });
  const { port } = await listenRetry(server, 0, "127.0.0.1");
  const base = `http://127.0.0.1:${port}`;
  cleanups.push(() => rmSync(photoDir, { recursive: true, force: true }));
  cleanups.push(() => new Promise<void>((r) => { feed.close(); server.closeAllConnections(); server.close(() => r()); }));
  return { feed, base, photoDir, sent };
}

/** http.get. 이 PC의 Windows는 127.0.0.1 connect가 가끔 EFAULT로 실패해 다시 시도한다(src/shared/net.ts). */
async function openStream(url: string): Promise<IncomingMessage> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await new Promise<IncomingMessage>((res, rej) => get(url, res).on("error", rej));
    } catch (e) {
      if ((e as { code?: string }).code !== "EFAULT" || attempt >= 4) throw e;
      await new Promise((r) => setTimeout(r, 50 * attempt));
    }
  }
}

describe("EyeFeed", () => {
  it("프레임 전에는 404, 프레임 뒤에는 최신 JPEG를 준다", async () => {
    const { feed, base } = await setup();
    expect((await fetchRetry(`${base}/api/eye/frame.jpg`)).status).toBe(404);
    feed.pushFrame(JPEG_A, 640, 480);
    feed.pushFrame(JPEG_B, 640, 480);
    const res = await fetchRetry(`${base}/api/eye/frame.jpg`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/jpeg");
    expect(Buffer.from(await res.arrayBuffer())).toEqual(JPEG_B);
  });

  it("MJPEG 스트림으로 새 프레임을 순서대로 흘린다", async () => {
    const { feed, base } = await setup();
    const res = await openStream(`${base}/api/eye/stream`);
    expect(res.headers["content-type"]).toBe("multipart/x-mixed-replace; boundary=eyeframe");
    const chunks: Buffer[] = [];
    res.on("data", (c: Buffer) => chunks.push(c));
    feed.pushFrame(JPEG_A, 640, 480);
    feed.pushFrame(JPEG_B, 640, 480);
    await new Promise((r) => setTimeout(r, 100));
    res.destroy();
    const body = Buffer.concat(chunks);
    expect(body.toString("latin1")).toContain("--eyeframe\r\nContent-Type: image/jpeg\r\nContent-Length: 6\r\n\r\n");
    const a = body.indexOf(JPEG_A), b = body.indexOf(JPEG_B);
    expect(a).toBeGreaterThan(0);
    expect(b).toBeGreaterThan(a);
  });

  // Codex(76d212b feed.ts:179): write가 true여도 못 보낸 데이터가 남아 작은 JPEG는 버퍼 한도까지 여러 장 쌓였다
  it("한 장을 다 보내기 전(write가 true여도)에는 프레임을 줄 세우지 않고 가장 새 한 장만 들고 있다가, 다 보내면 그것만 보낸다(늦게 보이는 미니맵)", () => {
    const { feed } = plainFeed();
    const res = fakeStream();
    expect(feed.handle({ method: "GET" } as IncomingMessage, res as unknown as ServerResponse, "/api/eye/stream")).toBe(true);
    // 첫 장은 바로 쓰고, 그 장을 보내는 동안 온 B·C는 C 하나만 남긴다
    feed.pushFrame(JPEG_A, 640, 480);
    feed.pushFrame(JPEG_B, 640, 480);
    feed.pushFrame(JPEG_C, 640, 480);
    expect(res.frames()).toEqual([JPEG_A]);
    res.flush();
    expect(res.frames()).toEqual([JPEG_A, JPEG_C]);
    // 다 보내 비어 있으면 바로 쓴다
    res.flush();
    feed.pushFrame(JPEG_B, 640, 480);
    expect(res.frames()).toEqual([JPEG_A, JPEG_C, JPEG_B]);
    // 더 보낼 것이 없으면 다 보낸 뒤에도 아무것도 쓰지 않는다
    res.flush();
    expect(res.frames()).toHaveLength(3);
  });

  // Codex(33a76df feed.ts:158·178): 끝내는 중에 남은 프레임의 쓰기 콜백이 res.end() 뒤에 다시 보내 ERR_STREAM_WRITE_AFTER_END가 날 수 있었다
  it("끝낼 때(close) 기다리던 프레임은 버리고, 보내던 장의 쓰기 콜백이 그 뒤에 와도 끝낸 연결에 쓰지 않는다", () => {
    const { feed } = plainFeed();
    const res = fakeStream();
    feed.handle({ method: "GET" } as IncomingMessage, res as unknown as ServerResponse, "/api/eye/stream");
    feed.pushFrame(JPEG_A, 640, 480);
    feed.pushFrame(JPEG_B, 640, 480);
    feed.close();
    res.flush();
    expect(res.frames()).toEqual([JPEG_A]);
    expect(res.afterEnd).toBe(0);
  });

  it("사진을 JPEG·JSON으로 저장하고 photo 이벤트를 보낸다", async () => {
    const { feed, base, photoDir, sent } = await setup();
    const rec = feed.savePhoto(JPEG_A, 1920, 1440, EYE);
    expect(rec).toMatchObject({ id: "20261024T101500-1", url: "/api/eye/photos/20261024T101500-1.jpg", width: 1920, height: 1440, measured_pose: EYE });
    expect(readFileSync(join(photoDir, `${rec.id}.jpg`))).toEqual(JPEG_A);
    expect(JSON.parse(readFileSync(join(photoDir, `${rec.id}.json`), "utf8"))).toEqual(rec);
    expect(sent).toEqual([{ type: "photo", photo: rec }]);
    const img = await fetchRetry(`${base}${rec.url}`);
    expect(img.status).toBe(200);
    expect(Buffer.from(await img.arrayBuffer())).toEqual(JPEG_A);
  });

  it("맞추기 전 사진은 pose_note: not_aligned, 이상한 id는 404", async () => {
    const { feed, base, photoDir } = await setup();
    const rec = feed.savePhoto(JPEG_B, 1920, 1440, null);
    expect(rec).toMatchObject({ id: "20261024T101500-1", measured_pose: null, pose_note: "not_aligned" });
    expect(existsSync(join(photoDir, `${rec.id}.jpg`))).toBe(true);
    expect((await fetchRetry(`${base}/api/eye/photos/..%2Fsecret.jpg`)).status).toBe(404);
    expect((await fetchRetry(`${base}/api/eye/photos/nope.jpg`)).status).toBe(404);
  });
});


describe("표시 영상(H.264) 스트림", () => {
  const DESC = Buffer.from([1, 0x42, 0xe0, 0x1f]);
  it("/api/eye/video는 설정·청크를 길이 붙인 메시지로 흘리고, 늦게 붙어도 설정과 키프레임부터 받는다", async () => {
    const { feed, base } = await setup();
    feed.video.config(1, { codec: "avc1.42E01F", width: 592, height: 1280, description: DESC });
    feed.video.chunk(1, { key: true, ts: 0, width: 592, height: 1280, data: Buffer.alloc(900, 0x65) });
    const v = await readVideo(`${base}/api/eye/video`);
    expect(v.res.headers["content-type"]).toBe("application/octet-stream");
    expect(v.res.headers["cache-control"]).toBe("no-store");
    feed.video.chunk(1, { key: false, ts: 33_333, width: 592, height: 1280, data: Buffer.alloc(120, 0x41) });
    await v.waitFor((m) => m.header.type === "chunk", 2);
    expect(v.got.map((m) => m.header)).toEqual([
      { type: "config", codec: "avc1.42E01F", width: 592, height: 1280 },
      { type: "chunk", key: true, ts: 0 },
      { type: "chunk", key: false, ts: 33_333 },
    ]);
    expect(Buffer.from(v.got[0]!.body)).toEqual(DESC);
    expect(v.got[1]!.body.length).toBe(900);
    const stats = await (await fetchRetry(`${base}/api/eye/stats`)).json() as Record<string, any>;
    expect(stats.display).toMatchObject({ codec: "avc1.42E01F", width: 592, height: 1280, viewers: 1 });
    expect(stats.display.fps).toBeGreaterThan(0);
    v.close();
  });

  it("feed.close는 영상 스트림도 끝낸다(집을 바꿀 때)", async () => {
    const { feed, base } = await setup();
    const v = await readVideo(`${base}/api/eye/video`);
    await new Promise((r) => setTimeout(r, 50));
    expect(feed.video.stats().viewers).toBe(1);
    feed.close();
    await v.ended;
  });
});

describe("받은 프레임 통계", () => {
  it("최근 2초 fps·평균 크기·마지막 크기, /api/eye/stats", async () => {
    let t = Date.parse("2026-10-24T10:15:00Z");
    const photoDir = mkdtempSync(join(tmpdir(), "eye-stats-"));
    cleanups.push(() => rmSync(photoDir, { recursive: true, force: true }));
    const feed = new EyeFeed({ photoDir, broadcast: () => {}, now: () => new Date(t) });
    expect(feed.stats()).toMatchObject({ fps: 0, frames: 0, kb_per_frame: null, last_frame_age_ms: null });
    for (let i = 0; i < 8; i++) {
      feed.pushFrame(Buffer.alloc(30_000, 1), 480, 360);
      t += 250;
    }
    const s = feed.stats();
    expect(s.fps).toBeCloseTo(3.5); // 2초 창(앞 끝 제외) 안의 7장
    expect(s.kb_per_frame).toBeCloseTo(29.3, 1);
    expect(s).toMatchObject({ width: 480, height: 360, last_frame_age_ms: 250 });
    t += 10_000;
    expect(feed.stats().fps).toBe(0);
    const { base } = await setup();
    const res = await fetchRetry(`${base}/api/eye/stats`);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, fps: 0, display: { codec: null, fps: 0, kbps: 0, key_age_ms: null, viewers: 0 } });
  });
});
