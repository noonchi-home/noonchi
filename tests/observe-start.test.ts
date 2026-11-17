// startServer(BRAIN=1) + 폰: 엔진 프레임 → 관찰 흐름 → 대시보드 observe 기록·World State → PAM 판단, /api/brain·/api/world.
// VLM은 가짜 OpenAI 호환 서버, PAM 서비스는 시험용 PAM 자리(tests/helpers/pam.ts).
import { mkdtempSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type WebSocket from "ws";
import { startFakeOpenAI, type FakeServer } from "../scripts/fake-openai.js";
import type { Detection } from "../src/contract/observe.js";
import { encodeFramePacket } from "../src/phone/packet.js";
import { fetchRetry, listenRetry } from "../src/shared/net.js";
import { MemoryBus, type Deliver, type NodeName, type Subscription, type TopicName } from "../src/bus/index.js";
import { startServer, type RunningServer } from "../src/server/start.js";
import { HEARD_MARK } from "../src/world/labels.js";
import { ScriptedDetector, det } from "./helpers/detectors.js";
import { startFakePamLlm, type FakePamLlm, pamLlmEnv } from "./helpers/pam.js";
import { openPhone, openWebSocket } from "./helpers/ws.js";

type Msg = Record<string, any>;
let srv: RunningServer | undefined;
let fake: FakeServer | undefined;
let pam: FakePamLlm | undefined;
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
const cup: Detection = det("cup", 0.9, [1, 1, 2, 1], 41);

describe("startServer(BRAIN=1) + 관찰 흐름", () => {
  it("서버를 끄면 집의 새 일(나가 있는 판단 요청)을 먼저 끊고, 그다음 진행 중인 반성 요청을 끊는다", async () => {
    fake = await startFakeOpenAI();
    const seen = { predict: 0, reflect: 0 };
    const aborted: string[] = [];
    // 답하지 않는 PAM LLM
    const hang = createServer(async (req) => {
      let raw = "";
      for await (const c of req) raw += c;
      seen[raw.includes("task inference module") ? "predict" : "reflect"]++;
    });
    const { port } = await listenRetry(hang, 0, "127.0.0.1");
    // 서버 안에서 PAM LLM으로 나가는 요청이 끊기는 차례(부른 쪽 신호가 끊기는 순간)를 적는다
    const realFetch = globalThis.fetch;
    globalThis.fetch = ((input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url.includes(`127.0.0.1:${port}/`)) {
        const kind = String(init?.body ?? "").includes("task inference module") ? "predict" : "reflect";
        init?.signal?.addEventListener("abort", () => aborted.push(kind));
      }
      return realFetch(input, init);
    }) as typeof fetch;
    try {
      srv = await startServer({
        env: env({ PHONE_PORT: "0", PHONE_HOST: "127.0.0.1", BRAIN: "1", VLM_BASE_URL: `${fake.url}/v1`, VLM_MODEL: "fake-vlm", ENGINE_FRAME_MS: "500",
          PAM_LLM_BASE_URL: `http://127.0.0.1:${port}/v1`, PAM_LLM_API_KEY: "fake-key", PAM_TIMEOUT_MS: "60000" }),
        log: () => {}, brain: { detector: new ScriptedDetector(() => [cup]) },
      });
      const phoneUrl = new URL(srv.phoneUrls[0]!);
      let phoneBox: Msg[] = [];
      const phone = await openPhone(`ws://${phoneUrl.host}/phone/events`, { options: { origin: phoneUrl.origin }, setup: (ws) => { phoneBox = inbox(ws); } });
      await until(phoneBox, (m) => m.type === "status");
      phone.send(encodeFramePacket({ kind: "engine", width: 4, height: 3, captured_at: Date.now() - 10, time_err_ms: 2 }, Buffer.from([0xff, 0xd8, 1])));
      const wait = async (ok: () => boolean, what: string) => {
        const end = Date.now() + 8000;
        while (!ok()) {
          if (Date.now() > end) throw new Error(`${what}이 오지 않았습니다`);
          await new Promise((r) => setTimeout(r, 20));
        }
      };
      await wait(() => seen.predict > 0, "판단 요청");
      srv.history.add("detection", Date.now(), "사람 보임");
      const day = srv.history.dayOf(Date.now());
      const running = fetchRetry(`${srv.url}/api/reflection/run`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ day }) }).catch(() => null);
      await wait(() => seen.reflect > 0, "반성 요청");
      await srv.close();
      srv = undefined;
      expect(aborted).toContain("predict");
      expect(aborted).toContain("reflect");
      expect(aborted.indexOf("predict")).toBeLessThan(aborted.indexOf("reflect"));
      await running;
      phone.close();
    } finally {
      globalThis.fetch = realFetch;
      hang.closeAllConnections();
      hang.close();
    }
  }, 30_000);

  it("BRAIN=1인데 PHONE_PORT가 없으면 관찰 흐름을 끄고 알린다", async () => {
    const lines: string[] = [];
    srv = await startServer({ env: env({ BRAIN: "1" }), log: (l) => lines.push(l) });
    expect(lines.some((l) => l.includes("BRAIN=1은 PHONE_PORT"))).toBe(true);
    expect(((await (await fetchRetry(`${srv.url}/api/health`)).json()) as Msg).brain).toBe(false);
    expect((await fetchRetry(`${srv.url}/api/world`)).status).toBe(404);
  });

  it("엔진 프레임마다 YOLO·VLM 기록이 대시보드로 가고 World State가 바뀌면 보내고, 프레임이 오는 동안 PAM을 5초마다 부른다. 표시 프레임은 관찰 흐름에 들어가지 않는다", async () => {
    fake = await startFakeOpenAI();
    pam = await startFakePamLlm();
    srv = await startServer({
      env: env({ PHONE_PORT: "0", PHONE_HOST: "127.0.0.1", BRAIN: "1", VLM_BASE_URL: `${fake.url}/v1`, VLM_MODEL: "fake-vlm", ENGINE_FRAME_MS: "500", ...pamLlmEnv(pam) }),
      log: () => {}, brain: { detector: new ScriptedDetector(() => [cup]) },
    });
    const phoneUrl = new URL(srv.phoneUrls[0]!);
    let dashBox: Msg[] = [];
    const dash = await openWebSocket(`${srv.url.replace(/^http/, "ws")}/events`, { setup: (ws) => { dashBox = inbox(ws); } });
    let phoneBox: Msg[] = [];
    const phone = await openPhone(`ws://${phoneUrl.host}/phone/events`, { options: { origin: phoneUrl.origin }, setup: (ws) => { phoneBox = inbox(ws); } });
    try {
      expect(await until(phoneBox, (m) => m.type === "status")).toMatchObject({ engine_ms: 500 });
      phone.send(encodeFramePacket({ kind: "frame", width: 4, height: 3 }, Buffer.from([0xff, 0xd8, 0x00])));
      for (let i = 1; i <= 3; i++) {
        const t = Date.now();
        phone.send(encodeFramePacket({ kind: "engine", width: 4, height: 3, captured_at: t - 10 - (3 - i) * 2000, time_err_ms: 2 }, Buffer.from([0xff, 0xd8, i]))); // 촬영 시각 2초 간격: 컵 등장은 처음 본 뒤 4초
        await new Promise((r) => setTimeout(r, 30));
      }
      await until(dashBox, (m) => m.type === "brain" && m.event.type === "observe" && m.event.yolo === "컵 0.90");
      // 물체 모양은 seen으로 가고 observe에는 상자가 없다. 기록 DB에는 넣지 않는다
      expect(await until(dashBox, (m) => m.type === "seen")).toMatchObject({ frame: { width: 4, height: 3 }, shapes: [{ label: "cup", score: 0.9, mask: { at: [1, 1, 2, 1], cols: 1, rows: 1 } }] });
      expect(dashBox.some((m) => m.type === "brain" && m.event.type === "observe" && "boxes" in m.event)).toBe(false);
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
      // 관찰 모드(보기 담당): 카메라를 맞추기 전 사진이라 판단 전 보기(B)를 부르지 않았다
      expect(status.look).toEqual({ calls: 0, costUsd: 0, looks: 0, waits: 0, tells: 0 });
      expect(((await (await fetchRetry(`${srv.url}/api/world`)).json()) as Msg).world.objects).toHaveLength(1);
      // 모델 요청은 VLM 사진 분석뿐이다(VLM_MODEL): 판단마다 생각 말풍선 모델을 부르지 않는다
      const chats = fake.requests.filter((r) => r.path.endsWith("/chat/completions"));
      expect(chats.length).toBeGreaterThan(0);
      expect(chats.every((r) => r.body.model === "fake-vlm")).toBe(true);
      const late = await openWebSocket(`${srv.url.replace(/^http/, "ws")}/events`, { setup: (ws) => { dashBox = inbox(ws); } });
      expect(await until(dashBox, (m) => m.type === "world")).toMatchObject({ world: { objects: [{ id: "cup_1" }] } });
      expect(await until(dashBox, (m) => m.type === "seen")).toMatchObject({ replay: true, shapes: [{ label: "cup" }] });
      expect(JSON.stringify(srv.history.list({}))).not.toContain('"seen"');
      late.close();
    } finally {
      dash.close();
      phone.close();
    }
  }, 30_000);

  it("통로를 잃으면(Redis가 다시 켜짐) 그 까닭을 남기고 서버를 닫은 뒤 끝 코드 1로 끝낸다", async () => {
    let lose: ((e: Error) => void) | null = null;
    let code: number | null = null;
    const lines: string[] = [];
    srv = await startServer({
      env: env(), log: (l) => lines.push(l), exit: (c) => { code = c; },
      openBus: async (_env, o) => { lose = o.onLost; return new MemoryBus({ warn: () => {} }); },
    });
    lose!(new Error("Redis가 다시 켜져 이번 기동의 메시지를 잃었어요"));
    for (let i = 0; i < 250 && code === null; i++) await new Promise((r) => setTimeout(r, 20));
    expect(code).toBe(1);
    expect(lines.some((l) => l.includes("잃었어요"))).toBe(true);
    expect((await fetchRetry(`${srv.url}/api/health`).catch(() => null))?.ok ?? false).toBe(false);
    srv = undefined;
  });

  it("집을 닫으면 인식 → 집 상태 → 거울 차례로 노드를 끝낸다. 들은 말은 판단으로 가고 기록에는 표시만 남는다", async () => {
    fake = await startFakeOpenAI();
    pam = await startFakePamLlm();
    /** 구독을 끊은 노드 차례를 적는 통로. */
    class StopOrder extends MemoryBus {
      readonly stops: NodeName[] = [];
      override async subscribe<N extends TopicName>(t: N, n: NodeName, d: Deliver<N>, o?: { mode?: "latest" | "all" }): Promise<Subscription> {
        const sub = await super.subscribe(t, n, d, o);
        return { start: () => sub.start(), lost: () => sub.lost(), stop: async () => { this.stops.push(n); await sub.stop(); } };
      }
    }
    const bus = new StopOrder({ warn: () => {} });
    srv = await startServer({
      env: env({ PHONE_PORT: "0", PHONE_HOST: "127.0.0.1", BRAIN: "1", VLM_BASE_URL: `${fake.url}/v1`, VLM_MODEL: "fake-vlm", ENGINE_FRAME_MS: "500", ...pamLlmEnv(pam) }),
      log: () => {}, brain: { detector: new ScriptedDetector(() => [cup]) }, openBus: async () => bus,
    });
    const phoneUrl = new URL(srv.phoneUrls[0]!);
    const phone = await openPhone(`ws://${phoneUrl.host}/phone/events`, { options: { origin: phoneUrl.origin } });
    try {
      phone.send(JSON.stringify({ type: "say", text: "컵 좀 치워 줘" }));
      const history = srv.history;
      for (let i = 0; i < 250 && !history.list({ kinds: ["world"] }).some((r) => (r.data as { kind?: string } | null)?.kind === "heard"); i++) await new Promise((r) => setTimeout(r, 20));
      const heard = history.list({ kinds: ["world"] }).filter((r) => (r.data as { kind?: string } | null)?.kind === "heard");
      expect(heard.map((r) => r.text)).toEqual([HEARD_MARK]);
    } finally {
      phone.close();
    }
    await srv.close();
    srv = undefined;
    const first = (n: NodeName) => bus.stops.indexOf(n);
    expect(first("perception")).toBeGreaterThanOrEqual(0);
    expect(first("perception")).toBeLessThan(first("world"));
    expect(first("world")).toBeLessThan(first("act"));
  }, 30_000);

  it("집을 바꾸기 바로 전에 바뀐 가전 상태도 발행 줄 → 집 상태 → 거울 차례로 비운 뒤 멈춰 기록에 남는다", async () => {
    fake = await startFakeOpenAI();
    pam = await startFakePamLlm();
    srv = await startServer({
      env: env({ PHONE_PORT: "0", PHONE_HOST: "127.0.0.1", BRAIN: "1", VLM_BASE_URL: `${fake.url}/v1`, VLM_MODEL: "fake-vlm", ENGINE_FRAME_MS: "500", ...pamLlmEnv(pam) }),
      log: () => {}, brain: { detector: new ScriptedDetector(() => [cup]) },
    });
    const light = srv.signals.list().find((d) => d.kind === "light")!;
    const other = srv.twin.home.id === "mokryeon_180b" ? undefined : "mokryeon_180b";
    expect(other).toBeDefined();
    const before = srv.history.list({ kinds: ["world"] }).length;
    await srv.hub.command(light.id, { type: "on" });
    await srv.switchHome(other!);
    const rows = srv.history.list({ kinds: ["world"] }).slice(before);
    expect(rows.some((r) => (r.data as { kind?: string } | null)?.kind === "device" && r.text.includes(light.label)), JSON.stringify(rows.map((r) => r.text))).toBe(true);
  }, 30_000);
});
