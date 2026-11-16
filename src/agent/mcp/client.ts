// MCP 서버가 쓰는 ToolBackend: 실행 중인 twin-home 서버의 REST를 부른다.

import type { ToolBackend, DeviceView, RoomView } from "../tools.js";
import type { Command, CommandResult } from "../../devices/hub/types.js";
import { fetchRetry } from "../../shared/net.js";

export const DEFAULT_TWIN_HOME_URL = "http://127.0.0.1:8200";

// 기본 fetch는 Windows의 일시적 connect EFAULT를 다시 시도한다(src/shared/net.ts)
const defaultFetch = ((input: string | URL, init?: RequestInit) => fetchRetry(input, init)) as typeof fetch;

export function httpBackend(baseUrl: string = DEFAULT_TWIN_HOME_URL, fetchImpl: typeof fetch = defaultFetch): ToolBackend {
  const base = baseUrl.replace(/\/+$/, "");

  async function req<T>(path: string, body?: unknown): Promise<T> {
    let res: Response;
    try {
      res = await fetchImpl(base + path, body === undefined
        ? { headers: { accept: "application/json" } }
        : { method: "POST", headers: { "content-type": "application/json", accept: "application/json" }, body: JSON.stringify(body) });
    } catch (e) {
      throw new Error(`twin-home 서버(${base})에 연결하지 못했습니다. 먼저 npm start로 서버를 띄우세요. (${(e as Error).message})`);
    }
    const text = await res.text();
    let json: unknown;
    try {
      json = text ? JSON.parse(text) : {};
    } catch {
      throw new Error(`twin-home 서버 응답을 읽지 못했습니다(HTTP ${res.status}).`);
    }
    if (res.status >= 500) throw new Error(`twin-home 서버 오류(HTTP ${res.status}): ${(json as { error?: string }).error ?? text.slice(0, 200)}`);
    return json as T;
  }

  return {
    rooms: () => req<RoomView[]>("/api/rooms"),
    devices: () => req<DeviceView[]>("/api/devices"),
    command: (id: string, cmd: Command, confirmToken?: string) =>
      req<CommandResult>(`/api/devices/${encodeURIComponent(id)}/command`, confirmToken ? { command: cmd, confirmToken } : { command: cmd }),
    confirm: (token: string) => req<CommandResult & { deviceId?: string }>("/api/agent/confirm", { token }),
  };
}
