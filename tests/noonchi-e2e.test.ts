// 처음부터 끝까지(가짜 서버): 폰 엔진 프레임 → YOLO(대본)·VLM(가짜 OpenAI 호환 서버, 컵 자리 대본) → World State → PAM(시험용 PAM 자리: 컵 치우기)
// → 에이전트 계획 모드(같은 가짜 서버의 도구 호출) → 실행 전 검사 → 실제 폰 단계 명령(소리) → 「완료」 단추·World State 컵 자리·말 「다 했어」로 한 단계씩 → 완료, 그리고 한 시간축 기록·대시보드 메시지.
// 기본 집(마곡 아파트, 식탁·싱크대 있음). 맞추기 전이라 폰 눈 위치를 몰라 이동 단계는 「완료」나 말로 넘긴다.
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { expectHistoryGolden, settledRows } from "./helpers/history-golden.js";
import type WebSocket from "ws";
import { startFakeOpenAI, type FakeServer } from "../scripts/fake-openai.js";
import type { HistoryRow } from "../src/contract/history.js";
import type { WorldView } from "../src/contract/world.js";
import { encodeFramePacket } from "../src/phone/packet.js";
import { CHECK_TEXT } from "../src/act/labels.js";
import { fetchRetry } from "../src/shared/net.js";
import { startServer, type RunningServer } from "../src/server/start.js";
import { ScriptedDetector, det } from "./helpers/detectors.js";
import { startFakePamLlm, type FakePamLlm, pamLlmEnv } from "./helpers/pam.js";
import { CUP_SCRIPTS, plannerRespond } from "./helpers/planner.js";
import { heardAtOf, openPhone, openWebSocket } from "./helpers/ws.js";

type Msg = Record<string, any>;
const RULE_LINE = "컵을 두고 자리를 뜨면 치워도 된다고 하셨어요";
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
  if (golden) await expectHistoryGolden("noonchi-e2e", ctx.task.name, golden);
});

const inbox = (list: Msg[]) => (ws: WebSocket) => ws.on("message", (d, bin) => { if (!bin) list.push(JSON.parse(String(d)) as Msg); });

describe("NOONCHI 처음부터 끝까지", () => {
  it("관찰부터 단계 명령·실행 결과까지 한 흐름으로 돌고 기록·대시보드에 남는다", async () => {
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
    // PAM은 기본 주기(5초)로 불린다. 관찰 텍스트에 컵이 있으면 컵 치우기를 고르고(끝난 뒤에도: 싱크대 안 컵으로는 새 명령을 보내지 않아야 한다), 없으면 대기
    pam = await startFakePamLlm({ predict: (b) => (/컵 cup_\d/.test(String(b.observation_text))
      ? { observation: "빈 컵이 식탁에 남음", reasoning: "자리를 비워 컵을 치운다", task_index: 0 } : { observation: "컵 없음", reasoning: "할 일 없음", task_index: -1 }) });
    // 컵 치우기는 전에 승인을 받은 일: 승인을 묻지 않고 첫 명령부터(기본 집 apartment). 승인 답 흐름은 tests/act-track.test.ts가 본다
    const runtimeDir = mkdtempSync(join(tmpdir(), "rt-"));
    mkdirSync(join(runtimeDir, "homes", "apartment"), { recursive: true });
    writeFileSync(join(runtimeDir, "homes", "apartment", "approvals.json"), JSON.stringify({ always: { "task:컵 치우기": "2026-11-09T00:00:00.000Z" }, never: {} }));
    srv = await startServer({
      env: { HUB: "memory", PORT: "0", RUNTIME_DIR: runtimeDir, PHONE_PORT: "0", PHONE_HOST: "127.0.0.1",
        BRAIN: "1", VLM_BASE_URL: `${fake.url}/v1`, ...pamLlmEnv(pam), OPENAI_API_KEY: "fake-key", OPENAI_BASE_URL: `${fake.url}/v1` },
      brain: { detector: new ScriptedDetector(() => [det("cup", 0.9, [220, 160, 40, 20], 41)]) }, log: () => {},
    });
    const dash: Msg[] = [];
    sockets.push(await openWebSocket(`${srv.url.replace(/^http/, "ws")}/events`, { setup: inbox(dash) }));
    const phoneUrl = new URL(srv.phoneUrls[0]!);
    const phone: Msg[] = [];
    const ws = await openPhone(`ws://${phoneUrl.host}/phone/events`, { options: { origin: phoneUrl.origin }, setup: inbox(phone) });
    sockets.push(ws);
    let n = 0;
    // 조건이 맞을 때까지 엔진 프레임을 150ms마다 보낸다(판단 뒤에도 대상을 다시 보도록, 최대 15초)
    const pump = async (until: () => boolean | Promise<boolean>) => {
      for (const end = Date.now() + 15_000; Date.now() < end; ) {
        if (await until()) return;
        ws.send(encodeFramePacket({ kind: "engine", width: 480, height: 360, captured_at: Date.now(), time_err_ms: 0 }, Buffer.from([0xff, 0xd8, n++ % 256, n >> 8])));
        await new Promise((r) => setTimeout(r, 150));
      }
      throw new Error("조건이 15초 안에 맞지 않음");
    };
    const history = async (kinds: string) => ((await (await fetchRetry(`${srv!.url}/api/history?kinds=${kinds}`)).json()) as { ok: boolean; rows: HistoryRow[] });
    const said = (text: string) => phone.find((m) => m.type === "command" && m.speak && m.text === text);

    await pump(() => !!said("식탁으로 가 주세요"));
    const first = said("식탁으로 가 주세요")!;
    expect(first).toEqual({ type: "command", id: expect.stringMatching(/^plan:pam-\d+$/), step: `${first.id}:1`, text: "식탁으로 가 주세요", vision: "식탁까지 거리 모름", choices: [{ id: "done", label: "완료" }], target: null, speak: true, kind: "go" });
    const planId = first.id as string;
    // 메시지 상자 문장은 모델 없이 판단 기록의 사실(맞은 규칙 left_cup + 컵 치우기)로 만든다
    const shown = () => dash.filter((m) => m.type === "thought").flatMap((m) => m.messages as { id: string; text: string; decision: string }[]);
    await pump(() => shown().some((m) => m.text === RULE_LINE));
    const cupAt = shown().find((m) => m.text === RULE_LINE)!;
    const cupDecision = dash.find((m) => m.type === "brain" && m.event.type === "decision" && m.event.id === cupAt.decision)!.event;
    expect(cupDecision).toMatchObject({ action: "컵 치우기", prediction: { reasoning: "자리를 비워 컵을 치운다" } });
    // 1 이동: 「완료」 단추
    ws.send(JSON.stringify({ type: "answer", id: planId, step: first.step, choice: "done" }));
    await pump(() => !!said("컵을 들어 주세요"));
    expect(said("컵을 들어 주세요")).toMatchObject({ id: planId, step: `${planId}:2`, vision: "컵 · 식탁 위" });
    // 2 집기: VLM이 컵을 손에 있음으로 본다
    cupPlace = "in_hand";
    await pump(() => !!said("싱크대로 가 주세요"));
    expect(said("싱크대로 가 주세요")).toMatchObject({ id: planId, step: `${planId}:3`, vision: "컵 · 손에 있음 · 싱크대까지 거리 모름" });
    // 3 이동: 말로 「다 했어」(답 글은 비어 있고 다음 명령이 따로 온다)
    ws.send(JSON.stringify({ type: "say", text: "다 했어", at: heardAtOf(phone) }));
    await pump(() => !!said("컵을 싱크대에 넣어 주세요"));
    // 첫 reply는 판본 hello 뒤의 지금 승인 대기 목록(빈 목록), 그다음이 말 답
    await pump(() => phone.filter((m) => m.type === "reply").length >= 2);
    expect(phone.filter((m) => m.type === "reply")).toEqual([{ type: "reply", text: "", pending: [] }, { type: "reply", text: "" }]);
    // 4 내려놓기: VLM이 컵을 싱크대 안으로 본다 → 명령을 지우고 완료
    cupPlace = "in_sink";
    await pump(() => phone.some((m) => m.type === "command_clear" && m.id === planId));
    await pump(async () => (await history("execution")).rows.some((r) => r.subject === planId && r.text === "완료"));
    // 다음 판단(컵 치우기)은 싱크대 안 컵을 대상으로 삼지 않고 실행 전 검사에서 멈춘다
    await pump(async () => (await history("execution")).rows.some((r) => r.subject !== planId && r.text === CHECK_TEXT.in_sink));
    // 그 뒤 VLM이 같은 컵을 「식탁 위」로 봐도(실제 판정에서 싱크대 속 컵에 나온 답) 실행 추적이 넣은 컵이라 다음 판단도 계획 전 검사에서 멈춘다
    cupPlace = "on_table";
    const cupNow = async () => ((await (await fetchRetry(`${srv!.url}/api/world`)).json()) as { world: WorldView }).world.objects.find((o) => o.cls === "cup");
    await pump(async () => (await cupNow())?.facts.place?.value === "on_table");
    const seen = Math.max(...(await history("execution")).rows.map((r) => r.id));
    await pump(async () => (await history("execution")).rows.some((r) => r.id > seen && r.subject !== planId && r.text === CHECK_TEXT.in_sink));

    expect(phone.filter((m) => m.type === "command" && m.speak).map((m) => m.text)).toEqual(["식탁으로 가 주세요", "컵을 들어 주세요", "싱크대로 가 주세요", "컵을 싱크대에 넣어 주세요"]);
    const all = await history("vlm,detection,pam_text,decision,plan,execution,feedback");
    expect(all.ok).toBe(true);
    expect([...new Set(all.rows.map((r) => r.kind))].sort()).toEqual(["decision", "detection", "execution", "feedback", "pam_text", "plan", "vlm"]);
    const steps = all.rows.filter((r) => r.kind === "execution" && r.subject === planId).sort((a, b) => a.id - b.id).map((r) => r.text);
    expect(steps).toEqual(["판단", "계획", "실행 중", "완료"]);
    expect(all.rows.filter((r) => r.kind === "feedback").sort((a, b) => a.id - b.id).map((r) => r.text)).toEqual(["완료 · 부탁: 식탁으로 가 주세요", "다 했어 · 부탁: 싱크대로 가 주세요"]);
    const decided = all.rows.find((r) => r.kind === "decision" && `plan:${r.subject}` === planId)!;
    expect(decided.text).toBe("컵 치우기");
    // 기록 DB 판단 줄에는 원래 생각이 그대로 남는다
    expect((decided.data as { prediction: { reasoning: string } }).prediction.reasoning).toBe("자리를 비워 컵을 치운다");
    // 메시지는 같은 말을 되풀이하지 않고, PAM 원래 생각·관찰은 대시보드로 보내지 않는다
    const texts = shown().map((m) => m.text);
    expect(new Set(texts).size).toBe(texts.length);
    // 생각 말풍선 모델을 부르지 않는다: 모델 요청(chat/completions)은 모두 사진을 실은 VLM 요청이다
    const chats = fake.requests.filter((r) => r.path.endsWith("/chat/completions"));
    expect(chats.length).toBeGreaterThan(0);
    expect(chats.every((r) => JSON.stringify(r.body).includes("image_url"))).toBe(true);
    for (const raw of ["자리를 비워 컵을 치운다", "빈 컵이 식탁에 남음", "할 일 없음", "컵 없음"]) expect(JSON.stringify(dash.filter((m) => m.type === "thought"))).not.toContain(raw);
    // 메시지는 기록 DB에 하나씩 집 id와 함께 남는다(다시 붙은 대시보드·다시 띄운 서버에 최근 것을 다시 보낸다)
    const stored = (await history("thought")).rows;
    expect(stored.map((r) => r.text)).toEqual(texts);
    expect(stored.map((r) => r.data)).toEqual(shown().map((m) => ({ home: "apartment", id: m.id })));
    expect(stored.find((r) => r.text === RULE_LINE)!.subject).toBe(cupDecision.id);
    expect(pam.bodies.some((b) => String(b.observation_text).includes("컵 cup_1 보임"))).toBe(true);
    // 대시보드: 판단·실행 기록과 계획(집기 대상 cup_1). 단계 상태가 지금 단계를 따라가고 끝나면 done
    const planMsgs = dash.filter((m) => m.type === "plan" && m.plan?.id === planId).map((m) => m.plan);
    expect(planMsgs[0]).toMatchObject({ source: "brain", dryRun: true, judgment: "자리를 비워 컵을 치운다" });
    expect(planMsgs[0].steps.find((s: Msg) => s.kind === "act").target).toMatchObject({ objectId: "cup_1" });
    const progress = planMsgs.map((p) => p.steps.map((s: Msg) => s.status).join(","));
    expect(progress).toEqual([
      "pending,pending,pending,pending", "active,pending,pending,pending", "done,active,pending,pending",
      "done,done,active,pending", "done,done,done,active", "done,done,done,done",
    ]);
    expect(planMsgs.at(-1)).toMatchObject({ status: "done" });
    expect(dash.some((m) => m.type === "brain" && m.event.type === "execution" && m.event.plan_id === planId && m.event.state === "done")).toBe(true);
    // 실제 폰 위에는 명령만 온다(판단·관찰 글을 보내지 않는다)
    expect(phone.some((m) => m.type === "brain_line")).toBe(false);
    // 대시보드 말풍선 말(클로이드가 직접 하는 말): 정한 것 → 실제 폰에 낸 명령 넷 → 끝낸 일. 글이 바뀔 때만 보낸다
    const says = dash.filter((m) => m.type === "say").map((m) => m.text as string | null);
    expect(says.every((t, i) => i === 0 || t !== says[i - 1])).toBe(true);
    const told = says.indexOf("식탁으로 갈게요.");
    expect(says[told - 1]).toMatch(/컵을 치울게요\.$/);
    expect(says.slice(told, told + 5)).toEqual(["식탁으로 갈게요.", "컵을 들게요.", "싱크대로 갈게요.", "컵을 싱크대에 넣을게요.", "컵을 다 치웠어요."]);
    // 새로 붙은 대시보드: world 다음에 마지막 판단과 그 판단의 생각 두 줄, 마지막 물체 모양(seen), 그다음 지금 말풍선 글
    const late: Msg[] = [];
    sockets.push(await openWebSocket(`${srv.url.replace(/^http/, "ws")}/events`, { setup: inbox(late) }));
    for (const end = Date.now() + 3000; !late.some((m) => m.type === "say") && Date.now() < end; ) await new Promise((r) => setTimeout(r, 20));
    const from = late.findIndex((m) => m.type === "world");
    expect(late.slice(from, late.findIndex((m) => m.type === "say") + 1).map((m) => (m.type === "brain" ? `brain:${m.event.type}` : m.type))).toEqual(["world", "brain:decision", "thought", "seen", "say"]);
    expect(late.find((m) => m.type === "thought")).toEqual({ type: "thought", replay: true, messages: shown().slice(-5) });
    expect(late.find((m) => m.type === "seen")).toMatchObject({
      replay: true, shapes: [{ label: "cup", score: 0.9, mask: { at: [220, 160, 40, 20] } }], frame: { width: 480, height: 360 },
    });
    expect(typeof late.find((m) => m.type === "say")!.text).toBe("string");
  }, 60_000);

  it("컵이 둘이면 놓기를 끝낸 컵(VLM이 「식탁 위」로 봐도)은 다음 계획 입력에 「이미 치움」으로 가고, 다음 계획은 다른 컵으로 실행 전 검사를 지나 첫 명령을 보낸다", async () => {
    // VLM은 두 컵 모두 늘 「식탁 위」로 본다(놓기는 「완료」로 끝낸다)
    fake = await startFakeOpenAI({
      reply: (body) => {
        if (body?.response_format?.json_schema?.name !== "scene_observation") return null;
        const parts = (body.messages as { role: string; content: unknown }[]).filter((m) => m.role === "user").flatMap((m) => (Array.isArray(m.content) ? m.content : [{ text: m.content }]));
        const text = parts.map((p: { text?: unknown }) => (typeof p.text === "string" ? p.text : "")).join("\n");
        const dets = JSON.parse(/Detections: (\[.*\])/.exec(text)?.[1] ?? "[]") as { id: string }[];
        return JSON.stringify({ scene: "kitchen", observations: dets.map((d) => ({ object_id: d.id, state: "on_table" })), summary: "컵 둘" });
      },
      respond: plannerRespond(CUP_SCRIPTS),
    });
    pam = await startFakePamLlm({ predict: (b) => (/컵 cup_\d/.test(String(b.observation_text))
      ? { observation: "빈 컵이 식탁에 남음", reasoning: "자리를 비워 컵을 치운다", task_index: 0 } : { observation: "컵 없음", reasoning: "할 일 없음", task_index: -1 }) });
    const runtimeDir = mkdtempSync(join(tmpdir(), "rt-"));
    mkdirSync(join(runtimeDir, "homes", "apartment"), { recursive: true });
    writeFileSync(join(runtimeDir, "homes", "apartment", "approvals.json"), JSON.stringify({ always: { "task:컵 치우기": "2026-11-09T00:00:00.000Z" }, never: {} }));
    srv = await startServer({
      env: { HUB: "memory", PORT: "0", RUNTIME_DIR: runtimeDir, PHONE_PORT: "0", PHONE_HOST: "127.0.0.1",
        BRAIN: "1", VLM_BASE_URL: `${fake.url}/v1`, ...pamLlmEnv(pam), OPENAI_API_KEY: "fake-key", OPENAI_BASE_URL: `${fake.url}/v1` },
      brain: { detector: new ScriptedDetector(() => [det("cup", 0.9, [220, 160, 40, 20], 41), det("cup", 0.9, [300, 160, 40, 20], 41)]) }, log: () => {},
    });
    const dash: Msg[] = [];
    sockets.push(await openWebSocket(`${srv.url.replace(/^http/, "ws")}/events`, { setup: inbox(dash) }));
    const phoneUrl = new URL(srv.phoneUrls[0]!);
    const phone: Msg[] = [];
    const ws = await openPhone(`ws://${phoneUrl.host}/phone/events`, { options: { origin: phoneUrl.origin }, setup: inbox(phone) });
    sockets.push(ws);
    let n = 0;
    const pump = async (until: () => boolean | Promise<boolean>, ms = 15_000) => {
      for (const end = Date.now() + ms; Date.now() < end; ) {
        if (await until()) return;
        ws.send(encodeFramePacket({ kind: "engine", width: 480, height: 360, captured_at: Date.now(), time_err_ms: 0 }, Buffer.from([0xff, 0xd8, n++ % 256, n >> 8])));
        await new Promise((r) => setTimeout(r, 150));
      }
      throw new Error(`조건이 ${ms / 1000}초 안에 맞지 않음`);
    };
    const history = async (kinds: string) => ((await (await fetchRetry(`${srv!.url}/api/history?kinds=${kinds}`)).json()) as { ok: boolean; rows: HistoryRow[] });
    const stepCommand = (step: string) => phone.find((m) => m.type === "command" && m.step === step);
    const actTarget = (planId: string) => dash.find((m) => m.type === "plan" && m.plan?.id === planId)?.plan.steps.find((s: Msg) => s.kind === "act")?.target;

    // 첫 계획(cup_1)의 네 단계를 「완료」로 넘긴다
    await pump(() => phone.some((m) => m.type === "command" && m.speak && /^plan:pam-\d+:1$/.test(m.step)));
    const planId = phone.find((m) => m.type === "command" && m.speak)!.id as string;
    expect(actTarget(planId)).toMatchObject({ objectId: "cup_1" });
    for (let k = 1; k <= 4; k++) {
      await pump(() => !!stepCommand(`${planId}:${k}`));
      ws.send(JSON.stringify({ type: "answer", id: planId, step: `${planId}:${k}`, choice: "done" }));
    }
    await pump(async () => (await history("execution")).rows.some((r) => r.subject === planId && r.text === "완료"));
    // 다음 계획(같은 행동 다시 계획 간격 15초 뒤): 이미 치운 cup_1이 아니라 cup_2로 첫 명령까지 간다
    await pump(() => phone.some((m) => m.type === "command" && m.speak && m.id !== planId), 40_000);
    const next = phone.find((m) => m.type === "command" && m.speak && m.id !== planId)!;
    expect(next).toMatchObject({ step: `${next.id}:1`, text: "식탁으로 가 주세요" });
    expect(actTarget(next.id)).toMatchObject({ objectId: "cup_2" });
    const inputs = fake.requests.filter((r) => r.method === "POST" && r.path.endsWith("/responses")).map((r) => String(r.body?.input?.[0]?.content ?? ""));
    expect(inputs.at(-1)).toContain("- 물건 cup_1 컵 · present · 이미 치움 · ");
    expect(inputs.at(-1)).not.toContain("- 물건 cup_2 컵 · present · 이미 치움");
    expect((await history("execution")).rows.some((r) => r.text === CHECK_TEXT.in_sink)).toBe(false);
  }, 90_000);
});
