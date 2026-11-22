import { mkdirSync, mkdtempSync, rmSync, writeFileSync, type ReadStream } from "node:fs";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import WebSocket from "ws";
import type { PlannedCommand } from "../src/contract/phone.js";
import { EyeFeed } from "../src/phone/feed.js";
import { encodeFramePacket } from "../src/phone/packet.js";
import { createPhoneServer, DEFAULT_UI_DIR, sameHost } from "../src/phone/server.js";
import { createApp, type TwinHomeApp } from "../src/server/app.js";
import { fetchRetry } from "../src/shared/net.js";
import { BOX_START, BOX_WALLS, alignMessages } from "./helpers/align.js";
import { ROOMS, makeHome } from "./helpers/home.js";
import { readVideo } from "./helpers/video.js";
import { openPhone, openWebSocket } from "./helpers/ws.js";
import { PHONE_PROTOCOL } from "../src/phone/protocol.js";

/** 서버가 연 파일 읽기 스트림(영상 받기를 끊은 뒤 닫혔는지 본다). 나머지 node:fs는 그대로다. */
const readStreams = vi.hoisted(() => [] as ReadStream[]);
vi.mock("node:fs", async (importOriginal) => {
  const fs = await importOriginal<typeof import("node:fs")>();
  return {
    ...fs,
    createReadStream: (...args: Parameters<typeof fs.createReadStream>) => {
      const s = fs.createReadStream(...args);
      readStreams.push(s);
      return s;
    },
  };
});

type Msg = Record<string, any>;
/** 6×5 네모 방과 그 가운데 시작 위치(tests/helpers/align.ts). 맞추면 AR = 평면 그대로다. */
const SYNC = { landmarks: [], walls: BOX_WALLS, start: BOX_START };
const sendAlign = (ws: WebSocket) => { for (const m of alignMessages(BOX_WALLS, BOX_START)) ws.send(JSON.stringify(m)); };
const BOTH = [{ id: "approve", label: "승인" }, { id: "reject", label: "거절" }];
const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()!();
});

/** 가짜 ui/dist: 폰 화면·빌드 파일·브랜드 그림·파비콘과 대시보드·설정 화면. */
function fakeUiDist(): string {
  const dir = mkdtempSync(join(tmpdir(), "phone-ui-"));
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  const files: [string, string][] = [
    ["phone/index.html", '<title>폰 테스트</title><script type="module" src="/assets/phone-x.js"></script>'],
    ["assets/phone-x.js", "export {};"],
    ["assets/noto-sans-kr-0-wght-normal-x.woff2", "w"],
    ["brand/mascot@1x.webp", "m"],
    ["favicon.ico", "i"],
    ["fonts/OFL-noto-sans-kr.txt", "ofl"],
    ["index.html", "<title>대시보드</title>"],
    ["setup/index.html", "<title>설정</title>"],
  ];
  for (const [p, body] of files) {
    mkdirSync(dirname(join(dir, p)), { recursive: true });
    writeFileSync(join(dir, p), body);
  }
  return dir;
}

const opened = (ws: WebSocket) =>
  new Promise<void>((res, rej) => {
    ws.once("open", () => res());
    ws.once("error", rej);
  });

/** 조건에 맞는 메시지를 기다린다(3초). cancel은 기다림을 치운다(타이머·리스너): 소켓 다시 열기에서 실패한 시도의 대기를 치울 때 쓴다. */
function next(ws: WebSocket, pred: (m: Msg) => boolean): Promise<Msg> & { cancel(): void } {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let onMessage: ((d: WebSocket.RawData) => void) | undefined;
  const wait = new Promise<Msg>((res, rej) => {
    timer = setTimeout(() => rej(new Error("메시지가 오지 않았습니다")), 3000);
    onMessage = (d) => {
      const m = JSON.parse(String(d)) as Msg;
      if (pred(m)) {
        clearTimeout(timer);
        res(m);
      }
    };
    ws.on("message", onMessage);
  });
  return Object.assign(wait, { cancel: () => { clearTimeout(timer); if (onMessage) ws.off("message", onMessage); } });
}

async function setup(opts: { log?: (m: string) => void } = {}) {
  const home = makeHome();
  const photoDir = mkdtempSync(join(tmpdir(), "phone-photos-"));
  cleanups.push(() => rmSync(photoDir, { recursive: true, force: true }));
  let app: TwinHomeApp | undefined;
  const feed = new EyeFeed({ photoDir, broadcast: (m) => app?.broadcast(m) });
  app = createApp({ hub: home.hub, policy: home.policy, rooms: ROOMS, eye: feed, log: () => {} });
  const { url } = await app.listen(0, "127.0.0.1");
  const main = app;
  cleanups.push(() => main.close());
  const phone = createPhoneServer({ sync: SYNC, uiDir: fakeUiDist(), feed, onEye: (eye) => main.broadcast({ type: "eye", eye }), log: opts.log ?? (() => {}) });
  const { port } = await phone.listen(0, "127.0.0.1");
  cleanups.push(() => phone.close());
  return { url, phoneBase: `http://127.0.0.1:${port}` };
}

const JPEG = Buffer.from([0xff, 0xd8, 0x12, 0x34, 0xff, 0xd9]);

async function alignedPhone(phoneBase: string) {
  const phone = await openWebSocket(`${phoneBase.replace(/^http/, "ws")}/phone/events`, { options: { origin: phoneBase } });
  phone.send(JSON.stringify({ type: "hello", protocol: PHONE_PROTOCOL }));
  const done = next(phone, (m) => m.type === "status" && m.aligned);
  sendAlign(phone);
  await done;
  return phone;
}

describe("phone camera", () => {
  it("frame 패킷은 본 서버 /api/eye/frame.jpg의 최신 화면이 된다", async () => {
    const { url, phoneBase } = await setup();
    expect(((await (await fetchRetry(`${url}/api/health`)).json()) as { eye?: boolean }).eye).toBe(true);
    const phone = await alignedPhone(phoneBase);
    phone.send(encodeFramePacket({ kind: "frame", width: 640, height: 480 }, JPEG));
    let res: Response | undefined;
    for (let i = 0; i < 20 && res?.status !== 200; i++) {
      res = await fetchRetry(`${url}/api/eye/frame.jpg`);
      if (res.status !== 200) await new Promise((r) => setTimeout(r, 50));
    }
    expect(res!.status).toBe(200);
    expect(Buffer.from(await res!.arrayBuffer())).toEqual(JPEG);
    phone.close();
  });

  it("맞춘 뒤 photo 패킷은 트윈 좌표 눈 자세와 함께 저장되고 /events로 알린다", async () => {
    const { url, phoneBase } = await setup();
    const dash = await openWebSocket(`${url.replace(/^http/, "ws")}/events`);
    const phone = await alignedPhone(phoneBase);
    const saved = next(phone, (m) => m.type === "photo_saved");
    const event = next(dash, (m) => m.type === "photo");
    phone.send(encodeFramePacket({ kind: "photo", width: 1920, height: 1440, position: [3.9, 1.4, 5], orientation: [0, 0, 0, 1], tracking: "ok" }, JPEG));
    expect(await saved).toMatchObject({ aligned: true });
    const photo = (await event).photo;
    expect(photo.measured_pose).toMatchObject({ position: [3.9, 5], height_m: 1.4, yaw_deg: 270 });
    expect(Buffer.from(await (await fetchRetry(url + photo.url)).arrayBuffer())).toEqual(JPEG);
    dash.close();
    phone.close();
  });

  it("깨진 바이너리는 이유를 돌려준다", async () => {
    const { phoneBase } = await setup();
    const phone = await openWebSocket(`${phoneBase.replace(/^http/, "ws")}/phone/events`, { options: { origin: phoneBase } });
    const reply = next(phone, (m) => m.type === "status" && m.error);
    phone.send(encodeFramePacket({ kind: "frame", width: 640, height: 480 }, Buffer.from([1, 2])));
    expect((await reply).error).toBe("JPEG가 아닙니다");
    phone.close();
  });

  it("video_config·video 패킷은 본 서버 /api/eye/video로 중계되고, 폰이 끊기면 end", async () => {
    const { url, phoneBase } = await setup();
    const v = await readVideo(`${url}/api/eye/video`);
    const phone = await openWebSocket(`${phoneBase.replace(/^http/, "ws")}/phone/events`, { options: { origin: phoneBase } });
    phone.send(encodeFramePacket({ kind: "video_config", codec: "avc1.42E01F", width: 592, height: 1280 }, Buffer.from([1, 0x42])));
    phone.send(encodeFramePacket({ kind: "video", key: true, ts: 0, width: 592, height: 1280 }, Buffer.alloc(800, 0x65)));
    phone.send(encodeFramePacket({ kind: "video", key: false, ts: 33_333, width: 592, height: 1280 }, Buffer.alloc(90, 0x41)));
    // 분석용 JPEG 프레임은 영상과 따로 그대로 간다
    phone.send(encodeFramePacket({ kind: "frame", width: 360, height: 780 }, JPEG));
    await v.waitFor((m) => m.header.type === "chunk", 2);
    expect(v.got.map((m) => m.header.type)).toEqual(["config", "chunk", "chunk"]);
    const stats = await (await fetchRetry(`${url}/api/eye/stats`)).json() as Msg;
    expect(stats).toMatchObject({ frames: 1, display: { codec: "avc1.42E01F", width: 592, height: 1280, viewers: 1 } });
    phone.close();
    await v.waitFor((m) => m.header.type === "end");
    v.close();
  });

  it("표시 장면의 촬영 시각: 영상 청크·화면 프레임의 captured_at은 엔진 프레임과 같은 규칙(captureTime, 이른 쪽)으로 at이 된다", async () => {
    const { url, phoneBase } = await setup();
    const v = await readVideo(`${url}/api/eye/video`);
    const phone = await openWebSocket(`${phoneBase.replace(/^http/, "ws")}/phone/events`, { options: { origin: phoneBase } });
    const t = Date.now() - 1000;
    // 영상 모드: H.264 없이 화면 프레임(JPEG)만 온다
    phone.send(encodeFramePacket({ kind: "frame", width: 360, height: 780, captured_at: t, time_err_ms: 4 }, JPEG));
    const [still] = await v.waitFor((m) => m.header.type === "jpeg");
    expect(still!.header).toEqual({ type: "jpeg", at: t - 4, width: 360, height: 780 });
    expect([...still!.body]).toEqual([...JPEG]);
    phone.send(encodeFramePacket({ kind: "video_config", codec: "avc1.42E01F", width: 592, height: 1280 }, Buffer.from([1, 0x42])));
    phone.send(encodeFramePacket({ kind: "video", key: true, ts: 0, width: 592, height: 1280, captured_at: t + 33, time_err_ms: 4 }, Buffer.alloc(800, 0x65)));
    // 시계를 아직 못 맞춘 폰은 받은 시각
    phone.send(encodeFramePacket({ kind: "video", key: false, ts: 33_333, width: 592, height: 1280 }, Buffer.alloc(90, 0x41)));
    const chunks = await v.waitFor((m) => m.header.type === "chunk", 2);
    expect(chunks[0]!.header).toMatchObject({ at: t + 29 });
    expect(Number(chunks[1]!.header.at)).toBeGreaterThanOrEqual(t + 1000);
    phone.close();
    v.close();
  });

  it("깨진 영상 패킷은 이유를 돌려준다", async () => {
    const { phoneBase } = await setup();
    const phone = await openWebSocket(`${phoneBase.replace(/^http/, "ws")}/phone/events`, { options: { origin: phoneBase } });
    const reply = next(phone, (m) => m.type === "status" && m.error);
    phone.send(encodeFramePacket({ kind: "video_config", width: 592, height: 1280 } as never, Buffer.alloc(0)));
    expect((await reply).error).toContain("codec");
    phone.close();
  });

  it("폰 연결·끊김을 로그에 한 줄씩 남긴다", async () => {
    const lines: string[] = [];
    const { phoneBase } = await setup({ log: (m) => lines.push(m) });
    const phone = await openWebSocket(`${phoneBase.replace(/^http/, "ws")}/phone/events`, { options: { origin: phoneBase } });
    const closed = new Promise((r) => phone.once("close", r));
    phone.close();
    await closed;
    for (let i = 0; i < 20 && !lines.some((l) => l.includes("끊김")); i++) await new Promise((r) => setTimeout(r, 25));
    expect(lines.filter((l) => l.startsWith("[phone]"))).toEqual(["[phone] 폰 연결(지금 1대)", "[phone] 폰 끊김(지금 0대)"]);
  });
});

describe("엔진 프레임", () => {
  async function engineSetup(videoDir?: string) {
    const photoDir = mkdtempSync(join(tmpdir(), "phone-photos-"));
    cleanups.push(() => rmSync(photoDir, { recursive: true, force: true }));
    const feed = new EyeFeed({ photoDir, broadcast: () => {} });
    const got: { header: Msg; eye: Msg | null; view: Msg | null; at: number }[] = [];
    const phone = createPhoneServer({
      sync: SYNC, feed, onEye: () => {}, log: () => {}, engineMs: 1000, videoDir,
      onEngine: (_jpeg, header, eye, view, at) => got.push({ header, eye, view, at }),
    });
    const { port } = await phone.listen(0, "127.0.0.1");
    cleanups.push(() => phone.close());
    return { feed, got, phoneBase: `http://127.0.0.1:${port}` };
  }

  it("engineMs를 주면 연결 직후 상태에 engine_ms를 싣는다", async () => {
    const { phoneBase } = await engineSetup();
    let status!: ReturnType<typeof next>;
    const ws = await openWebSocket(`${phoneBase.replace(/^http/, "ws")}/phone/events`, { options: { origin: phoneBase }, setup: (s) => { status = next(s, (m) => m.type === "status"); return status.cancel; } });
    expect(await status).toMatchObject({ engine_ms: 1000 });
    ws.close();
  });

  it("engine 패킷은 onEngine으로 가고 표시 화면으로는 가지 않는다. frame 패킷은 관찰 흐름으로 가지 않는다. 맞춘 뒤면 투영과 트윈 원점을 붙인다", async () => {
    const { feed, got, phoneBase } = await engineSetup();
    const ws = await alignedPhone(phoneBase);
    const projection = Array.from({ length: 16 }, (_, i) => (i % 5 === 0 ? 1 : 0));
    ws.send(encodeFramePacket({ kind: "frame", width: 480, height: 360 }, JPEG));
    ws.send(encodeFramePacket({ kind: "engine", width: 480, height: 360, position: [3.9, 1.4, 5], orientation: [0, 0, 0, 1], captured_at: 1000, time_err_ms: 5, projection }, JPEG));
    for (let i = 0; i < 40 && !got.length; i++) await new Promise((r) => setTimeout(r, 25));
    expect(got).toHaveLength(1);
    expect(got[0]!.header).toMatchObject({ kind: "engine", captured_at: 1000 });
    expect(got[0]!.eye).toMatchObject({ position: [3.9, 5], height_m: 1.4 });
    expect(got[0]!.view).toMatchObject({ origin: [3.9, 1.4, 5], projection });
    expect(feed.stats().frames).toBe(1);
    ws.close();
  });

  it("붙잡은 장면 표시(held)는 이 서버가 내주는 영상으로 연 연결(video=<영상>)에서만 넘긴다. 실제 폰·없는 영상 이름의 held는 지운다", async () => {
    const videoDir = mkdtempSync(join(tmpdir(), "phone-videos-"));
    cleanups.push(() => rmSync(videoDir, { recursive: true, force: true }));
    writeFileSync(join(videoDir, "cup-demo.mp4"), "mp4");
    const { got, phoneBase } = await engineSetup(videoDir);
    const send = async (query: string) => {
      const ws = await openWebSocket(`${phoneBase.replace(/^http/, "ws")}/phone/events${query}`, { options: { origin: phoneBase } });
      const before = got.length;
      for (let i = 0; i < 2; i++) ws.send(encodeFramePacket({ kind: "engine", width: 480, height: 360, captured_at: 1000 + i * 100, time_err_ms: 5, held: true }, JPEG));
      for (let i = 0; i < 40 && got.length < before + 2; i++) await new Promise((r) => setTimeout(r, 25));
      ws.close();
      return got.slice(before).map((g) => g.header.held);
    };
    expect(await send("")).toEqual([undefined, undefined]);
    expect(await send("?video=nope.mp4")).toEqual([undefined, undefined]);
    expect(await send("?video=../cup-demo.mp4")).toEqual([undefined, undefined]);
    expect(await send("?video=cup-demo.mp4")).toEqual([true, true]);
  });
});

describe("sameHost", () => {
  it("출처 호스트가 요청 호스트와 같을 때만 받는다", () => {
    expect(sameHost(undefined, "192.168.0.5:8210")).toBe(true);
    expect(sameHost("http://192.168.0.5:8210", "192.168.0.5:8210")).toBe(true);
    expect(sameHost("http://evil.example", "192.168.0.5:8210")).toBe(false);
    expect(sameHost("not a url", "192.168.0.5:8210")).toBe(false);
  });
});

describe("phone server", () => {
  it("위치를 맞춘 뒤의 자세가 본 서버 /events에 eye로 나간다", async () => {
    const { url, phoneBase } = await setup();
    const dash = await openWebSocket(`${url.replace(/^http/, "ws")}/events`);
    let first!: ReturnType<typeof next>;
    const phone = await openWebSocket(`${phoneBase.replace(/^http/, "ws")}/phone/events`, { options: { origin: phoneBase }, setup: (s) => { first = next(s, (m) => m.type === "status"); return first.cancel; } });
    expect((await first).aligned).toBe(false);
    const done = next(phone, (m) => m.type === "status" && m.aligned);
    sendAlign(phone);
    expect((await done).sync).toMatchObject({ state: "aligned", source: "walls", started: true });
    const eye = next(dash, (m) => m.type === "eye");
    phone.send(JSON.stringify({ type: "pose", position: [3.9, 1.4, 5], orientation: [0, 0, 0, 1] }));
    expect((await eye).eye).toMatchObject({ position: [3.9, 5], height_m: 1.4, yaw_deg: 270, pitch_deg: 0, tracking: "ok" });
    dash.close();
    phone.close();
  });

  it("다른 출처의 WebSocket은 거절한다", async () => {
    const { phoneBase } = await setup();
    const ws = new WebSocket(`${phoneBase.replace(/^http/, "ws")}/phone/events`, { origin: "http://evil.example" }); // 시험 소켓: 거절 확인
    await expect(opened(ws)).rejects.toThrow();
  });

  it("ui/dist에서 폰 화면·빌드 파일·브랜드 그림·글꼴 라이선스·파비콘만 준다. 대시보드·설정 화면은 주지 않는다", async () => {
    const phone = createPhoneServer({ sync: SYNC, uiDir: fakeUiDist(), onEye: () => {}, log: () => {} });
    const { port } = await phone.listen(0, "127.0.0.1");
    cleanups.push(() => phone.close());
    const base = `http://127.0.0.1:${port}`;
    expect(await (await fetchRetry(`${base}/phone/`)).text()).toContain("폰 테스트");
    const js = await fetchRetry(`${base}/assets/phone-x.js`);
    expect(js.status).toBe(200);
    expect(js.headers.get("content-type")).toContain("javascript");
    expect((await fetchRetry(`${base}/assets/noto-sans-kr-0-wght-normal-x.woff2`)).headers.get("content-type")).toBe("font/woff2");
    for (const p of ["/brand/mascot@1x.webp", "/favicon.ico", "/fonts/OFL-noto-sans-kr.txt"]) expect((await fetchRetry(`${base}${p}`)).status, p).toBe(200);
    for (const p of ["/index.html", "/setup/", "/setup/index.html", "/api/devices", "/phone/..%2Findex.html", "/brand/..%2Findex.html", "/assets/..%2Fsetup%2Findex.html"]) {
      expect((await fetchRetry(`${base}${p}`)).status, p).toBe(404);
    }
    expect((await fetchRetry(`${base}/`, { redirect: "manual" })).headers.get("location")).toBe("/phone/");
  });

  it("videoDir의 영상을 /phone/videos/<이름>으로 준다: 통째 200, Range 하나면 206, 범위 밖은 416. 이름·확장자가 틀리거나 없는 파일·폴더 밖은 404", async () => {
    const root = mkdtempSync(join(tmpdir(), "phone-videos-"));
    cleanups.push(() => rmSync(root, { recursive: true, force: true }));
    const videoDir = join(root, "videos");
    mkdirSync(videoDir);
    writeFileSync(join(videoDir, "a.mp4"), "0123456789");
    writeFileSync(join(videoDir, "b.webm"), "webm");
    writeFileSync(join(videoDir, "a.exe"), "exe");
    writeFileSync(join(root, "x.mp4"), "outside");
    const phone = createPhoneServer({ sync: SYNC, uiDir: fakeUiDist(), videoDir, onEye: () => {}, log: () => {} });
    const { port } = await phone.listen(0, "127.0.0.1");
    cleanups.push(() => phone.close());
    const url = `http://127.0.0.1:${port}/phone/videos/a.mp4`;

    const whole = await fetchRetry(url);
    expect(whole.status).toBe(200);
    expect(whole.headers.get("content-type")).toBe("video/mp4");
    expect(whole.headers.get("accept-ranges")).toBe("bytes");
    expect(whole.headers.get("content-length")).toBe("10");
    expect(await whole.text()).toBe("0123456789");
    expect((await fetchRetry(`http://127.0.0.1:${port}/phone/videos/b.webm`)).headers.get("content-type")).toBe("video/webm");

    const part = await fetchRetry(url, { headers: { range: "bytes=2-5" } });
    expect(part.status).toBe(206);
    expect(part.headers.get("content-range")).toBe("bytes 2-5/10");
    expect(part.headers.get("content-length")).toBe("4");
    expect(part.headers.get("content-type")).toBe("video/mp4");
    expect(await part.text()).toBe("2345");
    const tail = await fetchRetry(url, { headers: { range: "bytes=7-" } });
    expect([tail.status, tail.headers.get("content-range"), await tail.text()]).toEqual([206, "bytes 7-9/10", "789"]);
    const last = await fetchRetry(url, { headers: { range: "bytes=-3" } });
    expect([last.status, last.headers.get("content-range"), await last.text()]).toEqual([206, "bytes 7-9/10", "789"]);
    const over = await fetchRetry(url, { headers: { range: "bytes=8-99" } });
    expect([over.status, over.headers.get("content-range"), await over.text()]).toEqual([206, "bytes 8-9/10", "89"]);
    const head = await fetchRetry(url, { method: "HEAD", headers: { range: "bytes=2-5" } });
    expect([head.status, head.headers.get("content-range"), head.headers.get("content-length"), await head.text()]).toEqual([206, "bytes 2-5/10", "4", ""]);

    for (const range of ["bytes=20-", "bytes=10-12", "bytes=-0"]) {
      const bad = await fetchRetry(url, { headers: { range } });
      expect(bad.status, range).toBe(416);
      expect(bad.headers.get("content-range"), range).toBe("bytes */10");
    }

    for (const p of ["/phone/videos/../x.mp4", "/phone/videos/..%2Fx.mp4", "/phone/videos/a.exe", "/phone/videos/none.mp4", "/phone/videos/", "/phone/videos/a.mp4/", "/phone/videos/a.b.mp4"]) {
      expect((await fetchRetry(`http://127.0.0.1:${port}${p}`)).status, p).toBe(404);
    }

    const plain = createPhoneServer({ sync: SYNC, uiDir: fakeUiDist(), onEye: () => {}, log: () => {} });
    const other = await plain.listen(0, "127.0.0.1");
    cleanups.push(() => plain.close());
    expect((await fetchRetry(`http://127.0.0.1:${other.port}/phone/videos/a.mp4`)).status).toBe(404);
  });

  it("영상 받기를 도중에 끊으면(다시 읽기·영상 바꾸기) 읽던 파일 스트림을 닫는다", async () => {
    const videoDir = mkdtempSync(join(tmpdir(), "phone-videos-"));
    cleanups.push(() => rmSync(videoDir, { recursive: true, force: true }));
    // 소켓 버퍼에 다 들어가지 않을 만큼 큰 파일
    writeFileSync(join(videoDir, "big.mp4"), Buffer.alloc(32 * 1024 * 1024));
    const phone = createPhoneServer({ sync: SYNC, uiDir: fakeUiDist(), videoDir, onEye: () => {}, log: () => {} });
    const { port } = await phone.listen(0, "127.0.0.1");
    cleanups.push(() => phone.close());
    const from = readStreams.length;
    for (const headers of [{}, { range: "bytes=0-" }, { range: "bytes=1000-" }]) {
      await new Promise<void>((done, fail) => {
        const req = request({ host: "127.0.0.1", port, path: "/phone/videos/big.mp4", headers }, (res) => {
          res.once("data", () => { req.destroy(); done(); });
        });
        req.on("error", (e) => { if (!req.destroyed) fail(e); });
        req.end();
      });
    }
    const mine = readStreams.slice(from).filter((s) => String(s.path).endsWith("big.mp4"));
    expect(mine).toHaveLength(3);
    await vi.waitFor(() => expect(mine.map((s) => s.closed)).toEqual([true, true, true]), { timeout: 3000, interval: 50 });
  });

  it("기본 화면 폴더는 ui/dist", () => {
    expect(DEFAULT_UI_DIR.replace(/\\/g, "/")).toMatch(/\/ui\/dist\/$/);
  });

  it("빌드 전이면 /phone/은 503과 빌드 명령", async () => {
    const empty = mkdtempSync(join(tmpdir(), "phone-ui-empty-"));
    cleanups.push(() => rmSync(empty, { recursive: true, force: true }));
    const phone = createPhoneServer({ sync: SYNC, uiDir: empty, onEye: () => {}, log: () => {} });
    const { port } = await phone.listen(0, "127.0.0.1");
    cleanups.push(() => phone.close());
    const r = await fetchRetry(`http://127.0.0.1:${port}/phone/`);
    expect(r.status).toBe(503);
    expect(await r.text()).toContain("npm run ui:build");
  });

  it("폰 페이지만 주고 기기 API는 없다", async () => {
    const { phoneBase } = await setup();
    const page = await fetchRetry(`${phoneBase}/phone/`);
    expect(page.status).toBe(200);
    expect(await page.text()).toContain("폰 테스트");
    expect((await fetchRetry(`${phoneBase}/api/devices`)).status).toBe(404);
  });
});

describe("폰 판본(hello)과 옛 탭", () => {
  const REFRESH = { type: "command", id: "refresh", step: "refresh", text: "화면을 새로 고쳐 주세요", choices: [], vision: null, target: null, speak: true };
  const PENDING = [{ token: "tok1", deviceLabel: "현관문", reason: "현관문 잠금 해제", choices: BOTH }];
  const CMD: PlannedCommand = {
    type: "command", id: "plan:pam-1", step: "plan:pam-1:2", text: "컵을 들어 주세요", vision: "컵 · 식탁 위", choices: [{ id: "done", label: "완료" }],
    target: { id: "cup_1", label: "컵", position: [1, 0.9, 3.7] }, speak: true, kind: "pick",
  };
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
  async function protoSetup(onNavigationPose?: (p:import("../src/contract/phone.js").NavigationPose)=>void) {
    const got = { choices: [] as string[][], said: [] as string[], confirmed: [] as string[], cancelled: [] as string[], answered: [] as [string, unknown][], engine: 0 };
    const phone = createPhoneServer({
      sync: SYNC, onEye: () => {}, onNavigationPose, log: () => {},
      onChoice: (id, step, choice) => got.choices.push([id, step, choice]),
      onSay: async (text) => { got.said.push(text); return { reply: "에이전트", pending: [] }; },
      onAnswer: (text, at) => { got.answered.push([text, at]); return { handled: false }; },
      onConfirm: async (token) => { got.confirmed.push(token); return { reply: "확정" }; },
      onCancel: async (token) => { got.cancelled.push(token); return { reply: "취소" }; },
      onEngine: () => { got.engine++; },
      pending: () => PENDING,
    });
    const { port } = await phone.listen(0, "127.0.0.1");
    cleanups.push(() => phone.close());
    return { phone, got, base: `http://127.0.0.1:${port}` };
  }
  /** hello 없이 연다(옛 탭). */
  async function tab(base: string) {
    const box: Msg[] = [];
    const ws = await openWebSocket(`${base.replace(/^http/, "ws")}/phone/events`, { options: { origin: base }, setup: (s) => s.on("message", (d, bin) => { if (!bin) box.push(JSON.parse(String(d)) as Msg); }) });
    cleanups.push(() => ws.close());
    return { ws, box };
  }
  it("sends portal coordinates only to the aligned navigation phone and clears them on loss",async()=>{
    const poses:import("../src/contract/phone.js").NavigationPose[]=[];
    const {phone,base}=await protoSetup(p=>poses.push(p));
    const a=await tab(base);
    const send=(m:unknown)=>a.ws.send(JSON.stringify(m));
    const fixed={epoch:"walk",position:[0,1.5,0],orientation:[0,0,0,1]};
    send({type:"hello",protocol:PHONE_PROTOCOL});
    send({type:"start",...fixed,fixed:true});
    send({type:"pose",...fixed,captured_at:Date.now(),tracking:"ok"});
    await vi.waitFor(()=>expect(poses.at(-1)?.quality).toBe("usable"));
    phone.command({...CMD,kind:"go",guide:{pose_gen:poses.at(-1)!.pose_gen,revision:1,near_m:0.32,remaining:[
      {kind:"portal",id:"door",from_room:"a",to_room:"b",position:[1,0,2]},
      {kind:"stand",room:"b",position:[2,0,3]}]}});
    await vi.waitFor(()=>expect(a.box.at(-1)).toMatchObject({type:"command",target:{id:"cup_1"},guide:{remaining:[
      {id:"door",kind:"portal",ar:expect.any(Array)},{kind:"stand",ar:expect.any(Array)}]}}));
    const b=await tab(base);
    b.ws.send(JSON.stringify({type:"hello",protocol:PHONE_PROTOCOL}));
    await vi.waitFor(()=>expect(b.box).toContainEqual(expect.objectContaining({type:"command",guide:null})));
    send({type:"pose",...fixed,captured_at:Date.now(),tracking:"limited"});
    await vi.waitFor(()=>expect(poses.at(-1)?.quality).toBe("unavailable"));
  });

  const answers = (ws: WebSocket) => {
    ws.send(JSON.stringify({ type: "answer", id: "plan:pam-1", step: "plan:pam-1:2", choice: "done" }));
    ws.send(JSON.stringify({ type: "say", text: "완료", at: { kind: "command", id: "plan:pam-1", step: "plan:pam-1:2", pending: [] } }));
    ws.send(JSON.stringify({ type: "confirm", token: "tok1", choice: "approve" }));
    ws.send(JSON.stringify({ type: "cancel", token: "tok1" }));
  };

  it("판본 없는 폰 탭은 상태(protocol)만 받고 2초 뒤 「화면을 새로 고쳐 주세요」를 받는다. 계획 명령은 받지 않고 그 탭의 answer·say·confirm·cancel은 받지 않는다(관찰 사진은 받는다)", async () => {
    const { phone, got, base } = await protoSetup();
    phone.command(CMD);
    const old = await tab(base);
    await wait(300);
    expect(old.box).toEqual([expect.objectContaining({ type: "status", protocol: PHONE_PROTOCOL })]);
    expect(phone.ready()).toBe(false);
    await wait(2000);
    expect(old.box.slice(1)).toEqual([REFRESH]);
    answers(old.ws);
    old.ws.send(encodeFramePacket({ kind: "engine", width: 4, height: 3 }, JPEG));
    phone.command({ ...CMD, step: "plan:pam-1:3", text: "싱크대로 가 주세요" });
    await wait(300);
    expect(got).toMatchObject({ choices: [], said: [], confirmed: [], cancelled: [], answered: [], engine: 1 });
    expect(old.box.slice(1)).toEqual([REFRESH]);
  });

  it("protocol이 다른 hello도 옛 탭이다: 2초를 기다리지 않고 새로 고침 안내를 받는다", async () => {
    const { phone, base } = await protoSetup();
    phone.command(CMD);
    const old = await tab(base);
    old.ws.send(JSON.stringify({ type: "hello", protocol: PHONE_PROTOCOL - 1 }));
    await wait(300);
    expect(old.box.slice(1)).toEqual([REFRESH]);
    expect(phone.ready()).toBe(false);
  });

  it("가까이 가서 보기 칸(near_m·view)을 모르는 판본 3 탭은 옛 탭이다: 새로 고침 안내를 받고 그 탭으로는 명령을 보내지 않는다", async () => {
    const { phone, base } = await protoSetup();
    phone.command(CMD);
    const old = await tab(base);
    old.ws.send(JSON.stringify({ type: "hello", protocol: 3 }));
    await wait(300);
    expect(PHONE_PROTOCOL).toBe(5);
    expect(old.box.slice(1)).toEqual([REFRESH]);
    expect(phone.ready()).toBe(false);
  });

  it("늦은 hello는 연결을 정상으로 되돌린다: 새로 고침 안내를 지우고 처음 보낸 명령 전체(kind·target(AR)·vision)와 승인 대기 목록을 다시 보내며, 그 뒤 답을 받는다", async () => {
    const { phone, got, base } = await protoSetup();
    const late = await tab(base);
    const aligned = next(late.ws, (m) => m.type === "status" && m.aligned);
    sendAlign(late.ws);
    await aligned;
    phone.command(CMD);
    await wait(2100);
    expect(late.box.filter((m) => m.type !== "status")).toEqual([REFRESH]);
    const n = late.box.length;
    late.ws.send(JSON.stringify({ type: "hello", protocol: PHONE_PROTOCOL }));
    for (const end = Date.now() + 2000; late.box.length < n + 3 && Date.now() < end; ) await wait(20);
    expect(late.box.slice(n)).toEqual([
      { type: "command_clear", id: "refresh" },
      { ...CMD, target: { id: "cup_1", label: "컵", ar: [1, 0.9, 3.7] }, speak: false },
      { type: "reply", text: "", pending: PENDING },
    ]);
    expect(phone.ready()).toBe(true);
    late.ws.send(JSON.stringify({ type: "answer", id: "plan:pam-1", step: "plan:pam-1:2", choice: "done" }));
    for (const end = Date.now() + 2000; !got.choices.length && Date.now() < end; ) await wait(20);
    expect(got.choices).toEqual([["plan:pam-1", "plan:pam-1:2", "done"]]);
    // 그 뒤 계획 명령도 받는다
    const more = next(late.ws, (m) => m.type === "command" && m.step === "plan:pam-1:3");
    phone.command({ ...CMD, step: "plan:pam-1:3" });
    await more;
  });

  it("판본이 맞는 첫 hello마다 지금 명령과 지금 승인 대기 목록을 보낸다(새로 연 폰도 대기 중인 질문을 본다)", async () => {
    const { phone, base } = await protoSetup();
    phone.command(CMD);
    const box: Msg[] = [];
    const ws = await openPhone(`${base.replace(/^http/, "ws")}/phone/events`, { options: { origin: base }, setup: (s) => s.on("message", (d, bin) => { if (!bin) box.push(JSON.parse(String(d)) as Msg); }) });
    cleanups.push(() => ws.close());
    for (const end = Date.now() + 2000; box.length < 3 && Date.now() < end; ) await wait(20);
    expect(box).toEqual([expect.objectContaining({ type: "status" }), { ...CMD, target: null, speak: false }, { type: "reply", text: "", pending: PENDING }]);
  });

  it("reply(text)는 판본이 맞는 붙은 폰 모두에 pending 없는 reply를 보내고 옛 탭에는 보내지 않는다", async () => {
    const { phone, base } = await protoSetup();
    const url = `${base.replace(/^http/, "ws")}/phone/events`;
    const boxes: Msg[][] = [[], []];
    const ws = await Promise.all(boxes.map((box) => openPhone(url, { options: { origin: base }, setup: (s) => s.on("message", (d, bin) => { if (!bin) box.push(JSON.parse(String(d)) as Msg); }) })));
    for (const s of ws) cleanups.push(() => s.close());
    const old = await tab(base);
    for (const end = Date.now() + 2000; !phone.ready() && Date.now() < end; ) await wait(20);
    phone.reply("인덕션이 다시 켜졌어요. 꺼 주세요");
    const said = (box: Msg[]) => box.filter((m) => m.type === "reply" && m.text !== "");
    for (const end = Date.now() + 2000; boxes.some((b) => !said(b).length) && Date.now() < end; ) await wait(20);
    for (const box of boxes) expect(said(box)).toEqual([{ type: "reply", text: "인덕션이 다시 켜졌어요. 꺼 주세요" }]);
    await wait(100);
    expect(old.box.filter((m) => m.type === "reply")).toEqual([]);
  });

  it("말(say)의 at을 onAnswer에 넘긴다. at 칸이 없거나 모양이 틀리면 at 없이 넘긴다(옛 탭과 같다)", async () => {
    const { got, base } = await protoSetup();
    const ws = await openPhone(`${base.replace(/^http/, "ws")}/phone/events`, { options: { origin: base } });
    cleanups.push(() => ws.close());
    const at = { kind: "command", id: "plan:pam-1", step: "plan:pam-1:2", pending: ["tok1"] };
    ws.send(JSON.stringify({ type: "say", text: "완료", at }));
    ws.send(JSON.stringify({ type: "say", text: "다 했어", at: { kind: "none", pending: [] } }));
    ws.send(JSON.stringify({ type: "say", text: "승인" }));
    ws.send(JSON.stringify({ type: "say", text: "그만", at: { kind: "command", id: 3, pending: [] } }));
    for (const end = Date.now() + 2000; got.answered.length < 4 && Date.now() < end; ) await wait(20);
    expect(got.answered).toEqual([["완료", at], ["다 했어", { kind: "none", pending: [] }], ["승인", undefined], ["그만", undefined]]);
  });
});

describe("폰 대화·승인·초점", () => {
  async function talkSetup() {
    const said: string[] = [];
    const confirmed: [string, string][] = [];
    const picked: string[][] = [];
    const phone = createPhoneServer({
      sync: SYNC, onEye: () => {}, log: () => {},
      onChoice: (id, step, choice) => picked.push([id, step, choice]),
      onSay: async (text) => {
        said.push(text);
        return { reply: "현관문 잠금 해제는 승인이 필요해요.", pending: [{ token: "tok1", deviceLabel: "현관문", reason: "현관문 잠금 해제", choices: BOTH }] };
      },
      onConfirm: async (token, choice) => {
        confirmed.push([token, choice]);
        return { reply: "현관문을 열었어요." };
      },
      onCancel: async (token) => ({ reply: `취소했어요(${token}).` }),
    });
    const { port } = await phone.listen(0, "127.0.0.1");
    cleanups.push(() => phone.close());
    return { phone, said, confirmed, picked, phoneBase: `http://127.0.0.1:${port}` };
  }

  it("answer(답 단추)는 id·step·choice를 onChoice로 넘기고, 모양이 틀리거나 너무 길면 버린다", async () => {
    const { phoneBase, picked } = await talkSetup();
    const ws = await alignedPhone(phoneBase);
    ws.send(JSON.stringify({ type: "answer", id: "plan:pam-1", step: "plan:pam-1:2", choice: "done" }));
    ws.send(JSON.stringify({ type: "answer", id: "plan:pam-1", choice: "done" }));
    ws.send(JSON.stringify({ type: "answer", id: "x".repeat(65), step: "plan:pam-1:2", choice: "done" }));
    ws.send(JSON.stringify({ type: "answer", id: "plan:pam-1", step: "plan:pam-1:2", choice: 1 }));
    ws.send(JSON.stringify({ type: "brain_reply", id: "plan:pam-1", choice: "done" }));
    ws.send(JSON.stringify({ type: "answer", id: "plan:pam-1", step: "plan:pam-1:3", choice: "done" }));
    for (const end = Date.now() + 2000; picked.length < 2 && Date.now() < end; ) await new Promise((r) => setTimeout(r, 20));
    expect(picked).toEqual([["plan:pam-1", "plan:pam-1:2", "done"], ["plan:pam-1", "plan:pam-1:3", "done"]]);
  });

  it("say는 에이전트 답과 승인 대기를 reply로 돌려주고, confirm·cancel은 그대로 넘긴다", async () => {
    const { phoneBase, said, confirmed } = await talkSetup();
    const ws = await alignedPhone(phoneBase);
    let got = next(ws, (m) => m.type === "reply");
    ws.send(JSON.stringify({ type: "say", text: "  현관문 열어줘 " }));
    expect(await got).toEqual({ type: "reply", text: "현관문 잠금 해제는 승인이 필요해요.", pending: [{ token: "tok1", deviceLabel: "현관문", reason: "현관문 잠금 해제", choices: BOTH }] });
    expect(said).toEqual(["현관문 열어줘"]);
    got = next(ws, (m) => m.type === "reply");
    ws.send(JSON.stringify({ type: "confirm", token: "tok1" }));
    // 승인·취소의 답은 승인 대기 칸을 싣지 않는다(남은 승인 대기를 실제 폰이 지우지 않게)
    expect(await got).toEqual({ type: "reply", text: "현관문을 열었어요." });
    // 답(choice)이 없으면 승인
    expect(confirmed).toEqual([["tok1", "approve"]]);
    got = next(ws, (m) => m.type === "reply");
    ws.send(JSON.stringify({ type: "cancel", token: "tok2" }));
    expect((await got).text).toBe("취소했어요(tok2).");
    got = next(ws, (m) => m.type === "reply");
    ws.send(JSON.stringify({ type: "say", text: "   " }));
    expect((await got).text).toMatch(/말이 비어/);
  });

  it("confirm의 답(승인·거절)을 onConfirm에 그대로 넘기고, 모르는 답(예전 이번만·앞으로도·하지 마 포함)은 넘기지 않는다", async () => {
    const { phoneBase, confirmed } = await talkSetup();
    const ws = await alignedPhone(phoneBase);
    for (const choice of ["reject", "approve"]) {
      const got = next(ws, (m) => m.type === "reply");
      ws.send(JSON.stringify({ type: "confirm", token: `tok-${choice}`, choice }));
      await got;
    }
    for (const choice of ["forever", "once", "always", "never"]) {
      const got = next(ws, (m) => m.type === "reply");
      ws.send(JSON.stringify({ type: "confirm", token: "tok-x", choice }));
      expect((await got).text, choice).toBe("승인할 작업을 찾지 못했어요.");
    }
    expect(confirmed).toEqual([["tok-reject", "reject"], ["tok-approve", "approve"]]);
  });

  /** 붙자마자 받는 메시지 n개. */
  async function connect(phoneBase: string, n: number) {
    const box: Msg[] = [];
    const ws = await openWebSocket(`${phoneBase.replace(/^http/, "ws")}/phone/events`, { options: { origin: phoneBase }, setup: (s) => s.on("message", (d) => box.push(JSON.parse(String(d)) as Msg)) });
    cleanups.push(() => ws.close());
    ws.send(JSON.stringify({ type: "hello", protocol: PHONE_PROTOCOL }));
    for (const end = Date.now() + 2000; box.length < n && Date.now() < end; ) await new Promise((r) => setTimeout(r, 20));
    return { ws, box };
  }

  it("command: 실제 폰 모두에 보내고 지금 명령으로 둔다. 새로 붙은 폰은 상태 다음에 지금 명령을 읽지 않게 받고, 그 명령을 지우면 command_clear", async () => {
    const { phone, phoneBase } = await talkSetup();
    const first = await connect(phoneBase, 2);
    expect(first.box).toEqual([expect.objectContaining({ type: "status" }), { type: "command_clear" }]);
    const cmd: PlannedCommand = { type: "command", id: "plan:pam-1", step: "plan:pam-1:1", text: "식탁으로 가 주세요", vision: "식탁까지 2.4m", choices: [{ id: "done", label: "완료" }], target: null, speak: true };
    let got = next(first.ws, (m) => m.type === "command");
    phone.command(cmd);
    expect(await got).toEqual(cmd);
    got = next(first.ws, (m) => m.type === "command" && m.vision === "식탁까지 1.8m");
    phone.command({ ...cmd, vision: "식탁까지 1.8m", speak: false });
    await got;
    const later = await connect(phoneBase, 2);
    expect(later.box).toEqual([expect.objectContaining({ type: "status" }), { ...cmd, vision: "식탁까지 1.8m", speak: false }]);
    // 다른 명령을 지우는 말은 지금 명령을 그대로 둔다
    got = next(first.ws, (m) => m.type === "command_clear");
    phone.command({ type: "command_clear", id: "plan:pam-0" });
    expect(await got).toEqual({ type: "command_clear", id: "plan:pam-0" });
    expect((await connect(phoneBase, 2)).box[1]).toMatchObject({ type: "command", id: "plan:pam-1" });
    got = next(first.ws, (m) => m.type === "command_clear" && m.id === "plan:pam-1");
    phone.command({ type: "command_clear", id: "plan:pam-1" });
    await got;
    expect((await connect(phoneBase, 2)).box[1]).toEqual({ type: "command_clear" });
  });

  it("명령 대상: 트윈 자리를 맞춘 변환으로 AR 자리로 바꿔 보낸다. 맞추기 전에는 null이고, 맞추면 지금 명령을 대상과 함께 다시 보낸다", async () => {
    const { phone, phoneBase } = await talkSetup();
    const first = await connect(phoneBase, 2);
    const cmd: PlannedCommand = {
      type: "command", id: "plan:pam-1", step: "plan:pam-1:2", text: "컵을 들어 주세요", vision: "컵 · 식탁 위", choices: [{ id: "done", label: "완료" }],
      target: { id: "cup_1", label: "컵", position: [1, 0.9, 3.7] }, speak: true,
    };
    let got = next(first.ws, (m) => m.type === "command");
    phone.command(cmd);
    expect(await got).toEqual({ ...cmd, target: null });
    got = next(first.ws, (m) => m.type === "command" && m.target !== null);
    sendAlign(first.ws);
    expect(await got).toEqual({ ...cmd, target: { id: "cup_1", label: "컵", ar: [1, 0.9, 3.7] }, speak: false });
    const later = await connect(phoneBase, 2);
    expect(later.box[1]).toEqual({ ...cmd, target: { id: "cup_1", label: "컵", ar: [1, 0.9, 3.7] }, speak: false });
  });

  it("관찰 자리 가기의 비출 곳(target.look)도 맞춘 변환으로 AR 자리로 바꿔 보낸다. 없는 명령에는 칸을 만들지 않는다", async () => {
    const { phone, phoneBase } = await talkSetup();
    const first = await connect(phoneBase, 2);
    const cmd: PlannedCommand = {
      type: "command", id: "visit:1", step: "visit:1:go", text: "주방 입구로 이동해 냉장고 앞을 비춰 주세요.", vision: null, choices: [], kind: "go",
      target: { id: "kitchen_entry", label: "주방 입구", position: [1, 0, 3.7], look: [0.5, 0.6, 3.2] }, speak: true,
    };
    const got = next(first.ws, (m) => m.type === "command" && m.target !== null);
    sendAlign(first.ws);
    phone.command(cmd);
    expect(await got).toMatchObject({ target: { id: "kitchen_entry", label: "주방 입구", ar: [1, 0, 3.7], look: [0.5, 0.6, 3.2] } });
    const plain = next(first.ws, (m) => m.type === "command" && m.id === "visit:2");
    phone.command({ ...cmd, id: "visit:2", target: { id: "kitchen_entry", label: "주방 입구", position: [1, 0, 3.7] } });
    expect((await plain).target).not.toHaveProperty("look");
  });

  it("소리 등급(grade): 실행 추적이 붙인 등급을 그대로 보내고, 없는 명령에는 칸을 만들지 않는다. reply(text, \"safety\")는 safety를 싣는다", async () => {
    const { phone, phoneBase } = await talkSetup();
    const first = await connect(phoneBase, 2);
    const base: PlannedCommand = { type: "command", id: "plan:pam-1", step: "plan:pam-1:1", text: "식탁으로 가 주세요", vision: null, choices: [{ id: "done", label: "완료" }], target: null, speak: true };
    const cases: PlannedCommand[] = [
      { ...base, step: "plan:pam-1:12", text: "인덕션을 꺼 주세요", grade: "safety" },
      { ...base, step: "plan:pam-1:7:hand", text: "냄비와 상판이 뜨거워져요. 인덕션을 켤까요?", choices: [{ id: "approve", label: "승인" }, { id: "reject", label: "거절" }], grade: "question" },
      base,
    ];
    for (const cmd of cases) {
      const got = next(first.ws, (m) => m.type === "command" && m.step === cmd.step);
      phone.command(cmd);
      expect(await got, cmd.step).toEqual(cmd);
    }
    let said = next(first.ws, (m) => m.type === "reply");
    phone.reply("인덕션이 다시 켜졌어요. 꺼 주세요", "safety");
    expect(await said).toEqual({ type: "reply", text: "인덕션이 다시 켜졌어요. 꺼 주세요", grade: "safety" });
    said = next(first.ws, (m) => m.type === "reply");
    phone.reply("네 알겠어요");
    expect(await said).toEqual({ type: "reply", text: "네 알겠어요" });
  });

  it("실제 폰 위에는 명령만 보낸다: 판단·관찰 말풍선 글(brain_line)을 보내지 않는다", async () => {
    const { phone, phoneBase } = await talkSetup();
    const { box } = await connect(phoneBase, 2);
    await new Promise((r) => setTimeout(r, 200));
    expect(box.map((m) => m.type)).toEqual(["status", "command_clear"]);
    expect("setLine" in phone).toBe(false);
  });

  it("here()는 폰이 보낸 조준점, sendFocus는 트윈 좌표를 AR 좌표로 바꿔 폰에 보낸다", async () => {
    const { phone, phoneBase } = await talkSetup();
    const ws = await alignedPhone(phoneBase);
    expect(phone.here()).toEqual({ error: expect.stringMatching(/폰 AR/) });
    ws.send(JSON.stringify({ type: "pose", position: [3, 1.4, 4], orientation: [0, 0, 0, 1], hit: [2, 0, 3] }));
    const end = Date.now() + 2000;
    while (!("position" in phone.here()) && Date.now() < end) await new Promise((r) => setTimeout(r, 20));
    expect(phone.here()).toEqual({ position: [2, 3], from: [3, 4] });
    const got = next(ws, (m) => m.type === "focus");
    phone.sendFocus([{ id: "tv_1", label: "TV", position: [1, 0.9, 3.7] }], 8000);
    expect(await got).toEqual({ type: "focus", targets: [{ id: "tv_1", label: "TV", ar: [1, 0.9, 3.7] }], ttl_ms: 8000 });
  });
});
