// 기록 API: GET /api/history, GET /api/history/day/{날짜}, GET /api/decisions.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { fetchRetry } from "../src/server/net.js";
import { startServer, type RunningServer } from "../src/server/start.js";

type Msg = Record<string, any>;
let srv: RunningServer | undefined;
afterEach(async () => {
  await srv?.close();
  srv = undefined;
});

const get = async (path: string) => {
  const r = await fetchRetry(`${srv!.url}${path}`);
  return { status: r.status, json: (await r.json()) as Msg };
};
const t = (h: number, m: number) => Date.UTC(2026, 10, 7, h - 9, m); // 서울 시각
const world = { objects: [], person_visible: true, vlm_missing: 0, yolo_missing: 0 };

async function start() {
  srv = await startServer({ env: { HUB: "memory", PORT: "0", RUNTIME_DIR: mkdtempSync(join(tmpdir(), "rt-")) }, log: () => {} });
  const db = srv.history;
  db.add("detection", t(8, 0), "사람 보임");
  for (const [i, action] of [[1, "대기"], [2, "컵 치우기"]] as const) {
    db.add("pam_text", t(8, i), `보낸 텍스트 ${i}`, { subject: `pam-${i}` });
    db.add("decision", t(8, i), action, { subject: `pam-${i}`, data: { seq: i, status: "valid", prediction: { observation: "o", reasoning: "r", task_index: i - 2 }, memory_version: 1, world } });
  }
  db.add("pam_text", t(8, 3), "다시 켠 뒤 같은 번호", { subject: "pam-1" });
  db.add("decision", t(8, 3), "판단 실패: PAM 연결 실패", { subject: "pam-1", data: { seq: 1, status: "failed", prediction: null, memory_version: 1, world } });
  db.add("feedback", t(8, 4), "다 마신 뒤에만 치워 줘");
}

describe("기록 API", () => {
  it("GET /api/history: 종류·시각으로 거르고, since가 없으면 최근 줄을 시각 순으로", async () => {
    await start();
    const decisions = await get("/api/history?kinds=decision");
    expect(decisions.status).toBe(200);
    expect(decisions.json.rows.map((r: Msg) => r.text)).toEqual(["대기", "컵 치우기", "판단 실패: PAM 연결 실패"]);
    expect((await get(`/api/history?since=${t(8, 2)}&until=${t(8, 3)}&kinds=decision,pam_text`)).json.rows.map((r: Msg) => r.kind)).toEqual(["pam_text", "decision", "pam_text", "decision"]);
    expect((await get("/api/history?limit=2")).json.rows.map((r: Msg) => r.text)).toEqual(["판단 실패: PAM 연결 실패", "다 마신 뒤에만 치워 줘"]);
    expect((await get(`/api/history?since=${t(8, 0)}&limit=1`)).json.rows.map((r: Msg) => r.text)).toEqual(["사람 보임"]);
    expect((await get("/api/history?kinds=decision")).json.rows[0]).toMatchObject({ day: "2026-11-07", subject: "pam-1", data: { seq: 1 } });
  });

  it("GET /api/history: 모르는 종류·숫자가 아닌 시각·범위 밖 limit은 400", async () => {
    await start();
    expect((await get("/api/history?kinds=photo_bytes")).status).toBe(400);
    expect((await get("/api/history?since=어제")).status).toBe(400);
    expect((await get("/api/history?limit=0")).status).toBe(400);
    expect((await get("/api/history?limit=5001")).status).toBe(400);
  });

  it("GET /api/history/day/{날짜}: 하루 요약, 없는 날짜는 400, 날짜 모양이 아니면 404", async () => {
    await start();
    const day = await get("/api/history/day/2026-11-07");
    expect(day.status).toBe(200);
    expect(day.json).toMatchObject({ ok: true, day: "2026-11-07", counts: { decision: 3, pam_text: 3, detection: 1, feedback: 1 }, dropped: { observation: 0, action: 0 } });
    expect(day.json.observation_text).toBe("08:00:00 사람 보임\n[하루] VLM 분석 0장 · VLM 분석 없음 0장 · YOLOX 분석 없음 0장");
    expect(day.json.action_summary).toBe("08:01:00 클로이드 판단: 대기\n08:02:00 클로이드 판단: 컵 치우기\n08:03:00 클로이드 판단: 판단 실패: PAM 연결 실패\n08:04:00 사용자: 다 마신 뒤에만 치워 줘");
    expect((await get("/api/history/day/2026-02-30")).status).toBe(400);
    expect((await get("/api/history/day/어제")).status).toBe(404);
  });

  it("GET /api/decisions: 최근 판단과 그때 보낸 관찰 텍스트(번호가 같아도 같은 시각의 것)", async () => {
    await start();
    const r = await get("/api/decisions?limit=2");
    expect(r.status).toBe(200);
    expect(r.json.decisions).toEqual([
      { id: "pam-2", at_ms: t(8, 2), day: "2026-11-07", text: "컵 치우기", text_sent: "보낸 텍스트 2", seq: 2, status: "valid", prediction: { observation: "o", reasoning: "r", task_index: 0 }, memory_version: 1, world },
      { id: "pam-1", at_ms: t(8, 3), day: "2026-11-07", text: "판단 실패: PAM 연결 실패", text_sent: "다시 켠 뒤 같은 번호", seq: 1, status: "failed", prediction: null, memory_version: 1, world },
    ]);
    expect((await get("/api/decisions")).json.decisions).toHaveLength(3);
    expect((await get("/api/decisions?limit=501")).status).toBe(400);
  });
});
