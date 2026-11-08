// 처음부터 끝까지(가짜 서버): 폰 엔진 프레임 → YOLOX(대본)·VLM(가짜 OpenAI 호환 서버, 컵 자리 대본) → World State → PAM(시험용 PAM 자리: 컵 치우기)
// → 계획 → 실행 전 검사 → 실제 폰 단계 명령(소리) → 「완료」 단추·World State 컵 자리·말 「다 했어」로 한 단계씩 → 완료, 그리고 한 시간축 기록·대시보드 메시지.
// 기본 집(마곡 아파트, 식탁·싱크대 있음). 맞추기 전이라 폰 눈 위치를 몰라 이동 단계는 「완료」나 말로 넘긴다.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type WebSocket from "ws";
import { startFakeOpenAI, type FakeServer } from "../scripts/fake-openai.js";
import type { HistoryRow } from "../src/contract/history.js";
import { encodeFramePacket } from "../src/phone/packet.js";
import { CHECK_TEXT } from "../src/plan/labels.js";
import { fetchRetry } from "../src/server/net.js";
import { startServer, type RunningServer } from "../src/server/start.js";
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
    });
    // PAM은 끝난 뒤에도 컵 치우기를 고른다: 싱크대 안 컵으로는 새 명령을 보내지 않아야 한다
    pam = await startFakePam({ predict: () => ({ observation: "빈 컵이 식탁에 남음", reasoning: "자리를 비워 컵을 치운다", task_index: 0 }) });
    srv = await startServer({
      env: { HUB: "memory", PORT: "0", RUNTIME_DIR: mkdtempSync(join(tmpdir(), "rt-")), PHONE_PORT: "0", PHONE_HOST: "127.0.0.1",
        BRAIN: "1", VLM_BASE_URL: `${fake.url}/v1`, PAM_URL: pam.url, PAM_MIN_GAP_MS: "0" },
      brain: { detector: new ScriptedDetector(() => [{ label: "cup", score: 0.9, cls: 41, box: [220, 160, 40, 20] }]) }, log: () => {},
    });
    const dash: Msg[] = [];
    sockets.push(await openWebSocket(`${srv.url.replace(/^http/, "ws")}/events`, { setup: inbox(dash) }));
    const phoneUrl = new URL(srv.phoneUrls[0]!);
    const phone: Msg[] = [];
    const ws = await openWebSocket(`ws://${phoneUrl.host}/phone/events`, { options: { origin: phoneUrl.origin }, setup: inbox(phone) });
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
    expect(first).toEqual({ type: "command", id: expect.stringMatching(/^plan:pam-\d+$/), step: `${first.id}:1`, text: "식탁으로 가 주세요", vision: "식탁까지 거리 모름", choices: [{ id: "done", label: "완료" }], speak: true });
    const planId = first.id as string;
    // 1 이동: 「완료」 단추
    ws.send(JSON.stringify({ type: "answer", id: planId, step: first.step, choice: "done" }));
    await pump(() => !!said("컵을 들어 주세요"));
    expect(said("컵을 들어 주세요")).toMatchObject({ id: planId, step: `${planId}:2`, vision: "컵 · 식탁 위" });
    // 2 집기: VLM이 컵을 손에 있음으로 본다
    cupPlace = "in_hand";
    await pump(() => !!said("싱크대로 가 주세요"));
    expect(said("싱크대로 가 주세요")).toMatchObject({ id: planId, step: `${planId}:3`, vision: "컵 · 손에 있음 · 싱크대까지 거리 모름" });
    // 3 이동: 말로 「다 했어」(답 글은 비어 있고 다음 명령이 따로 온다)
    ws.send(JSON.stringify({ type: "say", text: "다 했어" }));
    await pump(() => !!said("컵을 싱크대에 넣어 주세요"));
    await pump(() => phone.some((m) => m.type === "reply"));
    expect(phone.find((m) => m.type === "reply")).toEqual({ type: "reply", text: "" });
    // 4 내려놓기: VLM이 컵을 싱크대 안으로 본다 → 명령을 지우고 완료
    cupPlace = "in_sink";
    await pump(() => phone.some((m) => m.type === "command_clear" && m.id === planId));
    await pump(async () => (await history("execution")).rows.some((r) => r.subject === planId && r.text === "완료"));
    // 다음 판단(컵 치우기)은 싱크대 안 컵을 대상으로 삼지 않고 실행 전 검사에서 멈춘다
    await pump(async () => (await history("execution")).rows.some((r) => r.subject !== planId && r.text === CHECK_TEXT.in_sink));

    expect(phone.filter((m) => m.type === "command" && m.speak).map((m) => m.text)).toEqual(["식탁으로 가 주세요", "컵을 들어 주세요", "싱크대로 가 주세요", "컵을 싱크대에 넣어 주세요"]);
    const all = await history("vlm,detection,pam_text,decision,plan,execution,feedback");
    expect(all.ok).toBe(true);
    expect([...new Set(all.rows.map((r) => r.kind))].sort()).toEqual(["decision", "detection", "execution", "feedback", "pam_text", "plan", "vlm"]);
    const steps = all.rows.filter((r) => r.kind === "execution" && r.subject === planId).sort((a, b) => a.id - b.id).map((r) => r.text);
    expect(steps).toEqual(["판단", "계획", "실행 중", "완료"]);
    expect(all.rows.filter((r) => r.kind === "feedback").sort((a, b) => a.id - b.id).map((r) => r.text)).toEqual(["완료 · 부탁: 식탁으로 가 주세요", "다 했어 · 부탁: 싱크대로 가 주세요"]);
    const decided = all.rows.find((r) => r.kind === "decision" && `plan:${r.subject}` === planId)!;
    expect(decided.text).toBe("컵 치우기");
    expect((pam.bodies[0] as { observation_text: string }).observation_text).toContain("컵 cup_1 보임");
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
  }, 60_000);
});
