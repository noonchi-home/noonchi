// 세로 머그 영상(cup-mug-empty-leave, 사람이 머그로 마시다 식탁에 두고 나감)을 실제 감지 모델(YOLO26-seg·pose, CPU)로 보고 가짜 모델(VLM·PAM·계획 에이전트)로
// 판단하는 처음부터 끝까지 시험. 2026-11-18 실제 녹화(cup-mug-empty.real3)에서 사람이 컵을 들고 마시는 중에 PAM이 「컵 그대로 두기」를 고르자 찾기가 시작돼
// 「컵 있던 곳으로 가 주세요」가 나가고, 그 뒤 「컵 치우기」가 계속 막혔다. 이 시험은 사람이 있는 동안 그대로 두기를 골라도 찾기 명령이 나가지 않고,
// 사람이 나간 뒤 컵 치우기가 「식탁으로 가 주세요 → 컵을 들어 주세요」로 가는지 본다(11-16 real2와 같은 흐름).
// 영상은 사용자 집이라 저장소에 넣지 않는다: PHONE_VIDEO_DIR(없으면 저장소 runtime/videos)에 그 영상이 있고 ffmpeg가 있을 때만 돈다(없으면 건너뜀).
// 영상 프레임은 ffmpeg로 초당 4장 360×640 JPEG로 뽑아 250ms마다 엔진 프레임으로 보내고, 영상이 끝나면 마지막 장면을 같은 간격으로 계속 보낸다(사진마다 끝에 번호를 붙여 같은 사진으로 버리지 않게).
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type WebSocket from "ws";
import { startFakeOpenAI, type FakeServer } from "../scripts/fake-openai.js";
import type { Quat } from "../src/contract/observe.js";
import type { Vec3 } from "../src/shared/geometry.js";
import { DETECTOR_MODEL, MODELS_DIR, OnnxDetector, POSE_MODEL } from "../src/observe/detector.js";
import { encodeFramePacket } from "../src/phone/packet.js";
import { startServer, type RunningServer } from "../src/server/start.js";
import { startFakePam, type FakePam } from "./helpers/pam.js";
import { CUP_SCRIPTS, plannerRespond } from "./helpers/planner.js";
import { openPhone, openWebSocket } from "./helpers/ws.js";

type Msg = Record<string, any>;
const VIDEOS = process.env.PHONE_VIDEO_DIR ?? join(import.meta.dirname, "..", "runtime", "videos");
const CLIP = join(VIDEOS, "cup-mug-empty-leave.mp4");
const canRun = existsSync(CLIP) && spawnSync("ffmpeg", ["-version"]).status === 0 && existsSync(join(MODELS_DIR, DETECTOR_MODEL.file));

let srv: RunningServer | undefined;
let fake: FakeServer | undefined;
let pam: FakePam | undefined;
let pumping = false;
const sockets: WebSocket[] = [];
afterEach(async () => {
  pumping = false;
  for (const s of sockets.splice(0)) s.close();
  await srv?.close();
  srv = undefined;
  await fake?.close();
  fake = undefined;
  await pam?.close();
  pam = undefined;
});

/** 영상을 초당 4장 360×640 JPEG로 뽑는다(JPEG 시작 표시 FFD8FF로 자른다). */
function frames(): Buffer[] {
  const r = spawnSync("ffmpeg", ["-loglevel", "error", "-i", CLIP, "-vf", "fps=4,scale=360:640", "-q:v", "4", "-f", "image2pipe", "-vcodec", "mjpeg", "pipe:1"], { maxBuffer: 1 << 28 });
  expect(r.status).toBe(0);
  const all = r.stdout as Buffer;
  const starts: number[] = [];
  for (let i = 0; i + 2 < all.length; i++) if (all[i] === 0xff && all[i + 1] === 0xd8 && all[i + 2] === 0xff) starts.push(i);
  return starts.map((s, k) => all.subarray(s, starts[k + 1] ?? all.length));
}

// tests/video-mode-e2e.test.ts와 같은 시작 자리: 식탁 가운데에서 1.5m 떨어진 거실, 높이 1.5m에서 식탁 윗면 가운데를 향해 숙인다. 세로 60° 시야(360×640) 투영(열 우선)
const TABLE: [number, number] = [9.9612, 3.9242];
const START: [number, number] = [TABLE[0] - 1.5, TABLE[1]];
const PITCH = Math.atan2(1.5 - 0.75, 1.5);
const POSITION: Vec3 = [0, 1.5, 0];
const ORIENTATION: Quat = [Math.sin(-PITCH / 2), 0, 0, Math.cos(-PITCH / 2)];
const F = 1 / Math.tan(Math.PI / 6);
const ASPECT = 360 / 640;
const NEAR = 0.01, FAR = 100;
const PROJECTION = [F / ASPECT, 0, 0, 0, 0, F, 0, 0, 0, 0, (FAR + NEAR) / (NEAR - FAR), -1, 0, 0, (2 * FAR * NEAR) / (NEAR - FAR), 0];
const EPOCH = "video-1";

describe.skipIf(!canRun)("세로 머그 영상(실제 감지, 가짜 모델) 처음부터 끝까지", () => {
  it("사람이 컵을 들고 있는 동안 「컵 그대로 두기」를 골라도 찾기 명령이 나가지 않고, 사람이 나간 뒤 컵 치우기가 「식탁으로 가 주세요 → 컵을 들어 주세요」로 간다", async () => {
    const shots = frames();
    expect(shots.length).toBeGreaterThan(40);
    fake = await startFakeOpenAI({
      reply: (body) => {
        if (body?.response_format?.json_schema?.name !== "scene_observation") return null;
        const parts = (body.messages as { role: string; content: unknown }[]).filter((m) => m.role === "user").flatMap((m) => (Array.isArray(m.content) ? m.content : [{ text: m.content }]));
        const text = parts.map((p: { text?: unknown }) => (typeof p.text === "string" ? p.text : "")).join("\n");
        const dets = JSON.parse(/Detections: (\[.*\])/.exec(text)?.[1] ?? "[]") as { id: string; class: string }[];
        return JSON.stringify({ scene: "kitchen", observations: dets.filter((d) => d.class === "cup").map((d) => ({ object_id: d.id, state: "on_table" })), summary: "컵" });
      },
      respond: plannerRespond(CUP_SCRIPTS),
    });
    // 실제 녹화처럼: 사람이 보이면(확인된 컵이 아직 없어도) 「컵 그대로 두기」, 사람이 떠난 뒤 컵이 남으면 「컵 치우기」, 그 밖은 대기
    pam = await startFakePam({ predict: (b) => {
      const text = String(b.observation_text);
      const tasks = b.tasks as string[];
      const cup = /컵 cup_\d/.test(text);
      if (/^\[지속\] 사람 보임/m.test(text)) return { observation: "사람이 컵으로 마시는 중", reasoning: "더 마실 수 있다", task_index: tasks.indexOf("컵 그대로 두기") };
      if (cup && /^\[지속\] 사람 안 보임/m.test(text)) return { observation: "사람이 떠나고 컵이 남음", reasoning: "컵을 치운다", task_index: tasks.indexOf("컵 치우기") };
      return { observation: "지켜봄", reasoning: "기다린다", task_index: -1 };
    } });
    const runtimeDir = mkdtempSync(join(tmpdir(), "rt-mug-"));
    mkdirSync(join(runtimeDir, "homes", "mokryeon_180b"), { recursive: true });
    writeFileSync(join(runtimeDir, "homes", "mokryeon_180b", "approvals.json"), JSON.stringify({ always: { "task:컵 치우기": "2026-11-11T00:00:00.000Z" }, never: {} }));
    const detector = await OnnxDetector.create({ modelPath: join(MODELS_DIR, DETECTOR_MODEL.file), posePath: join(MODELS_DIR, POSE_MODEL.file), provider: "cpu" });
    srv = await startServer({
      env: { HUB: "memory", PORT: "0", HOME_ID: "mokryeon_180b", RUNTIME_DIR: runtimeDir, PHONE_PORT: "0", PHONE_HOST: "127.0.0.1",
        BRAIN: "1", VLM_BASE_URL: `${fake.url}/v1`, PAM_URL: pam.url, OPENAI_API_KEY: "fake-key", OPENAI_BASE_URL: `${fake.url}/v1`,
        PAM_PERIOD_MS: "500", PAM_MIN_GAP_MS: "0" },
      brain: { detector },
      log: () => {},
    });
    const saved = await fetch(`${srv.url}/api/phone/start-pose`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ position: START, yaw_deg: 0 }) });
    expect(saved.status).toBe(200);

    const timeline: string[] = [];
    const dash: Msg[] = [];
    sockets.push(await openWebSocket(`${srv.url.replace(/^http/, "ws")}/events`, { setup: (ws) => ws.on("message", (d, bin) => {
      if (bin) return;
      const m = JSON.parse(String(d)) as Msg;
      dash.push(m);
      if (m.type === "brain" && m.event.type === "world_change" && /^person_(appeared|gone)$/.test(m.event.kind)) timeline.push(m.event.kind);
      if (m.type === "brain" && m.event.type === "decision" && m.event.action) timeline.push(`decision:${m.event.action}`);
    }) }));
    const phoneUrl = new URL(srv.phoneUrls[0]!);
    const phone: Msg[] = [];
    const ws = await openPhone(`ws://${phoneUrl.host}/phone/events`, { options: { origin: phoneUrl.origin }, setup: (w) => w.on("message", (d, bin) => {
      if (bin) return;
      const m = JSON.parse(String(d)) as Msg;
      phone.push(m);
      if (m.type === "command") timeline.push(`command:${m.text}`);
    }) });
    sockets.push(ws);
    const until = async (ok: () => boolean, what: string, ms = 90_000) => {
      for (const end = Date.now() + ms; Date.now() < end; await new Promise((r) => setTimeout(r, 50))) if (ok()) return;
      throw new Error(`${ms / 1000}초 안에 오지 않음: ${what} · 시간축 ${JSON.stringify(timeline)}`);
    };

    ws.send(JSON.stringify({ type: "reset", epoch: EPOCH }));
    ws.send(JSON.stringify({ type: "start", fixed: true, position: POSITION, orientation: ORIENTATION, epoch: EPOCH }));
    await until(() => phone.some((m) => m.type === "status" && m.aligned), "맞춤");

    // 250ms마다 영상 한 장(초당 4장), 끝나면 마지막 장면
    pumping = true;
    void (async () => {
      for (let n = 0; pumping; n++) {
        const shot = shots[Math.min(n, shots.length - 1)]!;
        const jpeg = n < shots.length ? shot : Buffer.concat([shot, Buffer.from(`hold${n}`)]);
        ws.send(JSON.stringify({ type: "pose", position: POSITION, orientation: ORIENTATION, tracking: "ok", epoch: EPOCH }));
        ws.send(encodeFramePacket({ kind: "engine", width: 360, height: 640, position: POSITION, orientation: ORIENTATION, tracking: "ok", projection: PROJECTION,
          epoch: EPOCH, captured_at: Date.now(), time_err_ms: 0 }, jpeg));
        await new Promise((r) => setTimeout(r, 250));
      }
    })();

    // 사람이 나간 뒤 첫 계획 명령은 「식탁으로 가 주세요」
    const planCommands = () => phone.filter((m) => m.type === "command" && m.speak && String(m.id).startsWith("plan:"));
    await until(() => planCommands().length > 0, "첫 계획 명령", 120_000);
    const first = planCommands()[0]!;
    expect(first.text).toBe("식탁으로 가 주세요");
    expect(timeline.indexOf("person_gone")).toBeGreaterThanOrEqual(0);
    expect(timeline.findIndex((t) => t === "command:식탁으로 가 주세요")).toBeGreaterThan(timeline.indexOf("person_gone"));
    // 「완료」로 가기를 넘기면 「컵을 들어 주세요」
    ws.send(JSON.stringify({ type: "answer", id: first.id, step: first.step, choice: "done" }));
    await until(() => planCommands().some((m) => m.text === "컵을 들어 주세요"), "컵을 들어 주세요");

    // 사람이 있는 동안 그대로 두기를 골랐어도 찾기 명령은 한 번도 나가지 않았다
    const kept = timeline.indexOf("decision:컵 그대로 두기");
    expect(kept).toBeGreaterThanOrEqual(0);
    expect(kept).toBeLessThan(timeline.indexOf("person_gone"));
    expect(phone.filter((m) => m.type === "command" && String(m.id).startsWith("find:"))).toEqual([]);
    expect(phone.some((m) => m.type === "command" && /있던 곳/.test(String(m.text)))).toBe(false);
  }, 240_000);
});
