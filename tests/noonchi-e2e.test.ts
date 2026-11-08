// 처음부터 끝까지(가짜 서버): 폰 엔진 프레임 → YOLOX(대본)·VLM(가짜 OpenAI 호환 서버) → World State → PAM(시험용 PAM 자리: 컵 치우기)
// → 계획 → 실행 전 검사 → 폰 부탁(소리) → 말로 답 → 결과 확인(컵 사라짐) → 완료, 그리고 한 시간축 기록·대시보드 메시지.
// 기본 집(마곡 아파트, 식탁·싱크대 있음). 맞추기 전이라 물건 위치는 모르고, 눈 자세 없는 프레임은 시야 안으로 보고 사라짐을 센다.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type WebSocket from "ws";
import { startFakeOpenAI, type FakeServer } from "../scripts/fake-openai.js";
import type { HistoryRow } from "../src/contract/history.js";
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
  it("관찰부터 실행 결과까지 한 흐름으로 돌고 기록·대시보드에 남는다", async () => {
    fake = await startFakeOpenAI();
    pam = await startFakePam({ predict: () => ({ observation: "빈 컵이 식탁에 남음", reasoning: "자리를 비워 컵을 치운다", task_index: 0 }) });
    let cupVisible = true;
    srv = await startServer({
      env: { HUB: "memory", PORT: "0", RUNTIME_DIR: mkdtempSync(join(tmpdir(), "rt-")), PHONE_PORT: "0", PHONE_HOST: "127.0.0.1",
        BRAIN: "1", VLM_BASE_URL: `${fake.url}/v1`, PAM_URL: pam.url, PAM_MIN_GAP_MS: "0" },
      brain: { detector: new ScriptedDetector(() => (cupVisible ? [{ label: "cup", score: 0.9, cls: 41, box: [220, 160, 40, 20] }] : [])) }, log: () => {},
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

    await pump(() => phone.some((m) => m.type === "action" && m.active));
    const ask = phone.find((m) => m.type === "action" && m.active)!;
    expect(ask).toMatchObject({ task: "컵 치우기", text: "식탁 위 컵을 치워 주세요", speak: true, dry_run: true });
    expect(ask.id).toMatch(/^plan:pam-\d+$/);
    ws.send(JSON.stringify({ type: "say", text: "치웠어요" }));
    await pump(() => phone.some((m) => m.type === "reply"));
    expect(phone.find((m) => m.type === "reply")).toMatchObject({ text: "고마워요. 컵이 안 보이는지 확인할게요" });
    cupVisible = false;
    await pump(async () => (await history("execution")).rows.some((r) => r.subject === ask.id && r.text === "완료"));

    const all = await history("vlm,detection,pam_text,decision,plan,execution,feedback");
    expect(all.ok).toBe(true);
    expect([...new Set(all.rows.map((r) => r.kind))].sort()).toEqual(["decision", "detection", "execution", "feedback", "pam_text", "plan", "vlm"]);
    const steps = all.rows.filter((r) => r.kind === "execution" && r.subject === ask.id).sort((a, b) => a.id - b.id).map((r) => r.text);
    expect(steps).toEqual(["판단", "계획", "실행 중", "결과 확인", "완료"]);
    expect(all.rows.filter((r) => r.kind === "feedback").map((r) => r.text)).toEqual(["치웠어요 · 부탁: 식탁 위 컵을 치워 주세요"]);
    const decided = all.rows.find((r) => r.kind === "decision" && `plan:${r.subject}` === ask.id)!;
    expect(decided.text).toBe("컵 치우기");
    expect((pam.bodies[0] as { observation_text: string }).observation_text).toContain("컵 cup_1 보임");
    // 대시보드: 판단·실행 기록과 계획(집기 대상 cup_1, 끝나면 done)
    const planMsgs = dash.filter((m) => m.type === "plan" && m.plan?.id === ask.id).map((m) => m.plan);
    expect(planMsgs[0]).toMatchObject({ source: "brain", dryRun: true, judgment: "자리를 비워 컵을 치운다" });
    expect(planMsgs[0].steps.find((s: Msg) => s.kind === "act").target).toMatchObject({ objectId: "cup_1" });
    expect(planMsgs.at(-1)).toMatchObject({ status: "done" });
    expect(dash.some((m) => m.type === "brain" && m.event.type === "execution" && m.event.plan_id === ask.id && m.event.state === "done")).toBe(true);
    expect(phone.some((m) => m.type === "action" && m.id === ask.id && m.active === false)).toBe(true);
    // 폰 마스코트 말풍선: 계획이 열린 동안 그 판단 글, 끝나면 마지막 판단의 관찰(대시보드가 받은 계획·판단과 같은 글)
    const lines = () => phone.filter((m) => m.type === "brain_line").map((m) => m.text as string);
    for (const end = Date.now() + 3000; lines().at(-1) !== "빈 컵이 식탁에 남음" && Date.now() < end; ) await new Promise((r) => setTimeout(r, 50));
    const said = lines();
    const judged = said.indexOf("자리를 비워 컵을 치운다");
    expect(judged, said.join(" / ")).toBeGreaterThanOrEqual(0);
    expect(said.slice(judged + 1), said.join(" / ")).toContain("빈 컵이 식탁에 남음");
    expect(said.at(-1)).toBe("빈 컵이 식탁에 남음");
  }, 40_000);
});
