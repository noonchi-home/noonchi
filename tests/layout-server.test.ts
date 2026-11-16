import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { LayoutEditor } from "../src/layout/editor.js";
import { createApp } from "../src/server/app.js";
import { fetchRetry } from "../src/shared/net.js";
import { ROOMS, makeHome } from "./helpers/home.js";
import { CATALOG, scene } from "./helpers/layout.js";
import { openWebSocket } from "./helpers/ws.js";

type Msg = Record<string, any>;
const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()!();
});

async function start() {
  const dir = mkdtempSync(join(tmpdir(), "twin-home-layout-server-"));
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  const editor = new LayoutEditor({ homeId: "oneroom", scene: scene(), catalog: CATALOG, savePath: join(dir, "edits.json") });
  const home = makeHome();
  const app = createApp({ hub: home.hub, policy: home.policy, rooms: ROOMS, layout: editor, log: () => {} });
  const { url } = await app.listen(0, "127.0.0.1");
  cleanups.push(() => app.close());
  return { editor, url, dir };
}

async function post(url: string, path: string, body: unknown = {}) {
  const res = await fetchRetry(url + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return { status: res.status, json: (await res.json()) as Msg };
}

async function listen(url: string) {
  const messages: Msg[] = [];
  const ws = await openWebSocket(url.replace(/^http/, "ws") + "/events", { setup: (s) => s.on("message", (d) => messages.push(JSON.parse(String(d)))) });
  cleanups.push(() => ws.close());
  const waitFor = async (pred: (m: Msg) => boolean, ms = 3000) => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      const m = messages.find(pred);
      if (m) return m;
      await new Promise((r) => setTimeout(r, 20));
    }
    throw new Error(`메시지를 기다리다 시간 초과: ${JSON.stringify(messages.slice(-5))}`);
  };
  return { ws, messages, waitFor };
}

describe("배치 보정 REST·WS", () => {
  it("연결하면 지금 보정 상태를 layout 메시지로 받고, 바뀔 때마다 방송된다", async () => {
    const { editor, url } = await start();
    editor.move("fridge_1", { x: 3, y: 3 });
    const a = await listen(url);
    const synced = await a.waitFor((m) => m.type === "layout");
    expect(synced).toMatchObject({ op: "move", id: "fridge_1", plan: { position: [3, 3] } });
    editor.add("air_purifier", { x: 1, y: 3 });
    expect(await a.waitFor((m) => m.type === "layout" && m.op === "add")).toMatchObject({ object: { id: "air_purifier_1" } });
  });

  it("GET /api/layout, 저장, 되돌리기", async () => {
    const { editor, url } = await start();
    editor.move("fridge_1", { x: 3, y: 3 });
    const status = await (await fetchRetry(url + "/api/layout")).json() as Msg;
    expect(status).toMatchObject({ ok: true, home: "oneroom", edits: 1, dirty: true, items: [{ op: "move", id: "fridge_1" }] });
    const saved = await post(url, "/api/layout/save");
    expect(saved.json).toMatchObject({ ok: true, count: 1 });
    expect(JSON.parse(readFileSync(saved.json.path, "utf8")).edits).toHaveLength(1);
    const a = await listen(url);
    const reset = await post(url, "/api/layout/reset");
    expect(reset.json).toMatchObject({ ok: true, reverted: 1 });
    expect(await a.waitFor((m) => m.type === "layout" && m.op === "move" && m.plan.position[0] === 1)).toMatchObject({ id: "fridge_1" });
    expect(editor.edits()).toEqual([]);
  });

  it("편집기가 없으면 404", async () => {
    const home = makeHome();
    const app = createApp({ hub: home.hub, policy: home.policy, rooms: ROOMS, log: () => {} });
    const { url } = await app.listen(0, "127.0.0.1");
    cleanups.push(() => app.close());
    expect((await fetchRetry(url + "/api/layout")).status).toBe(404);
  });
});

describe("loadLayout: 집 scene.json + 카탈로그 + 저장한 수정본", () => {
  it("scene이 있으면 편집기를 만들고 저장한 수정본을 다시 적용한다", async () => {
    const { mkdirSync, writeFileSync } = await import("node:fs");
    const { loadLayout } = await import("../src/layout/load.js");
    const { resolveHome } = await import("../src/layout/homes.js");
    const studio = mkdtempSync(join(tmpdir(), "twin-home-studio-"));
    const runtime = mkdtempSync(join(tmpdir(), "twin-home-runtime-"));
    cleanups.push(() => rmSync(studio, { recursive: true, force: true }), () => rmSync(runtime, { recursive: true, force: true }));
    const w = (path: string, data: unknown) => {
      mkdirSync(join(path, ".."), { recursive: true });
      writeFileSync(path, JSON.stringify(data), "utf8");
    };
    w(join(studio, "homes.json"), { homes: [{ id: "oneroom", name: "원룸", data: "data/homes/oneroom", out: "homes/oneroom" }] });
    w(join(studio, "homes", "oneroom", "scene.json"), scene());
    for (const t of CATALOG.values()) w(join(studio, "data", "catalog", `${t.type}.json`), t);
    w(join(runtime, "homes", "oneroom", "edits.json"), { version: 1, home: "oneroom", edits: [{ op: "move", id: "fridge_1", position: [3, 3], facing_deg: 90, room: "room" }] });
    const lines: string[] = [];
    const home = resolveHome(studio, "oneroom");
    const r = loadLayout(home, { runtimeDir: runtime, log: (l) => lines.push(l) })!;
    expect(r.editor.object("fridge_1")!.plan.position).toEqual([3, 3]);
    expect(r.editor.savePath).toBe(join(runtime, "homes", "oneroom", "edits.json"));
    expect(r.catalog.get("air_purifier")?.label).toBe("공기청정기");
    expect(lines.join("\n")).toMatch(/1건/);
    expect(loadLayout(resolveHome(mkdtempSync(join(tmpdir(), "twin-home-empty-"))), { runtimeDir: runtime, log: () => {} })).toBeUndefined();
  });
});
