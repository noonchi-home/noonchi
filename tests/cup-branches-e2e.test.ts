// 컵 갈래를 처음부터 끝까지(가짜 서버): 같은 컵 장면이 사실에 따라 컵 치우기(사람이 컵을 두고 떠나면 내용물과 상관없이)·컵에 물 채워 주기로 갈라진다.
// 폰 엔진 프레임 → YOLO(대본)·VLM(가짜 OpenAI 호환 서버: 감지 종류마다 정한 사실) → World State 관찰 텍스트 → PAM(시험용 PAM 자리, cupBranchPredict가
// 관찰 텍스트의 사실로 고른다) → 에이전트 계획 모드(같은 가짜 서버의 도구 호출) → 실행 전 검사 → 실제 폰 단계 명령. tests/noonchi-e2e.test.ts와 같은 틀이다.
// 기본 집(마곡 아파트: 식탁·싱크대·냉장고). 맞추기 전이라 폰 눈 위치를 몰라 이동 단계는 「완료」로 넘긴다.
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { expectHistoryGolden, settledRows } from "./helpers/history-golden.js";
import type WebSocket from "ws";
import { startFakeOpenAI, type FakeServer } from "../scripts/fake-openai.js";
import { tasksFor } from "../src/act/tasks.js";
import type { Detection } from "../src/contract/observe.js";
import type { HistoryRow } from "../src/contract/history.js";
import { encodeFramePacket } from "../src/phone/packet.js";
import { fetchRetry } from "../src/shared/net.js";
import { startServer, type RunningServer } from "../src/server/start.js";
import { ScriptedDetector, det } from "./helpers/detectors.js";
import { cupBranchPredict, startFakePamLlm, type FakePamLlm, type PredictView, pamLlmEnv } from "./helpers/pam.js";
import { CUP_SCRIPTS, FILL_SCRIPTS, plannerRespond } from "./helpers/planner.js";
import { openPhone, openWebSocket } from "./helpers/ws.js";
import { useLearnedMemory } from "./helpers/memory.js";
import type { FsmMemory } from "../src/brain/decision.js";

type Msg = Record<string, any>;
let srv: RunningServer | undefined;
let fake: FakeServer | undefined;
let pam: FakePamLlm | undefined;
const sockets: WebSocket[] = [];
afterEach(async (ctx) => {
  // 기록 DB 같음 시험: 서버를 닫기 전에 반성용 줄 모양을 뽑아 두고, 다 닫은 뒤 정답과 견준다(시험이 실패했으면 견주지 않음)
  const golden = srv && ctx.task.result?.state !== "fail" ? await settledRows(srv) : null;
  for (const s of sockets.splice(0)) s.close();
  await srv?.close();
  srv = undefined;
  await fake?.close();
  fake = undefined;
  await pam?.close();
  pam = undefined;
  if (golden instanceof Error) throw golden;
  if (golden) await expectHistoryGolden("cup-branches-e2e", ctx.task.name, golden);
});

const inbox = (list: Msg[]) => (ws: WebSocket) => ws.on("message", (d, bin) => { if (!bin) list.push(JSON.parse(String(d)) as Msg); });
const CUP = det("cup", 0.9, [220, 160, 40, 20], 41);
const PERSON = det("person", 0.9, [40, 40, 120, 280]);
const BOTTLE = det("bottle", 0.9, [300, 120, 30, 70]);

/** 장면: 감지(YOLO 대본)와 감지 종류마다 VLM이 내는 사실 값. 시험이 도중에 바꾼다. */
interface Scene { dets: Detection[]; facts: Record<string, string[]> }

/** 서버·가짜 OpenAI(VLM 답과 계획 대본)·시험용 PAM 자리·대시보드와 실제 폰 소켓. approved: 미리 승인해 둔 행동. */
async function start(scene: Scene, approved: string[]) {
  fake = await startFakeOpenAI({
    // VLM 답(src/observe/scene.ts 모양): 감지 번호마다 사실 하나씩 observations 줄. 사람 사실도 그 사람 감지 번호의 줄이다
    reply: (body) => {
      if (body?.response_format?.json_schema?.name !== "scene_observation") return null;
      const parts = (body.messages as { role: string; content: unknown }[]).filter((m) => m.role === "user").flatMap((m) => (Array.isArray(m.content) ? m.content : [{ text: m.content }]));
      const text = parts.map((p: { text?: unknown }) => (typeof p.text === "string" ? p.text : "")).join("\n");
      const dets = JSON.parse(/Detections: (\[.*\])/.exec(text)?.[1] ?? "[]") as { id: string; class: string }[];
      return JSON.stringify({ scene: "kitchen", observations: dets.flatMap((d) => (scene.facts[d.class] ?? []).map((state) => ({ object_id: d.id, state }))), summary: "식탁" });
    },
    respond: plannerRespond({ ...CUP_SCRIPTS, ...FILL_SCRIPTS }),
  });
  pam = await startFakePamLlm({ predict: cupBranchPredict });
  const runtimeDir = mkdtempSync(join(tmpdir(), "rt-"));
  // 치우기를 보는 시험은 배운 뒤 기억(합성 3일째부터의 로봇 FSM)으로 돈다. seed 기억이면 떠날 때 묻는다
  useLearnedMemory(runtimeDir);
  mkdirSync(join(runtimeDir, "homes", "apartment"), { recursive: true });
  writeFileSync(join(runtimeDir, "homes", "apartment", "approvals.json"), JSON.stringify({ always: Object.fromEntries(approved.map((a) => [`task:${a}`, "2026-11-13T00:00:00.000Z"])), never: {} }));
  srv = await startServer({
    env: { HUB: "memory", PORT: "0", RUNTIME_DIR: runtimeDir, PHONE_PORT: "0", PHONE_HOST: "127.0.0.1", PAM_PERIOD_MS: "2000", PAM_MIN_GAP_MS: "1000",
      BRAIN: "1", VLM_BASE_URL: `${fake.url}/v1`, ...pamLlmEnv(pam), OPENAI_API_KEY: "fake-key", OPENAI_BASE_URL: `${fake.url}/v1` },
    brain: { detector: new ScriptedDetector(() => scene.dets) }, log: () => {},
  });
  const dash: Msg[] = [];
  sockets.push(await openWebSocket(`${srv.url.replace(/^http/, "ws")}/events`, { setup: inbox(dash) }));
  const phoneUrl = new URL(srv.phoneUrls[0]!);
  const phone: Msg[] = [];
  const ws = await openPhone(`ws://${phoneUrl.host}/phone/events`, { options: { origin: phoneUrl.origin }, setup: inbox(phone) });
  sockets.push(ws);
  let n = 0;
  const frame = () => ws.send(encodeFramePacket({ kind: "engine", width: 480, height: 360, captured_at: Date.now(), time_err_ms: 0 }, Buffer.from([0xff, 0xd8, n++ % 256, n >> 8])));
  /** 조건이 맞을 때까지 엔진 프레임을 150ms마다 보낸다(최대 ms). */
  const pump = async (until: () => boolean | Promise<boolean>, ms = 20_000) => {
    for (const end = Date.now() + ms; Date.now() < end; ) {
      if (await until()) return;
      frame();
      await new Promise((r) => setTimeout(r, 150));
    }
    throw new Error(`조건이 ${ms / 1000}초 안에 맞지 않음`);
  };
  /** ms 동안 엔진 프레임만 보낸다. */
  const hold = async (ms: number) => {
    for (const end = Date.now() + ms; Date.now() < end; ) {
      frame();
      await new Promise((r) => setTimeout(r, 150));
    }
  };
  const history = async (kinds: string) => ((await (await fetchRetry(`${srv!.url}/api/history?kinds=${kinds}`)).json()) as { ok: boolean; rows: HistoryRow[] }).rows;
  const spoken = () => phone.filter((m) => m.type === "command" && m.speak);
  const said = (text: string) => spoken().find((m) => m.text === text);
  const answer = (m: Msg) => ws.send(JSON.stringify({ type: "answer", id: m.id, step: m.step, choice: "done" }));
  return { dash, phone, pump, hold, history, spoken, said, answer };
}

describe("컵 장면 갈래", () => {
  it("빈 컵 + 사람 없음 → 컵 치우기: 실제 폰 첫 명령은 「식탁으로 가 주세요」", async () => {
    const s = await start({ dets: [CUP], facts: { cup: ["on_table", "empty"] } }, ["컵 치우기"]);
    await s.pump(() => s.spoken().length > 0);
    expect(s.spoken()[0]).toMatchObject({ text: "식탁으로 가 주세요", kind: "go" });
    // 컵 치우기는 내용물과 상관없이 바로 첫 명령을 낸다. 내용물은 그 뒤에도 비전으로 계속 확정된다
    await s.pump(async () => (await s.history("world")).some((r) => r.text === "컵 cup_1 비어 있음"));
    expect((await s.history("decision")).map((r) => r.text)).toContain("컵 치우기");
    expect((pam!.bodies.at(-1) as PredictView).tasks).toEqual(tasksFor("noonchi"));
  }, 60_000);

  it("물이 남은 컵 + 사람 없음 → 컵 치우기(컵을 두고 떠나면 치우는 습관, 내용물과 상관없음): 실제 폰 첫 명령은 「식탁으로 가 주세요」", async () => {
    const s = await start({ dets: [CUP], facts: { cup: ["on_table", "has_contents"] } }, ["컵 치우기"]);
    await s.pump(() => s.spoken().length > 0);
    expect(s.spoken()[0]).toMatchObject({ text: "식탁으로 가 주세요", kind: "go" });
    // 컵 치우기는 내용물과 상관없이 바로 첫 명령을 낸다. 내용물은 그 뒤에도 비전으로 계속 확정된다
    await s.pump(async () => (await s.history("world")).some((r) => r.text === "컵 cup_1 내용물 있음"));
    const decisions = (await s.history("decision")).map((r) => r.text);
    expect(decisions).toContain("컵 치우기");
    // PAM에 보낸 기억은 배운 뒤 기억이다: 마시는 중에서 떠나는 화살표의 행동이 컵 치우기다
    const drinking = (pam!.bodies.at(-1)!.memory as FsmMemory).states.find((x) => x.id === "drinking")!;
    expect(drinking.next.find((e) => e.to === "*")!.action).toBe("컵 치우기");
  }, 60_000);

  it("사람이 먹는 중 + 빈 컵 → 컵에 물 채워 주기: 네 명령이 차례로 오고, 병 집기는 병이 손에 있음으로 보일 때, 따르기는 컵이 내용물 있음일 때 「완료」 없이 넘어가 계획이 끝난다. PAM에는 사진이 가지 않는다", async () => {
    const scene: Scene = { dets: [PERSON, CUP], facts: { person: ["sitting", "eating"], cup: ["on_table", "empty"] } };
    const s = await start(scene, ["컵에 물 채워 주기"]);
    await s.pump(() => !!s.said("냉장고로 가 주세요"));
    const first = s.said("냉장고로 가 주세요")!;
    const planId = first.id as string;
    expect(first).toMatchObject({ step: `${planId}:1`, kind: "go", choices: [{ id: "done", label: "완료" }] });
    s.answer(first);
    await s.pump(() => !!s.said("물병을 꺼내 주세요"));
    expect(s.said("물병을 꺼내 주세요")).toMatchObject({ step: `${planId}:2`, kind: "pick", vision: null });
    // 사람이 무엇인가 들고 있다는 답만으로는(든 것을 모름) 병 집기를 넘기지 않는다
    scene.facts = { ...scene.facts, person: ["sitting", "eating", "holding_object"] };
    await s.hold(2500);
    expect(s.spoken().map((m) => m.text)).toEqual(["냉장고로 가 주세요", "물병을 꺼내 주세요"]);
    // 병이 보이고 손에 있음이면 넘어간다
    scene.dets = [PERSON, CUP, BOTTLE];
    scene.facts = { ...scene.facts, bottle: ["in_hand"] };
    await s.pump(() => !!s.said("식탁으로 가 주세요"));
    const back = s.said("식탁으로 가 주세요")!;
    expect(back).toMatchObject({ step: `${planId}:3`, kind: "go" });
    s.answer(back);
    await s.pump(() => !!s.said("컵에 물을 따라 주세요"));
    expect(s.said("컵에 물을 따라 주세요")).toMatchObject({ step: `${planId}:4`, kind: "do", vision: "컵 · 비어 있음", choices: [{ id: "done", label: "완료" }] });
    // 따른 뒤: VLM이 컵을 내용물 있음으로 본다
    scene.facts = { person: ["sitting", "eating"], cup: ["on_table", "has_contents"], bottle: ["on_table"] };
    await s.pump(() => s.phone.some((m) => m.type === "command_clear" && m.id === planId));
    await s.pump(async () => (await s.history("execution")).some((r) => r.subject === planId && r.text === "완료"));
    expect(s.spoken().map((m) => [m.text, m.kind])).toEqual([["냉장고로 가 주세요", "go"], ["물병을 꺼내 주세요", "pick"], ["식탁으로 가 주세요", "go"], ["컵에 물을 따라 주세요", "do"]]);
    const rows = await s.history("decision,execution,feedback");
    expect(rows.filter((r) => r.kind === "execution" && r.subject === planId).sort((a, b) => a.id - b.id).map((r) => r.text)).toEqual(["판단", "계획", "실행 중", "완료"]);
    expect(rows.find((r) => r.kind === "decision" && `plan:${r.subject}` === planId)!.text).toBe("컵에 물 채워 주기");
    // 누른 「완료」는 이동 둘뿐이다
    expect(rows.filter((r) => r.kind === "feedback").map((r) => r.text).sort()).toEqual(["완료 · 부탁: 냉장고로 가 주세요", "완료 · 부탁: 식탁으로 가 주세요"]);
    // 대시보드: 계획 화면 단계와 생각 말풍선 자료(상태 drinking), 말풍선 카드는 단계 이름을 부탁했다고 한다
    const plan = s.dash.filter((m) => m.type === "plan" && m.plan?.id === planId).map((m) => m.plan);
    expect(plan[0]).toMatchObject({ goal: "컵에 물 채워 주기", source: "brain", dryRun: true });
    expect(plan[0].steps.map((x: Msg) => [x.kind, x.label])).toEqual([["move", "냉장고로 가기"], ["act", "물병 꺼내기"], ["move", "식탁으로 가기"], ["act", "컵에 물 따르기"]]);
    expect(plan.at(-1)).toMatchObject({ status: "done" });
    expect(s.dash.find((m) => m.type === "brain" && m.event.type === "decision" && `plan:${m.event.id}` === planId)!.event).toMatchObject({ action: "컵에 물 채워 주기", fsm: { state: "drinking" } });
    const says = s.dash.filter((m) => m.type === "say").map((m) => m.text as string);
    expect(says).toEqual(expect.arrayContaining(["컵에 물을 채울게요.", "냉장고로 갈게요.", "물병을 꺼낼게요.", "컵에 물을 따를게요.", "컵에 물 채워 주기를 마쳤어요."]));
    // PAM 판단 요청 그대로: 칸 일곱(직전 사람 상태 포함), 사진 칸 없음, 실제로 나간 LLM 본문에도 사진 없음
    expect(pam!.bodies.length).toBeGreaterThan(0);
    for (const r of pam!.requests) expect(JSON.stringify(r)).not.toMatch(/data:image|base64|"image_url"|"type":"image/);
    for (const b of pam!.bodies) {
      expect(Object.keys(b).sort()).toEqual(["final_time", "last_state", "memory", "memory_kind", "observation_text", "role", "tasks"]);
      expect(b.role).toBe("predict");
      expect((b as PredictView).tasks).toEqual(tasksFor("noonchi"));
    }
    expect(pam!.bodies.some((b) => /\[지속\] 사람 먹는 중/.test(String(b.observation_text)) && /컵 cup_1 .*비어 있음/.test(String(b.observation_text)))).toBe(true);
    // 기억은 사람 활동 FSM(상태 넷)이다
    expect((pam!.bodies[0]!.memory as { states: { id: string }[] }).states.map((x) => x.id)).toEqual(["drinking", "watching_tv", "cooking", "away"]);
  }, 90_000);
});
