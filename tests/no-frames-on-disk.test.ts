// 분석한 엔진 프레임은 디스크에 쓰지 않는다. DATASET_COLLECT=1일 때만 RUNTIME_DIR/dataset/에 쓴다.
import { mkdtempSync, readdirSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type WebSocket from "ws";
import { startFakeOpenAI, type FakeServer } from "../scripts/fake-openai.js";
import { encodeFramePacket } from "../src/phone/packet.js";
import { startServer, type RunningServer } from "../src/server/start.js";
import { ScriptedDetector } from "./helpers/detectors.js";
import { openPhone } from "./helpers/ws.js";

type Msg = Record<string, any>;
let srv: RunningServer | undefined;
let fake: FakeServer | undefined;
afterEach(async () => {
  await srv?.close();
  srv = undefined;
  await fake?.close();
  fake = undefined;
});
const files = (d: string): string[] => readdirSync(d).flatMap((n) => (statSync(join(d, n)).isDirectory() ? files(join(d, n)) : [join(d, n)]));
const inbox = (ws: WebSocket) => {
  const list: Msg[] = [];
  ws.on("message", (d) => list.push(JSON.parse(String(d)) as Msg));
  return list;
};
async function until(pred: () => boolean, ms = 5000) {
  const end = Date.now() + ms;
  while (!pred()) {
    if (Date.now() > end) throw new Error("시간 초과");
    await new Promise((r) => setTimeout(r, 20));
  }
}

/** 엔진 프레임 3장과 사진 찍기 1장을 보내고, VLM 분석이 셋 다 끝날 때까지 기다린다. */
async function sendFrames(env: Record<string, string>) {
  fake = await startFakeOpenAI();
  const runtime = mkdtempSync(join(tmpdir(), "rt-"));
  srv = await startServer({
    env: { HUB: "memory", PORT: "0", RUNTIME_DIR: runtime, PHONE_PORT: "0", PHONE_HOST: "127.0.0.1", BRAIN: "1", VLM_BASE_URL: `${fake.url}/v1`, PAM_URL: "http://127.0.0.1:9", ...env },
    brain: { detector: new ScriptedDetector(() => []) }, log: () => {},
  });
  const phoneUrl = new URL(srv.phoneUrls[0]!);
  let box: Msg[] = [];
  const phone = await openPhone(`ws://${phoneUrl.host}/phone/events`, { options: { origin: phoneUrl.origin }, setup: (ws) => { box = inbox(ws); } });
  try {
    await until(() => box.some((m) => m.type === "status"));
    for (let i = 1; i <= 3; i++) {
      phone.send(encodeFramePacket({ kind: "engine", width: 2, height: 2, captured_at: Date.now() - (3 - i) * 2000, time_err_ms: 0 }, Buffer.from([0xff, 0xd8, i]))); // 촬영 시각 2초 간격: 세 장 모두 VLM 프레임
      await new Promise((r) => setTimeout(r, 30));
    }
    phone.send(encodeFramePacket({ kind: "photo", width: 2, height: 2 }, Buffer.from([0xff, 0xd8, 0x77])));
    await until(() => box.some((m) => m.type === "photo_saved"));
    await until(() => srv!.history.list({ kinds: ["vlm"] }).length === 3);
  } finally {
    phone.close();
  }
  return runtime;
}

describe("사진은 디스크에 쓰지 않는다", () => {
  it("엔진 프레임을 분석해도 런타임 폴더에는 사진 찍기 사진만 있고, 사진 찍기는 photos 표와 기록에 남는다", async () => {
    const runtime = await sendFrames({});
    const images = files(runtime).filter((f) => /\.(jpe?g|png|bin)$/i.test(f));
    expect(images).toHaveLength(1);
    expect(images[0]!.startsWith(join(runtime, "photos"))).toBe(true);
    expect(srv!.history.listPhotos()).toEqual([expect.objectContaining({ origin: "photo", path: images[0] })]);
    expect(srv!.history.list({ kinds: ["photo"] })).toEqual([expect.objectContaining({ text: "사진 찍기 사진 저장" })]);
  });

  it("DATASET_COLLECT=1이면 엔진 프레임을 dataset/<날짜>/에 쓰고 photos 표에 시험 자료로 적는다", async () => {
    const runtime = await sendFrames({ DATASET_COLLECT: "1" });
    const jpgs = files(runtime).filter((f) => /\.jpe?g$/i.test(f) && f.startsWith(join(runtime, "dataset")));
    expect(jpgs).toHaveLength(3);
    const day = srv!.history.dayOf(Date.now());
    expect(jpgs.every((f) => f.startsWith(join(runtime, "dataset", day)))).toBe(true);
    const meta = JSON.parse(readFileSync(jpgs[0]!.replace(/\.jpg$/, ".json"), "utf8")) as Msg;
    expect(meta).toMatchObject({ width: 2, height: 2, eye: null, view: null });
    expect(srv!.history.listPhotos().filter((p) => p.origin === "dataset")).toHaveLength(3);
  });
});
