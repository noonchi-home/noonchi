// 앱 화면 오류 받기(POST /api/mobile/client-error): 껍데기 서버가 받아 서버 로그에 남긴다. 집 앱이 없어도(집을 바꾸는 중) 받는다.
import { afterEach, describe, expect, it } from "vitest";
import type { ClientErrorReport } from "../src/contract/client-error.js";
import { CLIENT_ERROR_PATH } from "../src/server/client-error.js";
import { createShell, type SetupApi, type Shell } from "../src/server/shell.js";
import { CLIENT_ERROR_PATH as APP_PATH, clientErrorReport } from "../apps/android/client-error.js";

let shell: Shell | undefined;
afterEach(async () => {
  await shell?.close();
  shell = undefined;
});

async function start(now: () => number = Date.now) {
  const lines: string[] = [];
  shell = createShell({
    setup: {} as SetupApi,
    current: () => null,
    allowOrigin: (origin) => origin === "https://hub.example.ts.net",
    log: (line) => lines.push(line),
    now,
  });
  const { url } = await shell.listen(0, "127.0.0.1");
  // 바쁜 Windows에서 listen이 다시 시도하며 남긴 줄은 세지 않는다
  lines.length = 0;
  const post = async (body: string, headers: Record<string, string> = {}) => {
    const r = await fetch(`${url}/api/mobile/client-error`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body });
    return { status: r.status, json: (await r.json()) as Record<string, unknown> };
  };
  return { lines, post, url };
}

const report: ClientErrorReport = {
  message: "TypeError: object null is not iterable",
  stack: "TypeError: object null is not iterable\n    at ConnectedPlan (address at index.android.bundle:1:2345)",
  component_stack: "\n    in ConnectedPlan\n    in ConnectedSettings",
  app_version: "1.0.0",
  at_ms: Date.UTC(2026, 10, 24, 13, 40),
};

describe("앱 화면 오류 받기", () => {
  it("받은 오류를 한 줄 머리와 스택으로 서버 로그에 남긴다", async () => {
    const { lines, post } = await start();
    expect(await post(JSON.stringify(report))).toEqual({ status: 200, json: { ok: true } });
    expect(lines).toHaveLength(1);
    const [head, ...rest] = lines[0]!.split("\n");
    expect(head).toBe("[앱 오류] TypeError: object null is not iterable · 앱 1.0.0 · 폰 시각 2026-11-24T13:40:00.000Z");
    expect(rest.join("\n")).toContain("at ConnectedPlan (address at index.android.bundle:1:2345)");
    expect(rest.join("\n")).toContain("in ConnectedSettings");
  });

  it("글 속 줄바꿈·제어 문자는 머리 줄을 나누지 못한다", async () => {
    const { lines, post } = await start();
    expect((await post(JSON.stringify({ ...report, message: "첫 줄\n[앱 오류] 가짜 줄\u001b[31m", stack: null, component_stack: null }))).status).toBe(200);
    expect(lines[0]!.split("\n")).toHaveLength(1);
    expect(lines[0]).not.toContain("\u001b");
  });

  it("16KB를 넘는 본문은 413으로 거절하고 로그에 남기지 않는다", async () => {
    const { lines, post } = await start();
    const big = JSON.stringify({ ...report, stack: "x".repeat(17 * 1024) });
    expect((await post(big)).status).toBe(413);
    expect(lines).toEqual([]);
  });

  it("1분에 10건까지 받고 11번째는 429, 1분이 지나면 다시 받는다", async () => {
    let t = 1_000_000;
    const { lines, post } = await start(() => t);
    for (let i = 0; i < 10; i++) expect((await post(JSON.stringify(report))).status).toBe(200);
    expect((await post(JSON.stringify(report))).status).toBe(429);
    expect(lines).toHaveLength(10);
    t += 60_000;
    expect((await post(JSON.stringify(report))).status).toBe(200);
  });

  it("잘못된 JSON, 빈 본문, 모르는 칸·틀린 모양은 400", async () => {
    const { lines, post } = await start();
    expect((await post("{not json")).status).toBe(400);
    expect((await post("")).status).toBe(400);
    expect((await post(JSON.stringify({ ...report, photo: "data:image/jpeg;base64,AAAA" }))).status).toBe(400);
    expect((await post(JSON.stringify({ ...report, at_ms: "어제" }))).status).toBe(400);
    expect((await post(JSON.stringify({ ...report, at_ms: 9e15 }))).status).toBe(400);
    expect((await post(JSON.stringify({ ...report, stack: "x".repeat(4001) }))).status).toBe(400);
    expect(lines).toEqual([]);
  });

  it("앱이 만든 보고(긴 스택은 잘라서)를 앱과 같은 경로로 받는다", async () => {
    const { lines, url } = await start();
    expect(APP_PATH).toBe(CLIENT_ERROR_PATH);
    const error = new TypeError("object null is not iterable");
    error.stack = `${error}\n${"    at render (index.android.bundle:1:2)\n".repeat(400)}`;
    const body = clientErrorReport(error, "\n    in ConnectedPlan".repeat(400), "1.0.0", Date.now());
    const r = await fetch(url + APP_PATH, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    expect(r.status).toBe(200);
    expect(lines[0]).toMatch(/^\[앱 오류\] TypeError: object null is not iterable · 앱 1\.0\.0 · /);
  });

  it("허용하지 않은 출처는 403, POST 말고는 405", async () => {
    const { lines, post, url } = await start();
    expect((await post(JSON.stringify(report), { origin: "https://evil.example" })).status).toBe(403);
    expect((await post(JSON.stringify(report), { origin: "https://hub.example.ts.net" })).status).toBe(200);
    expect((await fetch(`${url}/api/mobile/client-error`)).status).toBe(405);
    expect(lines).toHaveLength(1);
  });
});
