// 실제 폰 말: 명령·질문이 떠 있으면 폰의 말(say)을 먼저 답으로 맞춰 보고(「완료」「다 했어」, 질문 답, 「그만」), 맞으면 에이전트로 보내지 않는다.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type WebSocket from "ws";
import { startFakeOpenAI, type FakeServer } from "../scripts/fake-openai.js";
import { matchChoice } from "../src/act/tasks.js";
import { ASK_PROMPT, STEP_DONE, STOP } from "../src/act/prompts.js";
import { encodeFramePacket } from "../src/phone/packet.js";
import { createPhoneServer, type PhoneServer } from "../src/phone/server.js";
import { startServer, type RunningServer } from "../src/server/start.js";
import { ScriptedDetector } from "./helpers/detectors.js";
import { startFakePam, type FakePam } from "./helpers/pam.js";
import { openWebSocket } from "./helpers/ws.js";

type Msg = Record<string, any>;
const TARGETS = [{ id: "dock", label: "도크", plan: [3.9, 5.51] as [number, number] }, { id: "door_main", label: "현관문", plan: [2.4, 3.55] as [number, number] }];
let phone: PhoneServer | undefined;
let ws: WebSocket | undefined;
afterEach(async () => {
  ws?.close();
  ws = undefined;
  await phone?.close();
  phone = undefined;
});

async function until(list: Msg[], n: number, ms = 3000): Promise<void> {
  for (const end = Date.now() + ms; list.length < n; ) {
    if (Date.now() > end) throw new Error("답이 오지 않았습니다");
    await new Promise((r) => setTimeout(r, 20));
  }
}

describe("폰 음성 질문", () => {
  it("명령이 떠 있으면 말을 답으로 받고 에이전트로 보내지 않는다. 맞지 않는 말은 에이전트로 간다", async () => {
    const said: string[] = [];
    const answered: string[] = [];
    phone = createPhoneServer({
      targets: TARGETS, onEye: () => {}, log: () => {},
      onSay: async (t) => { said.push(t); return { reply: "에이전트", pending: [] }; },
      onAnswer: (t) => { answered.push(t); return t.includes("완료") ? { handled: true, reply: "" } : { handled: false }; },
    });
    const { port } = await phone.listen(0, "127.0.0.1");
    const replies: Msg[] = [];
    ws = await openWebSocket(`ws://127.0.0.1:${port}/phone/events`, { setup: (s) => s.on("message", (d) => {
      const m = JSON.parse(String(d)) as Msg;
      if (m.type === "reply") replies.push(m);
    }) });
    ws.send(JSON.stringify({ type: "say", text: "  완료 " }));
    await until(replies, 1);
    ws.send(JSON.stringify({ type: "say", text: "불 꺼 줘" }));
    await until(replies, 2);
    expect(replies.map((m) => m.text)).toEqual(["", "에이전트"]);
    expect(replies[0]).toMatchObject({ pending: [] });
    expect(answered).toEqual(["완료", "불 꺼 줘"]);
    expect(said).toEqual(["불 꺼 줘"]);
  });
});

describe("말과 선택지 맞추기", () => {
  const step = [STEP_DONE];
  const ask = ASK_PROMPT.choices;
  it("버튼 글이나 그 선택지의 말이 들어 있으면 그 선택지", () => {
    expect(matchChoice("완료", step)?.id).toBe("done");
    expect(matchChoice("응 다 했어", step)?.id).toBe("done");
    expect(matchChoice("이제 그만", [STOP])?.id).toBe("stop");
    expect(matchChoice("이따가 나중에 할게", step)).toBeNull();
    expect(matchChoice("치워 줘", ask)?.id).toBe("clear");
    expect(matchChoice("그냥 그대로 둬", ask)?.id).toBe("keep");
  });
  it("「완료」「다 했어」「그만」은 짧은 말 전체일 때만 맞춘다(늘 듣기의 주변 말에 걸리지 않게)", () => {
    for (const said of ["다 했어요", "응, 완료", "그만해요", "그만둬", "이제 그만!"]) expect(matchChoice(said, [STEP_DONE, STOP]), said).not.toBeNull();
    for (const said of ["그만큼 좋아", "그만이야", "숙제 다 했어?", "완료 버튼 어디 있어", "다 했어 그럼 밥 먹자"]) expect(matchChoice(said, [STEP_DONE, STOP]), said).toBeNull();
  });
  it("맞는 선택지가 없거나 빈 말이면 null", () => {
    expect(matchChoice("불 꺼 줘", step)).toBeNull();
    expect(matchChoice("  ", ask)).toBeNull();
  });
});

describe("startServer(BRAIN=1): 클로이드 질문을 폰 말로 답한다", () => {
  let srv: RunningServer | undefined;
  let fake: FakeServer | undefined;
  let pam: FakePam | undefined;
  afterEach(async () => {
    await srv?.close();
    srv = undefined;
    await fake?.close();
    fake = undefined;
    await pam?.close();
    pam = undefined;
  });

  it("질문이 소리로 오고, 말한 답은 에이전트로 가지 않고 실행을 끝내며 반성 피드백으로 남는다", async () => {
    fake = await startFakeOpenAI();
    pam = await startFakePam({ predict: () => ({ observation: "컵이 식탁에 있음", reasoning: "치울지 묻는다", task_index: 1 }) });
    srv = await startServer({
      env: { HUB: "memory", PORT: "0", RUNTIME_DIR: mkdtempSync(join(tmpdir(), "rt-")), PHONE_PORT: "0", PHONE_HOST: "127.0.0.1",
        BRAIN: "1", VLM_BASE_URL: `${fake.url}/v1`, PAM_URL: pam.url, PAM_MIN_GAP_MS: "0" },
      brain: { detector: new ScriptedDetector(() => [{ label: "cup", score: 0.9, cls: 41, box: [1, 1, 2, 1] }]) }, log: () => {},
    });
    const phoneUrl = new URL(srv.phoneUrls[0]!);
    const box: Msg[] = [];
    ws = await openWebSocket(`ws://${phoneUrl.host}/phone/events`, { options: { origin: phoneUrl.origin }, setup: (s) => s.on("message", (d, bin) => { if (!bin) box.push(JSON.parse(String(d)) as Msg); }) });
    let n = 0;
    const asked = async () => {
      for (const end = Date.now() + 10_000; Date.now() < end; ) {
        const m = box.find((x) => x.type === "command");
        if (m) return m;
        ws!.send(encodeFramePacket({ kind: "engine", width: 4, height: 3, captured_at: Date.now(), time_err_ms: 0 }, Buffer.from([0xff, 0xd8, n++ % 256, n >> 8])));
        await new Promise((r) => setTimeout(r, 100));
      }
      throw new Error("질문이 오지 않았습니다");
    };
    const ask = await asked();
    expect(ask).toEqual({ type: "command", id: expect.stringMatching(/^plan:pam-\d+$/), step: `${ask.id}:1`, text: "컵을 치울까요?", vision: null, speak: true,
      choices: [{ id: "clear", label: "치워 주세요" }, { id: "keep", label: "그대로 둬요" }] });
    ws.send(JSON.stringify({ type: "say", text: "그냥 그대로 둬" }));
    for (const end = Date.now() + 5000; !box.some((m) => m.type === "reply"); ) {
      if (Date.now() > end) throw new Error("답이 오지 않았습니다");
      await new Promise((r) => setTimeout(r, 20));
    }
    expect(box.find((m) => m.type === "reply")).toMatchObject({ text: "알겠어요. 그대로 둘게요" });
    const rows = srv.history.list({ kinds: ["feedback", "execution"] });
    expect(rows.filter((r) => r.kind === "feedback").map((r) => r.text)).toEqual(["그냥 그대로 둬 · 질문: 컵을 치울까요?"]);
    expect(rows.some((r) => r.kind === "execution" && r.subject === ask.id && r.text === "완료: 그대로 둬요")).toBe(true);
    expect(box.some((m) => m.type === "command_clear" && m.id === ask.id)).toBe(true);
  }, 30_000);
});
