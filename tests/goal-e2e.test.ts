// 미리 세운 목표를 처음부터 끝까지(가짜 서버, 한양목련, 기준점을 맞춘 카메라): 사람이 컵으로 마시는 동안 「컵 치우기」 목표를 세우고 계획을 미리 만든다.
// 식탁에서 떠난 뒤에는 확인 중이다. 폰이 거실을 비추고 TV 시청이 확인된 때부터 첫 명령 지연을 잰다.
// 목표가 서 있는 동안 VLM 사진 간격은 1초이고, 계획이 시작되면 2초로 돌아간다(src/observe/pipeline.ts FAST_VLM_MS, src/act/track/tracker.ts fastVlm).
// 물건은 장면 VLM 물건 목록(objects)으로만 생기고 VLM 사진 간격(VLM_FRAME_MS 2초)마다 확정되므로, 컵이 서고 목표가 서기까지 몇 초가 걸린다. 주기 판단은 기본 5초다.
// 폰 눈·카메라는 tests/mokryeon-e2e.test.ts와 같다(식탁 윗면 가운데를 1.5 m 떨어진 거실에서 높이 1.5 m로 본다).
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type WebSocket from "ws";
import { startFakeOpenAI, type FakeServer } from "../scripts/fake-openai.js";
import type { Detection } from "../src/contract/observe.js";
import { encodeFramePacket } from "../src/phone/packet.js";
import { startServer, type RunningServer } from "../src/server/start.js";
import { ScriptedDetector, det } from "./helpers/detectors.js";
import { startFakePamLlm, type FakePamLlm, pamLlmEnv } from "./helpers/pam.js";
import { CUP_SCRIPTS, planTurn, plannerRespond } from "./helpers/planner.js";
import { openPhone, openWebSocket } from "./helpers/ws.js";
import { alignOnServer } from "./helpers/align.js";
import { useLearnedMemory } from "./helpers/memory.js";
import { HistoryDb } from "../src/brain/history/db.js";

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

/** 받은 메시지에 받은 시각(_at, 실제 시계)을 붙인다. */
const inbox = (list: Msg[]) => (ws: WebSocket) => ws.on("message", (d, bin) => { if (!bin) list.push({ ...JSON.parse(String(d)), _at: Date.now() } as Msg); });
const PROJECTION = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, -1.0002, -1, 0, 0, -0.020002, 0];
const mul = (a: number[], b: number[]) => [a[3]! * b[0]! + a[0]! * b[3]! + a[1]! * b[2]! - a[2]! * b[1]!, a[3]! * b[1]! - a[0]! * b[2]! + a[1]! * b[3]! + a[2]! * b[0]!, a[3]! * b[2]! + a[0]! * b[1]! - a[1]! * b[0]! + a[2]! * b[3]!, a[3]! * b[3]! - a[0]! * b[0]! - a[1]! * b[1]! - a[2]! * b[2]!];
const PITCH = Math.atan2(1.5 - 0.75, 1.5);
const ORIENTATION = mul([0, Math.sin(-Math.PI / 4), 0, Math.cos(-Math.PI / 4)], [Math.sin(-PITCH / 2), 0, 0, Math.cos(-PITCH / 2)]) as [number, number, number, number];
const EYE: [number, number, number] = [9.9612 - 1.5, 1.5, 3.9242];
const SIZE = { width: 480, height: 360 };
// 상자 아래 가운데가 480×360 화면 한가운데(식탁 윗면 가운데)
const CUP_BOX: [number, number, number, number] = [220, 160, 40, 20];
const CUP = det("cup", 0.9, CUP_BOX, 41);
const PERSON = det("person", 0.9, [180, 40, 120, 286]);
const TABLE_ID = "dining_table_978b20c7";
interface Scene { dets: Detection[]; facts: Record<string, string[]> }

describe("미리 세운 목표(가짜 서버 처음부터 끝까지)", () => {
  it("식탁에서 마시는 동안 미리 만들고, 떠난 뒤 TV 앞에 앉아 시청하는 것을 확인하면 준비한 계획을 쓴다", async () => {
    let watching = false;
    let camera = EYE;
    const scene: Scene = { dets: [PERSON, CUP], facts: { person: ["sitting", "drinking"], cup: ["on_table", "has_contents"] } };
    /** 장면 VLM 요청을 받은 시각(실제 시계). */
    const vlmAt: number[] = [];
    fake = await startFakeOpenAI({
      // 장면 VLM 답: 감지 번호마다 사실, 그리고 VLM 물건 목록(컵 감지와 이은 v1)
      reply: (body) => {
        if (body?.response_format?.json_schema?.name !== "scene_observation") return null;
        vlmAt.push(Date.now());
        const parts = (body.messages as { role: string; content: unknown }[]).filter((m) => m.role === "user").flatMap((m) => (Array.isArray(m.content) ? m.content : [{ text: m.content }]));
        const text = parts.map((p: { text?: unknown }) => (typeof p.text === "string" ? p.text : "")).join("\n");
        const dets = JSON.parse(/Detections: (\[.*\])/.exec(text)?.[1] ?? "[]") as { id: string; class: string }[];
        const cup = dets.find((d) => d.class === "cup");
        const [x, y, w, h] = CUP_BOX;
        return JSON.stringify({
          scene: "living", summary: watching ? "TV 시청" : "식탁",
          household: {seats:"clear", dining_food:"yes", people:dets.filter(d=>d.class==="person").map(d=>({id:d.id,attention:watching?"toward_tv":"elsewhere"}))},
          observations: dets.flatMap((d) => (scene.facts[d.class] ?? []).map((state) => ({ object_id: d.id, state }))),
          objects: cup ? [{ id: "v1", cls: "cup", box: { x: x / SIZE.width, y: y / SIZE.height, w: w / SIZE.width, h: h / SIZE.height }, det: cup.id }] : [],
        });
      },
      respond: plannerRespond({ ...CUP_SCRIPTS }),
    });
    // PAM: 사람이 안 보이고 컵이 있으면 컵 치우기, 아니면 대기
    pam = await startFakePamLlm({ predict: (b) => (/사람 안 보임/.test(String(b.observation_text)) && /컵 cup_\d/.test(String(b.observation_text))
      ? { observation: "사람이 컵을 두고 자리를 비움", reasoning: "습관대로 치운다", task_index: b.tasks.indexOf("컵 치우기") }
      : { observation: "사람이 마시는 중", reasoning: "기다린다", task_index: -1 }) });
    const runtimeDir = mkdtempSync(join(tmpdir(), "rt-"));
    // 치우기를 보는 시험은 배운 뒤 기억(합성 3일째부터의 로봇 FSM)으로 돈다. seed 기억이면 떠날 때 묻는다
    useLearnedMemory(runtimeDir);
    const history = HistoryDb.open(join(runtimeDir,"noonchi.db"));
    try { history.cupAnswers.seedDemo("mokryeon_180b"); } finally { history.close(); }
    srv = await startServer({
      env: { HUB: "memory", PORT: "0", HOME_ID: "mokryeon_180b", RUNTIME_DIR: runtimeDir, PHONE_PORT: "0", PHONE_HOST: "127.0.0.1",
        BRAIN: "1", VLM_BASE_URL: `${fake.url}/v1`, ...pamLlmEnv(pam), OPENAI_API_KEY: "fake-key", OPENAI_BASE_URL: `${fake.url}/v1` },
      brain: { detector: new ScriptedDetector(() => scene.dets) }, log: () => {},
    });
    const dash: Msg[] = [];
    sockets.push(await openWebSocket(`${srv.url.replace(/^http/, "ws")}/events`, { setup: inbox(dash) }));
    const phoneUrl = new URL(srv.phoneUrls[0]!);
    const phone: Msg[] = [];
    const ws = await openPhone(`ws://${phoneUrl.host}/phone/events`, { options: { origin: phoneUrl.origin }, setup: inbox(phone) });
    sockets.push(ws);
    const until = async (ok: () => boolean, what: string) => {
      for (const end = Date.now() + 5000; Date.now() < end; await new Promise((r) => setTimeout(r, 20))) if (ok()) return;
      throw new Error(`5초 안에 오지 않음: ${what}`);
    };
    await alignOnServer(srv.url, (t) => ws.send(t), join(srv.twin.dir, "homes", "mokryeon_180b", "scene.json"), [EYE[0], EYE[2]]);
    await until(() => phone.some((m) => m.type === "status" && m.aligned), "맞춤");
    ws.send(JSON.stringify({ type: "pose", position: EYE, orientation: ORIENTATION, tracking: "ok" }));
    await until(() => dash.some((m) => m.type === "eye"), "눈");
    let n = 0;
    const goals = () => dash.filter((m) => m.type === "goal").map((m) => `${m.goal.status}/${m.goal.prep}`);
    /** 조건이 맞을 때까지 맞춘 카메라 자세를 실은 엔진 프레임을 150ms마다 보낸다. */
    const pump = async (done: () => boolean, what: string, ms = 30_000) => {
      for (const end = Date.now() + ms; Date.now() < end; ) {
        if (done()) return;
        ws.send(encodeFramePacket({ kind: "engine", ...SIZE, position: camera, orientation: ORIENTATION, tracking: "ok", projection: PROJECTION, captured_at: Date.now(), time_err_ms: 0 },
          Buffer.from([0xff, 0xd8, n++ % 256, n >> 8])));
        await new Promise((r) => setTimeout(r, 150));
      }
      throw new Error(`${ms / 1000}초 안에 맞지 않음: ${what} · 목표 ${JSON.stringify(goals())} · 실제 폰 ${JSON.stringify(phone.filter((m) => m.type === "command").slice(-2))}`);
    };
    const planned = () => fake!.requests.filter((r) => r.method === "POST" && r.path.endsWith("/responses") && planTurn(r.body)?.action === "컵 치우기").length;
    const spoken = () => phone.filter((m) => m.type === "command" && m.speak);

    // 1 마시는 동안: 컵이 VLM 물건으로 확정되면 목표를 세우고 계획을 미리 만든다(폰 명령 없음)
    await pump(() => goals().includes("armed/ready"), "미리 만든 계획");
    expect(goals().slice(0, 3)).toEqual(["armed/waiting", "armed/planning", "armed/ready"]);
    const cup = dash.filter((m) => m.type === "world").at(-1)!.world.objects.find((o: Msg) => o.cls === "cup");
    expect(cup).toMatchObject({ surface: TABLE_ID });
    expect(planned()).toBe(1);
    expect(dash.filter(m=>m.type==="goal").at(-1)!.goal.plan.steps.map((step: Msg)=>step.label)).not.toContain("컵 안 보기");
    expect(spoken()).toEqual([]);
    expect(dash.some((m) => m.type === "thought" && m.messages.some((t: { text: string }) => t.text === "컵을 두고 자리를 뜨면 컵을 치울게요"))).toBe(true);
    expect(dash.filter((m) => m.type === "goal").at(-1)!.goal).toMatchObject({ action: "컵 치우기", object: cup.id, plan: { goal: "컵 치우기" } });
    /** from 뒤에 받은 장면 VLM 요청 사이 간격(ms). */
    const gaps = (from: number) => vlmAt.filter((t) => t >= from).flatMap((t, i, xs) => (i ? [t - xs[i - 1]!] : []));
    const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]!;
    // 목표가 서 있는 동안(사람이 아직 마신다) VLM 사진 간격 1초
    const armed = Date.now();
    await pump(() => Date.now() - armed >= 4600, "목표 동안 사진");
    expect(gaps(armed).length, JSON.stringify(gaps(armed))).toBeGreaterThanOrEqual(3);
    expect(median(gaps(armed))).toBeLessThanOrEqual(1300);

    // 2 떠남만으로는 청소하지 않는다. 같은 집 거실의 실제 TV 상태와 시청 사진을 판단에 넣는다.
    scene.dets = [CUP];
    scene.facts = { cup: ["on_table", "has_contents"] };
    await pump(() => goals().includes("checking/ready"), "식탁 이탈 확인 중");
    expect(spoken().some(m=>m.id?.startsWith("plan:pam"))).toBe(false);
    const tv = srv.signals.list().find(d=>d.kind==="tv")!;
    expect((await srv.hub.command(tv.id,{type:"on"})).ok).toBe(true);
    camera = [4,1.5,9.8];
    ws.send(JSON.stringify({type:"pose",position:camera,orientation:ORIENTATION,tracking:"ok"}));
    watching = true;
    scene.dets = [det("person",0.9,[180,40,120,128])];
    scene.facts = {person:["sitting","watching_tv"]};
    const cleanup = () => spoken().filter(m=>m.id?.startsWith("plan:pam"));
    await pump(() => cleanup().length > 0, "첫 식탁 명령");
    const gone = dash.find((m) => m.type === "brain" && m.event.type === "world_change" && m.event.kind === "person_gone")!;
    expect(gone).toBeDefined();
    expect(cleanup()[0]).toMatchObject({ text: "식탁으로 가 주세요", kind: "go" });
    const confirmed = dash.find(m=>m.type==="goal" && m.goal.confirmed_ms)!;
    expect(cleanup()[0]!._at - confirmed._at).toBeLessThanOrEqual(1000);
    expect(planned()).toBe(1);
    expect(goals().slice(-2)).toEqual(["fired/ready", "used/ready"]);
    expect(JSON.stringify(phone)).not.toContain("할까요");

    // 3 계획이 시작되면(목표 씀) VLM 사진 간격은 다시 2초
    const started = Date.now();
    // 전환 직후 1초를 빼면 다음 사진까지 최대 한 주기를 더 기다려야 한다.
    await pump(() => gaps(started + 1000).length >= 2, "계획 뒤 VLM 사진 세 장", 8000);
    expect(Math.min(...gaps(started + 1000)), JSON.stringify(gaps(started + 1000))).toBeGreaterThanOrEqual(1800);
    // A running phone plan leaves the independent TV slot available.
    const viewer=scene.dets;
    scene.dets=[]; scene.facts={};
    await pump(()=>srv!.signals.get(tv.id)?.twin.power==="off","시청자 부재로 허브 TV 끄기",15_000);
    scene.dets=viewer; scene.facts={person:["sitting","watching_tv"]};
    await pump(()=>srv!.signals.get(tv.id)?.twin.power==="on","다시 보는 사람이 있어 허브 TV 켜기",10_000);

  }, 120_000);
});
