// 시연 준비 명령(scripts/demo-setup.ts)과 장면 시작 위치(scripts/demo-start.ts). 서버는 시험 안의 가짜 HTTP 서버만 쓴다(실제 서버·PAM은 띄우지 않는다).
import { createServer, type Server } from "node:http";
import { existsSync, mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import type { FsmMemory } from "../src/brain/decision.js";
import { HistoryDb } from "../src/history/db.js";
import { insidePolygon } from "../src/phone/home-plan.js";
import { loadScene } from "../src/model/scene.js";
import { resolveHome } from "../src/model/homes.js";
import { acquireServerLock } from "../src/server/lock.js";
import { listenRetry } from "../src/server/net.js";
import { DEMO_APPROVALS, DemoStop, demoSetup, silentAircon } from "../scripts/demo-setup.js";
import { DEMO_STARTS, startFor } from "../scripts/demo-start.js";

const NOW = Date.parse("2026-11-14T00:30:00Z"); // 서울 11-14 09:30
const TODAY = "2026-11-14";
const env = { HISTORY_TZ_MINUTES: "540" };
const tmp = () => mkdtempSync(join(tmpdir(), "demo-"));
/** 꺼진 서버 주소: 잠깐 연 포트를 닫아 연결이 거부되는 곳(ECONNREFUSED). */
let CLOSED = "";
beforeAll(async () => {
  const s = createServer();
  const { port } = await listenRetry(s, 0, "127.0.0.1");
  await new Promise<void>((ok) => s.close(() => ok()));
  CLOSED = `http://127.0.0.1:${port}`;
});
const run = async (argv: string[]) => {
  const logs: string[] = [];
  await demoSetup(argv, { env, now: () => NOW, log: (l) => logs.push(l) });
  return logs;
};

/** 가짜 서버: 날마다 기억 판본·고정 상태를 들고 /api/memory/day·/api/reflection/run·/api/history·/api/homes·/api/phone/start-pose를 흉내 낸다. */
interface Fake {
  url: string;
  home: string;
  calls: string[];
  /** 날 → 고정 판본. */
  pins: Map<string, number>;
  /** 판본: 번호·반성한 날·쓰기 시작하는 날. */
  versions: { version: number; day: string | null; appliesDay: string | null; source: string }[];
  /** 반성 하나: 그날 → appliesDay를 바꾸고 싶으면 돌려준다. */
  appliesFor?: (day: string) => string;
  /** 반성 뒤 오늘을 다른 판본으로 고정한다. */
  pinAfterRun?: () => void;
  started: unknown[];
}
let servers: Server[] = [];
afterEach(() => {
  for (const s of servers) { s.closeAllConnections(); s.close(); }
  servers = [];
});
const next = (d: string) => new Date(Date.parse(`${d}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
async function fakeServer(home = "mokryeon_180b"): Promise<Fake> {
  const f: Fake = { url: "", home, calls: [], pins: new Map(), versions: [{ version: 1, day: null, appliesDay: null, source: "synthetic" }], started: [] };
  const usesFor = (day: string) => {
    const pinned = f.pins.get(day);
    const v = pinned !== undefined ? f.versions.find((x) => x.version === pinned) : [...f.versions].reverse().find((x) => x.appliesDay === null || x.appliesDay <= day);
    return v ? { version: v.version, source: v.source, appliesDay: v.appliesDay, day: v.day } : null;
  };
  const srv = createServer(async (req, res) => {
    let raw = "";
    for await (const c of req) raw += c;
    const send = (status: number, body: unknown) => { res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(body)); };
    const path = req.url ?? "";
    f.calls.push(`${req.method} ${path}`);
    if (path === "/api/health") return send(200, { ok: true });
    if (path === "/api/homes") return send(200, { current: f.home, homes: [] });
    if (req.method === "POST" && path === "/api/phone/start-pose") { f.started.push(JSON.parse(raw)); return send(200, { ok: true, start: { label: "식탁 앞" } }); }
    const day = /^\/api\/memory\/day\/(\d{4}-\d{2}-\d{2})$/.exec(path)?.[1];
    if (day) return send(200, { ok: true, day, pinned: f.pins.get(day) ?? null, uses: usesFor(day), latest: f.versions.at(-1)!.version });
    if (req.method === "POST" && path === "/api/reflection/run") {
      const d = (JSON.parse(raw) as { day: string }).day;
      const version = f.versions.at(-1)!.version + 1;
      const appliesDay = f.appliesFor?.(d) ?? next(d);
      f.versions.push({ version, day: d, appliesDay, source: "reflection" });
      f.pinAfterRun?.();
      return send(200, { ok: true, day: d, version, appliesDay });
    }
    if (path.startsWith("/api/history")) return send(200, { ok: true, rows: [{ data: { learned: [], active: [] } }] });
    send(404, { ok: false, error: "없음" });
  });
  servers.push(srv);
  const { port } = await listenRetry(srv, 0, "127.0.0.1");
  f.url = `http://127.0.0.1:${port}`;
  return f;
}
const runs = (f: Fake) => f.calls.filter((c) => c === "POST /api/reflection/run");

describe("시연 폴더(day1·week)", () => {
  it("day1이 설정·승인·수업 기록·시작 위치·빈 기록 DB 다섯 파일을 쓴다", async () => {
    const dir = join(tmp(), "day1");
    await run(["day1", "--dir", dir]);
    const home = join(dir, "homes", "mokryeon_180b");
    expect(JSON.parse(readFileSync(join(dir, "setup.json"), "utf8"))).toEqual({ version: 1, home: "mokryeon_180b", done: true, mode: "test", assist: "auto" });
    const approvals = JSON.parse(readFileSync(join(home, "approvals.json"), "utf8")) as Record<string, unknown>;
    expect(JSON.stringify(approvals)).toContain("task:컵 치우기");
    for (const name of DEMO_APPROVALS) expect(JSON.stringify(approvals), name).toContain(`task:${name}`);
    const lessons = JSON.parse(readFileSync(join(home, "lessons.json"), "utf8")) as { lessons: Record<string, { runs: number; steps: { label: string; alone: number }[] }> };
    const ramen = lessons.lessons["라면 끓이기 알려 주기"]!;
    expect(ramen.runs).toBe(2);
    expect(ramen.steps.filter((s) => s.alone === 2).map((s) => s.label)).toEqual(["수납장으로 가기", "냄비 꺼내기", "싱크대로 가기", "인덕션으로 가기"]);
    const start = JSON.parse(readFileSync(join(home, "phone-start.json"), "utf8")) as { version: number; start: { position: number[]; yawDeg: number } };
    expect(start.version).toBe(1);
    const pose = startFor(loadScene(resolveHome("twin", "mokryeon_180b"))!, DEMO_STARTS.cup.target, DEMO_STARTS.cup.distanceM);
    expect(start.start.position).toEqual(pose.position);
    const db = HistoryDb.open(join(dir, "noonchi.db"), 540);
    expect(db.list({ limit: 10 })).toEqual([]);
    db.close();
  });

  it("기록 DB가 있는 폴더에 week를 다시 하면 멈추고, --fresh는 옛 폴더를 옮기고 새로 만든다. 서버가 켜져 있으면 --fresh도 멈춘다", async () => {
    const base = tmp();
    const dir = join(base, "week");
    await run(["week", "--dir", dir, "--api", CLOSED]);
    const db = HistoryDb.open(join(dir, "noonchi.db"), 540);
    expect(db.list({ kinds: ["reflection"] })).toEqual([]);
    expect(db.list({ limit: 10 }).length).toBeGreaterThan(0);
    db.close();
    await expect(run(["week", "--dir", dir, "--api", CLOSED])).rejects.toThrow(/--fresh로 새로 시작하세요/);
    const up = await fakeServer();
    await expect(run(["week", "--dir", dir, "--fresh", "--api", up.url])).rejects.toThrow(/서버를 먼저 끄세요/);
    await run(["week", "--dir", dir, "--fresh", "--api", CLOSED]);
    expect(readdirSync(base).filter((n) => n.startsWith("week.old-"))).toHaveLength(1);
    expect(existsSync(join(dir, "noonchi.db"))).toBe(true);
  }, 60_000);
});

describe("서버가 꺼졌는지(--fresh·--scripted)", () => {
  /** 연결은 받지만 답을 늦게(3초) 주는 서버: 켜져 있을 수 있다. */
  async function slowServer(): Promise<string> {
    const srv = createServer((_req, res) => { setTimeout(() => { res.writeHead(200); res.end("{}"); }, 3000); });
    servers.push(srv);
    const { port } = await listenRetry(srv, 0, "127.0.0.1");
    return `http://127.0.0.1:${port}`;
  }

  it("서버가 늦게 답하면(시간 초과) 꺼졌다고 보지 않고 멈춘다: --fresh는 폴더를 옮기지 않고, --scripted는 DB에 쓰지 않는다", async () => {
    const base = tmp();
    const dir = join(base, "week");
    await run(["week", "--dir", dir, "--api", CLOSED]);
    const slow = await slowServer();
    await expect(run(["week", "--dir", dir, "--fresh", "--api", slow])).rejects.toThrow(/서버가 꺼졌는지 알 수 없어요/);
    expect(readdirSync(base)).toEqual(["week"]);
    await expect(run(["reflect", "--scripted", "--dir", dir, "--api", slow])).rejects.toThrow(/서버가 꺼졌는지 알 수 없어요/);
    const db = HistoryDb.open(join(dir, "noonchi.db"), 540);
    expect(db.list({ kinds: ["reflection"] })).toEqual([]);
    db.close();
  }, 60_000);

  it("그 폴더를 쓰는 서버가 다른 포트에서 돌면(그 폴더의 서버 잠금 파이프에 붙음) --api가 꺼져 있어도 멈추고, 서버가 없으면 진행한다", async () => {
    const base = tmp();
    const dir = join(base, "week");
    await run(["week", "--dir", dir, "--api", CLOSED]);
    // 다른 포트에 뜬 서버: 그 폴더의 서버 잠금을 잡고 있다
    const held = await acquireServerLock(dir);
    try {
      await expect(run(["week", "--dir", dir, "--fresh", "--api", CLOSED])).rejects.toThrow(/이 폴더를 쓰는 서버가 켜져 있어요/);
      expect(readdirSync(base)).toEqual(["week"]);
      await expect(run(["reflect", "--scripted", "--dir", dir, "--api", CLOSED])).rejects.toThrow(/이 폴더를 쓰는 서버가 켜져 있어요/);
      const db = HistoryDb.open(join(dir, "noonchi.db"), 540);
      expect(db.list({ kinds: ["reflection"] })).toEqual([]);
      db.close();
    } finally {
      await held.release();
    }
    // 서버가 끝났다(잠금을 놓았다): 진행한다
    await run(["reflect", "--scripted", "--dir", dir, "--api", CLOSED]);
    await run(["week", "--dir", dir, "--fresh", "--api", CLOSED]);
    expect(readdirSync(base).filter((n) => n.startsWith("week.old-"))).toHaveLength(1);
  }, 60_000);
});

describe("장면 시작 위치", () => {
  it("startFor가 식탁 앞 1.5m에서 식탁을 보는 방향을 내고 그 자리가 방 안이다", () => {
    const scene = loadScene(resolveHome("twin", "mokryeon_180b"))!;
    const table = (scene.objects as { id: string; room: string; plan: { position: number[] } }[]).find((o) => o.id === "dining_table_978b20c7")!;
    const { position, yaw_deg } = startFor(scene, DEMO_STARTS.cup.target, 1.5);
    const [tx, ty] = table.plan.position as [number, number];
    expect(Math.hypot(position[0] - tx, position[1] - ty)).toBeCloseTo(1.5, 2);
    const toward = (Math.atan2(ty - position[1], tx - position[0]) * 180) / Math.PI;
    expect(Math.abs(((yaw_deg - toward + 540) % 360) - 180)).toBeLessThan(0.2);
    const room = (scene.plan.rooms as { id: string; polygon: number[][] }[]).find((r) => r.id === table.room)!;
    expect(insidePolygon(position, room.polygon)).toBe(true);
  });

  it("start는 지금 집이 원룸이면 시작 위치를 보내지 않고 멈춘다. 한양목련이면 그 장면 시작 위치를 보낸다", async () => {
    const one = await fakeServer("oneroom");
    await expect(run(["start", "cup", "--api", one.url])).rejects.toThrow(DemoStop);
    expect(one.started).toEqual([]);
    const mk = await fakeServer();
    await run(["start", "tv", "--api", mk.url]);
    expect(mk.started).toHaveLength(1);
    expect(mk.started[0]).toMatchObject({ home: "mokryeon_180b", position: startFor(loadScene(resolveHome("twin", "mokryeon_180b"))!, DEMO_STARTS.tv.target, 1.8).position });
  });
});

describe("이어 반성(reflect --chain)", () => {
  const DAYS = ["2026-11-07", "2026-11-08", "2026-11-09", "2026-11-10", "2026-11-11", "2026-11-12"];

  it("가짜 서버로 1~6일을 차례로 부르고, 3일차 appliesDay가 어긋나면 3일차에서 멈춘다", async () => {
    const f = await fakeServer();
    await run(["reflect", "--chain", "--api", f.url]);
    expect(f.versions.slice(1).map((v) => v.day)).toEqual(DAYS);
    const g = await fakeServer();
    g.appliesFor = (d) => (d === DAYS[2] ? next(next(d)) : next(d));
    await expect(run(["reflect", "--chain", "--api", g.url])).rejects.toThrow(/2026-11-09/);
    expect(g.versions.slice(1).map((v) => v.day)).toEqual(DAYS.slice(0, 3));
  });

  it("1~3일이 이미 된 폴더에서 다시 돌리면 1~3일은 건너뛰고 4일부터 부른다", async () => {
    const f = await fakeServer();
    DAYS.slice(0, 3).forEach((d, i) => f.versions.push({ version: i + 2, day: d, appliesDay: next(d), source: "reflection" }));
    await run(["reflect", "--chain", "--api", f.url]);
    expect(f.versions.slice(4).map((v) => v.day)).toEqual(DAYS.slice(3));
    expect(runs(f)).toHaveLength(3);
  });

  it("4일차 다음 날이 다른 판본으로 고정돼 있으면 부르지 않고 멈춘다", async () => {
    const f = await fakeServer();
    DAYS.slice(0, 3).forEach((d, i) => f.versions.push({ version: i + 2, day: d, appliesDay: next(d), source: "reflection" }));
    f.pins.set(next(DAYS[3]!), 1);
    await expect(run(["reflect", "--chain", "--api", f.url])).rejects.toThrow(/앞 판의 고정이 남아 있어요/);
    expect(runs(f)).toEqual([]);
  });
});

describe("오늘부터 쓰는 반성(reflect)", () => {
  it("오늘 pinned가 있으면 부르지 않는다", async () => {
    const f = await fakeServer();
    f.pins.set(TODAY, 1);
    await expect(run(["reflect", "--api", f.url])).rejects.toThrow(/폰을 켜기 전에 반성하세요/);
    expect(runs(f)).toEqual([]);
  });

  it("반성 뒤 오늘이 다른 판본으로 고정돼 있으면 멈춘다. 아니면 어제를 반성해 오늘부터 쓴다", async () => {
    const f = await fakeServer();
    f.pinAfterRun = () => f.pins.set(TODAY, 1);
    await expect(run(["reflect", "--api", f.url])).rejects.toThrow(/반성 중에 판단이 오늘 기억을 고정했어요/);
    const ok = await fakeServer();
    const logs = await run(["reflect", "--api", ok.url]);
    expect(ok.versions.at(-1)).toMatchObject({ day: "2026-11-13", appliesDay: TODAY });
    expect(logs.join("\n")).toContain("reflect --scripted");
  });

  it("--scripted는 서버 없이 오늘부터 쓰는 판본에 말없는 에어컨 습관을 넣고 반성 줄에 합성 표시를 단다", async () => {
    const dir = join(tmp(), "week");
    await run(["week", "--dir", dir, "--api", CLOSED]);
    await run(["reflect", "--scripted", "--dir", dir, "--api", CLOSED]);
    const db = HistoryDb.open(join(dir, "noonchi.db"), 540);
    const v = db.memoryFor(TODAY)!;
    expect(v).toMatchObject({ source: "synthetic", appliesDay: TODAY });
    expect((v.memory as FsmMemory).states.flatMap((s) => s.rules).some(silentAircon)).toBe(true);
    const row = db.list({ kinds: ["reflection"] }).at(-1)!;
    expect(row.data).toMatchObject({ synthetic: true, ok: true, version: v.version, applies_day: TODAY });
    expect((row.data as { active: { action: string; trigger: string }[] }).active.some(silentAircon)).toBe(true);
    db.close();
  }, 60_000);
});
