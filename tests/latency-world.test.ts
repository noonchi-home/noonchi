// 지연 예산(stage-queue 묶음 2): 폰 엔진 프레임이 서버에 닿아 집 상태 변화가 발행되기(대시보드 world)까지 걸린 시간.
// 감지기는 바로 실패하는 대본 감지기라 YOLO 시간은 빠지고, 프레임마다 변화 하나(YOLO 분석 없음)가 나서 서버 안 길
// (관찰 흐름 → World State → 발행 → 대시보드)의 지연을 프레임마다 잴 수 있다. 정상 감지 프레임도 변화가 나면 같은 길을 지난다.
// 프레임 짝 맞추기: 대시보드 world의 yolo_missing 수가 그 프레임 차례다(모든 프레임이 VLM 프레임이어야 감지 실패가 변화로 난다: VLM_FRAME_MS = ENGINE_FRAME_MS).
// 기준(tests/fixtures/latency/world.json)은 단계 사이를 통로로 바꾸기 전 이 시험으로 잰 값이다. LATENCY_BASELINE=write면 기준을 다시 쓴다.
// 한도: p95가 기준 p95의 1.5배와 기준 p95 + 10ms 가운데 큰 값을 넘으면 실패한다(묶음 2 끝 조건).
// 한 번 넘으면 같은 서버로 한 번 더 잰다(이 PC에서 다른 일이 잠깐 몰리면 한 판이 두 배까지 튀었다: 2026-11-18 p95 25.4ms, 바로 다음 판 12.7ms).
// 두 판 다 넘어야 실패한다: 정말 느려졌으면 두 판 다 넘는다.
import { appendFileSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { afterEach, describe, expect, it } from "vitest";
import type WebSocket from "ws";
import { startFakeOpenAI, type FakeServer } from "../scripts/fake-openai.js";
import { encodeFramePacket } from "../src/phone/packet.js";
import { startServer, type RunningServer } from "../src/server/start.js";
import { ScriptedDetector, det } from "./helpers/detectors.js";
import { startFakePamLlm, type FakePamLlm, pamLlmEnv } from "./helpers/pam.js";
import { openPhone, openWebSocket } from "./helpers/ws.js";

type Msg = Record<string, any>;
const BASELINE = new URL("./fixtures/latency/world.json", import.meta.url);
const SAMPLES = 40;
const GAP_MS = 150;

let srv: RunningServer | undefined;
let fake: FakeServer | undefined;
let pam: FakePamLlm | undefined;
const sockets: WebSocket[] = [];
afterEach(async () => {
  for (const s of sockets.splice(0)) s.close();
  await srv?.close();
  srv = undefined;
  await fake?.close();
  fake = undefined;
  await pam?.close();
  pam = undefined;
});

const pct = (xs: number[], p: number) => { const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))]!; };
const round = (x: number) => Math.round(x * 10) / 10;
/** 잰 값을 남긴다: LATENCY_OUT 파일이 있으면 한 줄 JSON으로 더한다(시험 출력은 console을 보이지 않을 수 있다). */
const report = (what: string, v: unknown) => { if (process.env.LATENCY_OUT) appendFileSync(process.env.LATENCY_OUT, JSON.stringify({ what, v }) + "\n"); };

describe("지연 예산", () => {
  it("엔진 프레임 → 집 상태 발행(대시보드 world) 지연 p95가 기준 한도 안이다", async () => {
    fake = await startFakeOpenAI();
    pam = await startFakePamLlm();
    srv = await startServer({
      env: { HUB: "memory", PORT: "0", RUNTIME_DIR: mkdtempSync(join(tmpdir(), "rt-")), PHONE_PORT: "0", PHONE_HOST: "127.0.0.1", BRAIN: "1",
        VLM_BASE_URL: `${fake.url}/v1`, VLM_MODEL: "fake-vlm", ENGINE_FRAME_MS: "100", VLM_FRAME_MS: "100", ...pamLlmEnv(pam) },
      log: () => {}, brain: { detector: new ScriptedDetector(() => { throw new Error("감지 실패(지연 시험)"); }) },
    });
    const arrived = new Map<number, number>();
    let worldBytes = 0;
    const dash = await openWebSocket(`${srv.url.replace(/^http/, "ws")}/events`, {
      setup: (ws) => ws.on("message", (d) => {
        const m = JSON.parse(String(d)) as Msg;
        if (m.type === "world" && !arrived.has(m.world.yolo_missing)) {
          arrived.set(m.world.yolo_missing, performance.now());
          worldBytes = Buffer.byteLength(JSON.stringify(m.world));
        }
      }),
    });
    sockets.push(dash);
    const phoneUrl = new URL(srv.phoneUrls[0]!);
    const phone = await openPhone(`ws://${phoneUrl.host}/phone/events`, { options: { origin: phoneUrl.origin } });
    sockets.push(phone);
    await new Promise((r) => setTimeout(r, 300));
    const base = Date.now() - 60_000;
    let sentFrames = 0;
    /** 한 판: 데우기 다섯 장 + SAMPLES장. 프레임 k(서버가 받은 차례)의 world는 yolo_missing이 k+1이다. */
    const once = async () => {
      const lat: number[] = [];
      for (let j = 0; j < SAMPLES + 5; j++) {
        const i = sentFrames++;
        const sent = performance.now();
        phone.send(encodeFramePacket({ kind: "engine", width: 4, height: 3, captured_at: base + i * GAP_MS, time_err_ms: 2 }, Buffer.from([0xff, 0xd8, i & 0xff, (i >> 8) & 0xff])));
        const end = Date.now() + 3000;
        while (!arrived.has(i + 1) && Date.now() < end) await new Promise((r) => setImmediate(r));
        expect(arrived.has(i + 1), `프레임 ${i}의 world`).toBe(true);
        if (j >= 5) lat.push(arrived.get(i + 1)! - sent);   // 처음 다섯 장은 데우기
        await new Promise((r) => setTimeout(r, GAP_MS));
      }
      return { p50_ms: round(pct(lat, 50)), p95_ms: round(pct(lat, 95)), max_ms: round(Math.max(...lat)), samples: lat.length, world_bytes: worldBytes };
    };
    const first = await once();
    if (process.env.LATENCY_BASELINE === "write") {
      writeFileSync(BASELINE, JSON.stringify({ frame_to_world: first, measured: new Date().toISOString().slice(0, 10) }, null, 2) + "\n");
      report("기준 지연", first);
      return;
    }
    const want = (JSON.parse(readFileSync(BASELINE, "utf8")) as { frame_to_world: typeof first }).frame_to_world;
    const limit = Math.max(want.p95_ms * 1.5, want.p95_ms + 10);
    const got = first.p95_ms <= limit ? first : await once();
    report("프레임 → world 지연", { first, got, want, limit });
    expect(got.p95_ms, `p95 ${got.p95_ms}ms (첫 판 ${first.p95_ms}ms, 기준 ${want.p95_ms}ms, 한도 ${limit}ms)`).toBeLessThanOrEqual(limit);
  }, 90_000);

  // 재기만 한다(LATENCY_DECIDE=1): 의미 있는 변화(사람 보임·안 보임)가 발행된 뒤 판단 요청(PAM LLM)이 나가기까지. event 계기 모드.
  it.runIf(process.env.LATENCY_DECIDE === "1")("변화 발행 → 판단 시작 지연(event 모드, 재기만)", async () => {
    fake = await startFakeOpenAI();
    pam = await startFakePamLlm();
    let person = false;
    srv = await startServer({
      env: { HUB: "memory", PORT: "0", RUNTIME_DIR: mkdtempSync(join(tmpdir(), "rt-")), PHONE_PORT: "0", PHONE_HOST: "127.0.0.1", BRAIN: "1",
        VLM_BASE_URL: `${fake.url}/v1`, VLM_MODEL: "fake-vlm", ENGINE_FRAME_MS: "100", PAM_TRIGGER: "event", ...pamLlmEnv(pam) },
      log: () => {},
      brain: { detector: new ScriptedDetector(() => [det("cup", 0.9, [1, 1, 2, 1], 41), ...(person ? [det("person", 0.9, [0, 0, 3, 3])] : [])]) },
    });
    const changed: { kind: string; at: number }[] = [];
    const dash = await openWebSocket(`${srv.url.replace(/^http/, "ws")}/events`, {
      setup: (ws) => ws.on("message", (d) => {
        const m = JSON.parse(String(d)) as Msg;
        if (m.type === "brain" && m.event.type === "world_change" && /^person_(appeared|gone)$/.test(m.event.kind)) changed.push({ kind: m.event.kind, at: performance.now() });
      }),
    });
    sockets.push(dash);
    const calls: number[] = [];
    let seen = 0;
    const watch = setInterval(() => { while (pam!.calls.length > seen) { seen++; calls.push(performance.now()); } }, 1);
    const phoneUrl = new URL(srv.phoneUrls[0]!);
    const phone = await openPhone(`ws://${phoneUrl.host}/phone/events`, { options: { origin: phoneUrl.origin } });
    sockets.push(phone);
    const lat: number[] = [];
    let captured = Date.now() - 120_000;
    let i = 0;
    const frames = async (ms: number) => {
      const end = captured + ms;
      while (captured < end) {
        captured += GAP_MS;
        i++;
        phone.send(encodeFramePacket({ kind: "engine", width: 4, height: 3, captured_at: captured, time_err_ms: 2 }, Buffer.from([0xff, 0xd8, i & 0xff, (i >> 8) & 0xff])));
        await new Promise((r) => setTimeout(r, GAP_MS));
      }
    };
    await frames(6000);
    for (let k = 0; k < 4; k++) {
      person = !person;
      const before = changed.length;
      await frames(person ? 3000 : 5000);
      const c = changed.slice(before).find((x) => x.kind === (person ? "person_appeared" : "person_gone"));
      const call = c && calls.find((t) => t >= c.at);
      if (c && call !== undefined) lat.push(call - c.at);
    }
    clearInterval(watch);
    report("변화 → 판단 시작(ms)", { samples: lat.map(round), p50: round(pct(lat, 50)), max: round(Math.max(...lat)) });
    expect(lat.length).toBeGreaterThan(0);
  }, 90_000);
});
