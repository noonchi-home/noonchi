// startServer가 PHONE_PORT를 보고 폰 AR 서버를 함께 띄우는지(HUB=memory로 빠르게).

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { loadAnchorTargets } from "../src/phone/anchors.js";
import { fetchRetry } from "../src/server/net.js";
import { startServer, type RunningServer } from "../src/server/start.js";

type Msg = Record<string, any>;
let srv: RunningServer | undefined;
afterEach(async () => {
  await srv?.close();
  srv = undefined;
});

const baseEnv = () => ({ HUB: "memory", PORT: "0", AGENT_PROVIDER: "mock", RUNTIME_DIR: mkdtempSync(join(tmpdir(), "rt-")) });

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
    const [dock, door] = loadAnchorTargets(join(srv.twin.dir, "apartment", "scene.json"), join(srv.twin.dir, "data", "apartment", "floorplan.json"));

    const dash = new WebSocket(`${srv.url.replace(/^http/, "ws")}/events`);
    await opened(dash);
    const phone = new WebSocket(`ws://${phoneUrl.host}/phone/events`, { origin: phoneUrl.origin });
    await opened(phone);
    const aligned = next(phone, (m) => m.type === "status" && m.aligned);
    phone.send(JSON.stringify({ type: "anchor", id: dock!.id, point: [dock!.plan[0], 0, dock!.plan[1]] }));
    phone.send(JSON.stringify({ type: "anchor", id: door!.id, point: [door!.plan[0], 0, door!.plan[1]] }));
    await aligned;
    const eye = next(dash, (m) => m.type === "eye");
    phone.send(JSON.stringify({ type: "pose", position: [dock!.plan[0], 1.3, dock!.plan[1]], orientation: [0, 0, 0, 1] }));
    expect((await eye).eye).toMatchObject({ position: dock!.plan, height_m: 1.3 });
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

  it("PHONE_PORT가 없으면 폰 서버를 띄우지 않는다", async () => {
    srv = await startServer({ env: baseEnv(), log: () => {} });
    expect(srv.phoneUrls).toEqual([]);
    const health = (await (await fetchRetry(`${srv.url}/api/health`)).json()) as { eye?: boolean };
    expect(health.eye).toBe(false);
  });

  it("PHONE_MAX_MISMATCH_M로 거리 차이 허용값을 바꾸고, 눈 화면 API를 연다", async () => {
    const photoDir = mkdtempSync(join(tmpdir(), "start-photos-"));
    try {
      srv = await startServer({ env: { ...baseEnv(), PHONE_PORT: "0", PHONE_HOST: "127.0.0.1", PHONE_MAX_MISMATCH_M: "2", PHONE_PHOTO_DIR: photoDir }, log: () => {} });
      const health = (await (await fetchRetry(`${srv.url}/api/health`)).json()) as { eye?: boolean };
      expect(health.eye).toBe(true);
      const phoneUrl = new URL(srv.phoneUrls[0]!);
      const [dock, door] = loadAnchorTargets(join(srv.twin.dir, "apartment", "scene.json"), join(srv.twin.dir, "data", "apartment", "floorplan.json"));
      const phone = new WebSocket(`ws://${phoneUrl.host}/phone/events`, { origin: phoneUrl.origin });
      await opened(phone);
      const status = next(phone, (m) => m.type === "status" && m.anchors.every((a: { recorded: boolean }) => a.recorded));
      // 두 번째 기준점을 1m 더 멀리 찍는다: 기본 허용값(0.3m)은 넘고 PHONE_MAX_MISMATCH_M=2 안쪽
      const len = Math.hypot(door!.plan[0] - dock!.plan[0], door!.plan[1] - dock!.plan[1]);
      const far = [door!.plan[0] + (door!.plan[0] - dock!.plan[0]) / len, 0, door!.plan[1] + (door!.plan[1] - dock!.plan[1]) / len];
      phone.send(JSON.stringify({ type: "anchor", id: dock!.id, point: [dock!.plan[0], 0, dock!.plan[1]] }));
      phone.send(JSON.stringify({ type: "anchor", id: door!.id, point: far }));
      expect(await status).toMatchObject({ aligned: true });
      phone.close();
    } finally {
      await srv?.close();
      srv = undefined;
      rmSync(photoDir, { recursive: true, force: true });
    }
  });
});
