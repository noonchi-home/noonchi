// npx tsx scripts/video-check.ts --clip cup-demo.mp4 [--phone http://127.0.0.1:8210] [--api http://127.0.0.1:8200] [--done-after 3]
//   [--out runtime/videos/cup-demo.<시각>.timeline.md] [--expect-after 36.3] [--fake]
// 영상 모드 판정: 헤드리스 크롬 하나(390×844)로 폰 페이지 <phone>/phone/?clip=<clip>을 열고 「AR 시작」을 눌러 영상을 끝까지 튼다.
// 판마다 서버를 새로 띄운다. 앞 판 계획이 끝나지 않았거나 엔진 프레임을 이미 받은 서버(World State가 남음)면 크롬을 띄우기 전에 멈춘다.
// 1초마다 window.__noonchiVideo(t0·받은 명령의 영상 시각·끝)를 읽는다. 새 명령이 오면 --done-after초 뒤 엄지 자리 첫 답 단추(승인·완료)를 누른다(0이면 안 누름).
// 영상이 끝나도 남은 답과 그 뒤 온 명령은 계획이 끝날 때까지 최대 30초 더 누른다. t0는 폰 페이지가 서버 시계로 고친 마지막 값을 쓴다.
// 끝나면 서버 기록(GET /api/history: 사람·물건 등장·사라짐, PAM 판단, 계획·단계, 실행)과 폰 명령을 영상 시각(at_ms − t0)순 표 하나로 합쳐 찍고 --out에 markdown으로 쓴다.
// 같은 출처의 같은 글이 이어지면 한 줄로 묶고 번 수를 붙인다. 표 밑에 판정 줄(첫 명령 시각, --expect-after초 전 명령, 첫 명령의 계획이 끝났는지)과
// 이번 판 VLM 비용(GET /api/brain, PAM·계획 비용 빠짐). 끝까지 돌지 않았으면(시간 넘김·중단) 판정 줄 위에 적고 끝 코드 1.
// 영상은 소리 없이 「AR 시작」 누름에서 튼다. launchChrome은 자동 재생 플래그를 받지 않지만 소리 없는 재생은 크롬 기본값으로 된다.
// --fake: 실제 모델 없이 같은 프로세스에서 스스로 시험한다. 본 서버(HUB=memory, 한양목련, 새 RUNTIME_DIR에 영상 복사, BRAIN=1, PAM 1초마다)와
// 가짜 OpenAI(VLM: 컵 식탁 위, 계획: 컵 치우기 네 단계), 가짜 PAM(컵이 있고 사람이 안 보이면 컵 치우기), 대본 YOLO(첫 프레임부터 30초 사람+컵, 그 뒤 컵만)를 띄운다.
// 식탁 1.5m 앞 시작 자리와 컵 치우기 승인을 미리 둔다. 기본 --expect-after는 대본 사람 시간(30초), 기본 --out은 <clip>.fake.timeline.md다.
// 사람 사라짐, PAM 컵 치우기, 사람 사라짐 뒤 첫 명령, 네 단계 끝, 계획 끝 중 하나라도 없으면 끝 코드 1. ui/dist 빌드가 있어야 한다.
// 잠금: npm run heavy -- 로 부르면 그 잠금(TWIN3D_HEAVY_PID) 안에서 돌고 크롬 pid를 그 잠금에 더한다. 혼자 부르면 withHeavy로 잡는다.
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { Detection } from "../src/brain/detector.js";
import type { HistoryRow } from "../src/contract/history.js";
import { EXEC_TEXT } from "../src/plan/labels.js";
import { chromePath, closeChrome, devtoolsPort, launchChrome, openPage, type Chrome, type Page } from "./twin3d/cdp.js";
import { heldLock, withHeavy, type Lock } from "./twin3d/heavy.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CLIP_NAME = /^[A-Za-z0-9_-]{1,64}\.(?:mp4|webm)$/;
const SIZE: [number, number] = [390, 844];
const HISTORY_KINDS = "detection,decision,plan,execution";
/** 영상이 끝난 뒤 남은 답 누르기·계획 끝을 더 기다리는 시간 */
const TAIL_MS = 30_000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// 표

export type Kind = "사람 등장" | "사람 사라짐" | "물건 등장" | "물건 사라짐" | "PAM 판단" | "계획" | "단계" | "명령" | "끝";
/** 표 한 줄. ms는 영상 시각, n은 묶은 줄 수. */
export interface Row { ms: number; kind: Kind; text: string; n: number }
/** 폰 페이지가 남긴 명령(window.__noonchiVideo.commands). */
export interface VideoCommand { video_ms: number; id: string; step: string; text: string }

const DETECTION_KIND: Record<string, Kind> = { person_appeared: "사람 등장", person_gone: "사람 사라짐", appeared: "물건 등장", gone: "물건 사라짐" };
const STEP_TEXT: Record<string, string> = { active: "시작", done: "끝남", failed: "실패", skipped: "건너뜀" };
const PLAN_END = new Set(["done", "cancelled", "failed"]);
const EXEC_END = new Set(["done", "failed"]);
// 실행 줄 중 상태 이름뿐인 글은 PAM 판단·계획 줄과 같아 뺀다. 남는 것은 까닭(같은 행동을 진행 중·새 판단으로 바뀜·계획을 만들 수 없음…)이다
const EXEC_PLAIN = new Set<string>([EXEC_TEXT.decided, EXEC_TEXT.planned, EXEC_TEXT.running, EXEC_TEXT.verifying, EXEC_TEXT.done, EXEC_TEXT.wait, EXEC_TEXT.decisionFailed]);
type PlanData = { status?: string; steps?: { id: string; label: string; status: string }[] };

/** 서버 기록·폰 명령 → 영상 시각순 표. 같은 출처(기록 종류·명령)의 같은 글이 이어지면 한 줄로 묶는다. endMs가 있으면 「영상 끝」. */
export function timeline(t0: number, history: HistoryRow[], commands: VideoCommand[], endMs: number | null = null): Row[] {
  const raw: (Row & { from: string })[] = [];
  const plans = new Map<string, { status: string; steps: Map<string, string> }>();
  for (const h of [...history].sort((a, b) => a.at_ms - b.at_ms || a.id - b.id)) {
    const ms = h.at_ms - t0;
    if (h.kind === "detection") {
      const kind = DETECTION_KIND[(h.data as { kind?: string } | null)?.kind ?? ""];
      if (kind) raw.push({ ms, kind, text: h.text, n: 1, from: "detection" });
    } else if (h.kind === "decision") {
      raw.push({ ms, kind: "PAM 판단", text: h.text, n: 1, from: "decision" });
    } else if (h.kind === "execution") {
      const state = (h.data as { state?: string } | null)?.state ?? "";
      if (!EXEC_PLAIN.has(h.text)) raw.push({ ms, kind: EXEC_END.has(state) ? "끝" : "계획", text: h.text, n: 1, from: "execution" });
    } else if (h.kind === "plan") {
      // 계획 줄은 바뀐 것만: 처음·계획 상태가 바뀜 → 계획(끝난 상태면 끝, 단계 줄 뒤), 단계 상태가 바뀜 → 단계
      const d = (h.data ?? {}) as PlanData;
      const id = h.subject ?? "";
      const prev = plans.get(id);
      const now = { status: d.status ?? "", steps: new Map((d.steps ?? []).map((s) => [s.id, s.status])) };
      plans.set(id, now);
      const end = PLAN_END.has(now.status);
      const plan = !prev || prev.status !== now.status ? { ms, kind: end ? "끝" as const : "계획" as const, text: h.text, n: 1, from: `plan:${id}` } : null;
      if (plan && !end) raw.push(plan);
      for (const s of d.steps ?? []) {
        if ((prev?.steps.get(s.id) ?? "pending") === s.status || !STEP_TEXT[s.status]) continue;
        raw.push({ ms, kind: "단계", text: `${s.label} ${STEP_TEXT[s.status]}`, n: 1, from: `step:${id}:${s.id}` });
      }
      if (plan && end) raw.push(plan);
    }
  }
  for (const c of commands) raw.push({ ms: c.video_ms, kind: "명령", text: c.text, n: 1, from: "command" });
  if (endMs !== null) raw.push({ ms: endMs, kind: "끝", text: "영상 끝", n: 1, from: "video" });
  raw.sort((a, b) => a.ms - b.ms);
  const rows: Row[] = [];
  const last = new Map<string, Row>();
  for (const { from, ...r } of raw) {
    const prev = last.get(from);
    if (prev && prev.text === r.text && from !== "command") { prev.n += 1; continue; }
    rows.push(r);
    last.set(from, r);
  }
  return rows;
}

/** 영상 시각 mm:ss.s. 0.1초로 먼저 반올림해 59.96초가 01:00.0이 된다. */
export function clock(ms: number): string {
  const t = Math.round(Math.max(0, ms) / 100);
  return `${String(Math.floor(t / 600)).padStart(2, "0")}:${((t % 600) / 10).toFixed(1).padStart(4, "0")}`;
}
const rowText = (r: Row) => (r.n > 1 ? `${r.text} ×${r.n}` : r.text);

/** 판정 줄: 첫 명령 시각, expectMs 전 명령 수, 첫 명령의 계획이 끝났는지. */
export function verdict(rows: Row[], commands: VideoCommand[], history: HistoryRow[], expectMs: number): { text: string; early: number; firstMs: number | null; done: boolean } {
  const first = commands[0];
  const early = commands.filter((c) => c.video_ms < expectMs).length;
  const done = !!first && history.some((h) => h.subject === first.id && ((h.kind === "plan" && (h.data as PlanData | null)?.status === "done") || (h.kind === "execution" && (h.data as { state?: string } | null)?.state === "done")));
  const at = (expectMs / 1000).toFixed(1);
  const text = first
    ? `판정: 첫 명령 ${clock(first.video_ms)} 「${first.text}」 · ${at}초 전 명령 ${early ? `${early}개 있음` : "없음"} · 계획 ${done ? "끝남" : "안 끝남"}`
    : `판정: 명령 없음 · 표 ${rows.length}줄`;
  return { text, early, firstMs: first?.video_ms ?? null, done };
}

/** markdown 문서. notes(끝까지 돌지 않음·페이지 오류)는 판정 줄 위에 쓴다. */
export function markdown(o: { clip: string; mode: string; ranAt: string; rows: Row[]; notes: string[]; verdict: string; cost: string }): string {
  const cell = (s: string) => s.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
  return [
    `# 영상 판정 · ${o.clip}`, "", `${o.ranAt} · ${o.mode}`, "",
    "| 영상 시각 | 종류 | 글 |", "|---|---|---|",
    ...o.rows.map((r) => `| ${clock(r.ms)} | ${r.kind} | ${cell(rowText(r))} |`),
    "", ...o.notes.flatMap((n) => [n, ""]), o.verdict, "", o.cost, "",
  ].join("\n");
}

// 서버 상태

type PlanNow = { status?: string; goal?: string } | null;
type BrainNow = { frames?: number; vlm?: { sent?: number; costUsd?: number } } | null;
const PLAN_OPEN = new Set(["planned", "running"]);

/** 앞 판이 남긴 서버인지: 끝나지 않은 계획, 이미 받은 엔진 프레임(World State가 남음). 그렇면 까닭, 새 서버면 null. */
export function usedServer(plan: PlanNow, brain: BrainNow): string | null {
  if (plan && PLAN_OPEN.has(plan.status ?? "")) return `끝나지 않은 계획이 있어요: ${plan.goal ?? ""}. 서버를 다시 띄우세요`;
  const frames = brain?.frames ?? 0;
  if (frames > 0) return `엔진 프레임 ${frames}장을 이미 받은 서버예요(앞 판 World State가 남음). 서버를 다시 띄우세요`;
  return null;
}

const getJson = async <T>(url: string): Promise<T | null> => fetch(url).then((r) => (r.ok ? (r.json() as Promise<T>) : null)).catch(() => null);

// 크롬에서 돌리는 식

/** 「AR 시작」 단추를 누를 수 있으면 누른다. */
const CLICK_START = `(() => {
  const b = [...document.querySelectorAll("button")].find((x) => x.textContent.trim() === "AR 시작");
  if (!b || b.disabled) return false;
  b.click();
  return true;
})()`;
/** 지금 기록·영상·화면. */
const READ = `(() => {
  const r = window.__noonchiVideo ?? null;
  const v = document.querySelector("video[data-phone-video]");
  return {
    record: r && { t0: r.t0, ended: r.ended, commands: r.commands },
    time: v ? v.currentTime : null, duration: v && Number.isFinite(v.duration) ? v.duration : null, ended: v ? v.ended : false,
    top: document.querySelector("[data-phone-zone=top] [data-phone-text]")?.textContent ?? null,
    buttons: [...document.querySelectorAll("[data-phone-zone=thumb] button")].map((b) => b.textContent.trim()),
    support: document.querySelector("[data-support]")?.textContent ?? null,
  };
})()`;
type Seen = {
  record: { t0: number | null; ended: boolean; commands: VideoCommand[] } | null;
  time: number | null; duration: number | null; ended: boolean; top: string | null; buttons: string[]; support: string | null;
};
/** 위 줄이 그 명령일 때만 엄지 자리 첫 답 단추를 누르고 그 글을 돌려준다. */
const clickAnswer = (text: string) => `(() => {
  const top = document.querySelector("[data-phone-zone=top] [data-phone-text]")?.textContent ?? null;
  const b = document.querySelector("[data-phone-zone=thumb] button");
  if (top !== ${JSON.stringify(text)} || !b) return null;
  b.click();
  return b.textContent.trim();
})()`;

// 가짜 서버(--fake)

const FAKE_PERSON_MS = 30_000;
const HOME = "mokryeon_180b";
// tests/video-mode-e2e.test.ts와 같은 시작 자리: 식탁 가운데([9.9612, 3.9242])에서 1.5m 떨어진 거실, 시작 방향 0°(+x)로 식탁을 본다
const START: [number, number] = [9.9612 - 1.5, 3.9242];
// 세로 영상의 엔진 프레임 360×640(core/pipeline.js frameWidth). 컵 상자 아래 가운데가 그림 한가운데(카메라 축, 식탁 윗면)
const CUP: Detection = { label: "cup", score: 0.9, cls: 41, box: [160, 300, 40, 20] };
const PERSON: Detection = { label: "person", score: 0.9, cls: 0, box: [100, 60, 160, 420] };

interface Fake { api: string; phone: string; logs: string[]; close(): Promise<void> }

async function startFake(clip: string): Promise<Fake> {
  const [{ startFakeOpenAI }, { startFakePam }, { ScriptedDetector }, { CUP_SCRIPTS, plannerRespond }, { startServer }] = await Promise.all([
    import("./fake-openai.js"), import("../tests/helpers/pam.js"), import("../tests/helpers/detectors.js"), import("../tests/helpers/planner.js"), import("../src/server/start.js"),
  ]);
  const src = join(ROOT, "runtime", "videos", clip);
  if (!existsSync(src)) throw new Error(`영상이 없어요: runtime/videos/${clip}`);
  const runtimeDir = mkdtempSync(join(tmpdir(), "video-check-"));
  mkdirSync(join(runtimeDir, "videos"), { recursive: true });
  copyFileSync(src, join(runtimeDir, "videos", clip));
  mkdirSync(join(runtimeDir, "homes", HOME), { recursive: true });
  writeFileSync(join(runtimeDir, "homes", HOME, "approvals.json"), JSON.stringify({ always: { "task:컵 치우기": "2026-11-11T00:00:00.000Z" }, never: {} }));
  const logs: string[] = [];
  const closers: (() => Promise<unknown>)[] = [];
  const close = async () => {
    for (const c of closers.reverse()) await c().catch(() => {});
    for (let i = 0; i < 10; i++) { try { rmSync(runtimeDir, { recursive: true, force: true }); break; } catch { await sleep(300); } }
  };
  try {
    const fake = await startFakeOpenAI({
      reply: (body) => {
        if (body?.response_format?.json_schema?.name !== "scene_observation") return null;
        const parts = (body.messages as { role: string; content: unknown }[]).filter((m) => m.role === "user").flatMap((m) => (Array.isArray(m.content) ? m.content : [{ text: m.content }]));
        const text = parts.map((p: { text?: unknown }) => (typeof p.text === "string" ? p.text : "")).join("\n");
        const dets = JSON.parse(/Detections: (\[.*\])/.exec(text)?.[1] ?? "[]") as { id: string; class: string }[];
        return JSON.stringify({ scene: "kitchen", observations: dets.filter((d) => d.class === "cup").map((d) => ({ object_id: d.id, state: "on_table" })), summary: "컵" });
      },
      respond: plannerRespond(CUP_SCRIPTS),
    });
    closers.push(() => fake.close());
    // 실제 PAM처럼 사람이 떠난 뒤 컵이 남았을 때 컵 치우기를 고른다(tests/video-mode-e2e.test.ts와 같은 조건). 사람이 보이면 대기
    const pam = await startFakePam({ predict: (b) => {
      const text = String(b.observation_text);
      const i = (b.tasks as string[]).indexOf("컵 치우기");
      return i >= 0 && /컵 cup_\d/.test(text) && /^\[지속\] 사람 안 보임/m.test(text)
        ? { observation: "사람이 떠나고 빈 컵이 식탁에 남음", reasoning: "컵을 치운다", task_index: i }
        : { observation: "사람이 식탁에 있음", reasoning: "기다린다", task_index: -1 };
    } });
    closers.push(() => pam.close());
    let first: number | null = null;
    const srv = await startServer({
      env: {
        HUB: "memory", PORT: "0", HOST: "127.0.0.1", HOME_ID: HOME, RUNTIME_DIR: runtimeDir, PHONE_PORT: "0", PHONE_HOST: "127.0.0.1",
        BRAIN: "1", VLM_BASE_URL: `${fake.url}/v1`, OPENAI_BASE_URL: `${fake.url}/v1`, OPENAI_API_KEY: "fake-key", PAM_URL: pam.url,
        PAM_PERIOD_MS: "1000", PAM_MIN_GAP_MS: "0",
      },
      // 첫 엔진 프레임부터 30초는 사람+컵, 그 뒤 컵만
      brain: { detector: new ScriptedDetector(() => {
        const now = Date.now();
        first ??= now;
        return now - first < FAKE_PERSON_MS ? [CUP, PERSON] : [CUP];
      }) },
      log: (line) => { logs.push(line); if (logs.length > 300) logs.shift(); },
    });
    closers.push(() => srv.close());
    const saved = await fetch(`${srv.url}/api/phone/start-pose`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ position: START, yaw_deg: 0 }) });
    if (!saved.ok) throw new Error(`시작 자리 저장 실패: HTTP ${saved.status} ${await saved.text()}`);
    return { api: srv.url, phone: new URL(srv.phoneUrls[0]!).origin, logs, close };
  } catch (e) {
    await close();
    throw e;
  }
}

// 돌리기

const arg = (k: string, d?: string) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1]! : d; };

async function main(): Promise<number> {
  const clip = arg("clip") ?? "";
  if (!CLIP_NAME.test(clip)) {
    console.error("쓰는 법: npx tsx scripts/video-check.ts --clip <이름.mp4> [--phone http://127.0.0.1:8210] [--api http://127.0.0.1:8200] [--done-after 3] [--out <파일.md>] [--expect-after 36.3] [--fake]");
    return 2;
  }
  const fakeMode = process.argv.includes("--fake");
  const doneAfterMs = Number(arg("done-after", "3")) * 1000;
  const expectMs = Number(arg("expect-after", fakeMode ? String(FAKE_PERSON_MS / 1000) : "36.3")) * 1000;
  const base = clip.replace(/\.[^.]+$/, "");
  // 실제 판은 판마다 파일 하나(시각을 붙여 앞 판을 덮지 않는다). 스스로 시험은 같은 파일을 덮는다
  const stamp = new Date().toLocaleString("sv-SE").replace(/[-:]/g, "").replace(" ", "-");
  const out = resolve(ROOT, arg("out", `runtime/videos/${base}.${fakeMode ? "fake" : stamp}.timeline.md`)!);
  if (!Number.isFinite(doneAfterMs) || doneAfterMs < 0 || !Number.isFinite(expectMs)) { console.error("--done-after·--expect-after는 0 이상 숫자(초)예요"); return 2; }
  if (fakeMode && !existsSync(join(ROOT, "ui", "dist", "phone", "index.html"))) { console.error("ui/dist가 없어요: npm run heavy -- npm --prefix ui run build"); return 2; }
  const chromeExe = chromePath();

  let stop = false;
  const onSignal = () => { stop = true; };
  process.on("SIGINT", onSignal);
  process.on("SIGTERM", onSignal);

  const work = async (note: (pid: number) => void): Promise<number> => {
    const errors: string[] = [];
    // 끝까지 돌지 않은 까닭(시간 넘김·중단)
    const unfinished: string[] = [];
    let fake: Fake | undefined;
    let chrome: Chrome | undefined;
    let page: Page | undefined;
    try {
      fake = fakeMode ? await startFake(clip) : undefined;
      const phone = (fake?.phone ?? arg("phone", "http://127.0.0.1:8210")!).replace(/\/+$/, "");
      const api = (fake?.api ?? arg("api", "http://127.0.0.1:8200")!).replace(/\/+$/, "");
      const url = `${phone}/phone/?clip=${encodeURIComponent(clip)}`;
      const planNow = () => getJson<{ plan: PlanNow }>(`${api}/api/plan`);

      // 앞 판 계획·World State가 남은 서버면 시작하지 않는다(새로 붙은 폰은 남은 명령을 바로 받는다)
      const before = await planNow();
      if (!before) throw new Error(`서버에 닿지 못함: ${api}/api/plan`);
      const used = usedServer(before.plan, await getJson<BrainNow>(`${api}/api/brain`));
      if (used) throw new Error(used);

      chrome = launchChrome({ path: chromeExe, size: SIZE });
      note(chrome.proc.pid!);
      page = await openPage(await devtoolsPort(chrome), (msg) => errors.push(msg));
      const cdp = page;
      await cdp.send("Emulation.setDeviceMetricsOverride", { width: SIZE[0], height: SIZE[1], deviceScaleFactor: 1, mobile: true });
      await cdp.send("Page.navigate", { url });
      console.log(`[video-check] ${url}`);
      const read = async () => (await cdp.evaluate(READ, 10_000)) as Seen;

      // 「AR 시작」을 누르고 재생이 시작될 때까지(t0)
      for (const end = Date.now() + 60_000; !(await cdp.evaluate(CLICK_START, 10_000).catch(() => false)); await sleep(250)) {
        if (Date.now() > end || stop) throw new Error("60초 안에 「AR 시작」 단추를 누를 수 없음");
      }
      let seen = await read();
      for (const end = Date.now() + 30_000; seen.record?.t0 == null; seen = await read()) {
        if (Date.now() > end || stop) throw new Error(`30초 안에 영상이 시작되지 않음(지원 줄 「${seen.support ?? ""}」)`);
        await sleep(250);
      }
      // 처음 t0는 폰 시계로 어림한 값일 수 있다. 폰 페이지가 시계를 맞춘 뒤 서버 시계로 고친다
      const firstT0 = seen.record!.t0!;
      console.log(`[video-check] 재생 시작 t0=${firstT0}`);

      // 끝날 때까지 1초마다 읽고, 새 명령은 --done-after초 뒤 첫 답 단추를 누른다
      const startedAt = Date.now();
      let endedAt: number | null = null;
      let due: { at: number; cmd: VideoCommand }[] = [];
      let known = 0;
      let commands: VideoCommand[] = [];
      let duration: number | null = null;
      for (;;) {
        seen = await read();
        commands = seen.record?.commands ?? commands;
        duration = seen.duration ?? duration;
        for (const c of commands.slice(known)) {
          console.log(`[video-check] ${clock(c.video_ms)} 명령 ${c.text}`);
          if (doneAfterMs > 0) due.push({ at: Date.now() + doneAfterMs, cmd: c });
        }
        known = commands.length;
        const now = Date.now();
        const ready = due.filter((d) => d.at <= now);
        due = due.filter((d) => d.at > now);
        for (const d of ready) {
          const label = (await cdp.evaluate(clickAnswer(d.cmd.text), 10_000)) as string | null;
          if (label) console.log(`[video-check] ${clock((seen.time ?? 0) * 1000)} 「${label}」 누름 · ${d.cmd.text}`);
        }
        if (seen.record?.ended || seen.ended) {
          if (endedAt === null) {
            endedAt = Date.now();
            console.log(`[video-check] ${clock((duration ?? seen.time ?? 0) * 1000)} 영상 끝`);
          }
          // 끝난 뒤에도 남은 답과 그 뒤 온 명령은 계획이 끝날 때까지 TAIL_MS 더 누른다
          if (!doneAfterMs || Date.now() - endedAt > TAIL_MS) break;
          if (!due.length && !PLAN_OPEN.has((await planNow())?.plan?.status ?? "")) break;
        } else {
          const limitMs = ((duration ?? 600) + 60) * 1000;
          if (Date.now() - startedAt > limitMs) { unfinished.push(`${Math.round(limitMs / 1000)}초 안에 영상이 끝나지 않음`); break; }
        }
        if (stop) { unfinished.push("중단"); break; }
        await sleep(1000);
      }
      const endMs = endedAt !== null ? (duration ?? seen.time ?? 0) * 1000 : null;
      const t0 = seen.record?.t0 ?? firstT0;
      if (t0 !== firstT0) console.log(`[video-check] 서버 시계 t0=${t0} (처음 ${firstT0})`);

      // 서버 기록·VLM 비용. 새 서버로만 시작하니 /api/brain 합계가 이번 판 값이다
      const hist = await fetch(`${api}/api/history?since=${Math.min(firstT0, t0)}&kinds=${HISTORY_KINDS}&limit=5000`);
      if (!hist.ok) throw new Error(`기록을 받지 못함: HTTP ${hist.status}`);
      const history = ((await hist.json()) as { rows: HistoryRow[] }).rows;
      const brain = await getJson<BrainNow>(`${api}/api/brain`);
      const cost = brain?.vlm ? `VLM ${brain.vlm.sent ?? 0}장 · $${(brain.vlm.costUsd ?? 0).toFixed(4)} · 엔진 프레임 ${brain.frames ?? 0}장 · PAM·계획 비용 빠짐` : "VLM 비용 모름(/api/brain 없음)";

      const rows = timeline(t0, history, commands, endMs);
      const v = verdict(rows, commands, history, expectMs);
      const pageErrors = errors.filter((e) => !/favicon/.test(e));
      const notes = [
        unfinished.length ? `끝까지 돌지 않음: ${unfinished.join(", ")}` : "",
        pageErrors.length ? `페이지 오류 ${pageErrors.length}개` : "",
      ].filter(Boolean);
      console.log("");
      for (const r of rows) console.log(`${clock(r.ms)} · ${r.kind} · ${rowText(r)}`);
      console.log("");
      for (const n of notes) console.log(n);
      console.log(v.text);
      console.log(cost);
      mkdirSync(dirname(out), { recursive: true });
      writeFileSync(out, markdown({ clip, mode: fakeMode ? "가짜 서버" : `실제 서버 ${api}`, ranAt: new Date().toLocaleString("sv-SE"), rows, notes, verdict: v.text, cost }));
      console.log(`[video-check] ${out}`);

      if (pageErrors.length) console.log(`[video-check] 페이지 오류\n${pageErrors.slice(0, 20).join("\n")}`);
      if (!fakeMode) return unfinished.length ? 1 : 0;
      // 스스로 시험: 사람 사라짐 → PAM 컵 치우기 → 사람 사라짐 뒤 첫 명령 → 네 단계 끝 → 계획 끝
      const gone = rows.find((r) => r.kind === "사람 사라짐");
      const firstPlan = commands[0]?.id;
      const stepsDone = history.filter((h) => h.kind === "plan" && h.subject === firstPlan).at(-1);
      const missing = [
        !gone && "사람 사라짐 줄",
        !rows.some((r) => r.kind === "PAM 판단" && r.text === "컵 치우기") && "PAM 컵 치우기 판단",
        !(gone && v.firstMs !== null && v.firstMs > gone.ms) && "사람 사라짐 뒤 첫 명령",
        !(((stepsDone?.data as PlanData | null)?.steps ?? []).filter((s) => s.status === "done").length === 4) && "네 단계 끝",
        !v.done && "계획 끝",
        endMs === null && "영상 끝",
        pageErrors.length > 0 && "페이지 오류 없음",
      ].filter(Boolean);
      if (missing.length) {
        console.log(`[video-check] 스스로 시험 틀림: ${missing.join(", ")} 없음`);
        console.log(fake!.logs.slice(-80).join("\n"));
        return 1;
      }
      console.log("[video-check] 스스로 시험 맞음");
      return 0;
    } catch (e) {
      console.error(`[video-check] 중단: ${(e as Error).message}`);
      if (errors.length) console.error(errors.slice(0, 20).join("\n"));
      if (fake) console.error(fake.logs.slice(-40).join("\n"));
      return 1;
    } finally {
      page?.close();
      if (chrome) await closeChrome(chrome);
      await fake?.close();
    }
  };

  // npm run heavy -- 안이면 그 잠금에, 아니면 스스로 잡은 잠금에 크롬 pid를 적는다(이 프로세스가 죽어도 다음 잠금이 크롬을 끝낸다)
  const run = (lock: Lock) => work((pid) => lock.note({ chromePid: pid }));
  const inner = heldLock();
  return inner ? run(inner) : withHeavy(`video-check ${clip}`, run);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().then((code) => process.exit(code), (e) => { console.error((e as Error).message); process.exit((e as Error).message.startsWith("다른 무거운 일이 돌고 있어요") ? 3 : 1); });
}
