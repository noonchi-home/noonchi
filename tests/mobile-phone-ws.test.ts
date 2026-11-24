import { afterEach, expect, it, vi } from "vitest";
import { createPhoneServer } from "../src/phone/index.js";
import { createApp } from "../src/server/app.js";
import { makeHome } from "./helpers/home.js";
import { openPhone, openWebSocket } from "./helpers/ws.js";

const close: (() => Promise<void>)[] = [];
afterEach(async () => {
  while (close.length) await close.pop()!();
});

async function setup() {
  const phone = createPhoneServer({ sync: { landmarks: [], walls: [], start: null }, onEye: () => {}, log: () => {} });
  close.push(() => phone.close());
  const direct = await phone.listen(0, "127.0.0.1");
  const home = makeHome();
  const app = createApp({ hub: home.hub, policy: home.policy, phonePortal: () => phone, log: () => {} });
  close.push(() => app.close());
  const { url } = await app.listen(0, "127.0.0.1");
  return { phone, url, portal: url.replace(/^http/, "ws") + "/mobile/phone-events", direct: direct.urls[0]! };
}

it("허브의 같은 출처 연결과 직접 폰 연결이 같은 폰 판본과 세션 사용권을 쓴다", async () => {
  const { phone, url, portal, direct } = await setup();
  const messages: unknown[] = [];
  const socket = await openPhone(portal, {
    options: { origin: url },
    setup: (ws) => ws.on("message", (message) => messages.push(JSON.parse(String(message)))),
  });
  await vi.waitFor(() => expect(phone.ready()).toBe(true));
  expect(messages).toContainEqual(expect.objectContaining({ type: "status", protocol: expect.any(Number) }));
  socket.close();
  await vi.waitFor(() => expect(phone.ready()).toBe(false));
  const directUrl = new URL("/phone/events", direct);
  const original = await openPhone(directUrl.href.replace(/^http/, "ws"), { options: { origin: new URL(direct).origin } });
  await vi.waitFor(() => expect(phone.ready()).toBe(true));
  original.close();
});

it("포털 폰 연결은 출처가 없거나 포트가 다르면 거절하며 영상 쿼리를 받지 않는다", async () => {
  const { phone, url, portal, direct } = await setup();
  await expect(openWebSocket(portal)).rejects.toThrow("403");
  await expect(openWebSocket(portal, { options: { origin: new URL(direct).origin } })).rejects.toThrow("403");
  await expect(openWebSocket(portal + "?video=fixture.mp4", { options: { origin: url } })).rejects.toThrow("400");
  expect(phone.ready()).toBe(false);
});
