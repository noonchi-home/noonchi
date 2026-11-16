// 영상 연결(폰 소켓 /phone/events?video=<영상>)과 실제 연결은 서버에서 같은 길이다: 같은 대본(엔진 프레임·VLM 컵 자리·「완료」 단추·말 「다 했어」)을 넣으면
// 실제 폰 명령(글·종류·단계 차례)·명령 지움, 단계 끝(실행 기록)·피드백, 대시보드 계획 단계 상태, World State 컵 자리가 하나도 다르지 않다.
// 다를 수 있는 것은 held(붙잡은 장면)와 시작 자세 fixed뿐이고(tests/video-mode-parity.test.ts 허용 갈래) 이 대본은 둘 다 쓰지 않는다.
// 흐름은 tests/noonchi-e2e.test.ts 첫 시험과 같다(가짜 OpenAI 호환 서버·시험용 PAM 자리·대본 YOLO, 기본 집).
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type WebSocket from "ws";
import { startFakeOpenAI, type FakeServer } from "../scripts/fake-openai.js";
import type { HistoryRow } from "../src/contract/history.js";
import type { WorldView } from "../src/contract/world.js";
import { encodeFramePacket } from "../src/phone/packet.js";
import { videoSession } from "../src/phone/server.js";
import { fetchRetry } from "../src/shared/net.js";
import { startServer, type RunningServer } from "../src/server/start.js";
import { ScriptedDetector, det } from "./helpers/detectors.js";
import { startFakePam, type FakePam } from "./helpers/pam.js";
import { CUP_SCRIPTS, plannerRespond } from "./helpers/planner.js";
import { heardAtOf, openPhone, openWebSocket } from "./helpers/ws.js";

type Msg = Record<string, any>;
let srv: RunningServer | undefined;
let fake: FakeServer | undefined;
let pam: FakePam | undefined;
const sockets: WebSocket[] = [];
async function stop() {
  for (const s of sockets.splice(0)) s.close();
  await srv?.close();
  srv = undefined;
  await fake?.close();
  fake = undefined;
  await pam?.close();
  pam = undefined;
}
afterEach(stop);

const inbox = (list: Msg[]) => (ws: WebSocket) => ws.on("message", (d, bin) => { if (!bin) list.push(JSON.parse(String(d)) as Msg); });

/** 컵 치우기 대본을 query(""이면 실제 연결, ?video=이면 영상 연결)로 처음부터 끝까지 돌리고, 계획 id를 PLAN으로 바꾼 결과를 모은다. */
async function cupRun(query: string, videoDir: string) {
  let cupPlace = "on_table";
  fake = await startFakeOpenAI({
    reply: (body) => {
      if (body?.response_format?.json_schema?.name !== "scene_observation") return null;
      const parts = (body.messages as { role: string; content: unknown }[]).filter((m) => m.role === "user").flatMap((m) => (Array.isArray(m.content) ? m.content : [{ text: m.content }]));
      const text = parts.map((p: { text?: unknown }) => (typeof p.text === "string" ? p.text : "")).join("\n");
      const dets = JSON.parse(/Detections: (\[.*\])/.exec(text)?.[1] ?? "[]") as { id: string }[];
      return JSON.stringify({ scene: "kitchen", observations: dets.map((d) => ({ object_id: d.id, state: cupPlace })), summary: "컵" });
    },
    respond: plannerRespond(CUP_SCRIPTS),
  });
  pam = await startFakePam({ predict: (b) => (/컵 cup_\d/.test(String(b.observation_text))
    ? { observation: "빈 컵이 식탁에 남음", reasoning: "자리를 비워 컵을 치운다", task_index: 0 } : { observation: "컵 없음", reasoning: "할 일 없음", task_index: -1 }) });
  const runtimeDir = mkdtempSync(join(tmpdir(), "rt-"));
  mkdirSync(join(runtimeDir, "homes", "apartment"), { recursive: true });
  writeFileSync(join(runtimeDir, "homes", "apartment", "approvals.json"), JSON.stringify({ always: { "task:컵 치우기": "2026-11-09T00:00:00.000Z" }, never: {} }));
  srv = await startServer({
    env: { HUB: "memory", PORT: "0", RUNTIME_DIR: runtimeDir, PHONE_PORT: "0", PHONE_HOST: "127.0.0.1", PHONE_VIDEO_DIR: videoDir,
      BRAIN: "1", VLM_BASE_URL: `${fake.url}/v1`, PAM_URL: pam.url, OPENAI_API_KEY: "fake-key", OPENAI_BASE_URL: `${fake.url}/v1` },
    brain: { detector: new ScriptedDetector(() => [det("cup", 0.9, [220, 160, 40, 20], 41)]) }, log: () => {},
  });
  const dash: Msg[] = [];
  sockets.push(await openWebSocket(`${srv.url.replace(/^http/, "ws")}/events`, { setup: inbox(dash) }));
  const phoneUrl = new URL(srv.phoneUrls[0]!);
  const phone: Msg[] = [];
  const ws = await openPhone(`ws://${phoneUrl.host}/phone/events${query}`, { options: { origin: phoneUrl.origin }, setup: inbox(phone) });
  sockets.push(ws);
  let n = 0;
  const pump = async (until: () => boolean | Promise<boolean>) => {
    for (const end = Date.now() + 15_000; Date.now() < end; ) {
      if (await until()) return;
      ws.send(encodeFramePacket({ kind: "engine", width: 480, height: 360, captured_at: Date.now(), time_err_ms: 0 }, Buffer.from([0xff, 0xd8, n++ % 256, n >> 8])));
      await new Promise((r) => setTimeout(r, 150));
    }
    throw new Error("조건이 15초 안에 맞지 않음");
  };
  const history = async (kinds: string) => ((await (await fetchRetry(`${srv!.url}/api/history?kinds=${kinds}`)).json()) as { rows: HistoryRow[] }).rows;
  const said = (text: string) => phone.find((m) => m.type === "command" && m.speak && m.text === text);

  await pump(() => !!said("식탁으로 가 주세요"));
  const planId = said("식탁으로 가 주세요")!.id as string;
  ws.send(JSON.stringify({ type: "answer", id: planId, step: said("식탁으로 가 주세요")!.step, choice: "done" }));
  await pump(() => !!said("컵을 들어 주세요"));
  cupPlace = "in_hand";
  await pump(() => !!said("싱크대로 가 주세요"));
  ws.send(JSON.stringify({ type: "say", text: "다 했어", at: heardAtOf(phone) }));
  await pump(() => !!said("컵을 싱크대에 넣어 주세요"));
  cupPlace = "in_sink";
  await pump(() => phone.some((m) => m.type === "command_clear" && m.id === planId));
  await pump(async () => (await history("execution")).some((r) => r.subject === planId && r.text === "완료"));
  const cup = ((await (await fetchRetry(`${srv.url}/api/world`)).json()) as { world: WorldView }).world.objects.find((o) => o.cls === "cup");

  const norm = (v: unknown) => JSON.parse(JSON.stringify(v).split(planId).join("PLAN"));
  const rows = await history("execution,feedback");
  const result = norm({
    commands: phone.filter((m) => (m.type === "command" && m.speak) || (m.type === "command_clear" && m.id === planId)),
    steps: rows.filter((r) => r.kind === "execution" && r.subject === planId).sort((a, b) => a.id - b.id).map((r) => r.text),
    feedback: rows.filter((r) => r.kind === "feedback").sort((a, b) => a.id - b.id).map((r) => r.text),
    progress: dash.filter((m) => m.type === "plan" && m.plan?.id === planId).map((m) => `${m.plan.status}:${m.plan.steps.map((s: Msg) => s.status).join(",")}`)
      .filter((p, i, all) => i === 0 || p !== all[i - 1]),
    cup: { id: cup?.id, place: cup?.facts.place?.value, status: cup?.status },
  });
  await stop();
  return result;
}

describe("영상 연결과 실제 연결은 서버에서 같다", () => {
  it("컵 치우기 대본: 실제 폰 명령·명령 지움·단계 끝·피드백·대시보드 계획 단계·World State 컵 자리가 하나도 다르지 않다", async () => {
    const videoDir = mkdtempSync(join(tmpdir(), "videos-"));
    writeFileSync(join(videoDir, "cup-demo.mp4"), "mp4");
    // ?video=가 이 서버가 내주는 영상이라 영상 연결로 붙는다(없는 영상 이름이면 실제 연결로 붙어 견줌이 뜻없다)
    expect(videoSession("/phone/events?video=cup-demo.mp4", videoDir)).toBe(true);
    const real = await cupRun("", videoDir);
    const video = await cupRun("?video=cup-demo.mp4", videoDir);
    expect(video).toEqual(real);
    // 대본이 실제로 네 명령·완료·컵 싱크대 안까지 갔는지(빈 결과끼리 같아 통과하지 않게)
    expect(real.commands.filter((m: Msg) => m.type === "command").map((m: Msg) => m.text)).toEqual(["식탁으로 가 주세요", "컵을 들어 주세요", "싱크대로 가 주세요", "컵을 싱크대에 넣어 주세요"]);
    expect(real.steps).toEqual(["판단", "계획", "실행 중", "완료"]);
    expect(real.cup.place).toBe("in_sink");
  }, 90_000);
});
