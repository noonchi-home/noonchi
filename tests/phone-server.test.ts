import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import type { AnchorTarget } from "../src/phone/anchors.js";
import { EyeFeed } from "../src/phone/feed.js";
import { encodeFramePacket } from "../src/phone/packet.js";
import { createPhoneServer, sameHost } from "../src/phone/server.js";
import { createApp, type TwinHomeApp } from "../src/server/app.js";
import { fetchRetry } from "../src/server/net.js";
import { ROOMS, makeHome } from "./helpers/home.js";
import { readVideo } from "./helpers/video.js";

type Msg = Record<string, any>;
const TARGETS: AnchorTarget[] = [
  { id: "dock", label: "도크", plan: [3.9, 5.51] },
  { id: "door_main", label: "현관문 문턱 가운데", plan: [2.4, 3.55] },
];
const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()!();
});

const opened = (ws: WebSocket) =>
  new Promise<void>((res, rej) => {
    ws.once("open", () => res());
    ws.once("error", rej);
  });

function next(ws: WebSocket, pred: (m: Msg) => boolean): Promise<Msg> {
  return new Promise((res, rej) => {
    const timer = setTimeout(() => rej(new Error("메시지가 오지 않았습니다")), 3000);
    ws.on("message", (d) => {
      const m = JSON.parse(String(d)) as Msg;
      if (pred(m)) {
        clearTimeout(timer);
        res(m);
      }
    });
  });
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
  const webDir = mkdtempSync(join(tmpdir(), "phone-web-"));
  cleanups.push(() => rmSync(webDir, { recursive: true, force: true }));
  writeFileSync(join(webDir, "index.html"), "<title>폰 테스트</title>");
  const phone = createPhoneServer({ targets: TARGETS, webDir, feed, onEye: (eye) => main.broadcast({ type: "eye", eye }), log: opts.log ?? (() => {}) });
  const { port } = await phone.listen(0, "127.0.0.1");
  cleanups.push(() => phone.close());
  return { url, phoneBase: `http://127.0.0.1:${port}` };
}

const JPEG = Buffer.from([0xff, 0xd8, 0x12, 0x34, 0xff, 0xd9]);

async function alignedPhone(phoneBase: string) {
  const phone = new WebSocket(`${phoneBase.replace(/^http/, "ws")}/phone/events`, { origin: phoneBase });
  await opened(phone);
  const done = next(phone, (m) => m.type === "status" && m.aligned);
  phone.send(JSON.stringify({ type: "anchor", id: "dock", point: [3.9, 0, 5.51] }));
  phone.send(JSON.stringify({ type: "anchor", id: "door_main", point: [2.4, 0, 3.55] }));
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
    const dash = new WebSocket(`${url.replace(/^http/, "ws")}/events`);
    await opened(dash);
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
    const phone = new WebSocket(`${phoneBase.replace(/^http/, "ws")}/phone/events`, { origin: phoneBase });
    await opened(phone);
    const reply = next(phone, (m) => m.type === "status" && m.error);
    phone.send(encodeFramePacket({ kind: "frame", width: 640, height: 480 }, Buffer.from([1, 2])));
    expect((await reply).error).toBe("JPEG가 아닙니다");
    phone.close();
  });

  it("video_config·video 패킷은 본 서버 /api/eye/video로 중계되고, 폰이 끊기면 end", async () => {
    const { url, phoneBase } = await setup();
    const v = await readVideo(`${url}/api/eye/video`);
    const phone = new WebSocket(`${phoneBase.replace(/^http/, "ws")}/phone/events`, { origin: phoneBase });
    await opened(phone);
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

  it("깨진 영상 패킷은 이유를 돌려준다", async () => {
    const { phoneBase } = await setup();
    const phone = new WebSocket(`${phoneBase.replace(/^http/, "ws")}/phone/events`, { origin: phoneBase });
    await opened(phone);
    const reply = next(phone, (m) => m.type === "status" && m.error);
    phone.send(encodeFramePacket({ kind: "video_config", width: 592, height: 1280 } as never, Buffer.alloc(0)));
    expect((await reply).error).toContain("codec");
    phone.close();
  });

  it("폰 연결·끊김을 로그에 한 줄씩 남긴다", async () => {
    const lines: string[] = [];
    const { phoneBase } = await setup({ log: (m) => lines.push(m) });
    const phone = new WebSocket(`${phoneBase.replace(/^http/, "ws")}/phone/events`, { origin: phoneBase });
    await opened(phone);
    const closed = new Promise((r) => phone.once("close", r));
    phone.close();
    await closed;
    for (let i = 0; i < 20 && !lines.some((l) => l.includes("끊김")); i++) await new Promise((r) => setTimeout(r, 25));
    expect(lines.filter((l) => l.startsWith("[phone]"))).toEqual(["[phone] 폰 연결(지금 1대)", "[phone] 폰 끊김(지금 0대)"]);
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
  it("기준점 두 곳 뒤의 자세가 본 서버 /events에 eye로 나간다", async () => {
    const { url, phoneBase } = await setup();
    const dash = new WebSocket(`${url.replace(/^http/, "ws")}/events`);
    await opened(dash);
    const phone = new WebSocket(`${phoneBase.replace(/^http/, "ws")}/phone/events`, { origin: phoneBase });
    const first = next(phone, (m) => m.type === "status");
    await opened(phone);
    expect((await first).aligned).toBe(false);
    const done = next(phone, (m) => m.type === "status" && m.aligned);
    phone.send(JSON.stringify({ type: "anchor", id: "dock", point: [3.9, 0, 5.51] }));
    phone.send(JSON.stringify({ type: "anchor", id: "door_main", point: [2.4, 0, 3.55] }));
    expect((await done).mismatch_m).toBe(0);
    const eye = next(dash, (m) => m.type === "eye");
    phone.send(JSON.stringify({ type: "pose", position: [3.9, 1.4, 5], orientation: [0, 0, 0, 1] }));
    expect((await eye).eye).toMatchObject({ position: [3.9, 5], height_m: 1.4, yaw_deg: 270, pitch_deg: 0, tracking: "ok" });
    dash.close();
    phone.close();
  });

  it("다른 출처의 WebSocket은 거절한다", async () => {
    const { phoneBase } = await setup();
    const ws = new WebSocket(`${phoneBase.replace(/^http/, "ws")}/phone/events`, { origin: "http://evil.example" });
    await expect(opened(ws)).rejects.toThrow();
  });

  it("web/phone의 실제 페이지와 스크립트를 준다", async () => {
    const phone = createPhoneServer({ targets: TARGETS, onEye: () => {}, log: () => {} });
    const { port } = await phone.listen(0, "127.0.0.1");
    cleanups.push(() => phone.close());
    const page = await fetchRetry(`http://127.0.0.1:${port}/phone/`);
    expect(await page.text()).toContain("클로이드의 눈");
    const script = await fetchRetry(`http://127.0.0.1:${port}/phone/phone.js`);
    expect(script.status).toBe(200);
    expect(script.headers.get("content-type")).toContain("javascript");
  });

  it("폰 페이지만 주고 기기 API는 없다", async () => {
    const { phoneBase } = await setup();
    const page = await fetchRetry(`${phoneBase}/phone/`);
    expect(page.status).toBe(200);
    expect(await page.text()).toContain("폰 테스트");
    expect((await fetchRetry(`${phoneBase}/api/devices`)).status).toBe(404);
  });
});

describe("폰 대화·승인·초점", () => {
  async function talkSetup() {
    const said: string[] = [];
    const confirmed: string[] = [];
    const webDir = mkdtempSync(join(tmpdir(), "phone-web-"));
    cleanups.push(() => rmSync(webDir, { recursive: true, force: true }));
    writeFileSync(join(webDir, "index.html"), "<title>폰</title>");
    const phone = createPhoneServer({
      targets: TARGETS, webDir, onEye: () => {}, log: () => {},
      onSay: async (text) => {
        said.push(text);
        return { reply: "현관문 잠금 해제는 승인이 필요해요.", pending: [{ token: "tok1", deviceLabel: "현관문", reason: "현관문 잠금 해제" }] };
      },
      onConfirm: async (token) => {
        confirmed.push(token);
        return { reply: "현관문을 열었어요." };
      },
      onCancel: async (token) => ({ reply: `취소했어요(${token}).` }),
    });
    const { port } = await phone.listen(0, "127.0.0.1");
    cleanups.push(() => phone.close());
    return { phone, said, confirmed, phoneBase: `http://127.0.0.1:${port}` };
  }

  it("say는 에이전트 답과 승인 대기를 reply로 돌려주고, confirm·cancel은 그대로 넘긴다", async () => {
    const { phoneBase, said, confirmed } = await talkSetup();
    const ws = await alignedPhone(phoneBase);
    let got = next(ws, (m) => m.type === "reply");
    ws.send(JSON.stringify({ type: "say", text: "  현관문 열어줘 " }));
    expect(await got).toEqual({ type: "reply", text: "현관문 잠금 해제는 승인이 필요해요.", pending: [{ token: "tok1", deviceLabel: "현관문", reason: "현관문 잠금 해제" }] });
    expect(said).toEqual(["현관문 열어줘"]);
    got = next(ws, (m) => m.type === "reply");
    ws.send(JSON.stringify({ type: "confirm", token: "tok1" }));
    expect((await got).text).toBe("현관문을 열었어요.");
    expect(confirmed).toEqual(["tok1"]);
    got = next(ws, (m) => m.type === "reply");
    ws.send(JSON.stringify({ type: "cancel", token: "tok2" }));
    expect((await got).text).toBe("취소했어요(tok2).");
    got = next(ws, (m) => m.type === "reply");
    ws.send(JSON.stringify({ type: "say", text: "   " }));
    expect((await got).text).toMatch(/말이 비어/);
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
