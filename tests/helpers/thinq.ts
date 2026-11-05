// 가짜 ThinQ Connect 서버(127.0.0.1, 빈 포트). 시험은 실제 ThinQ 대신 이 서버만 부른다(THINQ_BASE_URL).
// 받은 요청을 모두 적어 두고, 기기마다 명령을 적용·무시·거부하거나 상태 읽기를 실패하게 할 수 있다.

import { createServer, type IncomingHttpHeaders } from "node:http";

/** apply: 받아서 상태를 바꿈, ignore: 받기만 함, reject: 거부, fail-read: 상태 읽기 실패. */
export type FakeBehavior = "apply" | "ignore" | "reject" | "fail-read";

export interface FakeRequest {
  method: string;
  path: string;
  headers: IncomingHttpHeaders;
  body: unknown;
}

export interface FakeThinqDevice {
  deviceId: string;
  deviceInfo: { deviceType: string; modelName: string; alias: string };
}

export interface FakeThinq {
  /** 끝에 /가 붙은 주소(THINQ_BASE_URL). */
  url: string;
  requests: FakeRequest[];
  devices: FakeThinqDevice[];
  states: Record<string, Record<string, unknown>>;
  behavior: Record<string, FakeBehavior>;
  /** 거부할 때 돌려줄 글. */
  rejectMessage: string;
  /** 명령 응답을 이만큼 늦춘다(겹친 명령 시험). */
  controlDelayMs: number;
  /** 명령(POST) 요청만. */
  controls(): FakeRequest[];
  close(): Promise<void>;
}

export const FAKE_AC = "thinq-ac-1";
export const FAKE_FRIDGE = "thinq-fridge-1";

export function fakeAirconState(): Record<string, unknown> {
  return {
    operation: { airConOperationMode: "POWER_ON" },
    airConJobMode: { currentJobMode: "COOL" },
    temperatureInUnits: [
      { unit: "C", currentTemperature: 27, targetTemperature: 24 },
      { unit: "F", currentTemperature: 80, targetTemperature: 75 },
    ],
    airFlow: { windStrength: "AUTO" },
  };
}

/** 명령 본문을 상태에 합친다. 배열 자원(temperatureInUnits)은 같은 unit 항목을 고친다. */
function applyBody(state: Record<string, unknown>, body: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(body)) {
    const cur = state[key];
    if (Array.isArray(cur) && value && typeof value === "object") {
      const v = value as Record<string, unknown>;
      const hit = cur.find((e) => (e as Record<string, unknown>).unit === (v.unit ?? "C")) as Record<string, unknown> | undefined;
      if (hit) Object.assign(hit, v);
    } else if (cur && typeof cur === "object" && value && typeof value === "object") {
      Object.assign(cur, value);
    } else {
      state[key] = structuredClone(value);
    }
  }
}

export async function startFakeThinq(): Promise<FakeThinq> {
  const fake: Omit<FakeThinq, "url" | "close"> = {
    requests: [],
    devices: [
      { deviceId: FAKE_AC, deviceInfo: { deviceType: "DEVICE_AIR_CONDITIONER", modelName: "FQ18", alias: "거실 에어컨" } },
      { deviceId: FAKE_FRIDGE, deviceInfo: { deviceType: "DEVICE_REFRIGERATOR", modelName: "M874", alias: "냉장고" } },
    ],
    states: {
      [FAKE_AC]: fakeAirconState(),
      [FAKE_FRIDGE]: { doorStatus: [{ locationName: "MAIN", doorState: "CLOSE" }] },
    },
    behavior: {},
    rejectMessage: "Device is not in a controllable state",
    controlDelayMs: 0,
    controls() {
      return this.requests.filter((r) => r.method === "POST");
    },
  };
  const ok = (response: unknown) => ({ messageId: "fake", timestamp: new Date().toISOString(), response });
  const fail = (code: string, message: string) => ({ messageId: "fake", timestamp: new Date().toISOString(), error: { code, message } });

  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", async () => {
      const text = Buffer.concat(chunks).toString("utf8");
      const body = text ? JSON.parse(text) as unknown : undefined;
      const path = new URL(req.url ?? "/", "http://fake").pathname.replace(/^\//, "");
      fake.requests.push({ method: req.method ?? "", path, headers: req.headers, body });
      const send = (status: number, payload: unknown) => {
        res.writeHead(status, { "content-type": "application/json" });
        res.end(JSON.stringify(payload));
      };
      const m = path.match(/^devices\/([^/]+)\/(state|control)$/);
      if (req.method === "GET" && path === "devices") return send(200, ok(fake.devices));
      if (!m) return send(404, fail("1101", "Not found"));
      const id = decodeURIComponent(m[1]!);
      const state = fake.states[id];
      if (!state) return send(404, fail("1222", "Device not found"));
      const behavior = fake.behavior[id] ?? "apply";
      if (m[2] === "state") {
        if (req.method !== "GET") return send(405, fail("1100", "Method not allowed"));
        if (behavior === "fail-read") return send(500, fail("1500", "Device state is not available"));
        return send(200, ok(structuredClone(state)));
      }
      if (req.method !== "POST") return send(405, fail("1100", "Method not allowed"));
      if (fake.controlDelayMs > 0) await new Promise((r) => setTimeout(r, fake.controlDelayMs));
      if (behavior === "reject") return send(400, fail("2207", fake.rejectMessage));
      if (behavior === "apply") applyBody(state, body as Record<string, unknown>);
      return send(200, ok({}));
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const { port } = server.address() as { port: number };
  return Object.assign(fake, {
    url: `http://127.0.0.1:${port}/`,
    close: () => new Promise<void>((r) => { server.closeAllConnections(); server.close(() => r()); }),
  });
}
