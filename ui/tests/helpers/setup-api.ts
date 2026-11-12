// 설정 화면 시험용 가짜 서버: fetch를 바꿔 /api/setup* 등을 메모리에서 답한다. 받은 요청을 calls에 남긴다.
import { vi } from "vitest";
import type { SetupDeviceView, SetupView } from "../../../src/contract/setup.ts";

type Reply = [number, unknown];
export type Call = { method: string; path: string; body: unknown };

const device = (id: string, label: string, roomLabel: string, kind: SetupDeviceView["kind"], kindLabel: string, pairable = false): SetupDeviceView => ({
  id, label, room: roomLabel, roomLabel, kind, kindLabel, source: { kind: "virtual" }, pairable,
});

export function setupView(over: Partial<SetupView> = {}): SetupView {
  return {
    ok: true, persist: true, done: false, switching: false, error: null,
    home: { id: "oneroom", name: "원룸" }, homes: [{ id: "oneroom", name: "원룸" }, { id: "apartment", name: "마곡 아파트" }],
    rooms: [],
    devices: [
      device("fridge_1", "냉장고", "주방", "fridge", "냉장고", true),
      device("tv_living", "거실 TV", "거실", "tv", "TV"),
      device("light_living", "거실 조명", "거실", "light", "조명"),
      device("ac_living", "거실 에어컨", "거실", "aircon", "에어컨", true),
      device("light_room1", "안방 조명", "안방", "light", "조명"),
    ],
    devices_saved: false,
    position: { start: false, layout: false, phone_urls: [] },
    mode: "test", assist: "noonchi", thinq: { ready: true }, pairs: {},
    ...over,
  };
}

/** routes: "METHOD /path" → (본문) => [상태, JSON]. 없으면 기본 답(설정 API는 view를 고쳐 돌려준다). */
export function fakeSetupApi(start: SetupView, routes: Record<string, (body: any) => Reply> = {}) {
  const calls: Call[] = [];
  let view = structuredClone(start);
  const defaults: Record<string, (body: any) => Reply> = {
    "GET /api/setup": () => [200, view],
    "POST /api/setup/home": (b) => {
      const home = view.homes.find((h) => h.id === b.home);
      if (!home) return [400, { ok: false, error: `없는 집입니다: ${b.home}` }];
      view = { ...view, home, done: view.home?.id === home.id ? view.done : false };
      return [200, view];
    },
    "POST /api/setup/devices": (b) => {
      view = { ...view, devices_saved: true, devices: view.devices.map((d) => ({ ...d, source: { kind: b.sources[d.id] ?? d.source.kind } })) };
      return [200, view];
    },
    "POST /api/setup/done": () => [200, { ...view, done: true }],
    "HEAD /twin/viewer/": () => [404, null],
    "GET /api/phone/start-pose": () => [404, { ok: false }],
    "GET /api/layout": () => [404, { ok: false }],
  };
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    const path = String(input);
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ method, path, body });
    const handler = routes[`${method} ${path}`] ?? defaults[`${method} ${path}`];
    const [status, json] = handler ? handler(body) : [404, { ok: false, error: `없는 API입니다: ${path}` }];
    return new Response(json === null ? null : JSON.stringify(json), { status });
  });
  return {
    fetchMock, calls,
    posts: (path: string) => calls.filter((c) => c.method === "POST" && c.path === path),
    view: () => view,
    setView: (v: SetupView) => { view = v; },
  };
}

/** 열리지 않는 WebSocket. 시험이 message를 직접 보낸다. */
export class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  constructor(readonly url: string) {
    FakeWebSocket.instances.push(this);
  }
  close() {}
  emit(msg: unknown) {
    this.onmessage?.({ data: JSON.stringify(msg) });
  }
}
