// 한양목련 처음부터 끝까지(가짜 서버, 시험 모드): 기준점을 맞춘 폰 엔진 프레임 → YOLO(대본)·VLM(가짜 OpenAI 호환 서버, 컵 자리 대본)
// → World State(컵은 거실·복도 식탁 위) → PAM(시험용 PAM 자리: 컵 치우기) → 에이전트 계획 모드(가짜 서버 도구 호출) → 처음 하는 일이라 실제 폰에 승인 질문 → 「승인」
// → 실제 폰 단계 명령 넷(「완료」 단추·VLM 컵 자리·말 「다 했어」로 한 단계씩) → 완료. 대시보드 말풍선 글·계획 단계·상자, 승인 기억 파일.
// 맞춘 눈은 식탁·싱크대에서 멀리 두어 이동 단계는 「완료」나 말로 넘긴다.
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type WebSocket from "ws";
import { startFakeOpenAI, type FakeServer } from "../scripts/fake-openai.js";
import { encodeFramePacket } from "../src/phone/packet.js";
import { APPROVAL_TEXT } from "../src/plan/labels.js";
import { startServer, type RunningServer } from "../src/server/start.js";
import { ScriptedDetector } from "./helpers/detectors.js";
import { startFakePam, type FakePam } from "./helpers/pam.js";
import { CUP_SCRIPTS, plannerRespond } from "./helpers/planner.js";
import { openWebSocket } from "./helpers/ws.js";
import { alignOnServer } from "./helpers/align.js";

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

// 위치 맞춤: 눈 자리에 시작 위치를 저장하고 「여기서 시작」 + 그 자리의 벽·바닥 점(AR 점 = 평면 점, 회전 0, 이동 0, tests/helpers/align.ts)
// 폰 눈: 식탁 가운데([9.9612, 3.9242], 윗면 0.75 m)에서 1.5 m 떨어진 거실에서 높이 1.5 m로 +x를 보고 식탁 윗면 가운데를 향해 숙인다.
// 식탁·싱크대에서 1.2 m 밖이라 이동 단계는 눈 자리로 넘어가지 않는다. 90° 시야 투영(열 우선, tests/act-track.test.ts와 같다)
const PROJECTION = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, -1.0002, -1, 0, 0, -0.020002, 0];
const mul = (a: number[], b: number[]) => [a[3]! * b[0]! + a[0]! * b[3]! + a[1]! * b[2]! - a[2]! * b[1]!, a[3]! * b[1]! - a[0]! * b[2]! + a[1]! * b[3]! + a[2]! * b[0]!, a[3]! * b[2]! + a[0]! * b[1]! - a[1]! * b[0]! + a[2]! * b[3]!, a[3]! * b[3]! - a[0]! * b[0]! - a[1]! * b[1]! - a[2]! * b[2]!];
const PITCH = Math.atan2(1.5 - 0.75, 1.5);
const ORIENTATION = mul([0, Math.sin(-Math.PI / 4), 0, Math.cos(-Math.PI / 4)], [Math.sin(-PITCH / 2), 0, 0, Math.cos(-PITCH / 2)]) as [number, number, number, number];
const EYE: [number, number, number] = [9.9612 - 1.5, 1.5, 3.9242];
// 상자 아래 가운데가 480×360 화면 한가운데
const CUP_BOX: [number, number, number, number] = [220, 160, 40, 20];
const TABLE_ID = "dining_table_978b20c7";

describe("한양목련 처음부터 끝까지", () => {
  it("컵 치우기를 처음 하면 실제 폰에 승인·거절 두 단추로 묻고, 「승인」 뒤 네 단계를 돌며, 대시보드는 판단·명령 글만 받고, 다음에는 묻지 않는다", async () => {
    let cupPlace = "on_table";
    fake = await startFakeOpenAI({
      reply: (body) => {
        if (body?.response_format?.json_schema?.name !== "scene_observation") return null;
        const parts = (body.messages as { role: string; content: unknown }[]).filter((m) => m.role === "user").flatMap((m) => (Array.isArray(m.content) ? m.content : [{ text: m.content }]));
        const text = parts.map((p: { text?: unknown }) => (typeof p.text === "string" ? p.text : "")).join("\n");
        const dets = JSON.parse(/Detections: (\[.*\])/.exec(text)?.[1] ?? "[]") as { id: string }[];
        return JSON.stringify({ scene: "kitchen", observations: dets.map((d) => ({ object_id: d.id, state: cupPlace })), summary: "컵" });
      },
      // 에이전트 계획 모드: 같은 가짜 서버가 컵 치우기 도구 호출(지금 서버와 같은 네 단계)을 낸다
      respond: plannerRespond(CUP_SCRIPTS),
    });
    // PAM은 기본 주기(5초)로 불린다. 관찰 텍스트에 컵이 있으면 컵 치우기, 없으면 대기
    pam = await startFakePam({ predict: (b) => (/컵 cup_\d/.test(String(b.observation_text))
      ? { observation: "빈 컵이 식탁에 남음", reasoning: "자리를 비워 컵을 치운다", task_index: 0 } : { observation: "컵 없음", reasoning: "할 일 없음", task_index: -1 }) });
    const runtimeDir = mkdtempSync(join(tmpdir(), "rt-"));
    srv = await startServer({
      env: { HUB: "memory", PORT: "0", HOME_ID: "mokryeon_180b", RUNTIME_DIR: runtimeDir, PHONE_PORT: "0", PHONE_HOST: "127.0.0.1",
        BRAIN: "1", VLM_BASE_URL: `${fake.url}/v1`, PAM_URL: pam.url, OPENAI_API_KEY: "fake-key", OPENAI_BASE_URL: `${fake.url}/v1` },
      brain: { detector: new ScriptedDetector(() => [{ label: "cup", score: 0.9, cls: 41, box: CUP_BOX }]) }, log: () => {},
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
    await alignOnServer(srv.url, (t) => ws.send(t), join(srv.twin.dir, "homes", "mokryeon_180b", "scene.json"), [EYE[0], EYE[2]]);
    await until(() => phone.some((m) => m.type === "status" && m.aligned), "맞춤");
    // 맞춘 눈 = 클로이드 자리(계획 경로의 출발점)
    ws.send(JSON.stringify({ type: "pose", position: EYE, orientation: ORIENTATION, tracking: "ok" }));
    await until(() => dash.some((m) => m.type === "eye"), "눈");
    let n = 0;
    // 조건이 맞을 때까지 엔진 프레임을 150ms마다 보낸다(판단 뒤에도 대상을 다시 보도록, 최대 15초)
    const pump = async (done: () => boolean) => {
      for (const end = Date.now() + 15_000; Date.now() < end; ) {
        if (done()) return;
        ws.send(encodeFramePacket({ kind: "engine", width: 480, height: 360, position: EYE, orientation: ORIENTATION, tracking: "ok", projection: PROJECTION,
          captured_at: Date.now(), time_err_ms: 0 }, Buffer.from([0xff, 0xd8, n++ % 256, n >> 8])));
        await new Promise((r) => setTimeout(r, 150));
      }
      const ran = dash.filter((m) => m.type === "brain" && m.event.type === "execution").slice(-3).map((m) => m.event.text);
      throw new Error(`조건이 15초 안에 맞지 않음 · 실제 폰 ${JSON.stringify(phone.filter((m) => m.type === "command").slice(-2))} · 실행 ${JSON.stringify(ran)}`);
    };
    const spoken = () => phone.filter((m) => m.type === "command" && m.speak);
    const said = (text: string) => spoken().find((m) => m.text === text);

    // 1 판단 → 처음 하는 일이라 실제 폰에 승인 질문(답 둘). 계획은 아직 planned
    const ask = APPROVAL_TEXT.ask("컵 치우기");
    await pump(() => !!said(ask));
    const asked = said(ask)!;
    const planId = asked.id as string;
    expect(asked).toEqual({
      type: "command", id: expect.stringMatching(/^plan:pam-\d+$/), step: `${planId}:approve`, text: "컵 치우기를 할까요?", vision: null,
      choices: [{ id: "approve", label: "승인" }, { id: "reject", label: "거절" }], target: null, speak: true,
    });
    const waiting = dash.filter((m) => m.type === "plan" && m.plan?.id === planId).at(-1)!.plan;
    expect(waiting.status).toBe("planned");
    expect(waiting.path.length).toBeGreaterThan(1);
    const cup = dash.filter((m) => m.type === "world").at(-1)!.world.objects.find((o: Msg) => o.cls === "cup");
    expect(cup).toMatchObject({ surface: TABLE_ID, surface_label: "거실·복도 식탁" });

    // 2 「승인」 → 네 단계
    ws.send(JSON.stringify({ type: "answer", id: planId, step: asked.step, choice: "approve" }));
    await pump(() => !!said("식탁으로 가 주세요"));
    const first = said("식탁으로 가 주세요")!;
    expect(first).toMatchObject({ id: planId, step: `${planId}:1`, choices: [{ id: "done", label: "완료" }], target: { id: TABLE_ID } });
    ws.send(JSON.stringify({ type: "answer", id: planId, step: first.step, choice: "done" }));
    await pump(() => !!said("컵을 들어 주세요"));
    expect(said("컵을 들어 주세요")).toMatchObject({ id: planId, step: `${planId}:2`, vision: "컵 · 식탁 위" });
    cupPlace = "in_hand";
    await pump(() => !!said("싱크대로 가 주세요"));
    expect(said("싱크대로 가 주세요")).toMatchObject({ id: planId, step: `${planId}:3`, target: { id: "sink_counter_kitchen" } });
    ws.send(JSON.stringify({ type: "say", text: "다 했어" }));
    await pump(() => !!said("컵을 싱크대에 넣어 주세요"));
    expect(said("컵을 싱크대에 넣어 주세요")).toMatchObject({ id: planId, step: `${planId}:4` });
    cupPlace = "in_sink";
    await pump(() => phone.some((m) => m.type === "command_clear" && m.id === planId));
    await pump(() => dash.some((m) => m.type === "plan" && m.plan?.id === planId && m.plan.status === "done") && dash.some((m) => m.type === "say" && m.text === "컵을 다 치웠어요."));
    expect(spoken().map((m) => m.text)).toEqual(["컵 치우기를 할까요?", "식탁으로 가 주세요", "컵을 들어 주세요", "싱크대로 가 주세요", "컵을 싱크대에 넣어 주세요"]);

    // 3 대시보드: 판단·명령 글 차례, 계획 단계 1→4, 상자 있는 observe. 승인 질문은 어디에도 없다
    const says = dash.filter((m) => m.type === "say").map((m) => m.text as string);
    expect(says[0]).toBe("지켜보고 있어요.");
    expect(says.every((t, i) => i === 0 || t !== says[i - 1])).toBe(true);
    const decided = says.findIndex((t) => t.endsWith("컵을 치우기로 했어요."));
    const cleared = says.indexOf("컵을 다 치웠어요.");
    expect(decided).toBeGreaterThan(0);
    for (const t of says.slice(0, decided)) expect(t).toMatch(/^(지켜보고 있어요\.|.+[을를] 보고 있어요\.)$/);
    expect(says.slice(decided, cleared + 1)).toEqual([
      "거실·복도 식탁 컵을 치우기로 했어요.", "식탁으로 가라고 했어요.", "컵을 들라고 했어요.", "싱크대로 가라고 했어요.", "컵을 싱크대에 넣으라고 했어요.", "컵을 다 치웠어요.",
    ]);
    const progress = dash.filter((m) => m.type === "plan" && m.plan?.id === planId).map((m) => m.plan.steps.map((s: Msg) => s.status).join(","));
    expect(progress).toEqual([
      "pending,pending,pending,pending", "active,pending,pending,pending", "done,active,pending,pending",
      "done,done,active,pending", "done,done,done,active", "done,done,done,done",
    ]);
    expect(dash.some((m) => m.type === "brain" && m.event.type === "observe" && m.event.boxes?.length > 0)).toBe(true);
    const shown = JSON.stringify(dash);
    for (const word of [ask, "할까요", "승인", "거절", ":approve"]) expect(shown).not.toContain(word);

    // 4 답은 기억 파일에 남고, 다음 판단은 묻지 않고 바로 첫 명령
    const memory = JSON.parse(readFileSync(join(runtimeDir, "homes", "mokryeon_180b", "approvals.json"), "utf8")) as Record<string, unknown>;
    expect(memory).toEqual({ always: { "task:컵 치우기": expect.any(String) } });
    cupPlace = "on_table";
    await pump(() => spoken().some((m) => m.id !== planId && m.text === "식탁으로 가 주세요"));
    const next = spoken().filter((m) => m.id !== planId);
    expect(next.map((m) => m.text)).toEqual(["식탁으로 가 주세요"]);
    expect(phone.filter((m) => m.type === "command" && m.text === ask)).toHaveLength(1);
  }, 90_000);
});
