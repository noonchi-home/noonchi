// 대시보드가 서버 자료(/events·health)를 화면에 잇는다: 할 일 진행도·말풍선 카드·마스코트 방향·FSM 카드·대시보드 폰 칸 영상과 YOLO 상자·연결 끊김 칩.
// 승인 대기는 대시보드에 보이지 않는다(D37). 서버 메시지는 가짜 단계(fake-run.json) 순간 2(컵 집기)를 쓴다.
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import type { DeviceView, HealthView, ServerMessage } from "../../../src/contract/events.ts";
import { Dashboard } from "../../src/dashboard/Dashboard";
import run from "../../src/dashboard/fake-run.json";

const SPOT = new Map<string, { x: number; y: number; visible: boolean }>();
vi.mock("../../src/twin/use-anchors", () => ({
  useAnchors: (ids: string[]) => {
    for (const id of ids) if (!SPOT.has(id)) SPOT.set(id, { x: 500, y: 400, visible: true });
    return SPOT;
  },
}));

class FakeSocket {
  static last: FakeSocket | null = null;
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  constructor(public url: string) { FakeSocket.last = this; }
  push(m: ServerMessage) { this.onmessage?.({ data: JSON.stringify(m) }); }
  send() {}
  close() {}
}

const PHONE_URL = "http://192.168.0.7:8210/phone/";
const device = (id: string, label: string, kind: DeviceView["kind"], twin: Record<string, unknown>): DeviceView => ({
  id, label, room: "living", roomLabel: "거실", twinType: "t", kind, matterDeviceType: "x", capabilities: [], sensors: [], twinAttrs: {},
  state: { id, online: true, twin, matter: {}, updatedAt: "t" },
});
const DEVICES = [device("lamp", "플로어 스탠드", "light", { power: "on" }), device("lock", "현관 도어록", "lock", { locked: true })];

/** 구운 3D가 없는 집(id "h"): 트윈 칸 지도 자리는 iframe 트윈(시험에서는 첫 그림을 그리지 않는다)과 확인 목록 말풍선이다. eye는 폰 서버가 켜졌는가, twin은 트윈이 있는 집인가. */
function stubServer(eye: boolean, twin = true) {
  const health: HealthView = {
    ok: true, devices: 2, hub: "memory", transport: null, provider: "openai", model: "m", twin, eye,
    home: { id: "h", name: "우리 집" }, phone_urls: [PHONE_URL], brain: true, mode: "test",
    ready: { ok: false, inference_mode: "mock", vlm: { base_url: "", model: "", key: false, reachable: false }, pam: { url: "", reachable: false, llm: null },
      agent: { provider: "openai", base_url: "", model: "", key: false, reachable: false }, db: false },
  };
  vi.stubGlobal("fetch", vi.fn(async (path: string) => (
    path === "/api/health" ? Response.json(health) : path === "/api/devices" ? Response.json(DEVICES) : new Response("{}", { status: 404 }))));
}

const moment = (n: number) => run.moments[n]!.messages as ServerMessage[];
const turnedOn: ServerMessage = {
  type: "agent", event: "action", sessionId: "phone",
  action: { tool: "turn_on", args: {}, ok: true, deviceId: "lamp", deviceLabel: "플로어 스탠드", reason: "켜 달라고 해서", at: "t" },
};
const unlockAsked: ServerMessage = {
  type: "agent", event: "reply", sessionId: "phone", message: "현관문 열어줘", reply: "폰에서 답해 주세요",
  actions: [{ tool: "unlock", args: {}, ok: false, needsConfirmation: true, deviceId: "lock", deviceLabel: "현관 도어록", reason: "열어 달라고 해서", at: "t" }],
  pendingConfirmations: [{ token: "k", deviceId: "lock", deviceLabel: "현관 도어록", command: { type: "unlock" }, reason: "문을 열어요", choices: [], expiresAt: "t" }],
};
const pending: ServerMessage = {
  type: "agent", event: "pending", sessionId: "phone",
  pending: { token: "k", deviceId: "lock", deviceLabel: "현관 도어록", command: { type: "unlock" }, reason: "문을 열어요", choices: [], expiresAt: "t" },
};

const called = (path: string) => vi.mocked(fetch).mock.calls.some((c) => c[0] === path);
const phonePane = () => screen.getByRole("region", { name: "폰 카메라" });
const sayLine = () => [...document.querySelectorAll<HTMLElement>("[data-say-line]")].find((p) => !p.hasAttribute("aria-hidden"))!;

/** 대시보드를 그리고 health·소켓이 붙을 때까지 기다린 뒤 연결을 연다. */
async function mount(eye: boolean) {
  stubServer(eye);
  const view = render(<Dashboard />);
  await waitFor(() => expect(FakeSocket.last).not.toBeNull());
  await waitFor(() => expect(called("/api/health")).toBe(true));
  await act(async () => { await Promise.resolve(); });
  act(() => FakeSocket.last!.onopen?.());
  return view;
}
const send = (ms: ServerMessage[]) => act(() => { for (const m of ms) FakeSocket.last!.push(m); });

describe("대시보드 자료 연결", () => {
  let rect: MockInstance;
  beforeEach(() => {
    SPOT.clear();
    FakeSocket.last = null;
    vi.stubGlobal("WebSocket", FakeSocket);
    // 영상 칸 크기를 알아야 YOLO 상자를 놓는다(jsdom은 0을 준다)
    rect = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(
      { x: 0, y: 0, left: 0, top: 0, right: 1920, bottom: 1080, width: 1920, height: 1080, toJSON: () => ({}) } as DOMRect,
    );
  });
  afterEach(() => {
    rect.mockRestore();
    vi.unstubAllGlobals();
    history.replaceState(null, "", "/");
  });

  it("순간 2(컵 집기)를 받으면 진행도 2/4 · 컵 집기, 말풍선 카드 말, 마스코트는 트윈을 본다", async () => {
    await mount(false);
    send(moment(2));
    expect(document.querySelector("[data-progress]")).toHaveTextContent("2/4 · 컵 집기");
    expect(sayLine()).toHaveTextContent("컵을 들라고 했어요.");
    expect(screen.getByRole("region", { name: "마스코트" })).toHaveAttribute("data-facing", "twin");
    expect(document.querySelector("main")).toHaveAttribute("data-step", "2");
  });

  it("지켜보기(순간 0)는 진행도가 없고 마스코트는 영상을 본다", async () => {
    await mount(false);
    send(moment(2));
    send(moment(0));
    expect(document.querySelector("[data-progress]")).toBeNull();
    expect(screen.getByRole("region", { name: "마스코트" })).toHaveAttribute("data-facing", "video");
    expect(sayLine()).toHaveTextContent("식탁을 보고 있어요.");
  });

  it("폰 서버가 꺼져 있으면(health.eye false) 대시보드 폰 칸은 연결 QR이고 FSM 카드가 없다", async () => {
    await mount(false);
    send(moment(2));
    await waitFor(() => expect(screen.getByRole("img", { name: "폰 연결 QR" })).toBeInTheDocument());
    expect(phonePane().querySelector("[data-fsm-card]")).toBeNull();
    expect(phonePane().querySelector("[data-detection]")).toBeNull();
  });

  it("폰 서버가 켜져 있어도 첫 장 전에는 QR이고 FSM 카드·상자가 없다. 영상에 첫 장이 오면 QR이 없어지고 FSM 카드와 컵 상자가 보인다", async () => {
    await mount(true);
    send(moment(2));
    await waitFor(() => expect(screen.getByRole("img", { name: "폰 연결 QR" })).toBeInTheDocument());
    expect(phonePane().querySelector("[data-fsm-card]")).toBeNull();
    expect(phonePane().querySelector("[data-detection]")).toBeNull();
    fireEvent.load(phonePane().querySelector<HTMLImageElement>("[data-eye-video] img")!);
    await waitFor(() => expect(screen.queryByRole("img", { name: "폰 연결 QR" })).toBeNull());
    const card = phonePane().querySelector<HTMLElement>("[data-fsm-card]")!;
    expect(card).not.toBeNull();
    const fsm = card.querySelector<HTMLElement>("[data-fsm]")!;
    expect(fsm).toHaveTextContent("FSM");
    expect(fsm).toHaveTextContent("식탁 위에 컵이 있고 사람이 자리를 비웠어요.");
    const action = card.querySelector<HTMLElement>("[data-action]")!;
    expect(action).toHaveTextContent("행동");
    expect(action).toHaveTextContent("컵 치우기");
    expect(phonePane().querySelector('[data-detection="컵"]')).not.toBeNull();
  });

  it("소켓이 닫히면 「연결 끊김 · 다시 연결 중」 칩이 생기고 다시 열리면 없어진다", async () => {
    await mount(false);
    send(moment(2));
    expect(screen.queryByText("연결 끊김 · 다시 연결 중")).toBeNull();
    const old = FakeSocket.last!;
    act(() => old.onclose?.());
    expect(screen.getByText("연결 끊김 · 다시 연결 중")).toBeInTheDocument();
    await waitFor(() => expect(FakeSocket.last).not.toBe(old), { timeout: 4000 });
    act(() => FakeSocket.last!.onopen?.());
    expect(screen.queryByText("연결 끊김 · 다시 연결 중")).toBeNull();
  });

  it("승인 대기 메시지와 「승인 대기」 확인 줄이 와도 화면에 「승인」 글이 없다: 승인 대기 기기는 말풍선도 없다", async () => {
    await mount(false);
    await waitFor(() => expect(called("/api/devices")).toBe(true));
    await act(async () => { await Promise.resolve(); });
    send([turnedOn, unlockAsked, pending, ...moment(2)]);
    await waitFor(() => expect(document.querySelector("[data-check=lamp]")).not.toBeNull());
    expect(document.querySelector("[data-check=lock]")).toBeNull();
    expect(document.body.textContent).not.toContain("승인");
    expect(document.querySelector('[aria-label*="승인"]')).toBeNull();
  });
});

describe("가짜 단계(?debug=steps)", () => {
  let rect: MockInstance;
  beforeEach(() => {
    SPOT.clear();
    FakeSocket.last = null;
    vi.stubGlobal("WebSocket", FakeSocket);
    stubServer(true);
    rect = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(
      { x: 0, y: 0, left: 0, top: 0, right: 1920, bottom: 1080, width: 1920, height: 1080, toJSON: () => ({}) } as DOMRect,
    );
  });
  afterEach(() => {
    rect.mockRestore();
    vi.unstubAllGlobals();
    history.replaceState(null, "", "/");
  });
  const open = (query: string) => {
    history.replaceState(null, "", `/?debug=steps${query}`);
    return render(<Dashboard />);
  };

  it("&step=2면 서버 자료 없이 그 순간이다: 진행도·말·대시보드 폰 칸 눈 그림·FSM 카드·컵 상자", async () => {
    open("&step=2");
    expect(document.querySelector("[data-progress]")).toHaveTextContent("2/4 · 컵 집기");
    expect(sayLine()).toHaveTextContent("컵을 들라고 했어요.");
    const img = phonePane().querySelector<HTMLImageElement>('img[alt="폰 카메라 영상"]')!;
    expect(img.getAttribute("src")).toBe("/debug-eye/eye-table-near.webp");
    expect(phonePane().querySelector("[data-fsm-card] [data-action]")).toHaveTextContent("컵 치우기");
    expect(phonePane().querySelector('[data-detection="컵"]')).not.toBeNull();
  });

  it("서버에서 온 계획·말은 쓰지 않는다", async () => {
    open("&step=2");
    await waitFor(() => expect(FakeSocket.last).not.toBeNull());
    send(moment(4));
    expect(document.querySelector("[data-progress]")).toHaveTextContent("2/4 · 컵 집기");
  });

  it("window.__dash.step(n)으로 그 순간으로 간다", () => {
    open("&step=1");
    expect(document.querySelector("main")).toHaveAttribute("data-step", "1");
    act(() => window.__dash!.step(3));
    expect(document.querySelector("[data-progress]")).toHaveTextContent("3/4 · 싱크대로 가기");
    expect(phonePane().querySelector('img[alt="폰 카메라 영상"]')!.getAttribute("src")).toBe("/debug-eye/eye-sink.webp");
    act(() => window.__dash!.step(0));
    expect(document.querySelector("main")).toHaveAttribute("data-step", "0");
    expect(document.querySelector("[data-progress]")).toBeNull();
  });

  it("&play=MS면 지도가 준비된 뒤부터 MS마다 4→0→1 차례로 넘긴다", async () => {
    stubServer(true, false);
    open("&step=4&play=40");
    expect(document.querySelector("main")).toHaveAttribute("data-step", "4");
    await waitFor(() => expect(document.querySelector("main")).toHaveAttribute("data-step", "0"));
    await waitFor(() => expect(document.querySelector("main")).toHaveAttribute("data-step", "1"));
  });

  it("&play=MS여도 트윈이 첫 그림을 그리기 전에는 넘기지 않는다", async () => {
    open("&step=4&play=40");
    await waitFor(() => expect(called("/api/health")).toBe(true));
    await act(async () => { await new Promise((r) => setTimeout(r, 200)); });
    expect(document.querySelector("main")).toHaveAttribute("data-step", "4");
  });

  it("&eye=0이면 연결 QR, &offline=1이면 연결 끊김 칩, &settings=1이면 설정 창이 열려 있다", async () => {
    const a = open("&step=0&eye=0");
    await waitFor(() => expect(screen.getByRole("img", { name: "폰 연결 QR" })).toBeInTheDocument());
    expect(screen.queryByText("연결 끊김 · 다시 연결 중")).toBeNull();
    a.unmount();
    const b = open("&step=2&offline=1");
    expect(screen.getByText("연결 끊김 · 다시 연결 중")).toBeInTheDocument();
    b.unmount();
    open("&step=0&settings=1");
    expect(await screen.findByRole("dialog")).toHaveTextContent("집 다시 설정하기");
  });
});
