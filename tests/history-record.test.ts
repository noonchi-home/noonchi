// 서버의 기록 연결: 가전 변화·계획이 RUNTIME_DIR/noonchi.db 한 시간축에 남는다. 시작 상태는 변화로 적지 않는다.
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { PlanView } from "../src/contract/plan.js";
import { HistoryDb } from "../src/brain/history/db.js";
import { recordWrites } from "../src/record/history.js";
import { fetchRetry } from "../src/shared/net.js";
import { startServer, type RunningServer } from "../src/server/start.js";

let srv: RunningServer | undefined;
afterEach(async () => {
  await srv?.close();
  srv = undefined;
});

const post = async (path: string, body: unknown) => {
  const r = await fetchRetry(`${srv!.url}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return { status: r.status, json: (await r.json()) as Record<string, unknown> };
};
const docPlan = (): PlanView => {
  const md = readFileSync(new URL("../docs/plan-contract.md", import.meta.url), "utf8");
  return JSON.parse(/```json\r?\n([\s\S]*?)```/.exec(md)![1]!).plan as PlanView;
};

describe("서버 기록 연결", () => {
  it("가전 명령으로 바뀐 값과 받은 계획을 기록 DB에 적고, 닫은 뒤 다시 열어도 남는다", async () => {
    const runtime = mkdtempSync(join(tmpdir(), "rt-"));
    srv = await startServer({ env: { HUB: "memory", PORT: "0", HOME_ID: "oneroom", RUNTIME_DIR: runtime }, log: () => {} });
    expect(srv.history.list({ kinds: ["device"] })).toEqual([]);
    expect((await post("/api/devices/ac_1/command", { command: { type: "on" } })).status).toBe(200);
    // 쓰기는 기록 작업 스레드가 커밋한 뒤에 읽힌다
    await srv.historyWriter.flush();
    const rows = srv.history.list({ kinds: ["device"] });
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.subject === "ac_1")).toBe(true);
    const label = srv.twin.devices.find((d) => d.id === "ac_1")!.label;
    expect(rows.every((r) => r.text.startsWith(`${label} `))).toBe(true);
    expect((await post("/api/plan", { plan: docPlan() })).status).toBe(200);
    await srv.historyWriter.flush();
    expect(srv.history.list({ kinds: ["plan"] }).map((r) => [r.subject, r.text])).toEqual([["cup-1", "컵 치우기 진행 중"]]);
    await srv.close();
    srv = undefined;
    const db = HistoryDb.open(join(runtime, "noonchi.db"));
    try {
      expect(db.list({ kinds: ["device", "plan"] }).length).toBe(rows.length + 1);
    } finally {
      db.close();
    }
  });
});

describe("사람 방 기록", () => {
  it("사람 방 변화 줄 data에 방 id를 남긴다", () => {
    const db = HistoryDb.open(":memory:");
    const T = Date.parse("2026-11-27T08:10:00+09:00");
    recordWrites(db, { now: () => T })["/world/changes"]!({ changes: [{ kind: "person_room", at_ms: T, subject: "person", text: "사람 주방에 있음", meaningful: true, room: "kitchen" }] }, T, {} as never);
    expect(db.list({ kinds: ["world"] })[0]!.data).toMatchObject({ kind: "person_room", room: "kitchen" });
  });
});
