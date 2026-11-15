// startServer가 PHONE_PORT를 보고 폰 AR 서버를 함께 띄우는지(HUB=memory로 빠르게).

import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { estimateViewpoint } from "../src/phone/session.js";
import { alignOnServer } from "./helpers/align.js";
import { fetchRetry } from "../src/server/net.js";
import { startServer, type RunningServer } from "../src/server/start.js";
import { PHONE_PROTOCOL } from "../src/phone/protocol.js";

type Msg = Record<string, any>;
let srv: RunningServer | undefined;
afterEach(async () => {
  await srv?.close();
  srv = undefined;
});

const baseEnv = () => ({ HUB: "memory", PORT: "0", RUNTIME_DIR: mkdtempSync(join(tmpdir(), "rt-")) });

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
const opened = (ws: WebSocket) => new Promise<void>((res, rej) => { ws.once("open", () => res()); ws.once("error", rej); });

describe("startServer + 폰 AR", () => {
  it("PHONE_PORT가 있으면 폰 서버를 함께 띄우고 눈 자세를 본 서버 /events로 보낸다", async () => {
    srv = await startServer({ env: { ...baseEnv(), PHONE_PORT: "0", PHONE_HOST: "127.0.0.1" }, log: () => {} });
    expect(srv.phoneUrls).toHaveLength(1);
    expect(((await (await fetchRetry(`${srv.url}/api/health`)).json()) as { phone_urls?: string[] }).phone_urls).toEqual(srv.phoneUrls);
    const phoneUrl = new URL(srv.phoneUrls[0]!);
    // 시작 위치: 기본 집(아파트) 가장 넓은 방 창가 안쪽
    const scenePath = join(srv.twin.dir, "apartment", "scene.json");
    const spot = estimateViewpoint(JSON.parse(readFileSync(scenePath, "utf8"))).position;

    const dash = new WebSocket(`${srv.url.replace(/^http/, "ws")}/events`);
    await opened(dash);
    const phone = new WebSocket(`ws://${phoneUrl.host}/phone/events`, { origin: phoneUrl.origin });
    await opened(phone);
    phone.send(JSON.stringify({ type: "hello", protocol: PHONE_PROTOCOL }));
    const aligned = next(phone, (m) => m.type === "status" && m.aligned);
    await alignOnServer(srv.url, (t) => phone.send(t), scenePath, spot);
    await aligned;
    const eye = next(dash, (m) => m.type === "eye" && m.eye.estimated === undefined);
    phone.send(JSON.stringify({ type: "pose", position: [spot[0], 1.3, spot[1]], orientation: [0, 0, 0, 1] }));
    const got = (await eye).eye;
    expect(got.position[0]).toBeCloseTo(spot[0], 2);
    expect(got.position[1]).toBeCloseTo(spot[1], 2);
    expect(got.height_m).toBeCloseTo(1.3, 2);
    dash.close();
    phone.close();
  });

  it("tailscale serve 주소를 와이파이 주소보다 앞에, PHONE_URL은 맨 앞에 둔다", async () => {
    const ts = "https://phone-pc.example-net.ts.net/phone/";
    const ports: number[] = [];
    srv = await startServer({
      env: { ...baseEnv(), PHONE_PORT: "0", PHONE_HOST: "127.0.0.1", PHONE_URL: "https://my.example/phone/" }, log: () => {},
      servedPhoneUrls: async (port) => { ports.push(port); return [ts]; },
    });
    expect(ports).toEqual([new URL(srv.phoneUrls[2]!).port].map(Number));
    expect(srv.phoneUrls.slice(0, 2)).toEqual(["https://my.example/phone/", ts]);
    expect(srv.phoneUrls[2]).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/phone\/$/);
    expect(((await (await fetchRetry(`${srv.url}/api/health`)).json()) as { phone_urls?: string[] }).phone_urls).toEqual(srv.phoneUrls);
  });

  it("PHONE_LAN_URLS=0(컨테이너)이면 이 기계 네트워크 주소는 빼고 밖에서 열 수 있는 PHONE_URL·tailscale 주소만 둔다", async () => {
    const ts = "https://phone-pc.example-net.ts.net/phone/";
    srv = await startServer({
      env: { ...baseEnv(), PHONE_PORT: "0", PHONE_HOST: "127.0.0.1", PHONE_LAN_URLS: "0", PHONE_URL: "https://my.example/phone/" }, log: () => {},
      servedPhoneUrls: async () => [ts],
    });
    expect(srv.phoneUrls).toEqual(["https://my.example/phone/", ts]);
    expect(((await (await fetchRetry(`${srv.url}/api/health`)).json()) as { phone_urls?: string[] }).phone_urls).toEqual(["https://my.example/phone/", ts]);
    await srv.close();
    srv = await startServer({ env: { ...baseEnv(), PHONE_PORT: "0", PHONE_HOST: "127.0.0.1", PHONE_LAN_URLS: "off" }, log: () => {} });
    expect(srv.phoneUrls).toEqual([]);
    expect(((await (await fetchRetry(`${srv.url}/api/health`)).json()) as { eye?: boolean; phone_urls?: string[] })).toMatchObject({ eye: true, phone_urls: [] });
  });

  it("PHONE_PORT가 없으면 폰 서버를 띄우지 않는다", async () => {
    srv = await startServer({ env: baseEnv(), log: () => {} });
    expect(srv.phoneUrls).toEqual([]);
    const health = (await (await fetchRetry(`${srv.url}/api/health`)).json()) as { eye?: boolean };
    expect(health.eye).toBe(false);
  });

  it("PHONE_PHOTO_DIR로 사진 폴더를 정하고 눈 화면 API를 연다", async () => {
    const photoDir = mkdtempSync(join(tmpdir(), "start-photos-"));
    try {
      srv = await startServer({ env: { ...baseEnv(), PHONE_PORT: "0", PHONE_HOST: "127.0.0.1", PHONE_PHOTO_DIR: photoDir }, log: () => {} });
      const health = (await (await fetchRetry(`${srv.url}/api/health`)).json()) as { eye?: boolean };
      expect(health.eye).toBe(true);
    } finally {
      await srv?.close();
      srv = undefined;
      rmSync(photoDir, { recursive: true, force: true });
    }
  });
});
