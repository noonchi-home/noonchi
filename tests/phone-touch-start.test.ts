// 벽 대기 맞춤 끝까지: 대시보드 REST로 A·B 저장 → 실행 중인 폰 세션이 바뀜 → 폰 위치 두 곳 기록 → 눈 높이 1.5.

import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { fetchRetry } from "../src/server/net.js";
import { startServer, type RunningServer } from "../src/server/start.js";

type Msg = Record<string, any>;
let srv: RunningServer | undefined;
const dirs: string[] = [];
afterEach(async () => {
  await srv?.close();
  srv = undefined;
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

const runtime = () => {
  const dir = mkdtempSync(join(tmpdir(), "touch-start-"));
  dirs.push(dir);
  return dir;
};
const env = (runtimeDir: string, extra: Record<string, string> = {}) => ({
  HUB: "memory", PORT: "0", PHONE_PORT: "0", PHONE_HOST: "127.0.0.1", RUNTIME_DIR: runtimeDir, ...extra,
});

/** 열기 전부터 받은 메시지를 모아 두고 조건에 맞는 것을 기다린다(연결 직후 status를 놓치지 않게). */
function inbox(ws: WebSocket) {
  const seen: Msg[] = [];
  const waiters: { pred: (m: Msg) => boolean; res: (m: Msg) => void }[] = [];
  ws.on("message", (d) => {
    const m = JSON.parse(String(d)) as Msg;
    seen.push(m);
    for (const w of [...waiters]) if (w.pred(m)) { waiters.splice(waiters.indexOf(w), 1); w.res(m); }
  });
  const wait = (pred: (m: Msg) => boolean, from = 0): Promise<Msg> => {
    const hit = seen.slice(from).find(pred);
    if (hit) return Promise.resolve(hit);
    return new Promise((res, rej) => {
      const timer = setTimeout(() => rej(new Error("메시지가 오지 않았습니다")), 3000);
      waiters.push({ pred, res: (m) => { clearTimeout(timer); res(m); } });
    });
  };
  /** 지금까지 받은 개수: wait(pred, mark())는 그 뒤에 온 것만 본다. */
  return Object.assign(wait, { mark: () => seen.length });
}
const opened = (ws: WebSocket) => new Promise<void>((res, rej) => { ws.once("open", () => res()); ws.once("error", rej); });

async function phoneOf(s: RunningServer) {
  const url = new URL(s.phoneUrls[0]!);
  const ws = new WebSocket(`ws://${url.host}/phone/events`, { origin: url.origin });
  const wait = inbox(ws);
  await opened(ws);
  return { ws, wait };
}
const json = async (path: string, body?: unknown) => {
  const res = await fetchRetry(`${srv!.url}${path}`, body === undefined ? {} : {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  });
  return { status: res.status, json: (await res.json()) as Msg };
};

const A = { label: "거실 창 아래 벽", position: [1, 2] };
const B = { label: "반대편 벽", position: [5, 2] };

describe("벽 대기 맞춤(startServer)", () => {
  it("저장하면 폰이 A·B 벽 대기로 바뀌고, 두 곳을 대면 눈이 맞은 자리·높이 1.5로 나온다", async () => {
    const dir = runtime();
    srv = await startServer({ env: env(dir), log: () => {} });
    expect((await json("/api/phone/touch-points")).json).toMatchObject({ ok: true, points: null, mode: "floor", eye_height_m: 1.5 });
    const phone = await phoneOf(srv);
    expect(await phone.wait((m) => m.type === "status")).toMatchObject({ mode: "floor" });

    const saved = await json("/api/phone/touch-points", { points: [A, B] });
    expect(saved.status).toBe(200);
    expect(saved.json).toMatchObject({ ok: true, mode: "touch", distance_m: 4, points: [{ id: "A", label: A.label }, { id: "B", label: B.label }] });
    expect(existsSync(join(dir, "homes", srv.twin.home.id, "phone-touch.json"))).toBe(true);
    const touch = await phone.wait((m) => m.type === "status" && m.mode === "touch");
    expect(touch.anchors.map((a: Msg) => a.id)).toEqual(["A", "B"]);

    const dash = new WebSocket(`${srv.url.replace(/^http/, "ws")}/events`);
    const dashWait = inbox(dash);
    await opened(dash);
    phone.ws.send(JSON.stringify({ type: "anchor", id: "A", point: [1, 0.9, 2] }));
    phone.ws.send(JSON.stringify({ type: "anchor", id: "B", point: [5, 1.2, 2] }));
    expect(await phone.wait((m) => m.type === "status" && m.aligned)).toMatchObject({ mode: "touch", mismatch_m: 0 });
    phone.ws.send(JSON.stringify({ type: "pose", position: [3, 0.7, 2.5], orientation: [0, 0, 0, 1] }));
    expect((await dashWait((m) => m.type === "eye")).eye).toMatchObject({ position: [3, 2.5], height_m: 1.5 });
    dash.close();
    phone.ws.close();
  });

  it("잘못된 A·B는 400이고 저장하지 않는다. 지우면 바닥 조준으로 돌아간다", async () => {
    const dir = runtime();
    srv = await startServer({ env: env(dir), log: () => {} });
    const phone = await phoneOf(srv);
    const bad = await json("/api/phone/touch-points", { points: [A, { label: "너무 가까움", position: [1.2, 2] }] });
    expect(bad.status).toBe(400);
    expect(bad.json.error).toContain("0.5m");
    expect((await json("/api/phone/touch-points", { points: [A, { position: [999, 2] }] })).json.error).toContain("집 범위");
    await json("/api/phone/touch-points", { points: [A, B] });
    await phone.wait((m) => m.type === "status" && m.mode === "touch");
    const mark = phone.wait.mark();
    const cleared = await json("/api/phone/touch-points/clear", {});
    expect(cleared.json).toMatchObject({ ok: true, points: null, mode: "floor" });
    expect(existsSync(join(dir, "homes", srv.twin.home.id, "phone-touch.json"))).toBe(false);
    expect(await phone.wait((m) => m.type === "status", mark)).toMatchObject({ mode: "floor", aligned: false });
    phone.ws.close();
  });

  it("저장해 둔 A·B가 있으면 벽 대기로 시작하고, PHONE_EYE_HEIGHT_M로 눈 높이를 바꾼다", async () => {
    const dir = runtime();
    const probe = await startServer({ env: { HUB: "memory", PORT: "0", RUNTIME_DIR: runtime() }, log: () => {} });
    const homeId = probe.twin.home.id;
    await probe.close();
    mkdirSync(join(dir, "homes", homeId), { recursive: true });
    writeFileSync(join(dir, "homes", homeId, "phone-touch.json"), JSON.stringify({ version: 1, points: [{ id: "A", ...A }, { id: "B", ...B }] }));
    srv = await startServer({ env: env(dir, { PHONE_EYE_HEIGHT_M: "1.6" }), log: () => {} });
    const phone = await phoneOf(srv);
    expect(await phone.wait((m) => m.type === "status")).toMatchObject({ mode: "touch", anchors: [{ id: "A" }, { id: "B" }] });
    const dash = new WebSocket(`${srv.url.replace(/^http/, "ws")}/events`);
    const dashWait = inbox(dash);
    await opened(dash);
    phone.ws.send(JSON.stringify({ type: "anchor", id: "A", point: [1, 1, 2] }));
    phone.ws.send(JSON.stringify({ type: "anchor", id: "B", point: [5, 1, 2] }));
    await phone.wait((m) => m.type === "status" && m.aligned);
    phone.ws.send(JSON.stringify({ type: "pose", position: [2, 1, 2], orientation: [0, 0, 0, 1] }));
    expect((await dashWait((m) => m.type === "eye")).eye).toMatchObject({ height_m: 1.6 });
    dash.close();
    phone.ws.close();
  });

  it("벽 하나로 A·B 구석: 실제 원룸 집에서 구석을 돌려주고 저장하지 않는다", async () => {
    const dir = runtime();
    srv = await startServer({ env: env(dir, { HOME_ID: "oneroom" }), log: () => {} });
    expect(srv.twin.home.id).toBe("oneroom");
    const auto = await json("/api/phone/touch-points/auto", { home: "oneroom", position: [0.1, 6], room: "bathroom", normal: [1, 0] });
    expect(auto.status).toBe(200);
    expect(auto.json).toEqual({
      ok: true, distance_m: 2.885,
      points: [{ id: "A", label: "욕실 구석", position: [0.1, 6.5] }, { id: "B", label: "욕실 맞은편 구석", position: [1.64, 4.06] }],
    });
    // 맞은편이 주방으로 열린 방은 A만
    expect((await json("/api/phone/touch-points/auto", { position: [3, 0.1] })).json).toEqual({
      ok: true, distance_m: null, points: [{ id: "A", label: "방 구석", position: [3.9, 0.1] }],
    });
    expect((await json("/api/phone/touch-points")).json).toMatchObject({ points: null, mode: "floor" });
    expect(existsSync(join(dir, "homes", "oneroom", "phone-touch.json"))).toBe(false);
    // 받은 두 점은 그대로 저장된다
    expect((await json("/api/phone/touch-points", { home: "oneroom", points: auto.json.points })).json).toMatchObject({ ok: true, mode: "touch", distance_m: 2.885 });

    const bad = await json("/api/phone/touch-points/auto", { home: "oneroom", position: [1, "x"] });
    expect(bad.status).toBe(400);
    expect(bad.json.error).toContain("위치");
    expect((await json("/api/phone/touch-points/auto", { home: "apartment", position: [0.1, 6] })).status).toBe(409);
  });

  it("누른 벽 점의 방: 같은 쪽을 여러 방이 쓰는 벽은 뷰어가 보낸 첫 방이 아니라 점 바로 안쪽이 든 방", async () => {
    const dir = runtime();
    srv = await startServer({ env: env(dir, { HOME_ID: "oneroom" }), log: () => {} });
    // 서쪽 벽 E04는 첫 면이 욕실, 동쪽 벽 E02는 첫 면이 방
    expect((await json("/api/phone/touch-points/room", { home: "oneroom", position: [0.1, 1.5], room: "bathroom", normal: [1, 0] })).json)
      .toEqual({ ok: true, room: "room" });
    expect((await json("/api/phone/touch-points/room", { home: "oneroom", position: [3.9, 4.7], room: "room", normal: [-1, 0] })).json)
      .toEqual({ ok: true, room: "kitchen" });
    expect((await json("/api/phone/touch-points/room", { position: [2, 2] })).json).toEqual({ ok: true, room: null });
    const bad = await json("/api/phone/touch-points/room", { home: "oneroom", position: [1, "x"] });
    expect(bad.status).toBe(400);
    expect(bad.json.error).toContain("위치");
    expect((await json("/api/phone/touch-points/room", { home: "apartment", position: [0.1, 1.5] })).status).toBe(409);
  });

  it("깨진 파일이면 경고하고 바닥 조준으로 시작한다", async () => {
    const dir = runtime();
    const probe = await startServer({ env: { HUB: "memory", PORT: "0", RUNTIME_DIR: runtime() }, log: () => {} });
    const homeId = probe.twin.home.id;
    await probe.close();
    mkdirSync(join(dir, "homes", homeId), { recursive: true });
    writeFileSync(join(dir, "homes", homeId, "phone-touch.json"), "{ 깨짐");
    const logs: string[] = [];
    srv = await startServer({ env: env(dir), log: (l) => logs.push(l) });
    expect(logs.some((l) => l.includes("phone-touch.json"))).toBe(true);
    const phone = await phoneOf(srv);
    expect(await phone.wait((m) => m.type === "status")).toMatchObject({ mode: "floor" });
    phone.ws.close();
  });
});
