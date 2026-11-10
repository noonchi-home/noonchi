// 한양목련 끝까지(가짜 서버, 시험 모드): 시작 위치로 맞춘 폰이 주방에서 냉장고를 비춤 → YOLO(대본) 냉장고 상자 → VLM(가짜 OpenAI 호환 서버) 「열림」
// → World State가 트윈 냉장고에 맞춤 → 허브 상태 문 열림(카메라로 봄) → 대시보드 state 메시지·PAM 관찰 텍스트.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type WebSocket from "ws";
import { startFakeOpenAI, type FakeServer } from "../scripts/fake-openai.js";
import { encodeFramePacket } from "../src/phone/packet.js";
import { startServer, type RunningServer } from "../src/server/start.js";
import { alignOnServer } from "./helpers/align.js";
import { ScriptedDetector } from "./helpers/detectors.js";
import { startFakePam, type FakePam } from "./helpers/pam.js";
import { openWebSocket } from "./helpers/ws.js";

type Msg = Record<string, any>;
let srv: RunningServer | undefined;
let fake: FakeServer | undefined;
let pam: FakePam | undefined;
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

const inbox = (list: Msg[]) => (ws: WebSocket) => ws.on("message", (d, bin) => { if (!bin) list.push(JSON.parse(String(d)) as Msg); });

const PROJECTION = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, -1.0002, -1, 0, 0, -0.020002, 0];
const mul = (a: number[], b: number[]) => [a[3]! * b[0]! + a[0]! * b[3]! + a[1]! * b[2]! - a[2]! * b[1]!, a[3]! * b[1]! - a[0]! * b[2]! + a[1]! * b[3]! + a[2]! * b[0]!, a[3]! * b[2]! + a[0]! * b[1]! - a[1]! * b[0]! + a[2]! * b[3]!, a[3]! * b[3]! - a[0]! * b[0]! - a[1]! * b[1]! - a[2]! * b[2]!];
// 폰 눈: 주방·식당에서 냉장고 가운데([5.9191, 0.925, 2.4596])를 화면 한가운데로 본다
const FRIDGE: [number, number, number] = [5.9191, 0.925, 2.4596];
const EYE: [number, number, number] = [7.4, 1.5, 2.46];
const YAW = Math.atan2(-(FRIDGE[0] - EYE[0]), -(FRIDGE[2] - EYE[2]));
const PITCH = Math.atan2(FRIDGE[1] - EYE[1], Math.hypot(FRIDGE[0] - EYE[0], FRIDGE[2] - EYE[2]));
const ORIENTATION = mul([0, Math.sin(YAW / 2), 0, Math.cos(YAW / 2)], [Math.sin(PITCH / 2), 0, 0, Math.cos(PITCH / 2)]) as [number, number, number, number];
const FRIDGE_ID = "fridge_bbc363a3";

describe("카메라로 가전 상태 맞추기, 한양목련 끝까지", () => {
  it("주방에서 냉장고가 열려 보이면 트윈 냉장고 문이 열림이 되고, 대시보드와 PAM 관찰 텍스트가 카메라로 본 것을 받는다", async () => {
    fake = await startFakeOpenAI({
      reply: (body) => {
        if (body?.response_format?.json_schema?.name !== "scene_observation") return null;
        const parts = (body.messages as { role: string; content: unknown }[]).filter((m) => m.role === "user").flatMap((m) => (Array.isArray(m.content) ? m.content : [{ text: m.content }]));
        const text = parts.map((p: { text?: unknown }) => (typeof p.text === "string" ? p.text : "")).join("\n");
        const dets = JSON.parse(/Detections: (\[.*\])/.exec(text)?.[1] ?? "[]") as { id: string }[];
        return JSON.stringify({ scene: "kitchen", observations: dets.map((d) => ({ object_id: d.id, state: "open" })), summary: "냉장고 문이 열려 있다" });
      },
    });
    pam = await startFakePam();
    srv = await startServer({
      env: { HUB: "memory", PORT: "0", HOME_ID: "mokryeon_180b", RUNTIME_DIR: mkdtempSync(join(tmpdir(), "rt-")), PHONE_PORT: "0", PHONE_HOST: "127.0.0.1",
        BRAIN: "1", VLM_BASE_URL: `${fake.url}/v1`, PAM_URL: pam.url, PAM_PERIOD_MS: "1000" },
      brain: { detector: new ScriptedDetector(() => [{ label: "refrigerator", score: 0.9, cls: 72, box: [180, 120, 120, 120] }]) }, log: () => {},
    });
    const dash: Msg[] = [];
    sockets.push(await openWebSocket(`${srv.url.replace(/^http/, "ws")}/events`, { setup: inbox(dash) }));
    const phoneUrl = new URL(srv.phoneUrls[0]!);
    const phone: Msg[] = [];
    const ws = await openWebSocket(`ws://${phoneUrl.host}/phone/events`, { options: { origin: phoneUrl.origin }, setup: inbox(phone) });
    sockets.push(ws);
    const until = async (ok: () => boolean, what: string) => {
      for (const end = Date.now() + 5000; Date.now() < end; await new Promise((r) => setTimeout(r, 20))) if (ok()) return;
      throw new Error(`5초 안에 오지 않음: ${what}`);
    };
    // 위치 맞춤: 눈 자리에 시작 위치를 저장하고 「여기서 시작」 + 그 자리의 벽·바닥 점(AR 점 = 평면 점, tests/mokryeon-e2e.test.ts와 같다)
    await alignOnServer(srv.url, (t) => ws.send(t), join(srv.twin.dir, "homes", "mokryeon_180b", "scene.json"), [EYE[0], EYE[2]]);
    await until(() => phone.some((m) => m.type === "status" && m.aligned), "맞춤");
    ws.send(JSON.stringify({ type: "pose", position: EYE, orientation: ORIENTATION, tracking: "ok" }));
    await until(() => dash.some((m) => m.type === "eye"), "눈");
    const fridgeStates = () => dash.filter((m) => m.type === "state" && m.state.id === FRIDGE_ID).map((m) => m.state);
    expect(fridgeStates().at(-1)).toMatchObject({ twin: { door: "closed" } });
    const texts = () => pam!.bodies.map((b) => String(b.observation_text ?? ""));
    let n = 0;
    for (const end = Date.now() + 15_000; Date.now() < end; await new Promise((r) => setTimeout(r, 150))) {
      if (fridgeStates().some((s) => s.twin.door === "open") && texts().some((t) => t.includes("주방·식당 냉장고 문 열림 · 카메라로 봄"))) break;
      ws.send(encodeFramePacket({ kind: "engine", width: 480, height: 360, position: EYE, orientation: ORIENTATION, tracking: "ok", projection: PROJECTION,
        captured_at: Date.now(), time_err_ms: 0 }, Buffer.from([0xff, 0xd8, n++ % 256, n >> 8])));
    }
    expect(fridgeStates().at(-1)).toMatchObject({ twin: { door: "open" }, vision: { twin: { door: "open" }, applied: true } });
    const sent = texts().find((t) => t.includes("주방·식당 냉장고 문 열림 · 카메라로 봄"));
    expect(sent, texts().at(-1)).toBeDefined();
    expect(sent).toMatch(/\[지속\] 주방·식당 냉장고 fridge_bbc363a3: 문 열림, .+, 카메라로 봄, 마지막 확인 \d\d:\d\d:\d\d/);
    const world = dash.filter((m) => m.type === "world").at(-1)!.world;
    expect(world.fixtures).toEqual([expect.objectContaining({ cls: "refrigerator", room: "kitchen", link: expect.objectContaining({ device: FRIDGE_ID, miss: null }) })]);
    const devices = await (await fetch(`${srv.url}/api/devices`)).json() as Msg[];
    expect(devices.find((d) => d.id === FRIDGE_ID)!.state).toMatchObject({ twin: { door: "open" }, vision: { applied: true } });
    expect(srv.history.list({ kinds: ["device"] }).map((r) => r.text)).toEqual(["주방·식당 냉장고 문 열림 · 카메라로 봄"]);
  }, 60_000);
});
