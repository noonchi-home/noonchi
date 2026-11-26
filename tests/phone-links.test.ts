// 폰에서 열 주소 순서: PHONE_URL → tailscale serve가 폰 포트로 잇는 https 주소 → 이 PC(루프백) 주소. 주소는 모두 가짜다.
import { describe, expect, it } from "vitest";
import { findServedPhoneUrls, orderPhoneUrls, phoneUrlWarning, servedPhoneUrls } from "../src/phone/links.js";

const serve = (web: Record<string, unknown>) => ({ TCP: { "443": { HTTPS: true } }, Web: web });
const FAKE = "phone-pc.example-net.ts.net";

describe("servedPhoneUrls", () => {
  it("폰 포트로 이어진 https 사이트만 /phone/ 주소로", () => {
    const cfg = serve({
      [`${FAKE}:443`]: { Handlers: { "/": { Proxy: "http://127.0.0.1:8210" } } },
      [`${FAKE}:8443`]: { Handlers: { "/": { Proxy: "http://localhost:8210/" } } },
      [`${FAKE}:10000`]: { Handlers: { "/": { Proxy: "http://127.0.0.1:8200" } } },
    });
    expect(servedPhoneUrls(cfg, 8210)).toEqual([`https://${FAKE}/phone/`, `https://${FAKE}:8443/phone/`]);
    expect(servedPhoneUrls(cfg, 9999)).toEqual([]);
  });

  it("다른 기계로 가는 프록시·이상한 값은 버린다", () => {
    expect(servedPhoneUrls(serve({ [`${FAKE}:443`]: { Handlers: { "/": { Proxy: "http://192.168.0.9:8210" } } } }), 8210)).toEqual([]);
    expect(servedPhoneUrls(serve({ [`${FAKE}:443`]: { Handlers: { "/": { Path: "/srv" } } } }), 8210)).toEqual([]);
    for (const bad of [null, {}, "x", { Web: [] }, { Web: { "no-port": {} } }]) expect(servedPhoneUrls(bad, 8210)).toEqual([]);
  });

  it("사이트 뿌리(/)로 이은 것만 쓴다(폰 화면 빌드 파일이 /assets/에 있다)", () => {
    expect(servedPhoneUrls(serve({ [`${FAKE}:443`]: { Handlers: { "/eye": { Proxy: "http://127.0.0.1:8210" } } } }), 8210)).toEqual([]);
  });
});

describe("orderPhoneUrls", () => {
  it("PHONE_URL, tailscale, 이 PC 주소 순서로 겹치지 않게", () => {
    const local = ["http://127.0.0.1:8210/phone/"];
    const ts = [`https://${FAKE}/phone/`];
    expect(orderPhoneUrls(local, ts)).toEqual([...ts, ...local]);
    expect(orderPhoneUrls(local, ts, " https://my.example/phone/ ")).toEqual(["https://my.example/phone/", ...ts, ...local]);
    expect(orderPhoneUrls(local, ts, ts[0])).toEqual([...ts, ...local]);
    expect(orderPhoneUrls(local, [], "")).toEqual(local);
  });
});

describe("phoneUrlWarning", () => {
  it("PHONE_URL이 http면 폰 카메라는 HTTPS 주소가 필요하다고 알린다", () => {
    expect(phoneUrlWarning(" http://my.example:8210/phone/ ")).toBe("폰 카메라는 HTTPS 주소가 필요해요: PHONE_URL=http://my.example:8210/phone/");
    for (const ok of [undefined, "", "https://my.example/phone/"]) expect(phoneUrlWarning(ok)).toBeNull();
  });
});

describe("findServedPhoneUrls", () => {
  it("tailscale serve status --json을 읽는다", async () => {
    const calls: string[][] = [];
    const run = async (cmd: string, args: string[]) => {
      calls.push([cmd, ...args]);
      return JSON.stringify(serve({ [`${FAKE}:443`]: { Handlers: { "/": { Proxy: "http://127.0.0.1:8210" } } } }));
    };
    expect(await findServedPhoneUrls(8210, run)).toEqual([`https://${FAKE}/phone/`]);
    expect(calls).toEqual([["tailscale", "serve", "status", "--json"]]);
  });

  it("tailscale이 없거나 실패하거나 엉뚱한 글이면 빈 목록", async () => {
    expect(await findServedPhoneUrls(8210, async () => { throw new Error("ENOENT"); })).toEqual([]);
    expect(await findServedPhoneUrls(8210, async () => "No serve config")).toEqual([]);
  });
});
