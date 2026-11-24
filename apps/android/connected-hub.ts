import type { SetupView } from "../../src/contract/setup";
import type { SceneJson, Vec2 } from "../../src/contract/layout";

export const connectedHouse = {
  id: "mokryeon_180b", name: "한양목련 180B", address: "군포시 산본로432번길 25",
  floorPlan: "/api/homes/mokryeon_180b/floor-plan.jpg",
} as const;

export class HubError extends Error {
  constructor(message: string, readonly status: number) { super(message); this.name = "HubError"; }
}

export interface ConnectedHub {
  readonly origin: string;
  url(path: string): string;
  get<T>(path: string, signal?: AbortSignal): Promise<T>;
  write<T>(path: string, body: object, method?: "POST" | "PUT"): Promise<T>;
}

export function createConnectedHub(hubUrl: string, send: typeof fetch = fetch): ConnectedHub {
  const portal = new URL(hubUrl);
  if (portal.protocol !== "https:" || portal.pathname !== "/mobile/" || portal.username || portal.password || portal.search || portal.hash) {
    throw new Error("대시보드 연결 주소를 확인해 주세요.");
  }
  const origin = portal.origin;

  function url(path: string): string {
    const target = new URL(path, origin);
    if (!path.startsWith("/") || target.origin !== origin || target.username || target.password) {
      throw new Error("연결한 서버의 주소를 확인해 주세요.");
    }
    return target.href;
  }

  async function request<T>(path: string, method: "GET" | "POST" | "PUT", body?: object, signal?: AbortSignal): Promise<T> {
    const target = url(path);
    const response = await send(target, { method, signal, credentials: "omit", redirect: "error",
      headers: body ? { accept: "application/json", "content-type": "application/json" } : { accept: "application/json" },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    if (response.redirected || response.url !== target) throw new HubError("허브가 다른 주소로 응답했어요.", 0);
    const data = await response.json().catch(() => null) as { ok?: unknown; error?: unknown } | null;
    if (!response.ok || !data || typeof data !== "object" || data.ok === false) {
      throw new HubError(typeof data?.error === "string" && data.error ? data.error : "허브에서 정보를 받지 못했어요.", response.status);
    }
    return data as T;
  }

  return { origin, url, get: (path, signal) => request(path, "GET", undefined, signal),
    write: (path, body, method = "POST") => request(path, method, body) };
}

const compact = (value: string) => value.normalize("NFKC").toLowerCase().replace(/[\s(),·]/g, "");
const houseNames = [connectedHouse.name, "한양목련", "목련한양", "목련2단지", "산본 한양목련"].map(compact);
const addresses = [connectedHouse.address, `경기도 ${connectedHouse.address}`, `경기 ${connectedHouse.address}`, "산본로432번길 25"].map(compact);

export function matchesConnectedHouse(query: string): boolean {
  const value = compact(query);
  if (value.length < 2) return false;
  if (houseNames.some(name => name.startsWith(value))) return true;
  if (/번길\d/.test(value)) return addresses.includes(value);
  return /산본로\d|산본로$/.test(value) && addresses.some(address => address.startsWith(value));
}

export function activeHome(setup: SetupView | null, registered: string | null): SetupView["home"] {
  if (!setup?.home || setup.switching) return null;
  return setup.done || setup.home.id === registered ? setup.home : null;
}

export type StartPosition = { position: Vec2; yaw_deg: number; label: string; facing_label: string };
type HomeStart = { home: string; start: StartPosition | null };

export async function readForHome<T>(hub: ConnectedHub, home: string, load: () => Promise<T>, signal?: AbortSignal): Promise<T> {
  const confirm = async () => {
    const setup = await hub.get<Pick<SetupView, "home" | "switching">>("/api/setup", signal);
    if (setup.switching || setup.home?.id !== home) throw new Error("허브에서 집이 바뀌었어요.");
  };
  await confirm();
  const value = await load();
  await confirm();
  return value;
}

export async function readHomeCard(hub: ConnectedHub, home: string, signal?: AbortSignal) {
  const readSetup = () => hub.get<SetupView>("/api/setup", signal);
  const matches = (setup: SetupView) => !setup.switching && setup.home?.id === home && setup.position.start;
  const setup = await readSetup();
  if (!matches(setup)) return { setup, reading: undefined, startFailed: false };

  let reading: HomeStart | undefined;
  let startFailed = false;
  try {
    const { start } = await hub.get<{ start: StartPosition | null }>("/api/phone/start-pose", signal);
    if (start !== null && (!start || !Array.isArray(start.position) || start.position.length !== 2
      || !start.position.every(Number.isFinite) || !Number.isFinite(start.yaw_deg))) {
      throw new Error("시작 위치를 확인하지 못했어요.");
    }
    reading = { home, start };
  } catch {
    startFailed = true;
  }
  // The pose reply carries no house ID. A fresh setup check must still match.
  const current = await readSetup();
  return matches(current)
    ? { setup: current, reading, startFailed }
    : { setup: current, reading: undefined, startFailed: false };
}

export function startPositionLabel(enabled: boolean, home: string, reading: HomeStart | undefined, failed: boolean): string {
  if (!enabled) return "사용 불가";
  if (failed) return "확인 실패";
  if (!reading || reading.home !== home) return "확인 중";
  return reading.start ? "설정됨" : "미설정";
}

async function openConnectedHouse(hub: ConnectedHub, setup: SetupView, beforeCheck?: () => Promise<void>): Promise<SetupView> {
  const home = connectedHouse.id;
  if (setup.switching || !setup.homes.some(option => option.id === home)) throw new Error("이 허브에는 등록할 집이 없어요.");
  const selected = await hub.write<SetupView>("/api/setup/home", { home });
  if (selected.home?.id !== home || selected.switching) throw new Error("허브에서 집을 열지 못했어요.");
  const { scene } = await hub.get<{ scene: SceneJson }>("/api/scene");
  if (!scene?.plan?.rooms?.length) throw new Error("집의 트윈을 불러오지 못했어요.");
  await beforeCheck?.();
  const current = await hub.get<SetupView>("/api/setup");
  if (current.home?.id !== home || current.switching) throw new Error("허브에서 다른 집을 열었어요. 다시 확인해 주세요.");
  return current;
}

export async function prepareConnectedHouse(hub: ConnectedHub, setup: SetupView): Promise<SetupView> {
  const started = Date.now();
  return openConnectedHouse(hub, setup, async () => {
    const remaining = started + 5_000 - Date.now();
    if (remaining > 0) await new Promise<void>(resolve => setTimeout(resolve, remaining));
  });
}

export async function confirmConnectedHouse(hub: ConnectedHub, remember: (id: string) => Promise<void>): Promise<SetupView> {
  const current = await hub.get<SetupView>("/api/setup");
  if (current.home?.id !== connectedHouse.id || current.switching) throw new Error("허브에서 다른 집을 열었어요. 다시 확인해 주세요.");
  await remember(connectedHouse.id);
  return current;
}
