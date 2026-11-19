// 관찰 → 판단 → 실제 폰 컵 치우기. 입력만 대본이고 통로·실행·WebSocket은 실제와 같다.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type WebSocket from "ws";
import { startFakeOpenAI } from "../../scripts/fake-openai.js";
import { startServer } from "../../src/server/start.js";
import { fetchRetry } from "../../src/shared/net.js";
import type { HistoryRow } from "../../src/contract/history.js";
import type { Detection } from "../../src/contract/observe.js";
import { useLearnedMemory } from "./memory.js";
import { startFakePamLlm, pamLlmEnv } from "./pam.js";
import { CUP_SCRIPTS, plannerRespond } from "./planner.js";
import { openPhone, openWebSocket } from "./ws.js";
import { ScriptedDetector, det } from "./detectors.js";
import { alignPhone, CUP_BOX, frameOf, SINK_VIEW, topLook } from "./top-look.js";

type Msg = Record<string, any>;
const inbox = (list: Msg[]) => (ws: WebSocket) => ws.on("message", (d, binary) => { if (!binary) list.push(JSON.parse(String(d))); });
export async function cupSession(hooks: { openBus?: NonNullable<Parameters<typeof startServer>[0]>["openBus"]; phone?: (m: Msg) => void } = {}) {
  const cleanup: (() => unknown)[] = [];
  const release = (cb: () => unknown) => cleanup.push(cb);
  const close = async () => { for (const cb of cleanup.splice(0).reverse()) await cb(); };
  try {
    // 사람 하는 일(VLM 사실): 처음에는 컵으로 마시다 떠나고, 컵을 치운 뒤에는 먹다가 떠난다(먹는 중도 마시는 중 상태라 떠남 화살표가 켜진다. 컵을 쓰지 않아 목표는 서지 않는다)
    const people: Detection[] = [];
    const top = topLook();
    const scene = { cupPlace: "on_table", atSink: false, personAct: "drinking", above: null as [number, number, number] | null };
    const fake = await startFakeOpenAI({
      reply: (body) => {
        const seen = top.reply(body);
        if (seen) return seen;
        if (body?.response_format?.json_schema?.name !== "scene_observation") return null;
        const parts = (body.messages as { role: string; content: unknown }[]).filter((m) => m.role === "user").flatMap((m) => (Array.isArray(m.content) ? m.content : [{ text: m.content }]));
        const text = parts.map((p: { text?: unknown }) => (typeof p.text === "string" ? p.text : "")).join("\n");
        const dets = JSON.parse(/Detections: (\[.*\])/.exec(text)?.[1] ?? "[]") as { id: string; class: string }[];
        return JSON.stringify({ scene: "kitchen", observations: dets.map((d) => ({ object_id: d.id, state: d.class === "person" ? scene.personAct : scene.cupPlace })), summary: "컵" });
      },
      // 에이전트 계획 모드: 같은 가짜 서버가 컵 치우기 도구 호출(지금 서버와 같은 네 단계)을 낸다
      respond: plannerRespond(CUP_SCRIPTS),
    });
    release(() => fake.close());
    // PAM은 기본 주기(5초)로 불린다. 관찰 텍스트에 컵이 있으면 컵 치우기를 고르고(끝난 뒤에도: 싱크대 안 컵으로는 새 명령을 보내지 않아야 한다), 없으면 대기
    const pam = await startFakePamLlm({ predict: (b) => (/컵 cup_\d/.test(String(b.observation_text))
      ? { observation: "빈 컵이 식탁에 남음", reasoning: "자리를 비워 컵을 치운다", task_index: 0 } : { observation: "컵 없음", reasoning: "할 일 없음", task_index: -1 }) });
    release(() => pam.close());
    // 처음 하는 컵 치우기도 승인을 묻지 않고 첫 명령부터(2026-11-18 사용자 결정: 처음 하는 일 묻기 끔, 기본 집 apartment). 승인 기억 파일도 쓰지 않는다.
    // 묻는 길은 tests/mokryeon-e2e.test.ts·tests/act-track.test.ts가 askFirst로 켜서 본다
    const runtimeDir = mkdtempSync(join(tmpdir(), "rt-"));
    // 치우기를 보는 시험은 배운 뒤 기억(합성 3일째부터의 로봇 FSM)으로 돈다. seed 기억이면 떠날 때 묻는다
    useLearnedMemory(runtimeDir);
    const srv = await startServer({
      openBus: hooks.openBus,
      env: { HUB: "memory", PORT: "0", RUNTIME_DIR: runtimeDir, PHONE_PORT: "0", PHONE_HOST: "127.0.0.1",
        BRAIN: "1", VLM_BASE_URL: `${fake.url}/v1`, ...pamLlmEnv(pam), OPENAI_API_KEY: "fake-key", OPENAI_BASE_URL: `${fake.url}/v1` },
      brain: { detector: new ScriptedDetector(top.detect(() => [...people, det("cup", 0.9, CUP_BOX, 41)])) }, log: () => {},
    });
    release(() => srv.close());
    const dash: Msg[] = [];
    const dashSocket = await openWebSocket(`${srv.url.replace(/^http/, "ws")}/events`, { setup: inbox(dash) });
    release(() => { dashSocket.close(); });
    const phoneUrl = new URL(srv.phoneUrls[0]!);
    const phone: Msg[] = [];
    const ws = await openPhone(`ws://${phoneUrl.host}/phone/events`, { options: { origin: phoneUrl.origin }, setup: (ws) => { inbox(phone)(ws); ws.on("message", (data, binary) => { if (!binary) hooks.phone?.(JSON.parse(String(data))); }); } });
    release(() => { ws.close(); });
    await alignPhone(srv, ws, phone, dash);
    let n = 0;
    // 조건이 맞을 때까지 엔진 프레임을 150ms마다 보낸다(판단 뒤에도 대상을 다시 보도록, 최대 15초)
    const pump = async (until: () => boolean | Promise<boolean>) => {
      for (const end = Date.now() + 15_000; Date.now() < end; ) {
        if (await until()) return;
        ws.send(frameOf(top, scene.above, n++, scene.atSink ? SINK_VIEW : undefined));
        await new Promise((r) => setTimeout(r, 150));
      }
      throw new Error("조건이 15초 안에 맞지 않음");
    };
    const history = async (kinds: string) => ((await (await fetchRetry(`${srv!.url}/api/history?kinds=${kinds}`)).json()) as { ok: boolean; rows: HistoryRow[] });
    const said = (text: string) => phone.find((m) => m.type === "command" && m.speak && m.text === text);

    return { scene, people, fake, pam, srv, dash, phone, ws, pump, said, history, runtimeDir, close };
  } catch (e) { await close(); throw e; }
}
