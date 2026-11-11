// startServer(BRAIN=1) + 폰: 엔진 프레임 → 관찰 흐름 → 대시보드 observe 기록·World State → PAM 판단, /api/brain·/api/world.
// VLM은 가짜 OpenAI 호환 서버, PAM 서비스는 시험용 PAM 자리(tests/helpers/pam.ts).
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type WebSocket from "ws";
import { startFakeOpenAI, type FakeServer } from "../scripts/fake-openai.js";
import type { Detection } from "../src/brain/detector.js";
import { encodeFramePacket } from "../src/phone/packet.js";
import { fetchRetry } from "../src/server/net.js";
import { startServer, type RunningServer } from "../src/server/start.js";
import { ScriptedDetector } from "./helpers/detectors.js";
import { startFakePam, type FakePam } from "./helpers/pam.js";
import { openWebSocket } from "./helpers/ws.js";

type Msg = Record<string, any>;
let srv: RunningServer | undefined;
let fake: FakeServer | undefined;
let pam: FakePam | undefined;
afterEach(async () => {
  await srv?.close();
  srv = undefined;
  await fake?.close();
  fake = undefined;
  await pam?.close();
  pam = undefined;
});

const env = (extra: Record<string, string> = {}) => ({ HUB: "memory", PORT: "0", RUNTIME_DIR: mkdtempSync(join(tmpdir(), "rt-")), ...extra });
const inbox = (ws: WebSocket) => {
  const list: Msg[] = [];
  ws.on("message", (d) => list.push(JSON.parse(String(d)) as Msg));
  return list;
};
async function until(list: Msg[], pred: (m: Msg) => boolean, ms = 5000): Promise<Msg> {
  const start = Date.now();
  for (;;) {
    const found = list.find(pred);
    if (found) return found;
    if (Date.now() - start > ms) throw new Error("메시지가 오지 않았습니다");
    await new Promise((r) => setTimeout(r, 20));
  }
}
const cup: Detection = { label: "cup", score: 0.9, cls: 41, box: [1, 1, 2, 1] };

describe("startServer(BRAIN=1) + 관찰 흐름", () => {
  it("BRAIN=1인데 PHONE_PORT가 없으면 관찰 흐름을 끄고 알린다", async () => {
    const lines: string[] = [];
    srv = await startServer({ env: env({ BRAIN: "1" }), log: (l) => lines.push(l) });
    expect(lines.some((l) => l.includes("BRAIN=1은 PHONE_PORT"))).toBe(true);
    expect(((await (await fetchRetry(`${srv.url}/api/health`)).json()) as Msg).brain).toBe(false);
    expect((await fetchRetry(`${srv.url}/api/world`)).status).toBe(404);
  });

  it("엔진 프레임마다 YOLO·VLM 기록이 대시보드로 가고 World State가 바뀌면 보내고, 프레임이 오는 동안 PAM을 5초마다 부른다. 표시 프레임은 관찰 흐름에 들어가지 않는다", async () => {
    fake = await startFakeOpenAI();
    pam = await startFakePam();
    srv = await startServer({
      env: env({ PHONE_PORT: "0", PHONE_HOST: "127.0.0.1", BRAIN: "1", VLM_BASE_URL: `${fake.url}/v1`, VLM_MODEL: "fake-vlm", ENGINE_FRAME_MS: "500", PAM_URL: pam.url }),
      log: () => {}, brain: { detector: new ScriptedDetector(() => [cup]) },
    });
    const phoneUrl = new URL(srv.phoneUrls[0]!);
    let dashBox: Msg[] = [];
    const dash = await openWebSocket(`${srv.url.replace(/^http/, "ws")}/events`, { setup: (ws) => { dashBox = inbox(ws); } });
    let phoneBox: Msg[] = [];
    const phone = await openWebSocket(`ws://${phoneUrl.host}/phone/events`, { options: { origin: phoneUrl.origin }, setup: (ws) => { phoneBox = inbox(ws); } });
    try {
      expect(await until(phoneBox, (m) => m.type === "status")).toMatchObject({ engine_ms: 500 });
      phone.send(encodeFramePacket({ kind: "frame", width: 4, height: 3 }, Buffer.from([0xff, 0xd8, 0x00])));
      for (let i = 1; i <= 3; i++) {
        const t = Date.now();
        phone.send(encodeFramePacket({ kind: "engine", width: 4, height: 3, captured_at: t - 10, time_err_ms: 2 }, Buffer.from([0xff, 0xd8, i])));
        await new Promise((r) => setTimeout(r, 30));
      }
      await until(dashBox, (m) => m.type === "brain" && m.event.type === "observe" && m.event.yolo === "컵 0.90");
      await until(dashBox, (m) => m.type === "brain" && m.event.type === "observe" && m.event.vlm === "가짜 장면");
      const world = await until(dashBox, (m) => m.type === "world" && m.world.objects.length === 1);
      expect(world.world.objects[0]).toMatchObject({ id: "cup_1", cls: "cup", status: "present" });
      await until(dashBox, (m) => m.type === "brain" && m.event.type === "world_change" && m.event.kind === "appeared");
      // 첫 판단은 첫 프레임 직후(컵을 인정하기 전일 수 있다), 다음 판단은 5초 뒤
      const decision = await until(dashBox, (m) => m.type === "brain" && m.event.type === "decision" && m.event.world.objects.some((o: Msg) => o.id === "cup_1"), 8000);
      expect(decision.event).toMatchObject({ status: "valid", action: null, memory_version: 1, world: { objects: [{ id: "cup_1" }] } });
      expect(decision.event.text_sent).toContain("컵 cup_1 보임");
      expect(pam.bodies.map((b) => b.observation_text)).toContain(decision.event.text_sent);
      // 기록 DB 한 시간축: VLM 답, 등장, PAM에 보낸 텍스트, 판단. YOLO 결과 줄은 적지 않는다
      const kinds = new Set(srv.history.list({}).map((r) => r.kind));
      expect([...kinds]).toEqual(expect.arrayContaining(["vlm", "detection", "pam_text", "decision"]));
      expect(srv.history.list({ kinds: ["vlm"] })[0]).toMatchObject({ text: "가짜 장면" });
      expect(srv.history.list({ kinds: ["pam_text"] }).map((r) => r.text)).toContain(decision.event.text_sent);
      const status = (await (await fetchRetry(`${srv.url}/api/brain`)).json()) as Msg;
      expect(status).toMatchObject({ ok: true, frames: 3, detected: 3, time_source: "phone", closer: { looks: 0, failed: 0, costUsd: 0 } });
      expect(((await (await fetchRetry(`${srv.url}/api/world`)).json()) as Msg).world.objects).toHaveLength(1);
      expect(fake.requests.filter((r) => r.path.endsWith("/chat/completions")).every((r) => r.body.model === "fake-vlm")).toBe(true);
      const late = await openWebSocket(`${srv.url.replace(/^http/, "ws")}/events`, { setup: (ws) => { dashBox = inbox(ws); } });
      expect(await until(dashBox, (m) => m.type === "world")).toMatchObject({ world: { objects: [{ id: "cup_1" }] } });
      late.close();
    } finally {
      dash.close();
      phone.close();
    }
  }, 30_000);
});
