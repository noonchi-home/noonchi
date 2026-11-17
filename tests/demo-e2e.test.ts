// 시연 네 장면(가짜 서버, 자동 모드 auto, 한양목련): 시연 준비 명령(scripts/demo-setup.ts day1·week)이 쓴 폴더(승인·시작 위치·수업 기록)로 서버를 띄우고
// 폰 엔진 프레임 → YOLO(대본)·VLM(가짜 OpenAI 호환 서버, 장면 대본) → World State → PAM(시험용 PAM 자리 demoPredict·demoReflect) → 계획 모드(가짜 서버 대본) → 실제 폰 명령.
// 1 빈 컵 치우기(눈치), 2 「아 덥다」로 에어컨(눈치)·3 말이 없으면 켜지 않음, 4 합성 7일 반성 뒤 말없이 에어컨(배운 습관), 5 전자레인지 코치(카메라 근거),
// 6 라면 코치(허브 근거: 인덕션 카메라 근거는 Task 11b 뒤), 7 PAM 요청에는 사진 칸이 없고 계약 판본이 맞다.
// 가짜 PAM·가짜 모델·대본 감지기는 tests/helpers/에만 둔다.
import { mkdtempSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { expectHistoryGolden, reflectionRows } from "./helpers/history-golden.js";
import type WebSocket from "ws";
import { DEMO_APPROVALS, demoSetup } from "../scripts/demo-setup.js";
import { startFakeOpenAI, type FakeServer } from "../scripts/fake-openai.js";
import { riskyNames } from "../src/agent/policy.js";
import type { Detection } from "../src/contract/observe.js";
import { CUP_FSM_MEMORY, type FsmMemory } from "../src/brain/decision.js";
import type { HistoryRow } from "../src/contract/history.js";
import { encodeFramePacket } from "../src/phone/packet.js";
import { fetchRetry, listenRetry } from "../src/shared/net.js";
import { startServer, type RunningServer } from "../src/server/start.js";
import { alignOnServer } from "./helpers/align.js";
import { ScriptedDetector, det } from "./helpers/detectors.js";
import { turnOf } from "./helpers/llm.js";
import { isObserving, observerRespond } from "./helpers/observer.js";
import { DEMO_AIRCON_RULE, DEMO_RAMEN_HABIT, demoPredict, demoReflect, startFakePamLlm, type FakePamLlm, pamLlmEnv } from "./helpers/pam.js";
import { CUP_SCRIPTS, microwaveScripts, planCalls, plannerRespond, ramenScripts } from "./helpers/planner.js";
import { heardAtOf, openPhone, openWebSocket } from "./helpers/ws.js";

type Msg = Record<string, any>;
let srv: RunningServer | undefined;
let fake: FakeServer | undefined;
let pam: FakePamLlm | undefined;
const sockets: WebSocket[] = [];
afterEach(async (ctx) => {
  // 기록 DB 같음 시험: 서버를 닫기 전에 반성용 줄 모양을 뽑아 두고, 다 닫은 뒤 정답과 견준다(시험이 실패했으면 견주지 않음)
  const golden = srv && ctx.task.result?.state !== "fail" ? reflectionRows(srv.history) : null;
  for (const s of sockets.splice(0)) s.close();
  await srv?.close();
  srv = undefined;
  await fake?.close();
  fake = undefined;
  await pam?.close();
  pam = undefined;
  if (golden) await expectHistoryGolden("demo-e2e", ctx.task.name, golden);
});

const TZ = { HISTORY_TZ_MINUTES: "540" };
/** 꺼진 서버 주소(시연 준비 명령은 서버가 꺼져 있어야 폴더를 쓴다). */
let CLOSED = "";
beforeAll(async () => {
  const s = createServer();
  const { port } = await listenRetry(s, 0, "127.0.0.1");
  await new Promise<void>((ok) => s.close(() => ok()));
  CLOSED = `http://127.0.0.1:${port}`;
});

const RAMEN = "라면 끓이기 알려 주기";
const MW_TASK = "전자레인지로 데우기 알려 주기";
const AIRCON = "stand_ac_dc22b8f3"; // 거실·복도 에어컨
const MW = "microwave_kitchen";
const PERSON = det("person", 0.9, [40, 40, 120, 280]);
const YESNO = [{ id: "approve", label: "승인" }, { id: "reject", label: "거절" }];

// 맞춘 카메라(90° 시야 투영, 열 우선): AR 좌표 = 트윈 [x, 높이, y](시작 위치 회전 0, tests/helpers/align.ts)
const PROJECTION = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, -1.0002, -1, 0, 0, -0.020002, 0];
const mul = (a: number[], b: number[]) => [a[3]! * b[0]! + a[0]! * b[3]! + a[1]! * b[2]! - a[2]! * b[1]!, a[3]! * b[1]! - a[0]! * b[2]! + a[1]! * b[3]! + a[2]! * b[0]!,
  a[3]! * b[2]! + a[0]! * b[1]! - a[1]! * b[0]! + a[2]! * b[3]!, a[3]! * b[3]! - a[0]! * b[0]! - a[1]! * b[1]! - a[2]! * b[2]!];
type View = { eye: [number, number, number]; orientation: [number, number, number, number] };
/** 눈 자리에서 yaw(라디안, 0이면 -y 쪽)로 돌아 target 높이·거리로 숙인 카메라. */
const look = (eye: [number, number, number], yaw: number, dist: number, height: number): View => {
  const pitch = Math.atan2(eye[1] - height, dist);
  return { eye, orientation: mul([0, Math.sin(yaw / 2), 0, Math.cos(yaw / 2)], [Math.sin(-pitch / 2), 0, 0, Math.cos(-pitch / 2)]) as View["orientation"] };
};
// 컵: 식탁 가운데([9.9612, 3.9242], 윗면 0.75 m)에서 1.5 m 떨어진 거실에서 +x를 보고 식탁 윗면 가운데를 향해 숙인다(tests/mokryeon-e2e.test.ts와 같다)
const CUP_VIEW = look([9.9612 - 1.5, 1.5, 3.9242], -Math.PI / 2, 1.5, 0.75);
const CUP_BOX: Detection["box"] = [220, 160, 40, 20];
// 전자레인지(배치 [7.66, -0.0715], 주방): 그 앞 1.57 m 주방에서 -y 쪽을 보고 높이 1.0 m를 향해 숙인다. 상자 가운데가 화면 한가운데
const MW_VIEW = look([7.66, 1.5, 1.5], 0, 1.57, 1.0);
const MW_BOX: Detection["box"] = [200, 140, 80, 80];

/** 장면: 감지(YOLO 대본)와 감지 종류마다 VLM이 내는 사실 값. */
interface Scene { dets: Detection[]; facts: Record<string, string[]> }

async function start(o: { scene: Scene; kind?: "day1" | "week"; view?: View }) {
  const scene = o.scene;
  const kind = o.kind ?? "day1";
  const dir = join(mkdtempSync(join(tmpdir(), "demo-e2e-")), kind);
  await demoSetup([kind, "--dir", dir, "--api", CLOSED], { env: TZ, log: () => {} });
  const planning = plannerRespond({
    ...CUP_SCRIPTS, ...ramenScripts(2), ...microwaveScripts(60),
    "에어컨 켜기": () => [planCalls([{ kind: "device", label: "거실 에어컨 켜기", target: AIRCON, tool: "turn_on", timeout_s: 60 }])],
  });
  const observing = observerRespond(() => undefined);
  fake = await startFakeOpenAI({
    reply: (body) => {
      if (body?.response_format?.json_schema?.name !== "scene_observation") return null;
      const parts = (body.messages as { role: string; content: unknown }[]).filter((m) => m.role === "user").flatMap((m) => (Array.isArray(m.content) ? m.content : [{ text: m.content }]));
      const text = parts.map((p: { text?: unknown }) => (typeof p.text === "string" ? p.text : "")).join("\n");
      const dets = JSON.parse(/Detections: (\[.*\])/.exec(text)?.[1] ?? "[]") as { id: string; class: string }[];
      return JSON.stringify({ scene: "room", observations: dets.flatMap((d) => (scene.facts[d.class] ?? []).map((state) => ({ object_id: d.id, state }))), summary: "집" });
    },
    // 계획 모드·관찰 모드는 대본, 말 요청 에이전트는 들은 말에 넘기기(leave_it)만
    respond: (body) => {
      const planned = planning(body);
      if (planned) return planned;
      if (isObserving(body)) return observing(body);
      const t = turnOf(body);
      if (!t) return null;
      return t.round === 0 ? { calls: [{ name: "leave_it", args: { reason: "시킨 말이 아니라서" } }] } : { text: "" };
    },
  });
  pam = await startFakePamLlm({ predict: demoPredict, reflect: demoReflect });
  srv = await startServer({
    env: { HUB: "memory", PORT: "0", HOME_ID: "mokryeon_180b", RUNTIME_DIR: dir, PHONE_PORT: "0", PHONE_HOST: "127.0.0.1", PAM_PERIOD_MS: "1500", PAM_MIN_GAP_MS: "1000",
      BRAIN: "1", VLM_BASE_URL: `${fake.url}/v1`, ...pamLlmEnv(pam), OPENAI_API_KEY: "fake-key", OPENAI_BASE_URL: `${fake.url}/v1`, ...TZ },
    // 시연 서버처럼 설정 파일(시연 준비가 쓴 setup.json: 집·자동 모드)을 읽는다
    brain: { detector: new ScriptedDetector(() => scene.dets) }, log: () => {}, persistSetup: true,
  });
  const server = srv;
  expect(server.assist).toBe("auto");
  const dash: Msg[] = [];
  sockets.push(await openWebSocket(`${server.url.replace(/^http/, "ws")}/events`, { setup: (ws) => ws.on("message", (d, bin) => { if (!bin) dash.push(JSON.parse(String(d)) as Msg); }) }));
  const phoneUrl = new URL(server.phoneUrls[0]!);
  const phone: Msg[] = [];
  const ws = await openPhone(`ws://${phoneUrl.host}/phone/events`, { options: { origin: phoneUrl.origin }, setup: (s) => s.on("message", (d, bin) => { if (!bin) phone.push(JSON.parse(String(d)) as Msg); }) });
  sockets.push(ws);
  const wait = async (ok: () => boolean, what: string, ms = 5000) => {
    for (const end = Date.now() + ms; Date.now() < end; await new Promise((r) => setTimeout(r, 20))) if (ok()) return;
    throw new Error(`${ms / 1000}초 안에 오지 않음: ${what}`);
  };
  const view = o.view;
  if (view) {
    await alignOnServer(server.url, (t) => ws.send(t), join(server.twin.dir, "homes", "mokryeon_180b", "scene.json"), [view.eye[0], view.eye[2]]);
    await wait(() => phone.some((m) => m.type === "status" && m.aligned), "맞춤");
    ws.send(JSON.stringify({ type: "pose", position: view.eye, orientation: view.orientation, tracking: "ok" }));
  }
  let n = 0;
  const frame = () => ws.send(encodeFramePacket({
    kind: "engine", width: 480, height: 360, captured_at: Date.now(), time_err_ms: 0,
    ...(view ? { position: view.eye, orientation: view.orientation, tracking: "ok" as const, projection: PROJECTION } : {}),
  }, Buffer.from([0xff, 0xd8, n++ % 256, n >> 8])));
  const commands = () => phone.filter((m) => m.type === "command");
  const pump = async (until: () => boolean, what: string, ms = 20_000) => {
    for (const end = Date.now() + ms; Date.now() < end; ) {
      if (until()) return;
      frame();
      await new Promise((r) => setTimeout(r, 150));
    }
    const ran = dash.filter((m) => m.type === "brain" && m.event.type === "execution").slice(-3).map((m) => m.event.text);
    throw new Error(`${ms / 1000}초 안에 오지 않음: ${what} · 실제 폰 ${JSON.stringify(commands().slice(-2))} · 실행 ${JSON.stringify(ran)}`);
  };
  const decisions = () => dash.filter((m) => m.type === "brain" && m.event.type === "decision").map((m) => m.event);
  const command = (step: string) => commands().find((m) => m.step === step);
  const answer = (m: Msg, choice = "done") => ws.send(JSON.stringify({ type: "answer", id: m.id, step: m.step, choice }));
  // 새 폰처럼 말할 때 떠 있던 명령(at)을 싣는다
  const say = (text: string) => ws.send(JSON.stringify({ type: "say", text, at: heardAtOf(phone) }));
  const history = async (kinds: string) => ((await (await fetchRetry(`${server.url}/api/history?limit=5000&kinds=${kinds}`)).json()) as { rows: HistoryRow[] }).rows;
  const done = async (planId: string) => (await history("execution")).some((r) => r.subject === planId && r.text === "완료");
  /** PAM 요청에는 사진 칸이 없고, 실제로 나간 LLM 본문에도 사진이 없다. 판단·반성 갈래는 요청 값과 같다. */
  const pamChecked = () => {
    expect(pam!.calls.length).toBe(pam!.bodies.length);
    expect(pam!.requests.length).toBe(pam!.bodies.length);
    pam!.bodies.forEach((b, i) => {
      const keys = Object.keys(b);
      expect(keys.filter((k) => /image|photo|jpeg|frame|picture/i.test(k)), pam!.calls[i]).toEqual([]);
      expect(JSON.stringify(pam!.requests[i])).not.toMatch(/data:image|base64|"image_url"|"type":"image/);
      expect(b.role, pam!.calls[i]).toBe(pam!.calls[i]);
    });
  };
  return { server, dir, scene, dash, phone, ws, wait, pump, commands, command, answer, say, decisions, history, done, pamChecked };
}

describe("시연 네 장면(자동 모드, 한양목련, 가짜 서버)", () => {
  it("시연 준비(day1)가 미리 둔 승인에 이 장면들의 행동이 다 있다", () => {
    expect(DEMO_APPROVALS).toEqual(expect.arrayContaining(["컵 치우기", "에어컨 켜기", RAMEN, MW_TASK]));
  });

  it("1 빈 컵: 사람이 자리를 비웠고 식탁 컵이 비면 첫 명령 「식탁으로 가 주세요」, 판단 사건은 눈치(noonchi)·배운 규칙 아님", async () => {
    const s = await start({ scene: { dets: [det("cup", 0.9, CUP_BOX, 41)], facts: { cup: ["on_table", "empty"] } }, view: CUP_VIEW });
    await s.pump(() => s.commands().some((m) => m.text === "식탁으로 가 주세요"), "첫 명령");
    expect(s.commands()[0]).toMatchObject({ text: "식탁으로 가 주세요", choices: [{ id: "done", label: "완료" }] });
    expect(s.decisions().find((e) => e.action === "컵 치우기")).toMatchObject({ assist: "noonchi", fsm: { learned: false } });
    s.pamChecked();
  }, 120_000);

  it("2 TV 보는 사람이 「아 덥다」라고 하면 폰 답은 빈 글이고 말 요청 에이전트는 가전 도구를 부르지 않으며, 판단이 거실 에어컨을 켠다", async () => {
    const s = await start({ scene: { dets: [PERSON], facts: { person: ["watching_tv"] } } });
    await s.pump(() => (s.server.hub.get(AIRCON)?.twin.power === "off") && s.decisions().length > 0, "첫 판단");
    s.say("아 덥다");
    await s.pump(() => s.server.hub.get(AIRCON)?.twin.power === "on", "에어컨 켜짐");
    expect(s.phone.filter((m) => m.type === "reply").map((m) => m.text)).toEqual(s.phone.filter((m) => m.type === "reply").map(() => ""));
    const tools = s.dash.filter((m) => m.type === "agent" && m.event === "reply").flatMap((m) => (m.actions ?? []).map((a: { tool: string }) => a.tool));
    expect(tools.filter((t) => t !== "leave_it")).toEqual([]);
    expect(s.decisions().find((e) => e.action === "에어컨 켜기")).toMatchObject({ assist: "noonchi", fsm: { learned: false } });
    s.pamChecked();
  }, 120_000);

  it("3 같은 장면에서 말이 없으면 에어컨을 켜지 않는다(대조)", async () => {
    const s = await start({ scene: { dets: [PERSON], facts: { person: ["watching_tv"] } } });
    const from = Date.now();
    await s.pump(() => Date.now() - from > 7_000 && s.decisions().length >= 2, "판단 둘", 30_000);
    expect(s.server.hub.get(AIRCON)?.twin.power).toBe("off");
    expect(s.decisions().every((e) => e.action === null)).toBe(true);
    s.pamChecked();
  }, 120_000);

  it("4 합성 7일(관찰만)을 날마다 반성하면 날마다 다음 날부터 쓰고 7일 판본은 오늘부터다. 라면 습관은 빠지고 요리 규칙은 seed 글이며, 말없이 TV를 보면 배운 습관으로 에어컨을 켠다", async () => {
    const s = await start({ kind: "week", scene: { dets: [PERSON], facts: { person: ["watching_tv"] } } });
    const db = s.server.history;
    const today = db.dayOf(Date.now());
    const day = (k: number) => new Date(Date.parse(`${today}T00:00:00Z`) + k * 86_400_000).toISOString().slice(0, 10);
    const post = async (body: unknown) => (await fetchRetry(`${s.server.url}/api/reflection/run`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })).json() as Promise<Msg>;
    let last: Msg | null = null;
    for (let k = -7; k <= -1; k++) {
      last = await post({ day: day(k) });
      expect(last, day(k)).toMatchObject({ ok: true, day: day(k), appliesDay: day(k + 1) });
    }
    expect(last!.appliesDay).toBe(today);
    const uses = (await (await fetchRetry(`${s.server.url}/api/memory/day/${today}`)).json()) as Msg;
    expect(uses.uses).toMatchObject({ version: last!.version, appliesDay: today });
    const memory = db.memoryVersion(last!.version)!.memory as FsmMemory;
    const rules = (id: string) => memory.states.find((x) => x.id === id)!.rules;
    expect(rules("watching_tv")).toContainEqual(DEMO_AIRCON_RULE);
    expect(memory.states.flatMap((x) => x.rules).some((r) => r.trigger === DEMO_RAMEN_HABIT.trigger)).toBe(false);
    expect(rules("cooking")).toEqual(CUP_FSM_MEMORY.states.find((x) => x.id === "cooking")!.rules);
    const reflections = db.list({ kinds: ["reflection"], limit: 50 });
    expect(reflections.some((r) => ((r.data as { dropped?: { action: string; reason: string }[] } | null)?.dropped ?? []).some((d) => d.action === RAMEN && d.reason === "coach"))).toBe(true);
    // 말없이 TV를 보는 장면: 오늘 판본의 배운 습관으로 에어컨을 켠다
    await s.pump(() => s.server.hub.get(AIRCON)?.twin.power === "on", "배운 습관으로 에어컨", 30_000);
    expect(s.decisions().find((e) => e.action === "에어컨 켜기")).toMatchObject({ assist: "noonchi", fsm: { learned: true } });
    s.pamChecked();
  }, 120_000);

  it("5 전자레인지 앞에서 「이거 어떻게 하지」: 명령이 Task 12 표의 서버 글 차례대로 오고, 5번은 승인 질문이 먼저이며 승인 뒤 VLM 쓰는 중이면 넘어가고, 6번 동안 꺼짐을 보면 7번이 바로 끝나 8·9번 뒤 끝난다. 끄기 안내가 없고 폰 글은 서버 글 틀이다", async () => {
    const scene: Scene = { dets: [det("microwave", 0.9, MW_BOX)], facts: { microwave: ["closed", "not_in_use"] } };
    const s = await start({ scene, view: MW_VIEW });
    await s.pump(() => s.decisions().length > 0, "첫 판단");
    s.say("이거 어떻게 하지");
    await s.pump(() => !!s.commands().find((m) => m.text === "전자레인지로 가 주세요"), "1번");
    const planId = s.commands().find((m) => m.text === "전자레인지로 가 주세요")!.id as string;
    expect(s.decisions().find((e) => e.action === MW_TASK)).toMatchObject({ assist: "coach" });
    for (const k of [1, 2, 3]) {
      await s.pump(() => !!s.command(`${planId}:${k}`), `${k}번`);
      s.answer(s.command(`${planId}:${k}`)!);
    }
    // 4번 문 닫기는 VLM이 이미 닫힘이면 바로 넘어간다. 아니면 「완료」
    await s.pump(() => !!s.command(`${planId}:4`) || !!s.command(`${planId}:5:hand`), "4번");
    if (!s.command(`${planId}:5:hand`)) s.answer(s.command(`${planId}:4`)!);
    await s.pump(() => !!s.command(`${planId}:5:hand`), "켜기 전 질문");
    expect(s.command(`${planId}:5:hand`)).toMatchObject({ text: "그릇이 뜨거워져요. 전자레인지를 켤까요?", choices: YESNO });
    expect(s.commands().some((m) => m.text === "전자레인지를 켜 주세요")).toBe(false);
    s.answer(s.command(`${planId}:5:hand`)!, "approve");
    await s.pump(() => !!s.command(`${planId}:5`), "켜라는 명령");
    scene.facts.microwave = ["closed", "in_use"];
    await s.pump(() => s.commands().some((m) => m.id === planId && m.text === "다 될 때까지 기다려요."), "6번 알림(켜짐을 봄)");
    // 카메라로 본 켜짐(가상 가전이라 본 값이 상태): World State 전자레인지가 켜짐
    const world = (await (await fetchRetry(`${s.server.url}/api/world`)).json()) as { world?: { devices: { id: string; state: string[] }[] }; devices?: { id: string; state: string[] }[] };
    expect((world.world ?? world).devices!.find((d) => d.id === MW)?.state).toContain("on");
    scene.facts.microwave = ["closed", "not_in_use"];
    await s.pump(() => !!s.command(`${planId}:8`), "8번(7번이 꺼짐으로 끝남)");
    s.answer(s.command(`${planId}:8`)!);
    await s.pump(() => !!s.command(`${planId}:9`), "9번");
    s.answer(s.command(`${planId}:9`)!);
    let finished = false;
    for (const end = Date.now() + 10_000; !(finished = await s.done(planId)) && Date.now() < end; ) await new Promise((r) => setTimeout(r, 100));
    expect(finished).toBe(true);
    expect(s.commands().some((m) => /^off:/.test(m.step))).toBe(false);
    // 단계 명령은 Task 12 표의 서버 글 차례대로
    const texts = [...new Set(s.commands().filter((m) => m.id === planId).map((m) => m.text as string))];
    const order = ["전자레인지로 가 주세요", "전자레인지 문을 열어 주세요", "그릇을 전자레인지에 넣어 주세요", "전자레인지 문을 닫아 주세요",
      "그릇이 뜨거워져요. 전자레인지를 켤까요?", "전자레인지를 켜 주세요", "다 될 때까지 기다려요.", "그릇을 꺼내 주세요"];
    expect(texts).toEqual(order.filter((t) => t !== "전자레인지 문을 닫아 주세요" || texts.includes(t)));
    // 폰으로 나간 글은 서버 글 틀이거나 위험 가전 이름이 없다
    const server = new Set(["전자레인지로 가 주세요", "전자레인지 문을 열어 주세요", "그릇을 전자레인지에 넣어 주세요", "전자레인지 문을 닫아 주세요",
      "그릇이 뜨거워져요. 전자레인지를 켤까요?", "전자레인지를 켜 주세요", "다 될 때까지 기다려요.", "그릇을 꺼내 주세요"]);
    for (const t of [...s.commands().map((m) => m.text as string), ...s.phone.filter((m) => m.type === "reply").map((m) => m.text as string)]) {
      if (!server.has(t)) expect(riskyNames(t), t).toEqual([]);
    }
    s.pamChecked();
  }, 120_000);

  it("6 「라면 끓이는 법 알려 줘」: 첫 명령 「수납장으로 가 주세요」, 6번 「냄비를 인덕션에 올려 주세요」, 7번 전에 승인 질문, 12번은 허브 꺼짐으로 끝나 끄기 안내가 없다. 판단 사건은 코치", async () => {
    const s = await start({ scene: { dets: [PERSON], facts: { person: ["standing"] } } });
    const cooktop = s.server.twin.devices.find((d) => d.kind === "cooktop")!.id;
    await s.pump(() => s.decisions().length > 0, "첫 판단");
    s.say("라면 끓이는 법 알려 줘");
    await s.pump(() => s.commands().some((m) => m.text === "수납장으로 가 주세요"), "1번");
    const first = s.commands().find((m) => m.text === "수납장으로 가 주세요")!;
    const planId = first.id as string;
    expect(first.step).toBe(`${planId}:1`);
    expect(s.decisions().find((e) => e.action === RAMEN)).toMatchObject({ assist: "coach" });
    for (const k of [1, 2, 3, 4, 5, 6]) {
      await s.pump(() => !!s.command(`${planId}:${k}`), `${k}번`);
      if (k === 6) expect(s.command(`${planId}:6`)).toMatchObject({ text: "냄비를 인덕션에 올려 주세요" });
      s.answer(s.command(`${planId}:${k}`)!);
    }
    await s.pump(() => !!s.command(`${planId}:7:hand`), "켜기 전 질문");
    expect(s.command(`${planId}:7:hand`)).toMatchObject({ choices: YESNO });
    expect(s.command(`${planId}:7:hand`)!.text).toMatch(/^냄비와 상판이 뜨거워져요\. .*인덕션.* 켤까요\?$/);
    s.answer(s.command(`${planId}:7:hand`)!, "approve");
    await s.pump(() => !!s.command(`${planId}:7`), "켜라는 명령");
    // 허브 근거: 사람이 켠다(인덕션 카메라 근거는 Task 11b 뒤)
    await s.server.hub.command(cooktop, { type: "on" });
    await s.pump(() => !!s.command(`${planId}:10`), "10번");
    s.answer(s.command(`${planId}:10`)!);
    await s.pump(() => !!s.command(`${planId}:12`), "12번");
    await s.server.hub.command(cooktop, { type: "off" });
    let finished = false;
    for (const end = Date.now() + 15_000; !(finished = await s.done(planId)) && Date.now() < end; ) await new Promise((r) => setTimeout(r, 100));
    expect(finished).toBe(true);
    expect(s.commands().some((m) => /^off:/.test(m.step))).toBe(false);
    s.pamChecked();
  }, 120_000);
});
