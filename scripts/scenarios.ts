// 데모 시나리오: 실행 중인 서버의 REST 에이전트(/api/agent/chat)로 한국어 요청을 보내고, 허브 상태·WS 이벤트로 확인한다.
// npm run demo와 tests/e2e.test.ts가 함께 쓴다.

import WebSocket from "ws";
import type { DeviceHub, DeviceSpec, DeviceState } from "../src/contract/devices.js";
import { fetchRetry } from "../src/shared/net.js";

export interface ScenarioRow {
  no: string;
  say: string;
  expect: string;
  reply: string;
  /** 이 단계 동안 받은 WS state 이벤트 수. */
  ws: number;
  /** 이 단계 뒤 관련 기기의 Matter 속성 요약. */
  matter: string;
  pass: boolean;
}

export interface ScenarioOptions {
  url: string;
  hub: DeviceHub;
  devices: DeviceSpec[];
  sessionId?: string;
}

interface ChatReply {
  reply?: string;
  error?: string;
  pendingConfirmations?: { token: string }[];
}

export async function runScenarios(opts: ScenarioOptions): Promise<ScenarioRow[]> {
  const { url, hub, devices } = opts;
  const sessionId = opts.sessionId ?? "demo";

  // WS 상태 이벤트 세기(접속 직후 보내는 전체 상태 스냅숏은 세지 않는다)
  let wsEvents = 0;
  let counting = false;
  const seen: string[] = []; // 센 state 이벤트의 기기 id(순서대로)
  const ws = new WebSocket(url.replace(/^http/, "ws") + "/events");
  ws.on("message", (data) => {
    const m = JSON.parse(String(data)) as { type: string; state?: { id: string } };
    if (m.type === "state" && counting) {
      wsEvents += 1;
      seen.push(m.state!.id);
    }
  });
  await new Promise<void>((resolve, reject) => {
    ws.once("open", () => resolve());
    ws.once("error", reject);
  });
  await sleep(300);
  counting = true;

  const post = async <T>(path: string, body: unknown): Promise<T> => {
    const res = await fetchRetry(url + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    return (await res.json()) as T;
  };
  const chat = async (message: string) => post<ChatReply>("/api/agent/chat", { message, sessionId });
  const st = (d: DeviceSpec): DeviceState => hub.get(d.id)!;
  const pick = (kind: string, room?: string) => devices.filter((d) => d.kind === kind && (!room || d.room === room));
  const matterOf = (list: DeviceSpec[], keys: string[]) =>
    list.map((d) => `${d.id} ${keys.filter((k) => k in st(d).matter).map((k) => `${k}=${st(d).matter[k]}`).join(",")}`).join("; ");

  const livingLights = pick("light", "living_room");
  const tv = pick("tv", "living_room")[0] ?? pick("tv")[0]!;
  const ac = pick("aircon", "living_room")[0] ?? pick("aircon")[0]!;
  const curtain = pick("covering", "bedroom")[0]!;
  const lock = pick("lock")[0]!;

  const rows: ScenarioRow[] = [];
  const snapshot = () => new Map(hub.states().map((x) => [x.id, JSON.stringify([x.twin, x.matter])]));

  async function step(no: string, say: string, expect: string, run: () => Promise<string>, check: () => boolean, matter: () => string): Promise<void> {
    const before = wsEvents;
    const from = seen.length;
    const prev = snapshot();
    let reply: string;
    try {
      reply = await run();
    } catch (e) {
      reply = `오류: ${(e as Error).message}`;
    }
    // 허브에서 바뀐 기기마다 WS 이벤트가 올 때까지 기다린다(고정 시간으로 자르면 바쁜 PC에서 다음 단계로 넘어간다)
    const changed = [...snapshot()].filter(([id, v]) => prev.get(id) !== v).map(([id]) => id);
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline && !changed.every((id) => seen.indexOf(id, from) >= 0)) await sleep(20);
    await sleep(50);
    rows.push({ no, say, expect, reply, ws: wsEvents - before, matter: matter(), pass: check() });
  }

  try {
    await step("1", "거실 TV 켜줘", `${tv.label} 켜짐`, async () => (await chat("거실 TV 켜줘")).reply ?? "",
      () => st(tv).twin.power === "on", () => matterOf([tv], ["onOff"]));
    await step("2", "거실 불 켜고 TV 꺼줘", `거실 조명 ${livingLights.length}개 켜짐·TV 꺼짐`, async () => (await chat("거실 불 켜고 TV 꺼줘")).reply ?? "",
      () => livingLights.length > 0 && livingLights.every((d) => st(d).twin.power === "on") && st(tv).twin.power === "off",
      () => matterOf([...livingLights, tv], ["onOff"]));
    await step("3", "에어컨 24도로 맞춰줘", `${ac.label} 켜짐·24°C`, async () => (await chat("에어컨 24도로 맞춰줘")).reply ?? "",
      () => st(ac).twin.power === "on" && st(ac).matter.setpointC === 24, () => matterOf([ac], ["onOff", "systemMode", "setpointC"]));
    await step("4", "안방 커튼 닫아줘", `${curtain.label} 닫힘`, async () => (await chat("안방 커튼 닫아줘")).reply ?? "",
      () => Object.values(st(curtain).twin).includes("closed"), () => matterOf([curtain], ["openPercent"]));
    let token = "";
    await step("5a", "현관문 열어줘", "승인 요청, 아직 잠김", async () => {
      const r = await chat("현관문 열어줘");
      token = r.pendingConfirmations?.[0]?.token ?? "";
      return r.reply ?? r.error ?? "";
    }, () => token !== "" && st(lock).twin.lock === "locked", () => matterOf([lock], ["lockState"]));
    await step("5b", "(승인 버튼)", "잠금 해제됨", async () => {
      const r = await post<{ reply?: string; error?: string }>("/api/agent/confirm", { token });
      return r.reply ?? r.error ?? "";
    }, () => st(lock).twin.lock === "unlocked", () => matterOf([lock], ["lockState"]));
  } finally {
    ws.close();
  }
  return rows;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
