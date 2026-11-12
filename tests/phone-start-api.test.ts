// 시작 위치 끝까지(startServer): 설정 REST로 자리·방향 저장 → 실행 중인 폰 상태에 이름 → 폰 「여기서 시작」 → 어림 맞춤.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { startFakeOpenAI, type FakeServer } from "../scripts/fake-openai.js";
import type { DetectResult, Detector } from "../src/brain/detector.js";
import { encodeFramePacket } from "../src/phone/packet.js";
import { fetchRetry } from "../src/server/net.js";
import { startServer, type RunningServer } from "../src/server/start.js";
import { startFakePam, type FakePam } from "./helpers/pam.js";
import { look, perspective } from "./helpers/sync-sim.js";

type Msg = Record<string, any>;
let srv: RunningServer | undefined;
let fake: FakeServer | undefined;
let pam: FakePam | undefined;
const dirs: string[] = [];
afterEach(async () => {
  await srv?.close();
  srv = undefined;
  await fake?.close();
  fake = undefined;
  await pam?.close();
  pam = undefined;
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

const env = (extra: Record<string, string> = {}) => {
  const dir = mkdtempSync(join(tmpdir(), "start-api-"));
  dirs.push(dir);
  return { HUB: "memory", PORT: "0", PHONE_PORT: "0", PHONE_HOST: "127.0.0.1", RUNTIME_DIR: dir, HOME_ID: "mokryeon_180b", ...extra };
};

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
  return Object.assign(wait, { mark: () => seen.length });
}

async function phone(s: RunningServer) {
  const url = new URL(s.phoneUrls[0]!);
  const ws = new WebSocket(`ws://${url.host}/phone/events`, { origin: url.origin });
  const wait = inbox(ws);
  await new Promise<void>((res, rej) => { ws.once("open", () => res()); ws.once("error", rej); });
  return { ws, wait };
}
const json = async (path: string, body?: unknown) => {
  const res = await fetchRetry(`${srv!.url}${path}`, body === undefined ? {} : {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  });
  return { status: res.status, json: (await res.json()) as Msg };
};

describe("시작 위치 REST와 폰", () => {
  it("저장하면 이름을 채우고 폰 상태에 실린다. 폰이 「여기서 시작」하면 어림, 지우면 이름이 사라진다", async () => {
    srv = await startServer({ env: env() });
    expect((await json("/api/phone/start-pose")).json).toEqual({ ok: true, start: null });
    const p = await phone(srv);
    const first = await p.wait((m) => m.type === "status");
    expect(first.sync).toMatchObject({ state: "none", start: null, started: false });

    const mark = p.wait.mark();
    const saved = await json("/api/phone/start-pose", { home: "mokryeon_180b", position: [8.3, 10.6], yaw_deg: 0 });
    expect(saved.json).toEqual({ ok: true, start: { position: [8.3, 10.6], yaw_deg: 0, label: "거실·복도 테이블 앞", facing_label: "거실·복도 TV수납장" } });
    expect((await json("/api/phone/start-pose")).json.start.label).toBe("거실·복도 테이블 앞");
    const named = await p.wait((m) => m.type === "status" && m.sync?.start, mark);
    expect(named.sync.start).toEqual({ label: "거실·복도 테이블 앞", facing: "거실·복도 TV수납장" });

    const mark2 = p.wait.mark();
    p.ws.send(JSON.stringify({ type: "start", position: [0, 0.05, 0], orientation: look(0, -0.2), epoch: "ep1" }));
    const started = await p.wait((m) => m.type === "status" && m.sync?.started, mark2);
    expect(started).toMatchObject({ aligned: false, sync: { state: "estimated", source: "start" } });
    const sync = (await json("/api/phone/sync")).json.sync;
    expect(sync).toMatchObject({ aligned: false, started: true, source: "start" });
    expect(sync.rigid.tx).toBeCloseTo(8.3, 6);
    expect(sync.rigid.ty).toBeCloseTo(10.6, 6);

    const mark4 = p.wait.mark();
    expect((await json("/api/phone/start-pose/clear", {})).json).toEqual({ ok: true, start: null });
    const cleared = await p.wait((m) => m.type === "status" && m.sync && m.sync.start === null, mark4);
    expect(cleared.sync.start).toBeNull();
    p.ws.close();
  });

  it("집 범위 밖·방향 없음은 400, 다른 집은 409", async () => {
    srv = await startServer({ env: env() });
    expect((await json("/api/phone/start-pose", { position: [99, 1], yaw_deg: 0 })).status).toBe(400);
    const noYaw = await json("/api/phone/start-pose", { position: [8.3, 10.6] });
    expect(noYaw.status).toBe(400);
    expect(noYaw.json.error).toContain("방향");
    expect((await json("/api/phone/start-pose", { home: "oneroom", position: [8.3, 10.6], yaw_deg: 0 })).status).toBe(409);
  });

  it("엔진 프레임 YOLO의 기준점 상자가 그 프레임 자세와 함께 위치 맞추기로 간다(관찰 흐름 BRAIN=1)", async () => {
    fake = await startFakeOpenAI();
    pam = await startFakePam();
    // 소파(COCO 57) 상자 하나를 내는 감지기
    const sofa: Detector = {
      name: "landmark-only", pose: null, provider: "test",
      detect: async (): Promise<DetectResult> => ({ detections: [], ms: 0, width: 360, height: 640, landmarks: [{ cls: 57, score: 0.9, box: [130, 300, 100, 160] }] }),
    };
    srv = await startServer({
      env: env({ BRAIN: "1", VLM_BASE_URL: `${fake.url}/v1`, VLM_MODEL: "fake-vlm", ENGINE_FRAME_MS: "500", PAM_URL: pam.url }),
      log: () => {}, brain: { detector: sofa },
    });
    await json("/api/phone/start-pose", { position: [8.3, 10.6], yaw_deg: 180 });
    const p = await phone(srv);
    await p.wait((m) => m.type === "status" && m.sync?.start);
    const orientation = look(0, -0.4);
    p.ws.send(JSON.stringify({ type: "start", position: [0, 1.4, 0], orientation, epoch: "ep1" }));
    await p.wait((m) => m.type === "status" && m.sync?.started);
    const projection = perspective(1.08, 360 / 640);
    for (let i = 1; i <= 2; i++) {
      p.ws.send(encodeFramePacket({ kind: "engine", width: 360, height: 640, position: [0, 1.4, 0], orientation, projection, epoch: i === 1 ? "old" : "ep1", captured_at: Date.now() }, Buffer.from([0xff, 0xd8, i])));
    }
    const start = Date.now();
    let observed = 0;
    while (Date.now() - start < 5000) {
      observed = (await json("/api/phone/sync")).json.sync.observed.landmarks;
      if (observed > 0) break;
      await new Promise((r) => setTimeout(r, 50));
    }
    // 다른 원점(old)의 프레임은 버리고 지금 원점 프레임 하나만
    expect(observed).toBe(1);
    p.ws.close();
  }, 20_000);
});
