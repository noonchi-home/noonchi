// TV 중계 HTTP 클라이언트. 중계는 실제 TV 옆 노트북에서 도는 지훈 님 tvrelay(Python)다.
// 원본: noonchi-home/experiment jihoon/2026-11-24_lg-tv-infrared-relay(code/tvrelay/server.py, code/noonchi-relay/feat-tv-relay.diff).
// 켜기·끄기는 아두이노 적외선, 켜짐·꺼짐은 TV 와이파이(NetCast 8080) 응답으로 본다. 빛 센서가 없는 장비용이다.
//   GET  {TV_RELAY_URL}/api/devices/{기기}          → { power: "on"|"off"|"unknown", since, online, ir }
//   POST {TV_RELAY_URL}/api/devices/{기기}/command  { type: "on"|"off" } → { ok, outcome: done|unverified|failed|not_sent, power, error? }
//   한 번에 한 명령(앞 명령 중이면 409 not_sent). 모든 요청에 Authorization: Bearer {TV_RELAY_TOKEN}. 응답이 없으면(시간 초과·끊김) status 0.
// 토큰은 요청 머리에만 쓴다: 중계가 돌려준 글·오류 글에 섞여 와도 지우고 넘긴다(로그·/api·대시보드로 나가지 않게).

import { headWithin } from "../../shared/cut.js";
import { fetchRetry, isLoopbackHost } from "../../shared/net.js";

/** 중계가 본 상태. unknown: 중계가 아직 TV 응답을 확인하지 못함. */
export interface RelayState {
  power: "on" | "off" | "unknown";
  /** 마지막으로 바뀐 시각(ISO). */
  since?: string | null;
}

/** 중계 명령 결과. done: 다시 확인함, unverified: 쏘았지만 확인 안 됨, failed: 쏘지 못함, not_sent: 보내지 않음. */
export interface RelayCommandResult {
  ok: boolean;
  outcome: "done" | "unverified" | "failed" | "not_sent";
  power?: RelayState["power"];
  error?: string;
}

export interface RelayConfig {
  baseUrl: string;
  token: string;
  /** 중계 쪽 기기 이름(경로의 {기기}). 기본 "tv". */
  target: string;
  /** 중계와 짝지을 트윈 기기 id(TV_RELAY_DEVICE, 예: tv_1). */
  deviceId: string;
  /** 상태 읽기 한도(ms). */
  timeoutMs: number;
  /** 명령 한도(ms). 적외선 켜기는 TV 부팅(5~6초)·와이파이 확인까지 기다려서 길다. */
  commandTimeoutMs: number;
}

export class RelayError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "RelayError";
  }
}

type Env = Record<string, string | undefined>;
const DEFAULT_TIMEOUT_MS = 3000;
const DEFAULT_COMMAND_TIMEOUT_MS = 45_000;
const HIDDEN = "[토큰]";

/** Tailscale이 기기에 주는 주소(100.64.0.0/10). */
function isTailscaleIp(host: string): boolean {
  const m = /^100\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  return !!m && Number(m[1]) >= 64 && Number(m[1]) <= 127 && m.slice(2).every((x) => Number(x) <= 255);
}

/** 평문(http)으로 보내도 되는 중계 주소: 이 PC(루프백)이거나 Tailscale 안(100.64.0.0/10, *.ts.net). 와이파이 주소는 아니다. */
function plainAllowed(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return isLoopbackHost(host) || isTailscaleIp(host) || /^[a-z0-9-]+(\.[a-z0-9-]+)*\.ts\.net$/.test(host);
}

/** TV_RELAY_URL이 없으면 { ok: false, off: true }(중계 안 씀). 있는데 틀리면 까닭(서버가 시작하지 않는다). 오류 글에 주소·토큰을 옮기지 않는다. */
export function relayConfig(env: Env): { ok: true; config: RelayConfig } | { ok: false; off: boolean; error: string } {
  const url = env.TV_RELAY_URL?.trim();
  if (!url) return { ok: false, off: true, error: "TV_RELAY_URL이 없어요." };
  const parsed = URL.parse(url);
  if (!parsed || (parsed.protocol !== "http:" && parsed.protocol !== "https:")) return { ok: false, off: false, error: "TV_RELAY_URL은 http(s) 주소여야 해요." };
  if (parsed.username || parsed.password) return { ok: false, off: false, error: "TV_RELAY_URL에 아이디·비밀번호를 넣지 마세요. 인증은 TV_RELAY_TOKEN으로 해요." };
  if (parsed.protocol === "http:" && !plainAllowed(parsed.hostname)) {
    return { ok: false, off: false, error: "TV_RELAY_URL은 https이거나 Tailscale 주소(100.64.0.0/10, *.ts.net)여야 해요. 와이파이 주소로는 보내지 않아요." };
  }
  const token = env.TV_RELAY_TOKEN?.trim();
  if (!token) return { ok: false, off: false, error: "TV_RELAY_TOKEN이 없어요(중계와 같은 값)." };
  const deviceId = env.TV_RELAY_DEVICE?.trim();
  if (!deviceId) return { ok: false, off: false, error: "TV_RELAY_DEVICE가 없어요(짝지을 트윈 TV id, 예: tv_1)." };
  const ms = (raw: string | undefined, fallback: number) => {
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n : fallback;
  };
  return {
    ok: true,
    config: {
      baseUrl: url.replace(/\/+$/, ""), token, target: env.TV_RELAY_TARGET?.trim() || "tv",
      deviceId,
      timeoutMs: ms(env.TV_RELAY_TIMEOUT_MS, DEFAULT_TIMEOUT_MS),
      commandTimeoutMs: ms(env.TV_RELAY_COMMAND_TIMEOUT_MS, DEFAULT_COMMAND_TIMEOUT_MS),
    },
  };
}

export class RelayClient {
  constructor(private readonly config: RelayConfig) {}

  get target(): string {
    return this.config.target;
  }

  async state(target = this.config.target): Promise<RelayState> {
    const body = await this.request("GET", `/api/devices/${encodeURIComponent(target)}`, undefined, this.config.timeoutMs);
    const power = (body as { power?: unknown }).power;
    if (power !== "on" && power !== "off" && power !== "unknown") throw new RelayError(`중계 답에 power가 없어요: ${this.clip(JSON.stringify(body), 120)}`, 200);
    const since = (body as { since?: unknown }).since;
    return { power, since: typeof since === "string" ? since : null };
  }

  async command(type: "on" | "off", target = this.config.target): Promise<RelayCommandResult> {
    const body = await this.request("POST", `/api/devices/${encodeURIComponent(target)}/command`, { type }, this.config.commandTimeoutMs) as Partial<RelayCommandResult>;
    const outcome = body.outcome;
    if (outcome !== "done" && outcome !== "unverified" && outcome !== "failed" && outcome !== "not_sent") {
      throw new RelayError(`중계 답에 outcome이 없어요: ${this.clip(JSON.stringify(body), 120)}`, 200);
    }
    const power = body.power === "on" || body.power === "off" || body.power === "unknown" ? body.power : undefined;
    return { ok: !!body.ok, outcome, power, ...(typeof body.error === "string" ? { error: this.clip(body.error, 200) } : {}) };
  }

  /** 글에 섞인 토큰(그대로·JSON 글 안 모양)을 지운다. */
  private hide(text: string): string {
    const quoted = JSON.stringify(this.config.token).slice(1, -1);
    return text.split(this.config.token).join(HIDDEN).split(quoted).join(HIDDEN);
  }

  /** 토큰을 지운 뒤 max자로 자른다(자르고 지우면 토큰 앞부분이 남는다). */
  private clip(text: string, max: number): string {
    return headWithin(this.hide(text), max);
  }

  private async request(method: "GET" | "POST", path: string, body: unknown, timeoutMs: number): Promise<unknown> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    let res: Response;
    let text: string;
    try {
      // 연결 단계의 Windows 일시 오류(EFAULT)는 요청이 나가기 전이라 다시 보낸다(src/shared/net.ts)
      res = await fetchRetry(this.config.baseUrl + path, {
        method, signal: ctrl.signal, redirect: "error",
        headers: { authorization: `Bearer ${this.config.token}`, ...(body !== undefined ? { "content-type": "application/json" } : {}) },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
      text = await res.text();
    } catch (e) {
      throw new RelayError(ctrl.signal.aborted ? `중계 응답이 ${timeoutMs}ms 안에 없어요.` : this.clip(`중계에 닿지 않아요: ${(e as Error).message}`, 200), 0);
    } finally {
      clearTimeout(timer);
    }
    let json: unknown;
    try {
      json = text ? JSON.parse(text) : {};
    } catch {
      throw new RelayError(`중계 답이 JSON이 아니에요 (HTTP ${res.status})`, res.status);
    }
    // 409(앞 명령 처리 중)·400 같은 명령 결과도 본문에 outcome이 있으면 그대로 돌려준다
    if (!res.ok && !(json && typeof json === "object" && "outcome" in json)) {
      const why = typeof (json as { error?: unknown })?.error === "string" ? (json as { error: string }).error : text;
      throw new RelayError(`중계가 거절했어요 (HTTP ${res.status}): ${this.clip(why, 120)}`, res.status);
    }
    return json;
  }
}
