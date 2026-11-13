// 코치 모드를 처음부터 끝까지(가짜 서버): 사람이 「라면 끓이는 법 알려 줘」라고 말하면 PAM이 코치 행동을 고르고, 에이전트 계획 모드가 만든 13단계를
// 실제 폰으로 한 단계씩 알려 준다. 폰 엔진 프레임 → YOLO(대본)·VLM(가짜 OpenAI 호환 서버) → World State 관찰 텍스트(들은 말 한 줄) → PAM(시험용 PAM 자리 coachPredict)
// → 계획 모드(같은 가짜 서버, tests/helpers/planner.ts 라면 대본) → 실제 폰 명령. 다른 행동·혼잣말은 관찰 모드(같은 가짜 서버)가 고른다.
// 한양목련 집(수납장·싱크대·인덕션). 맞추기 전이라 폰 눈 위치를 몰라 이동 단계는 「완료」·말로 넘긴다. 기다리기는 2초 대본.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type WebSocket from "ws";
import { startFakeOpenAI, type FakeResponse, type FakeServer } from "../scripts/fake-openai.js";
import { tasksFor } from "../src/act/tasks.js";
import type { Detection } from "../src/brain/detector.js";
import type { HistoryRow } from "../src/contract/history.js";
import { encodeFramePacket } from "../src/phone/packet.js";
import { fetchRetry } from "../src/server/net.js";
import { startServer, type RunningServer } from "../src/server/start.js";
import { ScriptedDetector, det } from "./helpers/detectors.js";
import { turnOf } from "./helpers/llm.js";
import { isObserving, observerRespond } from "./helpers/observer.js";
import { coachPredict, startFakePam, type FakePam } from "./helpers/pam.js";
import { plannerRespond, ramenScripts } from "./helpers/planner.js";
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
const RAMEN = "라면 끓이기 알려 주기";
const ASK_RAMEN = "라면 끓이는 법 알려 줘";
const LOST = "어 뭐 해야 되지";
const TELL_WATER = "먼저 냄비에 물을 받아 주세요";
const PERSON = det("person", 0.9, [40, 40, 120, 280]);
const YESNO = [{ id: "approve", label: "승인" }, { id: "reject", label: "거절" }];

/** 장면: 감지(YOLO 대본)와 감지 종류마다 VLM이 내는 사실 값. */
interface Scene { dets: Detection[]; facts: Record<string, string[]> }

async function start(o: { assist: "coach" | "noonchi"; scene?: Scene } = { assist: "coach" }) {
  const scene: Scene = o.scene ?? { dets: [], facts: {} };
  let light = "";
  const planning = plannerRespond(ramenScripts(2));
  // 관찰 모드 대본: 들은 말이면 그 말에 따라(상관없는 말은 넘김), 다른 행동이면 지금 할 일을 다시 알린다
  const observing = observerRespond((input) => {
    if (input.includes("[들은 말] 에어컨 켜 줘")) return [["pass_on", { reason: "이 일과 상관없는 말이라" }]];
    if (input.includes("[들은 말]")) return [["tell_person", { mode: "repeat", reason: "무엇을 할지 모르겠다고 해서" }]];
    return [["tell_person", { mode: "earlier", reason: "물을 받기 전에 불을 켜서" }]];
  });
  fake = await startFakeOpenAI({
    reply: (body) => {
      if (body?.response_format?.json_schema?.name !== "scene_observation") return null;
      const parts = (body.messages as { role: string; content: unknown }[]).filter((m) => m.role === "user").flatMap((m) => (Array.isArray(m.content) ? m.content : [{ text: m.content }]));
      const text = parts.map((p: { text?: unknown }) => (typeof p.text === "string" ? p.text : "")).join("\n");
      const dets = JSON.parse(/Detections: (\[.*\])/.exec(text)?.[1] ?? "[]") as { id: string; class: string }[];
      return JSON.stringify({ scene: "kitchen", observations: dets.flatMap((d) => (scene.facts[d.class] ?? []).map((state) => ({ object_id: d.id, state }))), summary: "주방" });
    },
    respond: (body): FakeResponse | null => {
      const planned = planning(body);
      if (planned) return planned;
      if (isObserving(body)) return observing(body);
      // 말 요청 에이전트: 가전 요청이 아닌 말에는 넘기기(leave_it), 「에어컨 켜 줘」는 에어컨을 켠다
      const t = turnOf(body);
      if (!t) return null;
      if (t.said === "에어컨 켜 줘") return t.round === 0 ? { calls: [{ name: "turn_on", args: { device_id: light, reason: "에어컨을 켜 달라고 해서" } }] } : { text: "에어컨을 켰어요." };
      return t.round === 0 ? { calls: [{ name: "leave_it", args: { reason: "가전 요청이 아니라서" } }] } : { text: "네." };
    },
  });
  pam = await startFakePam({ predict: coachPredict });
  const runtimeDir = mkdtempSync(join(tmpdir(), "rt-"));
  mkdirSync(join(runtimeDir, "homes", "mokryeon_180b"), { recursive: true });
  writeFileSync(join(runtimeDir, "homes", "mokryeon_180b", "approvals.json"), JSON.stringify({ always: { [`task:${RAMEN}`]: "2026-11-13T00:00:00.000Z" } }));
  srv = await startServer({
    env: { HUB: "memory", PORT: "0", HOME_ID: "mokryeon_180b", RUNTIME_DIR: runtimeDir, PHONE_PORT: "0", PHONE_HOST: "127.0.0.1", PAM_PERIOD_MS: "1500", PAM_MIN_GAP_MS: "1000",
      BRAIN: "1", VLM_BASE_URL: `${fake.url}/v1`, PAM_URL: pam.url, OPENAI_API_KEY: "fake-key", OPENAI_BASE_URL: `${fake.url}/v1` },
    brain: { detector: new ScriptedDetector(() => scene.dets) }, log: () => {},
  });
  const post = async (path: string, body: unknown) => (await fetchRetry(`${srv!.url}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })).json() as Promise<Msg>;
  expect(await post("/api/setup/assist", { assist: o.assist })).toMatchObject({ ok: true, assist: o.assist });
  light = srv.twin.devices.find((d) => d.kind === "aircon")!.id;
  const cooktop = srv.twin.devices.find((d) => d.kind === "cooktop")!.id;
  const dash: Msg[] = [];
  sockets.push(await openWebSocket(`${srv.url.replace(/^http/, "ws")}/events`, { setup: inbox(dash) }));
  const phoneUrl = new URL(srv.phoneUrls[0]!);
  const phone: Msg[] = [];
  const ws = await openWebSocket(`ws://${phoneUrl.host}/phone/events`, { options: { origin: phoneUrl.origin }, setup: inbox(phone) });
  sockets.push(ws);
  let n = 0;
  const frame = () => ws.send(encodeFramePacket({ kind: "engine", width: 480, height: 360, captured_at: Date.now(), time_err_ms: 0 }, Buffer.from([0xff, 0xd8, n++ % 256, n >> 8])));
  const pump = async (until: () => boolean | Promise<boolean>, what: string, ms = 20_000) => {
    for (const end = Date.now() + ms; Date.now() < end; ) {
      if (await until()) return;
      frame();
      await new Promise((r) => setTimeout(r, 150));
    }
    throw new Error(`${ms / 1000}초 안에 오지 않음: ${what} · 실제 폰 ${JSON.stringify(phone.filter((m) => m.type === "command").slice(-2))}`);
  };
  const history = async (kinds?: string) => ((await (await fetchRetry(`${srv!.url}/api/history?limit=5000${kinds ? `&kinds=${kinds}` : ""}`)).json()) as { ok: boolean; rows: HistoryRow[] }).rows;
  const commands = () => phone.filter((m) => m.type === "command");
  const spoken = () => commands().filter((m) => m.speak);
  const said = (text: string) => spoken().find((m) => m.text === text);
  const last = () => commands().at(-1)!;
  const answer = (m: Msg, choice = "done") => ws.send(JSON.stringify({ type: "answer", id: m.id, step: m.step, choice }));
  const say = (text: string) => ws.send(JSON.stringify({ type: "say", text }));
  const replies = () => phone.filter((m) => m.type === "reply");
  const agentBodies = () => fake!.requests.filter((r) => r.method === "POST" && r.path.endsWith("/responses") && !isObserving(r.body) && !planning(r.body)).map((r) => r.body);
  const observerBodies = () => fake!.requests.filter((r) => r.method === "POST" && r.path.endsWith("/responses") && isObserving(r.body)).map((r) => r.body);
  const predicts = () => pam!.paths.filter((p) => p === "POST /predict").length;
  return { scene, runtimeDir, cooktop, light, dash, phone, pump, history, commands, spoken, said, last, answer, say, replies, agentBodies, observerBodies, predicts };
}

/** 「라면 끓이는 법 알려 줘」로 시작해 n번 단계 명령이 뜰 때까지 앞 단계를 「완료」로 넘긴다. 계획 id를 돌려준다. */
async function toStep(s: Awaited<ReturnType<typeof start>>, n: number): Promise<string> {
  s.say(ASK_RAMEN);
  await s.pump(() => !!s.said("수납장으로 가 주세요"), "첫 명령");
  const planId = s.said("수납장으로 가 주세요")!.id as string;
  for (let k = 1; k < n; k++) {
    await s.pump(() => s.commands().some((m) => m.step === `${planId}:${k}`), `${k}번 명령`);
    s.answer({ id: planId, step: `${planId}:${k}` });
  }
  await s.pump(() => s.commands().some((m) => m.step === `${planId}:${n}` || m.step === `${planId}:${n}:hand`), `${n}번 명령`);
  return planId;
}

describe("코치 모드: 라면 끓이기 알려 주기", () => {
  it("말로 시작해 단계마다 알려 주고, 다른 행동은 한 줄로 바로잡고, 혼잣말에 지금 할 일을 다시 알리고, 불 켜기 전에 묻고, 끝까지 가면 수업 기록을 남긴다. 들은 말은 기록에 남지 않는다", async () => {
    const s = await start({ assist: "coach" });
    // 1 말 → 말 요청 에이전트는 답하지 않고(빈 글), PAM이 코치 목록에서 고른다 → 첫 명령
    s.say(ASK_RAMEN);
    await s.pump(() => s.replies().length > 0, "말의 답");
    expect(s.replies()[0]).toMatchObject({ type: "reply", text: "" });
    await s.pump(() => !!s.said("수납장으로 가 주세요"), "첫 명령");
    const first = s.said("수납장으로 가 주세요")!;
    const planId = first.id as string;
    expect(first).toMatchObject({ step: `${planId}:1`, kind: "go", choices: [{ id: "done", label: "완료" }] });
    const chosen = pam!.bodies.find((b) => String(b.observation_text).includes(`사람이 말함: 「${ASK_RAMEN}」`))!;
    expect(chosen.tasks).toEqual(tasksFor("coach"));
    expect(chosen.tasks).toEqual(["사용자에게 물어보기", RAMEN]);
    expect(Object.keys(chosen).sort()).toEqual(["contract", "final_time", "memory", "memory_kind", "observation_text", "tasks"]);
    const during = s.predicts();

    // 2 「완료」·VLM 답(사람이 물건을 들고 있음)·말 「다 했어」로 단계를 넘긴다
    s.answer(first);
    await s.pump(() => !!s.said("냄비를 꺼내 주세요"), "2번");
    s.scene.dets = [PERSON];
    s.scene.facts = { person: ["standing", "holding_object"] };
    await s.pump(() => !!s.said("싱크대로 가 주세요"), "3번(비전으로 넘어감)");
    s.say("다 했어");
    await s.pump(() => !!s.said("냄비에 물을 받아 주세요"), "4번(말로 넘어감)");
    const fill = s.said("냄비에 물을 받아 주세요")!;

    // 3 물 받기 단계인데 인덕션을 먼저 켬 → 관찰 모드(off_track)가 지금 할 일을 한 줄로 다시 알리고, 8초 뒤 원래 글로 돌아온다
    await srv!.hub.command(s.cooktop, { type: "on" });
    await s.pump(() => !!s.said(TELL_WATER), "바로잡는 글");
    expect(s.said(TELL_WATER)).toMatchObject({ id: planId, step: fill.step, kind: "do", choices: [{ id: "done", label: "완료" }] });
    const off = s.observerBodies().at(-1)!.input[0].content as string;
    expect(off).toContain("- 사람이 지금 단계와 다른 일을 하는 것 같다");
    expect(off).toContain("- 4 물 받기 · 지금");
    expect(off).toMatch(/\[방금 본 변화\]\n(- .*\n)*- .*인덕션.*켜짐/);
    await s.pump(() => s.dash.some((m) => m.type === "say" && m.text === "다시 알려 줬어요."), "말풍선 카드");
    await srv!.hub.command(s.cooktop, { type: "off" });
    await s.pump(() => s.last().step === fill.step && s.last().text === "냄비에 물을 받아 주세요" && s.last().speak === false, "원래 글로 되돌림", 15_000);
    s.answer(fill);

    // 4·5·6 → 7 인덕션 켜기: 먼저 묻고(승인·거절), 승인 뒤에만 켜라는 명령
    for (const k of [5, 6]) {
      await s.pump(() => s.commands().some((m) => m.step === `${planId}:${k}`), `${k}번`);
      s.answer({ id: planId, step: `${planId}:${k}` });
    }
    await s.pump(() => s.commands().some((m) => m.step === `${planId}:7:hand`), "켜기 전 질문");
    const ask = s.commands().find((m) => m.step === `${planId}:7:hand`)!;
    expect(ask).toMatchObject({ vision: null, choices: YESNO, speak: true });
    // 켜기 전 질문의 안전 문구는 서버 글이다
    expect(ask.text).toMatch(/^냄비와 상판이 뜨거워져요\. .*인덕션.* 켤까요\?$/);
    expect(s.said("인덕션을 켜 주세요")).toBeUndefined();
    s.answer({ id: planId, step: `${planId}:7` });
    s.say("다 했어");
    await new Promise((r) => setTimeout(r, 800));
    expect(s.said("인덕션을 켜 주세요")).toBeUndefined();
    s.answer(ask, "approve");
    await s.pump(() => !!s.said("인덕션을 켜 주세요"), "켜라는 명령");
    s.answer(s.said("인덕션을 켜 주세요")!);

    // 8 알림 · 9 기다리기(2초) → 10 면 넣기: 혼잣말 → 관찰 모드(heard)가 지금 할 일을 다시 읽는다. 말 요청 에이전트는 부르지 않는다
    await s.pump(() => !!s.said("물이 끓을 때까지 기다려요."), "알림");
    await s.pump(() => !!s.said("면과 스프를 넣어 주세요"), "10번");
    const agentBefore = s.agentBodies().length;
    const readBefore = s.spoken().filter((m) => m.text === "면과 스프를 넣어 주세요").length;
    const repliesBefore = s.replies().length;
    s.say(LOST);
    await s.pump(() => s.spoken().filter((m) => m.text === "면과 스프를 넣어 주세요").length > readBefore, "다시 읽기");
    await s.pump(() => s.replies().length > repliesBefore, "혼잣말의 답");
    expect(s.replies().at(-1)).toMatchObject({ text: "" });
    expect(s.agentBodies()).toHaveLength(agentBefore);
    expect(s.observerBodies().at(-1)!.input[0].content).toContain(`[들은 말] ${LOST}`);
    // 이 일과 상관없는 말은 넘겨서 말 요청 에이전트가 한다
    s.say("에어컨 켜 줘");
    await s.pump(() => s.replies().some((m) => m.text === "에어컨을 켰어요."), "가전 요청의 답");
    expect(srv!.hub.get(s.light)!.twin.power).toBe("on");

    // 끝까지: 면 넣기 완료 → 기다리기 → 인덕션 끄기 완료 → 알림 → 완료
    s.answer({ id: planId, step: `${planId}:10` });
    await s.pump(() => !!s.said("인덕션을 꺼 주세요"), "12번");
    expect(s.said("인덕션을 꺼 주세요")).toMatchObject({ step: `${planId}:12`, kind: "do" });
    s.answer(s.said("인덕션을 꺼 주세요")!);
    await s.pump(() => !!s.said("라면이 다 됐어요."), "끝 알림");
    await s.pump(async () => (await s.history("execution")).some((r) => r.subject === planId && r.text === "완료"), "완료");
    // 진행 중에는 PAM을 부르지 않는다(시작 때 나가 있던 판단 하나까지는 봐준다)
    expect(s.predicts() - during).toBeLessThanOrEqual(1);
    expect(s.commands().some((m) => m.step === `${planId}:off`)).toBe(false);

    // 수업 기록: 사람 단계 아홉(알림·기다리기는 없음). 도움을 받은 단계는 0
    const lessons = JSON.parse(readFileSync(join(s.runtimeDir, "homes", "mokryeon_180b", "lessons.json"), "utf8")) as { lessons: Record<string, { runs: number; steps: { label: string; alone: number }[] }> };
    expect(lessons.lessons[RAMEN]!.runs).toBe(1);
    expect(lessons.lessons[RAMEN]!.steps.map((x) => x.label)).toEqual(["수납장으로 가기", "냄비 꺼내기", "싱크대로 가기", "물 받기", "인덕션으로 가기", "냄비 올리기", "인덕션 켜기", "면과 스프 넣기", "인덕션 끄기"]);
    expect(lessons.lessons[RAMEN]!.steps.filter((x) => x.alone === 0).map((x) => x.label)).toEqual(["물 받기", "면과 스프 넣기"]);

    // 대시보드: 계획 13단계, 생각 말풍선 자료(상태 cooking), 켜기 전 질문은 말풍선 카드에 없다
    const plan = s.dash.filter((m) => m.type === "plan" && m.plan?.id === planId).map((m) => m.plan);
    expect(plan[0].steps).toHaveLength(13);
    expect(plan.at(-1)).toMatchObject({ status: "done", goal: RAMEN });
    expect(s.dash.find((m) => m.type === "brain" && m.event.type === "decision" && `plan:${m.event.id}` === planId)!.event).toMatchObject({ action: RAMEN, fsm: { state: "cooking" } });
    const says = s.dash.filter((m) => m.type === "say").map((m) => m.text as string);
    expect(says).toEqual(expect.arrayContaining(["냄비 꺼내기를 부탁했어요.", "다시 알려 줬어요.", "인덕션 켜기를 부탁했어요.", "라면 끓이기 알려 주기를 마쳤어요."]));
    expect(says.some((t) => t.includes("켤까요") || t === "폰으로 물어봤어요.")).toBe(false);

    // 들은 말은 기록 DB에도 대시보드 방송에도 남지 않는다: 내용 없는 표시만 있다
    const rows = await s.history();
    const stored = JSON.stringify(rows);
    for (const words of ["끓이는 법 알려 줘", "뭐 해야 되지", "에어컨 켜 줘"]) expect(stored).not.toContain(words);
    expect(rows.filter((r) => r.kind === "world").map((r) => r.text)).toContain("들은 말 있음");
    expect(rows.filter((r) => r.kind === "pam_text").some((r) => r.text.includes("들은 말 있음"))).toBe(true);
    const shown = JSON.stringify(s.dash.filter((m) => m.type === "brain" || m.type === "say" || m.type === "plan" || m.type === "agent"));
    for (const words of ["끓이는 법 알려 줘", "뭐 해야 되지", "에어컨 켜 줘"]) expect(shown).not.toContain(words);
    expect(s.dash.filter((m) => m.type === "agent" && m.event === "reply").map((m) => m.message)).toContain("들은 말 있음");
    expect(readFileSync(join(s.runtimeDir, "homes", "mokryeon_180b", "lessons.json"), "utf8")).not.toMatch(/알려 줘|뭐 해야/);
  }, 120_000);

  it("인덕션을 켜라고 한 뒤 「그만」이면 계획을 취소하고 「…꺼 주세요」 명령을 보낸다. 거절이면 켜라는 명령도 끄기 안내도 없다", async () => {
    const s = await start({ assist: "coach" });
    const planId = await toStep(s, 7);
    s.answer({ id: planId, step: `${planId}:7:hand` }, "approve");
    await s.pump(() => !!s.said("인덕션을 켜 주세요"), "켜라는 명령");
    s.say("그만");
    await s.pump(() => s.commands().some((m) => m.step === `${planId}:off`), "끄기 안내");
    const off = s.commands().find((m) => m.step === `${planId}:off`)!;
    expect(off).toMatchObject({ id: planId, choices: [{ id: "done", label: "완료" }], speak: true });
    expect(off.text).toMatch(/인덕션.* 꺼 주세요$/);
    await s.pump(async () => (await s.history("execution")).some((r) => r.subject === planId && r.text === "사용자가 그만둠"), "취소 기록");
    await s.pump(() => s.dash.some((m) => m.type === "say" && m.text === "불을 꺼 달라고 했어요."), "말풍선 카드");
    s.answer(off);
    await s.pump(() => s.phone.at(-1)?.type === "command_clear", "안내 지움");
    expect(existsSync(join(s.runtimeDir, "homes", "mokryeon_180b", "lessons.json"))).toBe(false);
  }, 90_000);

  it("눈치 모드에서는 같은 말에도 PAM 요청의 행동 목록에 코치 행동이 없고 명령이 나가지 않는다", async () => {
    const s = await start({ assist: "noonchi" });
    s.say(ASK_RAMEN);
    await s.pump(() => pam!.bodies.some((b) => String(b.observation_text).includes(`사람이 말함: 「${ASK_RAMEN}」`)), "들은 말이 든 PAM 요청");
    const body = pam!.bodies.find((b) => String(b.observation_text).includes("사람이 말함"))!;
    expect(body.tasks).toEqual(tasksFor("noonchi"));
    expect(body.tasks).not.toContain(RAMEN);
    await new Promise((r) => setTimeout(r, 1500));
    expect(s.commands()).toEqual([]);
  }, 60_000);
});
