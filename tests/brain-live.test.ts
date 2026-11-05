// 실시간 두뇌 연결: 촬영 시각 보정, LiveBrain 메시지 나눔(대시보드·폰), startServer(BRAIN=1) + 폰 WebSocket 왕복.

import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { DEFAULT_BRAIN_CONFIG } from "../src/brain/config.js";
import { MockDecision } from "../src/brain/decision.js";
import { ScriptedDetector, type Detection } from "../src/brain/detector.js";
import { LiveBrain, captureTime } from "../src/brain/live.js";
import { ScriptedPerceiver, type RawPerception } from "../src/brain/perception.js";
import { encodeFramePacket, type FrameHeader } from "../src/phone/packet.js";
import { fetchRetry } from "../src/server/net.js";
import { startServer, type RunningServer } from "../src/server/start.js";
import { openWebSocket } from "./helpers/ws.js";

type Msg = Record<string, any>;
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
const PHOTO = Buffer.from([0xff, 0xd8, 0x02, 0xff, 0xd9]);
const base: RawPerception = {
  person_present: "no", person_holding_cup: "no", drinking: "no", cup_visible: "yes", cup_support: "table",
  cup_contents: { visible: false, value: "unknown", certain: false }, note: "",
};
const drinking: RawPerception = { ...base, person_present: "yes", person_holding_cup: "yes", drinking: "yes", cup_support: "hand" };
const person: Detection = { label: "person", score: 0.9, box: [0, 0, 1, 1], cls: 0 };
const cup: Detection = { label: "cup", score: 0.8, box: [0, 0, 1, 1], cls: 41 };

describe("captureTime", () => {
  it("폰 동기 시각이 있으면 오차만큼 이른 시각(가장 이른 가능 시각)", () => {
    expect(captureTime({ receivedAtMs: 10_000, capturedAt: 9_900, timeErrMs: 30, eye: null })).toEqual({ atMs: 9_870, latestMs: 9_930, source: "phone" });
  });
  it("받은 시각보다 늦을 수 없다", () => {
    expect(captureTime({ receivedAtMs: 10_000, capturedAt: 10_500, timeErrMs: 10, eye: null })).toMatchObject({ atMs: 10_000, latestMs: 10_000 });
  });
  it("동기 정보가 없거나 오차가 없으면 받은 시각(received)", () => {
    expect(captureTime({ receivedAtMs: 10_000, capturedAt: 9_900, eye: null })).toEqual({ atMs: 10_000, latestMs: 10_000, source: "received" });
    expect(captureTime({ receivedAtMs: 10_000, eye: null })).toEqual({ atMs: 10_000, latestMs: 10_000, source: "received" });
  });
});

describe("LiveBrain", () => {
  it("요청은 폰 큰 글씨로, 행동은 폰 부탁(버튼·dry_run)으로, 폰 답은 결과로. 대시보드에는 모두 brain 이벤트로", async () => {
    let now = 0;
    let phase: "drink" | "away" | "gone" = "drink";
    const toPhone: Msg[] = [];
    const toDash: Msg[] = [];
    const live = new LiveBrain({
      config: { ...DEFAULT_BRAIN_CONFIG, awayMs: 2000 },
      perceiver: new ScriptedPerceiver((frames) => {
        if (frames.length === 1 && frames[0]!.jpeg === PHOTO) return { ...base, cup_contents: { visible: true, value: "empty", certain: true } };
        return phase === "drink" ? drinking : phase === "gone" ? { ...base, cup_visible: "no", cup_support: "unknown" } : base;
      }),
      detector: new ScriptedDetector(() => (phase === "drink" ? [person, cup] : phase === "away" ? [cup] : [])),
      decision: new MockDecision(),
      surfaces: () => [],
      toDashboard: (m) => toDash.push(m as Msg), toPhone: (m) => toPhone.push(m as Msg),
      clock: { now: () => now }, tickMs: 60_000,
    });
    const step = async (t: number) => {
      now = t;
      live.onFrame(JPEG, { receivedAtMs: t, capturedAt: t - 20, timeErrMs: 5, eye: null });
      await live.idle();
      live.brain.tick();
      await live.idle();
    };
    try {
      for (let t = 0; t <= 2000; t += 84) await step(t);
      phase = "away";
      for (let t = 2084; t <= 7000; t += 84) await step(t);
      const req = toPhone.find((m) => m.type === "request" && m.active);
      expect(req).toMatchObject({ text: "컵 안이 보이게 위에서 찍어 주세요" });
      now = 7050;
      expect(live.onPhoto(PHOTO, { receivedAtMs: 7050, capturedAt: 7040, timeErrMs: 5, eye: null })).toBe("answer");
      await live.idle();
      for (let t = 7084; t <= 18_000 && !toPhone.some((m) => m.type === "action"); t += 84) await step(t);
      const action = toPhone.find((m) => m.type === "action" && m.active)!;
      expect(action).toMatchObject({ task: "컵 치우기", dry_run: true, text: "식탁 위 컵을 치워 주세요" });
      expect(action.choices.map((c: Msg) => c.id)).toEqual(["done", "later"]);
      live.onReply(action.id, "later");
      expect(toPhone.find((m) => m.type === "action" && !m.active)).toBeTruthy();
      expect(toDash.some((m) => m.type === "brain" && m.event.type === "result" && m.event.outcome === "declined")).toBe(true);
      expect(toDash.some((m) => m.type === "brain" && m.event.type === "presence")).toBe(true);
      expect(toPhone.some((m) => m.type === "brain_line" && /실행\(모의\)/.test(m.text))).toBe(true);
      expect(live.status()).toMatchObject({ state: "done", detector: "scripted", decision: "mock", time_source: "phone" });
    } finally {
      await live.close();
    }
  }, 30_000);
});

let srv: RunningServer | undefined;
afterEach(async () => {
  await srv?.close();
  srv = undefined;
});

function inbox(ws: WebSocket): Msg[] {
  const list: Msg[] = [];
  ws.on("message", (d, binary) => { if (!binary) list.push(JSON.parse(String(d)) as Msg); });
  return list;
}
async function until(list: Msg[], pred: (m: Msg) => boolean, ms = 5000): Promise<Msg> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const hit = list.find(pred);
    if (hit) return hit;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error("메시지가 오지 않았습니다");
}

describe("startServer(BRAIN=1) + 폰", () => {
  it("BRAIN=1인데 PHONE_PORT가 없으면 두뇌를 끄고 알린다", async () => {
    const lines: string[] = [];
    srv = await startServer({ env: { HUB: "memory", PORT: "0", AGENT_PROVIDER: "mock", BRAIN: "1" }, log: (l) => lines.push(l) });
    expect(lines.some((l) => l.includes("BRAIN=1은 PHONE_PORT"))).toBe(true);
    expect(((await (await fetchRetry(`${srv.url}/api/health`)).json()) as Msg).brain).toBe(false);
  });

  it("폰 시계 핑에 답하고, 프레임 → 두뇌 → 대시보드 brain 이벤트·폰 요청, 사진 답, /api/brain 상태", async () => {
    let phase: "drink" | "away" = "drink";
    srv = await startServer({
      env: { HUB: "memory", PORT: "0", AGENT_PROVIDER: "mock", PHONE_PORT: "0", PHONE_HOST: "127.0.0.1", BRAIN: "1", BRAIN_AWAY_MS: "300" },
      log: () => {},
      brain: {
        perceiver: new ScriptedPerceiver((frames) => {
          if (frames.length === 1 && frames[0]!.jpeg.equals(PHOTO)) return { ...base, cup_contents: { visible: true, value: "empty", certain: true } };
          return phase === "drink" ? drinking : base;
        }),
        detector: new ScriptedDetector(() => (phase === "drink" ? [person, cup] : [cup])),
        decision: new MockDecision(),
      },
    });
    expect(((await (await fetchRetry(`${srv.url}/api/health`)).json()) as Msg).brain).toBe(true);
    const phoneUrl = new URL(srv.phoneUrls[0]!);
    let dashBox: Msg[] = [];
    const dash = await openWebSocket(`${srv.url.replace(/^http/, "ws")}/events`, { setup: (ws) => { dashBox = inbox(ws); } });
    let phoneBox: Msg[] = [];
    const phone = await openWebSocket(`ws://${phoneUrl.host}/phone/events`, { options: { origin: phoneUrl.origin }, setup: (ws) => { phoneBox = inbox(ws); } });
    try {
      phone.send(JSON.stringify({ type: "clock", t0: 1234.5 }));
      expect(await until(phoneBox, (m) => m.type === "clock")).toMatchObject({ t0: 1234.5, server: expect.any(Number) });
      const send = (kind: FrameHeader["kind"], jpeg: Buffer) => {
        const t = Date.now();
        phone.send(encodeFramePacket({ kind, width: 4, height: 3, captured_at: t - 15, time_err_ms: 3 }, jpeg));
      };
      const start = Date.now();
      while (Date.now() - start < 600) {
        send("frame", JPEG);
        await new Promise((r) => setTimeout(r, 40));
      }
      await until(dashBox, (m) => m.type === "brain" && m.event.type === "brain" && m.event.text === "컵으로 마시는 중");
      phase = "away";
      const t0 = Date.now();
      while (!phoneBox.some((m) => m.type === "request" && m.active) && Date.now() - t0 < 5000) {
        send("frame", JPEG);
        await new Promise((r) => setTimeout(r, 40));
      }
      expect(await until(phoneBox, (m) => m.type === "request" && m.active)).toMatchObject({ text: "컵 안이 보이게 위에서 찍어 주세요" });
      expect(phoneBox.some((m) => m.type === "brain_line" && /자리 비움 확인/.test(m.text))).toBe(true);
      await new Promise((r) => setTimeout(r, 30));
      send("photo", PHOTO);
      expect(await until(phoneBox, (m) => m.type === "photo_saved")).toMatchObject({ answer: true });
      await until(dashBox, (m) => m.type === "brain" && m.event.type === "brain" && /컵 안 확인: 빈 컵/.test(m.event.text));
      const status = (await (await fetchRetry(`${srv.url}/api/brain`)).json()) as Msg;
      expect(status).toMatchObject({ ok: true, detector: "scripted", decision: "mock", time_source: "phone", time_err_ms: 3 });
      expect(status.frames).toBeGreaterThan(5);
    } finally {
      dash.close();
      phone.close();
    }
  }, 30_000);
});
