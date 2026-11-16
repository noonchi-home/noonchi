// npm run heavy -- npx tsx scripts/twin3d/e2e-dashboard.ts --out <폴더> [--port 8202] [--size 1920x1080] [--gpu] [--timeout 60]
// 한양목련 컵 치우기를 실제 대시보드로 처음부터 끝까지 돌린다(시험 모드, 실제 모델·ThinQ 없음). 같은 프로세스에서 가짜 서버(가짜 OpenAI 호환 VLM,
// 시험용 PAM, 대본 YOLO)와 본 서버(HUB=memory, 화면 ui/dist, 폰 서버 켬, 새 RUNTIME_DIR)를 띄우고, 크롬 하나로 대시보드를 연 채
// 폰 메시지(기준점·눈·엔진 프레임·표시 프레임·답)로 흐름을 몬다. 엔진·표시 프레임은 docs/superpowers/specs/2026-11-06-twin3d-baseline/room_kitchen.jpg다.
// 순간마다(0 지켜보기, 1~4 단계, 끝) main[data-step]과 그 순간 말풍선 글을 기다려 <out>/step-<n>.png를 찍고 본다:
// 진행도 「n/4 · 단계 이름」(끝·지켜보기는 없음), 마스코트 보는 쪽(계획 중 twin, 아니면 video), YOLO 상자 하나 이상, 문서 글에 「승인」·승인 질문 없음, 페이지 오류 없음.
// 하나라도 틀리면 끝 코드 1. 결과는 <out>/result.json, 서버 기록은 <out>/server.log.
// 판단 시각은 이 스크립트가 정한다: PAM은 1초마다 부르고(PAM_TRIGGER=periodic), 가짜 PAM은 지켜보기 사진을 찍은 뒤부터 끝 단계 전까지만 컵 치우기를 고른다.
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type WebSocket from "ws";
import { alignOnServer } from "../../tests/helpers/align.js";
import { ScriptedDetector, det } from "../../tests/helpers/detectors.js";
import { startFakePam, type FakePam } from "../../tests/helpers/pam.js";
import { openWebSocket } from "../../tests/helpers/ws.js";
import { encodeFramePacket } from "../../src/phone/packet.js";
import { APPROVAL_TEXT, SAY_TEXT, STEP_LABEL } from "../../src/act/labels.js";
import { fetchRetry } from "../../src/shared/net.js";
import { startServer, type RunningServer } from "../../src/server/start.js";
import { startFakeOpenAI, type FakeServer } from "../fake-openai.js";
import { chromePath, closeChrome, devtoolsPort, launchChrome, openPage, type Chrome, type Page } from "./cdp.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const arg = (k: string, d?: string) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1]! : d; };
const out = arg("out");
if (!out) { console.error("쓰는 법: npm run heavy -- npx tsx scripts/twin3d/e2e-dashboard.ts --out <폴더> [--port 8202] [--size 1920x1080] [--gpu] [--timeout 60]"); process.exit(2); }
const PORT = Number(arg("port", "8202"));
const [W, H] = arg("size", "1920x1080")!.split("x").map(Number) as [number, number];
const gpu = process.argv.includes("--gpu");
const momentMs = Number(arg("timeout", "60")) * 1000;
const HOME = "mokryeon_180b";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// 엔진·표시 프레임(가로 1280×800). YOLO 상자 아래 가운데가 그림 한가운데
const JPEG = readFileSync(join(ROOT, "docs/superpowers/specs/2026-11-06-twin3d-baseline/room_kitchen.jpg"));
const FRAME = { width: 1280, height: 800 };
const CUP_BOX: [number, number, number, number] = [FRAME.width / 2 - 20, FRAME.height / 2 - 20, 40, 20];
// 눈 자리에 시작 위치를 저장하고 「여기서 시작」 + 그 자리의 벽·바닥 점으로 맞춘다(AR 점 = 평면 점). 눈은 tests/mokryeon-e2e.test.ts와 같다:
// 거실·복도 식탁 가운데에서 1.5 m 떨어진 높이 1.5 m에서 +x를 보고 식탁 윗면 가운데를 향해 숙인다(식탁·싱크대에서 1.2 m 밖이라 이동 단계는 답으로 넘긴다)
const PROJECTION = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, -1.0002, -1, 0, 0, -0.020002, 0];
const mul = (a: number[], b: number[]) => [a[3]! * b[0]! + a[0]! * b[3]! + a[1]! * b[2]! - a[2]! * b[1]!, a[3]! * b[1]! - a[0]! * b[2]! + a[1]! * b[3]! + a[2]! * b[0]!, a[3]! * b[2]! + a[0]! * b[1]! - a[1]! * b[0]! + a[2]! * b[3]!, a[3]! * b[3]! - a[0]! * b[0]! - a[1]! * b[1]! - a[2]! * b[2]!];
const PITCH = Math.atan2(1.5 - 0.75, 1.5);
const ORIENTATION = mul([0, Math.sin(-Math.PI / 4), 0, Math.cos(-Math.PI / 4)], [Math.sin(-PITCH / 2), 0, 0, Math.cos(-PITCH / 2)]) as [number, number, number, number];
const EYE: [number, number, number] = [9.9612 - 1.5, 1.5, 3.9242];

/** 순간: 단계 번호(main[data-step]), 그 순간 말, 진행도(단계 번호·이름), 마스코트 보는 쪽. */
interface Moment { name: string; step: number; say: (t: string) => boolean; sayText: string; progress: string | null; facing: "twin" | "video" }
const STEPS = [STEP_LABEL.goTable, STEP_LABEL.pickCup, STEP_LABEL.goSink, STEP_LABEL.placeCup];
const TOLD = [SAY_TEXT.told.goTable, SAY_TEXT.told.pickCup, SAY_TEXT.told.goSink, SAY_TEXT.told.placeCup];
const watching: Moment = { name: "0", step: 0, say: (t) => t.endsWith("보고 있어요."), sayText: "…보고 있어요.", progress: null, facing: "video" };
const stepMoment = (n: number): Moment => ({ name: String(n), step: n, say: (t) => t === TOLD[n - 1], sayText: TOLD[n - 1]!, progress: `${n}/4 · ${STEPS[n - 1]}`, facing: "twin" });
const doneMoment: Moment = { name: "done", step: 0, say: (t) => t === SAY_TEXT.done("컵 치우기"), sayText: SAY_TEXT.done("컵 치우기"), progress: null, facing: "video" };

/** 지금 화면 값(크롬에서 돌린다). */
const READ = `(() => {
  const main = document.querySelector("main");
  const now = document.querySelector('[data-say-line]:not([aria-hidden="true"])');
  return {
    ready: Boolean(main?.hasAttribute("data-ready")), step: main?.getAttribute("data-step") ?? null, say: now?.textContent ?? null,
    progress: document.querySelector("[data-progress]")?.textContent ?? null, facing: document.querySelector("[data-mascot]")?.getAttribute("data-facing") ?? null,
    detections: document.querySelectorAll("[data-detection]").length, text: document.body.innerText,
  };
})()`;
type Seen = { ready: boolean; step: string | null; say: string | null; progress: string | null; facing: string | null; detections: number; text: string };

const logPath = join(out, "server.log");
mkdirSync(out, { recursive: true });
writeFileSync(logPath, "");
const errors: string[] = [];
const results: { moment: string; file: string; seen: Omit<Seen, "text">; failed: string[] }[] = [];
let fake: FakeServer | undefined;
let pam: FakePam | undefined;
let srv: RunningServer | undefined;
let phone: WebSocket | undefined;
let chrome: Chrome | undefined;
let page: Page | undefined;
let pump: ReturnType<typeof setInterval> | undefined;
const runtimeDir = mkdtempSync(join(tmpdir(), "twin3d-e2e-"));

try {
  let cupPlace = "on_table";
  let decide = false;
  fake = await startFakeOpenAI({
    reply: (body) => {
      if (body?.response_format?.json_schema?.name !== "scene_observation") return null;
      const parts = (body.messages as { role: string; content: unknown }[]).filter((m) => m.role === "user").flatMap((m) => (Array.isArray(m.content) ? m.content : [{ text: m.content }]));
      const text = parts.map((p: { text?: unknown }) => (typeof p.text === "string" ? p.text : "")).join("\n");
      const dets = JSON.parse(/Detections: (\[.*\])/.exec(text)?.[1] ?? "[]") as { id: string }[];
      return JSON.stringify({ scene: "kitchen", observations: dets.map((d) => ({ object_id: d.id, state: cupPlace })), summary: "컵" });
    },
  });
  pam = await startFakePam({
    predict: () => (decide
      ? { observation: "빈 컵이 식탁에 남음", reasoning: "자리를 비워 컵을 치운다", task_index: 0 }
      : { observation: "컵이 식탁에 있음", reasoning: "지켜본다", task_index: -1 }),
  });
  srv = await startServer({
    env: {
      HUB: "memory", PORT: String(PORT), HOST: "127.0.0.1", HOME_ID: HOME, RUNTIME_DIR: runtimeDir, PHONE_PORT: "0", PHONE_HOST: "127.0.0.1",
      BRAIN: "1", VLM_BASE_URL: `${fake.url}/v1`, OPENAI_BASE_URL: `${fake.url}/v1`, OPENAI_API_KEY: "fake-key", PAM_URL: pam.url,
      PAM_TRIGGER: "periodic", PAM_PERIOD_MS: "1000", PAM_MIN_GAP_MS: "0",
    },
    brain: { detector: new ScriptedDetector(() => [det("cup", 0.9, CUP_BOX, 41)]) },
    log: (line) => appendFileSync(logPath, `${line}\n`),
  });
  const done = await fetchRetry(`${srv.url}/api/setup/done`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ home: HOME }) });
  if (!done.ok) throw new Error(`설정 끝내기 실패: HTTP ${done.status}`);

  // 실제 폰 자리: 시작 위치·벽 점으로 맞춤 → 맞춘 눈(자세)·엔진 프레임·표시 프레임
  const fromPhone: Record<string, any>[] = [];
  const phoneUrl = new URL(srv.phoneUrls[0]!);
  phone = await openWebSocket(`ws://${phoneUrl.host}/phone/events`, {
    options: { origin: phoneUrl.origin }, setup: (s) => s.on("message", (d, bin) => { if (!bin) fromPhone.push(JSON.parse(String(d))); }),
  });
  const ws = phone;
  const waitFor = async <T>(what: string, get: () => T | undefined | null | false, ms = momentMs): Promise<T> => {
    for (const end = Date.now() + ms; Date.now() < end; await sleep(100)) { const v = get(); if (v) return v; }
    throw new Error(`${ms / 1000}초 안에 오지 않음: ${what}`);
  };
  await alignOnServer(srv.url, (t) => ws.send(t), join(srv.twin.dir, "homes", HOME, "scene.json"), [EYE[0], EYE[2]]);
  await waitFor("맞춤", () => fromPhone.some((m) => m.type === "status" && m.aligned));
  const pose = JSON.stringify({ type: "pose", position: EYE, orientation: ORIENTATION, tracking: "ok" });
  const header = { width: FRAME.width, height: FRAME.height, position: EYE, orientation: ORIENTATION, tracking: "ok" as const };
  // 같은 바이트의 엔진 프레임은 관찰 흐름이 겹친 프레임으로 버리므로 JPEG 끝(EOI) 뒤에 번호를 붙인다(그림은 그대로)
  let n = 0;
  // 실제 폰처럼 자세도 이어 보낸다(나중에 붙은 대시보드도 클로이드 자리를 안다)
  pump = setInterval(() => {
    ws.send(pose);
    ws.send(encodeFramePacket({ kind: "engine", ...header, projection: PROJECTION, captured_at: Date.now(), time_err_ms: 0 }, Buffer.concat([JPEG, Buffer.from(String(n++))])));
    ws.send(encodeFramePacket({ kind: "frame", ...header }, JPEG));
  }, 250);

  // 크롬 하나로 대시보드
  chrome = launchChrome({ path: chromePath(), size: [W, H], gpu });
  page = await openPage(await devtoolsPort(chrome), (msg) => errors.push(msg));
  const cdp = page;
  await cdp.send("Emulation.setDeviceMetricsOverride", { width: W, height: H, deviceScaleFactor: 1, mobile: false });
  await cdp.send("Page.navigate", { url: `${srv.url}/` });
  const read = async () => (await cdp.evaluate(READ, 10_000)) as Seen;
  for (const end = Date.now() + 180_000; !(await read()).ready; await sleep(250)) if (Date.now() > end) throw new Error("180초 안에 대시보드가 준비되지 않음");

  /** 그 순간 단계 번호와 말을 기다렸다가 화면이 자리 잡으면 찍고 본다. */
  const shoot = async (m: Moment) => {
    let seen: Seen | null = null;
    for (const end = Date.now() + momentMs; ; await sleep(150)) {
      const s = await read();
      if (s.step === String(m.step) && s.say && m.say(s.say)) { seen = s; break; }
      if (Date.now() > end) throw new Error(`순간 ${m.name}: ${momentMs / 1000}초 안에 data-step=${m.step}·「${m.sayText}」가 되지 않음(지금 data-step=${s.step}·「${s.say}」)`);
    }
    await sleep(1200); // 카메라 옮김·말풍선 바뀜이 끝나게
    seen = await read();
    const file = `step-${m.name}.png`;
    writeFileSync(join(out, file), await cdp.screenshot({ format: "png" }, 30_000));
    const failed: string[] = [];
    if (seen.step !== String(m.step)) failed.push(`data-step ${seen.step}(기대 ${m.step})`);
    if (!seen.say || !m.say(seen.say)) failed.push(`말풍선 「${seen.say}」(기대 「${m.sayText}」)`);
    if (m.progress ? !seen.progress?.includes(m.progress) : seen.progress !== null) failed.push(`진행도 「${seen.progress}」(기대 ${m.progress ? `「${m.progress}」` : "없음"})`);
    if (seen.facing !== m.facing) failed.push(`마스코트 data-facing ${seen.facing}(기대 ${m.facing})`);
    if (seen.detections < 1) failed.push("YOLO 상자 없음");
    for (const word of ["승인", APPROVAL_TEXT.ask("컵 치우기")]) if (seen.text.includes(word)) failed.push(`문서 글에 「${word}」`);
    const { text: _text, ...shown } = seen;
    results.push({ moment: m.name, file, seen: shown, failed });
    console.log(`순간 ${m.name}: ${failed.length ? `틀림 ${failed.join(", ")}` : "맞음"} · ${file}`);
  };
  const command = (pred: (m: Record<string, any>) => boolean, what: string) =>
    waitFor(what, () => fromPhone.find((m) => m.type === "command" && m.speak && pred(m)));

  await shoot(watching);
  decide = true;
  // 처음 하는 일: 실제 폰 승인 질문에 「승인」
  const asked = await command((m) => m.text === APPROVAL_TEXT.ask("컵 치우기"), "승인 질문");
  const planId = asked.id as string;
  ws.send(JSON.stringify({ type: "answer", id: planId, step: asked.step, choice: "approve" }));
  const first = await command((m) => m.id === planId && m.step === `${planId}:1`, "첫 명령");
  await shoot(stepMoment(1));
  ws.send(JSON.stringify({ type: "answer", id: planId, step: first.step, choice: "done" }));
  await command((m) => m.id === planId && m.step === `${planId}:2`, "둘째 명령");
  await shoot(stepMoment(2));
  cupPlace = "in_hand";
  await command((m) => m.id === planId && m.step === `${planId}:3`, "셋째 명령");
  await shoot(stepMoment(3));
  ws.send(JSON.stringify({ type: "say", text: "다 했어" }));
  await command((m) => m.id === planId && m.step === `${planId}:4`, "넷째 명령");
  await shoot(stepMoment(4));
  // 끝난 뒤 새 판단이 끝 화면을 바꾸지 않게 PAM을 대기로 돌리고, 이미 보낸 판단이 다 돌아온 뒤 컵을 싱크대에 넣는다
  decide = false;
  await sleep(2500);
  cupPlace = "in_sink";
  await waitFor("명령 지우기", () => fromPhone.some((m) => m.type === "command_clear" && m.id === planId));
  await shoot(doneMoment);
} catch (e) {
  errors.push(`중단: ${(e as Error).message}`);
} finally {
  if (pump) clearInterval(pump);
  page?.close();
  if (chrome) await closeChrome(chrome);
  try { phone?.close(); } catch { /* 이미 닫힘 */ }
  await srv?.close().catch(() => {});
  await fake?.close().catch(() => {});
  await pam?.close().catch(() => {});
  for (let i = 0; i < 10; i++) { try { rmSync(runtimeDir, { recursive: true, force: true }); break; } catch { await sleep(300); } }
}

const wrong = results.filter((r) => r.failed.length > 0);
const moments = ["0", "1", "2", "3", "4", "done"];
const missing = moments.filter((m) => !results.some((r) => r.moment === m));
writeFileSync(join(out, "result.json"), JSON.stringify({ url: `http://127.0.0.1:${PORT}/`, size: [W, H], gpu, results, missing, errors }, null, 1));
console.log(JSON.stringify({ moments: results.map((r) => r.moment), wrong: wrong.map((r) => ({ moment: r.moment, failed: r.failed })), missing, errors }, null, 1));
process.exit(wrong.length || missing.length || errors.length ? 1 : 0);
