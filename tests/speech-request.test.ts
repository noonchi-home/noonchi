// 말 부탁 → 계획 모드 → 실행(가짜 서버): PAM은 기억 화살표의 행동만 고르므로, 기억에 그 행동 화살표가 없는 상태에서 한 부탁은
// 말 요청 에이전트의 할 일 부탁 도구(request_task)가 실행 추적의 말 부탁 길(onRequest)로 넘긴다. 계획 전 검사·계획 모드·승인·실행은 PAM 판단과 같다.
// 한양목련 집(수납장·싱크대·인덕션). 말 요청 에이전트·계획 모드·VLM은 같은 가짜 OpenAI 호환 서버, PAM은 늘 화살표 없음.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type WebSocket from "ws";
import { startFakeOpenAI, type FakeResponse, type FakeServer } from "../scripts/fake-openai.js";
import type { Detection } from "../src/contract/observe.js";
import type { HistoryRow } from "../src/contract/history.js";
import type { PlanView } from "../src/contract/plan.js";
import { encodeFramePacket } from "../src/phone/packet.js";
import { fetchRetry } from "../src/shared/net.js";
import { startServer, type RunningServer } from "../src/server/start.js";
import { ScriptedDetector, det } from "./helpers/detectors.js";
import { toolOutputs, turnOf } from "./helpers/llm.js";
import { isObserving } from "./helpers/observer.js";
import { startFakePamLlm, type FakePamLlm, pamLlmEnv } from "./helpers/pam.js";
import { plannerRespond, ramenScripts } from "./helpers/planner.js";
import { heardAtOf, openPhone, openWebSocket } from "./helpers/ws.js";

type Msg = Record<string, any>;
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

const inbox = (list: Msg[]) => (ws: WebSocket) => ws.on("message", (d, bin) => { if (!bin) list.push(JSON.parse(String(d)) as Msg); });
const PERSON = det("person", 0.9, [40, 40, 120, 280]);

/** 말 부탁 서버: 사람은 personState(VLM 사실)로 보이고, PAM은 늘 화살표 없음, 말 요청 에이전트는 첫 차례에 agentCalls를 부르고 다음 차례에 짧게 답한다. */
async function speechSetup(o: { personState?: string; agentCalls: { name: string; args: Record<string, unknown> }[] }) {
  const planning = plannerRespond(ramenScripts(2));
  const facts: Record<string, string[]> = { person: ["standing", o.personState ?? "watching_tv"] };
  const dets: Detection[] = [PERSON];
  fake = await startFakeOpenAI({
    reply: (body) => {
      if (body?.response_format?.json_schema?.name !== "scene_observation") return null;
      const parts = (body.messages as { role: string; content: unknown }[]).filter((m) => m.role === "user").flatMap((m) => (Array.isArray(m.content) ? m.content : [{ text: m.content }]));
      const text = parts.map((p: { text?: unknown }) => (typeof p.text === "string" ? p.text : "")).join("\n");
      const seen = JSON.parse(/Detections: (\[.*\])/.exec(text)?.[1] ?? "[]") as { id: string; class: string }[];
      return JSON.stringify({ scene: "living", observations: seen.flatMap((d) => (facts[d.class] ?? []).map((state) => ({ object_id: d.id, state }))), summary: "거실" });
    },
    respond: (body): FakeResponse | null => {
      const planned = planning(body);
      if (planned) return planned;
      if (isObserving(body)) return { calls: [{ name: "pass_on", args: { reason: "상관없는 말이라" } }] };
      const t = turnOf(body);
      if (!t) return null;
      return t.round === 0 ? { calls: o.agentCalls.map((c) => ({ name: c.name, args: { reason: "할 일을 부탁해서", ...c.args } })) } : { text: "네." };
    },
  });
  // PAM은 늘 화살표 없음(지금 상태 그대로): 기억에 없는 부탁은 PAM으로는 막힌다
  pam = await startFakePamLlm({ predict: (v) => ({ observation: "o", reasoning: "r", state: v.last_state ?? "watching_tv", from: null, next_index: -1 }) });
  srv = await startServer({
    env: { HUB: "memory", PORT: "0", HOME_ID: "mokryeon_180b", RUNTIME_DIR: mkdtempSync(join(tmpdir(), "rt-")), PHONE_PORT: "0", PHONE_HOST: "127.0.0.1", PAM_PERIOD_MS: "1500", PAM_MIN_GAP_MS: "1000",
      BRAIN: "1", VLM_BASE_URL: `${fake.url}/v1`, ...pamLlmEnv(pam), OPENAI_API_KEY: "fake-key", OPENAI_BASE_URL: `${fake.url}/v1` },
    brain: { detector: new ScriptedDetector(() => dets) }, log: () => {},
  });
  const dash: Msg[] = [];
  sockets.push(await openWebSocket(`${srv.url.replace(/^http/, "ws")}/events`, { setup: inbox(dash) }));
  const phoneUrl = new URL(srv.phoneUrls[0]!);
  const phone: Msg[] = [];
  const ws = await openPhone(`ws://${phoneUrl.host}/phone/events`, { options: { origin: phoneUrl.origin }, setup: inbox(phone) });
  sockets.push(ws);
  let n = 0;
  const frame = () => ws.send(encodeFramePacket({ kind: "engine", width: 480, height: 360, captured_at: Date.now(), time_err_ms: 0 }, Buffer.from([0xff, 0xd8, n++ % 256, n >> 8])));
  const until = async (ok: () => boolean | Promise<boolean>, ms = 20_000) => {
    for (const end = Date.now() + ms; Date.now() < end; ) {
      if (await ok()) return;
      frame();
      await new Promise((r) => setTimeout(r, 150));
    }
    throw new Error(`${ms / 1000}초 안에 맞지 않음 · 계획 ${JSON.stringify(plans().map((p) => [p.goal, p.status]))}`);
  };
  const history = async (kinds: string) => ((await (await fetchRetry(`${srv!.url}/api/history?limit=5000&kinds=${kinds}`)).json()) as { ok: boolean; rows: HistoryRow[] }).rows;
  const plans = () => dash.filter((m) => m.type === "plan" && m.plan).map((m) => m.plan as PlanView);
  const decisions = () => dash.filter((m) => m.type === "brain" && m.event.type === "decision").map((m) => m.event as Msg);
  const mode = () => dash.filter((m) => m.type === "mode").at(-1)?.mode as string | undefined;
  const agentBodies = () => fake!.requests.filter((r) => r.method === "POST" && r.path.endsWith("/responses") && !isObserving(r.body) && !planning(r.body)).map((r) => r.body);
  const toolResults = () => agentBodies().flatMap((b) => toolOutputs(b));
  // 사람이 보이고 판단이 한 번 돈 뒤에 말한다
  await until(() => decisions().length > 0);
  // 말한 뒤 에이전트 답(reply)을 기다린다(붙을 때 오는 승인 대기 목록 답은 세지 않는다)
  const say = async (text: string) => {
    const before = phone.filter((m) => m.type === "reply").length;
    ws.send(JSON.stringify({ type: "say", text, at: heardAtOf(phone) }));
    await until(() => phone.filter((m) => m.type === "reply").length > before && agentBodies().length >= 2);
  };
  return { say, until, plans, decisions, mode, history, toolResults };
}

describe("말 부탁 → 계획 모드 → 실행", () => {
  it("기억에 그 행동 화살표가 없는 상태(TV 보는 중)에서 「라면 끓이는 법 알려 줘」는 말 요청 에이전트의 request_task로 계획 모드에 가고 코치 계획이 시작된다(PAM은 화살표 없음)", async () => {
    const s = await speechSetup({ personState: "watching_tv", agentCalls: [{ name: "request_task", args: { task: "라면 끓이기 알려 주기" } }] });
    await s.say("라면 끓이는 법 알려 줘");
    await s.until(() => s.plans().some((p) => p.goal === "라면 끓이기 알려 주기" && p.status === "running"));
    expect(s.decisions().filter((d) => d.source === "speech").at(-1)).toMatchObject({ source: "speech", action: "라면 끓이기 알려 주기" });
    expect(s.decisions().filter((d) => d.source !== "speech").every((d) => d.action === null)).toBe(true);
    expect(s.mode()).toBe("coach");
  }, 60_000);

  it("목록에 없는 이름은 거절하고 계획을 만들지 않는다", async () => {
    const s = await speechSetup({ agentCalls: [{ name: "request_task", args: { task: "설거지하기" } }] });
    await s.say("설거지 해 줘");
    expect(s.toolResults().at(-1)).toMatchObject({ ok: false });
    expect(s.plans()).toEqual([]);
  }, 60_000);
});
