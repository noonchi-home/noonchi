// ThinQ Connect 클라이언트(src/thinq/client.ts): 공식 SDK와 같은 주소·머리글·경로, 오류 글에 토큰이 없다.
// 실제 ThinQ는 부르지 않는다. 가짜 서버(tests/helpers/thinq.ts)만 쓴다.
import { afterEach, describe, expect, it, vi } from "vitest";
import { ThinqClient, ThinqError, thinqConfig } from "../src/thinq/client.js";
import { FAKE_AC, startFakeThinq, type FakeThinq } from "./helpers/thinq.js";
import { guardFetch } from "./setup/no-real-thinq.js";

const TOKEN = "thinq_pat_for_tests_only_1234";
let fake: FakeThinq | undefined;
afterEach(async () => {
  await fake?.close();
  fake = undefined;
});

function client(extra: Record<string, string> = {}): ThinqClient {
  const c = thinqConfig({ THINQ_TOKEN: TOKEN, THINQ_BASE_URL: fake!.url, THINQ_CLIENT_ID: "client-1", ...extra });
  if (!c.ok) throw new Error(c.error);
  return new ThinqClient(c.config);
}

async function caught(p: Promise<unknown>): Promise<ThinqError> {
  try {
    await p;
  } catch (e) {
    return e as ThinqError;
  }
  throw new Error("거부되지 않았어요");
}

describe("thinqConfig", () => {
  it("토큰이 없으면 오류", () => {
    expect(thinqConfig({})).toEqual({ ok: false, error: "ThinQ 토큰이 없어요." });
    expect(thinqConfig({ THINQ_TOKEN: "  " }).ok).toBe(false);
  });

  it("기본은 한국(KR, kic) 주소, 지역·나라·주소를 환경변수로 바꾼다", () => {
    const base = thinqConfig({ THINQ_TOKEN: TOKEN });
    expect(base.ok && base.config).toMatchObject({ baseUrl: "https://api-kic.lgthinq.com/", country: "KR", token: TOKEN });
    const us = thinqConfig({ THINQ_TOKEN: TOKEN, THINQ_REGION: "AIC", THINQ_COUNTRY: "us" });
    expect(us.ok && us.config).toMatchObject({ baseUrl: "https://api-aic.lgthinq.com/", country: "US" });
    const local = thinqConfig({ THINQ_TOKEN: TOKEN, THINQ_BASE_URL: "http://127.0.0.1:9/" });
    expect(local.ok && local.config.baseUrl).toBe("http://127.0.0.1:9/");
    expect(thinqConfig({ THINQ_TOKEN: TOKEN, THINQ_REGION: "xyz" }).ok).toBe(false);
  });
});

describe("ThinqClient", () => {
  it("기기 목록: GET devices와 공식 SDK의 머리글", async () => {
    fake = await startFakeThinq();
    const devices = await client().devices();
    expect(devices).toEqual([
      { id: FAKE_AC, type: "DEVICE_AIR_CONDITIONER", name: "거실 에어컨", model: "FQ18" },
      { id: "thinq-fridge-1", type: "DEVICE_REFRIGERATOR", name: "냉장고", model: "M874" },
    ]);
    const [r] = fake.requests;
    expect(r).toMatchObject({ method: "GET", path: "devices" });
    expect(r!.headers).toMatchObject({
      authorization: `Bearer ${TOKEN}`, "x-country": "KR", "x-client-id": "client-1", "x-service-phase": "OP",
    });
    expect(r!.headers["x-message-id"]).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(String(r!.headers["x-api-key"])).not.toBe("");
    expect(r!.headers["x-conditional-control"]).toBeUndefined();
  });

  it("상태: GET devices/{id}/state의 response를 풀어 준다", async () => {
    fake = await startFakeThinq();
    const state = await client().state(FAKE_AC);
    expect(state).toMatchObject({ operation: { airConOperationMode: "POWER_ON" } });
    expect(fake.requests[0]).toMatchObject({ method: "GET", path: `devices/${FAKE_AC}/state` });
  });

  it("명령: POST devices/{id}/control에 본문 그대로, x-conditional-control: true", async () => {
    fake = await startFakeThinq();
    await client().control(FAKE_AC, { operation: { airConOperationMode: "POWER_OFF" } });
    const [r] = fake.controls();
    expect(r).toMatchObject({ path: `devices/${FAKE_AC}/control`, body: { operation: { airConOperationMode: "POWER_OFF" } } });
    expect(r!.headers["x-conditional-control"]).toBe("true");
    expect(r!.headers["content-type"]).toMatch(/application\/json/);
  });

  it("x-message-id는 요청마다 다르다", async () => {
    fake = await startFakeThinq();
    const c = client();
    await c.devices();
    await c.devices();
    expect(fake.requests[0]!.headers["x-message-id"]).not.toBe(fake.requests[1]!.headers["x-message-id"]);
  });

  it("거부하면 ThinqError(상태 코드·ThinQ 코드)이고, 서버가 토큰을 돌려줘도 글에 토큰이 없다", async () => {
    fake = await startFakeThinq();
    fake.behavior[FAKE_AC] = "reject";
    fake.rejectMessage = `token ${TOKEN} is not allowed`;
    const e = await caught(client().control(FAKE_AC, { operation: { airConOperationMode: "POWER_ON" } }));
    expect(e).toBeInstanceOf(ThinqError);
    expect(e).toMatchObject({ status: 400, code: "2207" });
    expect(e.message).not.toContain(TOKEN);
    expect(String(e.stack)).not.toContain(TOKEN);
  });

  it("상태를 못 읽으면 ThinqError", async () => {
    fake = await startFakeThinq();
    fake.behavior[FAKE_AC] = "fail-read";
    expect(await caught(client().state(FAKE_AC))).toMatchObject({ status: 500, code: "1500" });
  });

  it("서버에 닿지 못하면 ThinqError(status 0), 글에 토큰이 없다", async () => {
    fake = await startFakeThinq();
    const c = client();
    await fake.close();
    const e = await caught(c.devices());
    expect(e).toMatchObject({ status: 0, code: "network" });
    expect(e.message).not.toContain(TOKEN);
    fake = undefined;
  });
});

describe("시험 안전장치(tests/setup/no-real-thinq.ts)", () => {
  it("실제 ThinQ 주소는 막고, 가짜 서버 주소는 그대로 보낸다", async () => {
    const inner = vi.fn(async () => new Response("{}"));
    const guarded = guardFetch(inner as unknown as typeof fetch);
    await expect(guarded("https://api-kic.lgthinq.com/devices")).rejects.toThrow(/실제 ThinQ/);
    await expect(guarded(new URL("https://connect-pat.lgthinq.com/"))).rejects.toThrow(/실제 ThinQ/);
    expect(inner).not.toHaveBeenCalled();
    await guarded("http://127.0.0.1:9/devices");
    expect(inner).toHaveBeenCalledTimes(1);
  });

  it("루트 시험의 fetch에는 안전장치가 걸려 있다", () => {
    expect((globalThis.fetch as typeof fetch & { noRealThinq?: true }).noRealThinq).toBe(true);
  });
});
