// 영상 모드 처음부터 끝까지(가짜 서버, 한양목련): 폰 페이지가 영상을 고정 카메라로 틀 때와 같은 메시지를 Node 소켓이 보낸다.
// 설정에서 저장한 시작 자리(식탁 1.5m 앞, 식탁을 봄)가 곧 카메라 자리라 reset → start fixed면 바로 맞춤(출처 video).
// 그 뒤 250ms마다 같은 epoch·자세·투영으로 pose와 엔진 프레임 → YOLO(대본: 처음 6장 사람+컵, 그 뒤 컵만)·VLM(가짜 OpenAI 호환 서버, 컵은 식탁 위)
// → World State → PAM(시험용 PAM 자리: 사람이 없고 컵이 남으면 컵 치우기) → 에이전트 계획 모드(가짜 서버 도구 호출) → 승인한 일이라 바로 첫 명령
// → 「완료」 네 번으로 네 단계 → 실행 done. 카메라가 움직이지 않으므로 이동 단계도 「완료」로 넘긴다. 면인 명령 대상(식탁·싱크대)은 윗면 가운데로 온다.
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type WebSocket from "ws";
import { startFakeOpenAI, type FakeServer } from "../scripts/fake-openai.js";
import type { Detection, Quat } from "../src/contract/observe.js";
import type { Vec3 } from "../src/shared/geometry.js";
import { encodeFramePacket } from "../src/phone/packet.js";
import { startServer, type RunningServer } from "../src/server/start.js";
import { ScriptedDetector, det } from "./helpers/detectors.js";
import { startFakePamLlm, type FakePamLlm, pamLlmEnv } from "./helpers/pam.js";
import { CUP_SCRIPTS, plannerRespond } from "./helpers/planner.js";
import { openPhone, openWebSocket } from "./helpers/ws.js";

type Msg = Record<string, any>;
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

// tests/mokryeon-e2e.test.ts와 같은 자리: 식탁 가운데([9.9612, 3.9242], 윗면 0.75m)에서 1.5m 떨어진 거실, 높이 1.5m에서 +x(시작 방향 0°)로 식탁 윗면 가운데를 향해 숙인다.
// 식탁·싱크대에서 1.2m 밖이라 이동 단계는 눈 자리로 넘어가지 않는다. 90° 시야 투영(열 우선), 컵 상자 아래 가운데가 480×360 화면 한가운데
const PROJECTION = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, -1.0002, -1, 0, 0, -0.020002, 0];
const TABLE: [number, number] = [9.9612, 3.9242];
const START: [number, number] = [TABLE[0] - 1.5, TABLE[1]];
const CUP: Detection = det("cup", 0.9, [220, 160, 40, 20], 41);
const PERSON: Detection = det("person", 0.9, [300, 40, 120, 300], 0);
const TABLE_ID = "dining_table_978b20c7";
// 영상 폰 자세: AR 원점 1.5m 높이, 방향은 그대로(서버가 시작 방향으로 맞춘다), 식탁 윗면 쪽으로 숙임만
const PITCH = Math.atan2(1.5 - 0.75, 1.5);
const POSITION: Vec3 = [0, 1.5, 0];
const ORIENTATION: Quat = [Math.sin(-PITCH / 2), 0, 0, Math.cos(-PITCH / 2)];
const EPOCH = "video-1";
const STEPS = ["식탁으로 가 주세요", "컵을 들어 주세요", "싱크대로 가 주세요", "컵을 싱크대에 넣어 주세요"];

describe("영상 모드 처음부터 끝까지", () => {
  it("고정 시작 자세는 바로 맞춤(video)이고, 사람이 사라진 뒤에만 컵 치우기 명령이 대상·거리와 함께 오며, 「완료」 네 번이면 실행이 끝난다", async () => {
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
    // 실제 PAM처럼 사람이 떠난 뒤 컵이 남았을 때 컵 치우기를 고른다. 사람이 보이면 대기
    pam = await startFakePamLlm({ predict: (b) => {
      const text = String(b.observation_text);
      return /컵 cup_\d/.test(text) && /^\[지속\] 사람 안 보임/m.test(text)
        ? { observation: "사람이 떠나고 빈 컵이 식탁에 남음", reasoning: "컵을 치운다", task_index: 0 }
        : { observation: "사람이 식탁에 있음", reasoning: "기다린다", task_index: -1 };
    } });
    const runtimeDir = mkdtempSync(join(tmpdir(), "rt-video-"));
    mkdirSync(join(runtimeDir, "homes", "mokryeon_180b"), { recursive: true });
    writeFileSync(join(runtimeDir, "homes", "mokryeon_180b", "approvals.json"), JSON.stringify({ always: { "task:컵 치우기": "2026-11-11T00:00:00.000Z" }, never: {} }));
    let calls = 0;
    srv = await startServer({
      env: { HUB: "memory", PORT: "0", HOME_ID: "mokryeon_180b", RUNTIME_DIR: runtimeDir, PHONE_PORT: "0", PHONE_HOST: "127.0.0.1",
        BRAIN: "1", VLM_BASE_URL: `${fake.url}/v1`, ...pamLlmEnv(pam), OPENAI_API_KEY: "fake-key", OPENAI_BASE_URL: `${fake.url}/v1`,
        PAM_PERIOD_MS: "500", PAM_MIN_GAP_MS: "0" },
      brain: { detector: new ScriptedDetector((): Detection[] => (++calls <= 12 ? [CUP, PERSON] : [CUP])) }, // 250ms 간격 12장(약 3초): 사람 등장은 처음 본 뒤 2초
      log: () => {},
    });
    // 설정 4단계에서 저장한 시작 자리: 식탁 1.5m 앞에서 식탁을 본다
    const saved = await fetch(`${srv.url}/api/phone/start-pose`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ position: START, yaw_deg: 0 }) });
    expect(saved.status).toBe(200);

    // 한 시간축: 사람 보임·사라짐(대시보드)과 실제 폰 명령
    const timeline: string[] = [];
    const dash: Msg[] = [];
    sockets.push(await openWebSocket(`${srv.url.replace(/^http/, "ws")}/events`, { setup: (ws) => ws.on("message", (d, bin) => {
      if (bin) return;
      const m = JSON.parse(String(d)) as Msg;
      dash.push(m);
      if (m.type === "brain" && m.event.type === "world_change" && /^person_(appeared|gone)$/.test(m.event.kind)) timeline.push(m.event.kind);
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
    const until = async (ok: () => boolean, what: string, ms = 15_000) => {
      for (const end = Date.now() + ms; Date.now() < end; await new Promise((r) => setTimeout(r, 20))) if (ok()) return;
      throw new Error(`${ms / 1000}초 안에 오지 않음: ${what} · 시간축 ${JSON.stringify(timeline)}`);
    };

    // 1 reset → start fixed: 바로 맞춤, 출처 video
    ws.send(JSON.stringify({ type: "reset", epoch: EPOCH }));
    ws.send(JSON.stringify({ type: "start", fixed: true, position: POSITION, orientation: ORIENTATION, epoch: EPOCH }));
    await until(() => phone.some((m) => m.type === "status" && m.aligned), "맞춤");
    expect(phone.filter((m) => m.type === "status").at(-1)).toMatchObject({ aligned: true, sync: { state: "aligned", source: "video", started: true } });
    expect(phone.some((m) => m.type === "status" && m.error)).toBe(false);

    // 영상 폰: 250ms마다 같은 epoch·자세·투영으로 pose와 엔진 프레임
    pumping = true;
    void (async () => {
      for (let n = 0; pumping; n++) {
        ws.send(JSON.stringify({ type: "pose", position: POSITION, orientation: ORIENTATION, tracking: "ok", epoch: EPOCH }));
        ws.send(encodeFramePacket({ kind: "engine", width: 480, height: 360, position: POSITION, orientation: ORIENTATION, tracking: "ok", projection: PROJECTION,
          epoch: EPOCH, captured_at: Date.now(), time_err_ms: 0 }, Buffer.from([0xff, 0xd8, n % 256, n >> 8])));
        await new Promise((r) => setTimeout(r, 250));
      }
    })();

    // 2 첫 명령: 사람이 사라진 뒤에만, 대상(식탁 AR 자리)과 식탁까지 거리
    const spoken = () => phone.filter((m) => m.type === "command" && m.speak);
    await until(() => spoken().length > 0, "첫 명령");
    const first = spoken()[0]!;
    expect(first.text).toBe(STEPS[0]);
    expect(first.target).not.toBeNull();
    expect(first.target).toMatchObject({ id: TABLE_ID, ar: expect.any(Array) });
    expect(first.vision).toMatch(/^식탁까지 \d+\.\dm$/);
    expect(first.choices).toEqual([{ id: "done", label: "완료" }]);
    const appeared = timeline.indexOf("person_appeared"), gone = timeline.indexOf("person_gone");
    const firstCommand = timeline.findIndex((t) => t.startsWith("command:"));
    expect(appeared).toBeGreaterThanOrEqual(0);
    expect(gone).toBeGreaterThan(appeared);
    expect(firstCommand).toBeGreaterThan(gone);
    // PAM은 사람이 보일 때도 불렸고(대기), 컵 치우기는 사람이 없을 때 골랐다
    const texts = pam.bodies.map((b) => String(b.observation_text ?? ""));
    expect(texts.some((t) => /^\[지속\] 사람 보임/m.test(t) && /컵 cup_\d/.test(t))).toBe(true);
    // 고정 자세로 본 컵은 식탁 위다(맞춘 카메라라 World State가 자리를 정한다)
    const cup = dash.filter((m) => m.type === "world").at(-1)!.world.objects.find((o: Msg) => o.cls === "cup");
    expect(cup).toMatchObject({ surface: TABLE_ID });

    // 3 「완료」 네 번 → 네 단계 → 실행 done
    const planId = first.id as string;
    for (const [i, text] of STEPS.entries()) {
      await until(() => spoken().some((m) => m.id === planId && m.text === text), text);
      const cmd = spoken().find((m) => m.id === planId && m.text === text)!;
      expect(cmd.step).toBe(`${planId}:${i + 1}`);
      ws.send(JSON.stringify({ type: "answer", id: planId, step: cmd.step, choice: "done" }));
    }
    await until(() => phone.some((m) => m.type === "command_clear" && m.id === planId), "명령 지우기");
    await until(() => dash.some((m) => m.type === "brain" && m.event.type === "execution" && m.event.plan_id === planId && m.event.state === "done"), "실행 done");
    await until(() => dash.some((m) => m.type === "plan" && m.plan?.id === planId && m.plan.status === "done"), "계획 done");
    expect(spoken().filter((m) => m.id === planId).map((m) => m.text)).toEqual(STEPS);

    // 4 면(식탁·싱크대)인 명령 대상은 배치 상자 가운데가 아니라 윗면 가운데다: 식탁 윗면 0.75m, 싱크대 윗면 0.9m(영상 폰 바닥은 AR y 0).
    // 싱크볼이 있는 싱크대는 조리대 가운데([5.853, 0.761])가 아니라 싱크볼 가운데([5.86, 0.693])다. 수평 거리는 시작 자리(AR 원점)에서 잰 것과 같다
    const targetOf = (text: string) => spoken().find((m) => m.id === planId && m.text === text)!.target;
    expect(first.target.ar[1]).toBeCloseTo(0.75, 3);
    for (const text of [STEPS[2]!, STEPS[3]!]) {
      const t = targetOf(text);
      expect(t.id).toBe("sink_counter_kitchen");
      expect(t.ar[1]).toBeCloseTo(0.9, 3);
      expect(Math.hypot(t.ar[0], t.ar[2])).toBeCloseTo(Math.hypot(START[0] - 5.86, START[1] - 0.693), 3);
    }

    // 5 대시보드 눈은 모두 맞춘 눈(estimated 없음), 시작 자리에서 시작 방향
    const eyes = dash.filter((m) => m.type === "eye").map((m) => m.eye);
    expect(eyes.length).toBeGreaterThan(0);
    for (const e of eyes) {
      expect(e.estimated).toBeUndefined();
      expect(Math.hypot(e.position[0] - START[0], e.position[1] - START[1])).toBeLessThan(0.01);
      expect(((e.yaw_deg + 540) % 360) - 180).toBeCloseTo(0, 0);
    }
  }, 60_000);
});
