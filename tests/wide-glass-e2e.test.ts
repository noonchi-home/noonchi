// 가로 유리컵 영상(wide-glass-leave, 1280×720: 사람이 유리컵으로 마시다 식탁에 두고 나감)을 실제 감지 모델(YOLO26-seg·pose, CPU)로 보고 가짜 모델(VLM·PAM·계획 에이전트)로
// 판단하는 처음부터 끝까지 시험. 2026-11-18 실제 판(cup-mug-empty.real4)에서 사람이 아직 컵을 쓰는 중에 계획 밖 가까이 가서 보기(「컵 가까이 가 주세요」)가 나가
// 영상 모드가 단계 영상으로 일찍 바뀌었고, 컵이 사라져 컵 치우기가 실패했다(그 전 real3에서는 찾기 「컵 있던 곳으로 가 주세요」가 나갔다).
// 이 시험은 사람이 쓰는 중인 컵(쓰는 중 지킴, src/act/track/use.ts)으로는 사람이 있는 동안 어떤 명령(찾기·가까이 가서 보기·계획 첫 명령)도 나가지 않고,
// 사람이 나간 뒤 컵 치우기가 「식탁으로 가 주세요 → 컵을 들어 주세요」로 가는지 본다. 가로 머그 영상(wide-mug-leave)은 사람이 나간 뒤 YOLO가 컵을 못 잡아 쓰지 않는다.
// 가짜 VLM은 감지한 컵을 식탁 위·불투명(내용물 모름: 계획 밖 가까이 가서 보기를 할 조건)으로, 컵과 함께 보인 사람을 마시는 중으로 답한다.
// 영상은 사용자 집이라 저장소에 넣지 않는다: PHONE_VIDEO_DIR(없으면 저장소 runtime/videos)에 그 영상이 있고 ffmpeg가 있을 때만 돈다(없으면 건너뜀).
// 영상 프레임은 ffmpeg로 초당 4장 640×360 JPEG로 뽑아 250ms마다 엔진 프레임으로 보내고, 12.25초(사람이 나가고 YOLO가 컵을 0.4 넘게 잡는 장)부터는 그 장면을
// 같은 간격으로 계속 보낸다(사진마다 끝에 번호를 붙여 같은 사진으로 버리지 않게. 영상 마지막 장은 컵을 못 잡아 쓰지 않는다).
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
import { pamLlmEnv, startFakePamLlm, type FakePamLlm } from "./helpers/pam.js";
import { CUP_SCRIPTS, plannerRespond } from "./helpers/planner.js";
import { openPhone, openWebSocket } from "./helpers/ws.js";

type Msg = Record<string, any>;
const VIDEOS = process.env.PHONE_VIDEO_DIR ?? join(import.meta.dirname, "..", "runtime", "videos");
const CLIP = join(VIDEOS, "wide-glass-leave.mp4");
const canRun = existsSync(CLIP) && spawnSync("ffmpeg", ["-version"]).status === 0 && existsSync(join(MODELS_DIR, DETECTOR_MODEL.file));

let srv: RunningServer | undefined;
let fake: FakeServer | undefined;
let pam: FakePamLlm | undefined;
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

/** 영상을 초당 4장 640×360 JPEG로 뽑는다(JPEG 시작 표시 FFD8FF로 자른다). */
function frames(): Buffer[] {
  const r = spawnSync("ffmpeg", ["-loglevel", "error", "-i", CLIP, "-vf", "fps=4,scale=640:360", "-q:v", "4", "-f", "image2pipe", "-vcodec", "mjpeg", "pipe:1"], { maxBuffer: 1 << 28 });
  expect(r.status).toBe(0);
  const all = r.stdout as Buffer;
  const starts: number[] = [];
  for (let i = 0; i + 2 < all.length; i++) if (all[i] === 0xff && all[i + 1] === 0xd8 && all[i + 2] === 0xff) starts.push(i);
  return starts.map((s, k) => all.subarray(s, starts[k + 1] ?? all.length));
}

// 시작 자리: 식탁 가운데에서 1.5m 떨어진 거실, 높이 1.5m. 가로 640×360, 세로 시야 40°(투영은 열 우선).
// 컵은 사진 (395, 245) 근처에 놓인다: 그 픽셀을 지나는 빛이 식탁 가운데(1.5m 앞, 0.75m 아래)에 닿게 숙인다
const TABLE: [number, number] = [9.9612, 3.9242];
const START: [number, number] = [TABLE[0] - 1.5, TABLE[1]];
const VFOV = (40 * Math.PI) / 180;
const CUP_DOWN = Math.atan(((245 - 180) / 180) * Math.tan(VFOV / 2));
const PITCH = Math.atan2(1.5 - 0.75, 1.5) - CUP_DOWN;
const POSITION: Vec3 = [0, 1.5, 0];
const ORIENTATION: Quat = [Math.sin(-PITCH / 2), 0, 0, Math.cos(-PITCH / 2)];
const F = 1 / Math.tan(VFOV / 2);
const ASPECT = 640 / 360;
const NEAR = 0.01, FAR = 100;
const PROJECTION = [F / ASPECT, 0, 0, 0, 0, F, 0, 0, 0, 0, (FAR + NEAR) / (NEAR - FAR), -1, 0, 0, (2 * FAR * NEAR) / (NEAR - FAR), 0];
const EPOCH = "video-1";
/** 이어 보낼 장(12.25초). */
const HOLD = 49;

describe.skipIf(!canRun)("가로 유리컵 영상(실제 감지, 가짜 모델) 처음부터 끝까지", () => {
  it("사람이 컵을 쓰는 동안은 찾기·가까이 가서 보기·계획 명령이 하나도 나가지 않고, 사람이 나간 뒤 컵 치우기가 「식탁으로 가 주세요 → 컵을 들어 주세요」로 간다", async () => {
    const shots = frames();
    expect(shots.length).toBeGreaterThan(HOLD);
    fake = await startFakeOpenAI({
      reply: (body) => {
        if (body?.response_format?.json_schema?.name !== "scene_observation") return null;
        const parts = (body.messages as { role: string; content: unknown }[]).filter((m) => m.role === "user").flatMap((m) => (Array.isArray(m.content) ? m.content : [{ text: m.content }]));
        const text = parts.map((p: { text?: unknown }) => (typeof p.text === "string" ? p.text : "")).join("\n");
        const dets = JSON.parse(/Detections: (\[.*\])/.exec(text)?.[1] ?? "[]") as { id: string; class: string }[];
        const cups = dets.filter((d) => d.class === "cup");
        const people = cups.length ? dets.filter((d) => d.class === "person") : [];
        return JSON.stringify({
          scene: "kitchen",
          observations: [
            ...cups.flatMap((d) => [{ object_id: d.id, state: "on_table" }, { object_id: d.id, state: "opaque" }]),
            ...people.map((d) => ({ object_id: d.id, state: "drinking" })),
          ],
          summary: "컵",
        });
      },
      respond: plannerRespond(CUP_SCRIPTS),
    });
    // 실제 녹화처럼: 사람이 보이면(확인된 컵이 아직 없어도) 「컵 그대로 두기」, 사람이 떠난 뒤 컵이 남으면 「컵 치우기」, 그 밖은 대기
    pam = await startFakePamLlm({ predict: (b) => {
      const text = b.observation_text;
      const tasks = b.tasks;
      const cup = /컵 cup_\d/.test(text);
      if (/^\[지속\] 사람 보임/m.test(text)) return { observation: "사람이 컵으로 마시는 중", reasoning: "더 마실 수 있다", task_index: tasks.indexOf("컵 그대로 두기") };
      if (cup && /^\[지속\] 사람 안 보임/m.test(text)) return { observation: "사람이 떠나고 컵이 남음", reasoning: "컵을 치운다", task_index: tasks.indexOf("컵 치우기") };
      return { observation: "지켜봄", reasoning: "기다린다", task_index: -1 };
    } });
    const runtimeDir = mkdtempSync(join(tmpdir(), "rt-glass-"));
    mkdirSync(join(runtimeDir, "homes", "mokryeon_180b"), { recursive: true });
    writeFileSync(join(runtimeDir, "homes", "mokryeon_180b", "approvals.json"), JSON.stringify({ always: { "task:컵 치우기": "2026-11-11T00:00:00.000Z" }, never: {} }));
    const detector = await OnnxDetector.create({ modelPath: join(MODELS_DIR, DETECTOR_MODEL.file), posePath: join(MODELS_DIR, POSE_MODEL.file), provider: "cpu" });
    srv = await startServer({
      env: { HUB: "memory", PORT: "0", HOME_ID: "mokryeon_180b", RUNTIME_DIR: runtimeDir, PHONE_PORT: "0", PHONE_HOST: "127.0.0.1",
        BRAIN: "1", VLM_BASE_URL: `${fake.url}/v1`, ...pamLlmEnv(pam), OPENAI_API_KEY: "fake-key", OPENAI_BASE_URL: `${fake.url}/v1`,
        PAM_PERIOD_MS: "500", PAM_MIN_GAP_MS: "0" },
      brain: { detector },
      log: () => {},
    });
    const saved = await fetch(`${srv.url}/api/phone/start-pose`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ position: START, yaw_deg: 0 }) });
    expect(saved.status).toBe(200);

    const timeline: string[] = [];
    sockets.push(await openWebSocket(`${srv.url.replace(/^http/, "ws")}/events`, { setup: (ws) => ws.on("message", (d, bin) => {
      if (bin) return;
      const m = JSON.parse(String(d)) as Msg;
      if (m.type === "brain" && m.event.type === "world_change" && /^person_(appeared|gone)$/.test(m.event.kind)) timeline.push(m.event.kind);
      if (m.type === "brain" && m.event.type === "decision" && m.event.action) timeline.push(`decision:${m.event.action}`);
      if (m.type === "thought") for (const t of m.messages ?? []) timeline.push(`thought:${t.text}`);
    }) }));
    const phoneUrl = new URL(srv.phoneUrls[0]!);
    const phone: Msg[] = [];
    const ws = await openPhone(`ws://${phoneUrl.host}/phone/events`, { options: { origin: phoneUrl.origin }, setup: (w) => w.on("message", (d, bin) => {
      if (bin) return;
      const m = JSON.parse(String(d)) as Msg;
      phone.push(m);
      if (m.type === "command") timeline.push(`command:${m.id}:${m.text}`);
    }) });
    sockets.push(ws);
    const until = async (ok: () => boolean, what: string, ms = 90_000) => {
      for (const end = Date.now() + ms; Date.now() < end; await new Promise((r) => setTimeout(r, 50))) if (ok()) return;
      throw new Error(`${ms / 1000}초 안에 오지 않음: ${what} · 시간축 ${JSON.stringify(timeline)}`);
    };

    ws.send(JSON.stringify({ type: "reset", epoch: EPOCH }));
    ws.send(JSON.stringify({ type: "start", fixed: true, position: POSITION, orientation: ORIENTATION, epoch: EPOCH }));
    await until(() => phone.some((m) => m.type === "status" && m.aligned), "맞춤");

    // 250ms마다 영상 한 장(초당 4장), 12.25초부터는 그 장면
    pumping = true;
    void (async () => {
      for (let n = 0; pumping; n++) {
        const shot = shots[Math.min(n, HOLD)]!;
        const jpeg = n <= HOLD ? shot : Buffer.concat([shot, Buffer.from(`hold${n}`)]);
        ws.send(JSON.stringify({ type: "pose", position: POSITION, orientation: ORIENTATION, tracking: "ok", epoch: EPOCH }));
        ws.send(encodeFramePacket({ kind: "engine", width: 640, height: 360, position: POSITION, orientation: ORIENTATION, tracking: "ok", projection: PROJECTION,
          epoch: EPOCH, captured_at: Date.now(), time_err_ms: 0 }, jpeg));
        await new Promise((r) => setTimeout(r, 250));
      }
    })();

    // 사람이 나간 뒤 첫 계획 명령은 「식탁으로 가 주세요」
    const planCommands = () => phone.filter((m) => m.type === "command" && m.speak && String(m.id).startsWith("plan:"));
    await until(() => planCommands().length > 0, "첫 계획 명령", 120_000);
    const first = planCommands()[0]!;
    expect(first.text).toBe("식탁으로 가 주세요");
    // 「완료」로 가기를 넘기면 「컵을 들어 주세요」
    ws.send(JSON.stringify({ type: "answer", id: first.id, step: first.step, choice: "done" }));
    await until(() => planCommands().some((m) => m.text === "컵을 들어 주세요"), "컵을 들어 주세요");

    // 사람이 있는 동안(person_gone 전) 나간 명령은 없다: 사람이 컵을 쓰는 것(든 컵·마심)을 봐 생각 말풍선에 「사람이 … 지켜볼게요」를 올리고 기다렸다
    const gone = timeline.indexOf("person_gone");
    expect(gone, JSON.stringify(timeline)).toBeGreaterThan(0);
    expect(timeline.slice(0, gone).filter((t) => t.startsWith("command:")), JSON.stringify(timeline)).toEqual([]);
    expect(timeline.slice(0, gone).filter((t) => /^thought:사람이 .+ 지켜볼게요$/.test(t)), JSON.stringify(timeline)).toHaveLength(1);
    const kept = timeline.indexOf("decision:컵 그대로 두기");
    expect(kept).toBeGreaterThanOrEqual(0);
    expect(kept).toBeLessThan(gone);
    // 찾기·계획 밖 가까이 가서 보기 명령은 한 번도 나가지 않았다
    expect(phone.filter((m) => m.type === "command" && /^(find|peek):/.test(String(m.id)))).toEqual([]);
  }, 240_000);
});
