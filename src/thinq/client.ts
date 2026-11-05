// LG ThinQ Connect 클라이언트. 주소·머리글·경로는 LG 공식 SDK(github.com/thinq-connect/pythinqconnect, thinq_api.py)와 같다.
//   GET devices · GET devices/{id}/state · POST devices/{id}/control(x-conditional-control: true)
//   성공 { messageId, timestamp, response }, 실패 { messageId, timestamp, error: { code, message } }
// 토큰(PAT)은 THINQ_TOKEN으로만 받고, 오류 글에서 지운다. 실제 모드(src/server/start.ts)에서만 만든다.

import { randomUUID } from "node:crypto";
import type { ThinqDeviceView } from "../contract/setup.js";
import { fetchRetry } from "../server/net.js";

type Env = Record<string, string | undefined>;

/** LG 공식 SDK(thinqconnect/const.py API_KEY)의 공개 값. THINQ_API_KEY로 바꾼다. */
const SDK_API_KEY = "v6GFvkweNo7DK7yD3ylIZ9w52aKBU0eJ7wLXkSR3";
const REGIONS = new Set(["kic", "aic", "eic"]);
const DEFAULT_TIMEOUT_MS = 10_000;

export interface ThinqConfig {
  /** 끝에 /가 붙은 API 주소. */
  baseUrl: string;
  token: string;
  /** x-country(두 글자). */
  country: string;
  clientId: string;
  apiKey: string;
  timeoutMs: number;
}

export class ThinqError extends Error {
  /** HTTP 상태(닿지 못하면 0). code는 ThinQ 오류 코드(닿지 못하면 network). */
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message);
    this.name = "ThinqError";
  }
}

/** THINQ_TOKEN(필수), THINQ_REGION(kic·aic·eic, 기본 kic), THINQ_COUNTRY(기본 KR), THINQ_CLIENT_ID, THINQ_API_KEY, THINQ_BASE_URL, THINQ_TIMEOUT_MS. */
export function thinqConfig(env: Env): { ok: true; config: ThinqConfig } | { ok: false; error: string } {
  const token = env.THINQ_TOKEN?.trim();
  if (!token) return { ok: false, error: "ThinQ 토큰이 없어요." };
  const region = env.THINQ_REGION?.trim().toLowerCase() || "kic";
  if (!REGIONS.has(region)) return { ok: false, error: `ThinQ 지역 값이 맞지 않아요: ${region}` };
  const base = env.THINQ_BASE_URL?.trim() || `https://api-${region}.lgthinq.com/`;
  const timeout = Number(env.THINQ_TIMEOUT_MS);
  return {
    ok: true,
    config: {
      baseUrl: base.endsWith("/") ? base : `${base}/`,
      token,
      country: env.THINQ_COUNTRY?.trim().toUpperCase() || "KR",
      clientId: env.THINQ_CLIENT_ID?.trim() || randomUUID(),
      apiKey: env.THINQ_API_KEY?.trim() || SDK_API_KEY,
      timeoutMs: Number.isFinite(timeout) && timeout > 0 ? timeout : DEFAULT_TIMEOUT_MS,
    },
  };
}

/** uuid4 16바이트를 base64url로(끝 == 없이 22자). SDK의 _generate_message_id와 같다. */
function messageId(): string {
  return Buffer.from(randomUUID().replace(/-/g, ""), "hex").toString("base64url");
}

interface RawDevice {
  deviceId?: unknown;
  deviceInfo?: { deviceType?: unknown; modelName?: unknown; alias?: unknown };
}

const text = (v: unknown) => (typeof v === "string" ? v : "");

export class ThinqClient {
  constructor(private readonly cfg: ThinqConfig) {}

  async devices(): Promise<ThinqDeviceView[]> {
    const list = await this.request("GET", "devices");
    if (!Array.isArray(list)) return [];
    return (list as RawDevice[]).filter((d) => typeof d?.deviceId === "string" && d.deviceId).map((d) => {
      const info = d.deviceInfo ?? {};
      return { id: d.deviceId as string, type: text(info.deviceType), name: text(info.alias) || text(info.modelName) || (d.deviceId as string), model: text(info.modelName) };
    });
  }

  async state(id: string): Promise<Record<string, unknown>> {
    const s = await this.request("GET", `devices/${encodeURIComponent(id)}/state`);
    return s && typeof s === "object" && !Array.isArray(s) ? s as Record<string, unknown> : {};
  }

  /** 명령을 보낸다. 돌아오면 ThinQ가 받은 것이다(적용됐는지는 state로 다시 읽어 본다). */
  async control(id: string, body: Record<string, unknown>): Promise<unknown> {
    return this.request("POST", `devices/${encodeURIComponent(id)}/control`, body, { "x-conditional-control": "true" });
  }

  private async request(method: "GET" | "POST", path: string, body?: unknown, extra: Record<string, string> = {}): Promise<unknown> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.cfg.token}`,
      "x-country": this.cfg.country,
      "x-message-id": messageId(),
      "x-client-id": this.cfg.clientId,
      "x-api-key": this.cfg.apiKey,
      "x-service-phase": "OP",
      accept: "application/json",
      ...(body === undefined ? {} : { "content-type": "application/json" }),
      ...extra,
    };
    let res: Response;
    try {
      // 이 PC의 연결 EFAULT만 다시 시도한다(연결 전이라 명령이 두 번 가지 않는다)
      res = await fetchRetry(`${this.cfg.baseUrl}${path}`, {
        method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(this.cfg.timeoutMs),
      });
    } catch (e) {
      throw new ThinqError(0, "network", this.clean(`ThinQ에 닿지 못했어요: ${(e as Error).message}`));
    }
    const payload = (await res.json().catch(() => null)) as { response?: unknown; error?: { code?: unknown; message?: unknown } } | null;
    if (!res.ok || payload?.error) {
      const code = String(payload?.error?.code ?? res.status);
      const message = text(payload?.error?.message) || res.statusText;
      throw new ThinqError(res.status, code, this.clean(`ThinQ ${code}: ${message}`));
    }
    return payload?.response;
  }

  /** 오류 글에 토큰이 섞이지 않게 지운다. */
  private clean(s: string): string {
    return s.split(this.cfg.token).join("***");
  }
}
