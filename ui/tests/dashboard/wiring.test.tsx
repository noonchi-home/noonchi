// 대시보드가 서버 자료(/events·health)를 화면에 잇는다: 할 일 진행도·말풍선 카드·마스코트 방향·시간 줄 카드·대시보드 폰 칸 영상과 YOLO 상자·연결 끊김 칩.
// 승인 대기는 대시보드에 보이지 않는다(D37). 서버 메시지는 가짜 단계(fake-run.json) 순간 2(컵 집기)를 쓴다.
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import type { DeviceView, HealthView, ServerMessage } from "../../../src/contract/events.ts";
import { Dashboard } from "../../src/dashboard/Dashboard";
import run from "../../src/dashboard/fake-run.json";
import { EMPTY_DASH, reduceDash } from "../../src/dashboard/data";
import { timelineLast } from "../../src/dashboard/timeline";
import { branchDecision, COACH, PLAN } from "./fixtures";

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
const MOBILE_URL = "https://hub.example.ts.net/mobile/";
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
    ready: { ok: false, inference_mode: "openai", vlm: { base_url: "", model: "", key: false, reachable: false }, pam: { base_url: "", model: "", key: false, reachable: false },
      agent: { provider: "openai", base_url: "", model: "", key: false, reachable: false }, db: false },
  };
  vi.stubGlobal("fetch", vi.fn(async (path: string) => (
    path === "/api/health" ? Response.json(health) : path === "/api/devices" ? Response.json(DEVICES)
      : path === "/api/setup" ? Response.json({ ok: true, done: false, mobile_urls: [MOBILE_URL] }) : new Response("{}", { status: 404 }))));
  return health;
}

const moment = (n: number) => run.moments[n]!.messages as ServerMessage[];
/** 그 순간 자료의 가장 늦은 때(시간 줄의 지금으로 쓴다). */
const lastOf = (n: number) => timelineLast(moment(n).reduce((s, m) => reduceDash(s, m, 0), EMPTY_DASH))!;
const statusCells = (label: string) => within(screen.getByRole("rowheader", { name: label }).closest("tr")!).getAllByRole("cell");
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
const talk = () => document.querySelector<HTMLElement>("[data-talk]")!;
/** 메시지 상자에 보이는 줄 글(오래된 것부터). */
const messageTexts = () => [...talk().querySelectorAll("[data-talk-line]")].map((l) => l.textContent);
/** 메시지 상자 최신 줄. */
const sayLine = () => talk().querySelector<HTMLElement>('[data-talk-line="new"]')!;

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

  it("미설정 허브는 health보다 먼저 폰 홈 QR을 보여 준다", async () => {
    vi.stubGlobal("fetch", vi.fn(async (path: string) => (
      path === "/api/setup" ? Response.json({ ok: true, done: false, mobile_urls: [MOBILE_URL] }) : new Response("{}", { status: 503 })
    )));
    render(<Dashboard />);
    expect(await screen.findByRole("img", { name: "폰 연결 QR" })).toBeInTheDocument();
    expect(phonePane()).toHaveTextContent(MOBILE_URL);
    expect(phonePane()).toHaveTextContent("NOONCHI 앱으로 스캔해 서버에 연결하세요");
  });

  it("기본 대시보드는 실제 계획과 Trace를 세 칸에 받아 집을 다시 열면 이전 줄을 지운다", async () => {
    await mount(false);
    send(moment(2));
    expect([...document.querySelectorAll("fieldset > legend")].map((e) => e.textContent)).toEqual(["Vision", "Digital Twin", "Agent Trace"]);
    const active = [...moment(2)].reverse().find(m => m.type === "plan");
    expect(active?.type).toBe("plan");
    if (active?.type !== "plan" || !active.plan) throw new Error("컵 집기 계획이 있어야 한다");
    const step = active.plan.steps.find(p => p.status === "active")!;
    const objectId = step.target?.objectId ?? "cup";
    const refs = { plan_id: active.plan.id, object_id: objectId };
    const rows = [
      { id: "house:b", activity_id: "house:work", rev: 1, kind: "EXECUTION", name: "집기 안내", input: "컵 · 식탁",
        output: "시연자 수행 대기", started_ms: 250, ended_ms: null, state: "pending", refs: { ...refs, step_id: step.id } },
    ] as const;
    const hello = { type: "hello", devices: 0, provider: null, hub: "memory", home: "h", trace_epoch: "house" } as const;
    send([hello, active, { type: "trace", epoch: "house", rows: [...rows] }]);
    expect(screen.getByRole("group", { name: "Agent Trace" })).toHaveTextContent("시연자 수행 대기");
    expect(screen.queryByRole("link", { name: "집 전체" })).toBeNull();
    send([{ ...hello, trace_epoch: "house:reopened" }, { type: "trace", epoch: "house", rows: [...rows] }]);
    expect(screen.getByRole("group", { name: "Agent Trace" })).not.toHaveTextContent("시연자 수행 대기");
  });

  // 의견 4(2026-11-25): 「집 전체」 단추와 overview 화면을 없앴다. 옛 주소로 열어도 기본 세 칸 배치다
  it("?view=overview로 열어도 기본 세 칸 배치이고 「집 전체」 링크·마스코트·메시지 상자가 없다", async () => {
    history.replaceState(null, "", "/?view=overview");
    await mount(false);
    send(moment(2));
    expect([...document.querySelectorAll("fieldset > legend")].map((e) => e.textContent)).toEqual(["Vision", "Digital Twin", "Agent Trace"]);
    expect(screen.queryByRole("link", { name: "집 전체" })).toBeNull();
    expect(screen.queryByRole("region", { name: "마스코트" })).toBeNull();
    expect(document.querySelector("[data-talk], [data-timeline-card], [data-mode-text]")).toBeNull();
    expect(document.querySelector("main")).toHaveAttribute("data-step", "2");
  });

  it("대시보드에서 Ctrl+1을 누르면 설정 창(허브 상태·폰 연결 QR)이 열린다", async () => {
    await mount(false);
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.keyDown(window, { key: "1", code: "Digit1", ctrlKey: true });
    const dialog = await screen.findByRole("dialog", { name: "설정" });
    expect(within(dialog).getByRole("list", { name: "허브 상태" })).toBeInTheDocument();
  });

  it("다시 연결되면(hello) health를 다시 받는다(서버를 다른 설정으로 다시 띄운 때). 트윈 칸에는 날짜·시간 칩이 없다", async () => {
    stubServer(false);
    render(<Dashboard />);
    await waitFor(() => expect(FakeSocket.last).not.toBeNull());
    const healths = () => vi.mocked(fetch).mock.calls.filter((c) => c[0] === "/api/health").length;
    await waitFor(() => expect(healths()).toBeGreaterThan(0));
    const before = healths();
    act(() => FakeSocket.last!.onopen?.());
    send([{ type: "hello", devices: 2, provider: null, hub: "memory", home: "h" }]);
    await waitFor(() => expect(healths()).toBe(before + 1));
    expect(document.querySelector("[data-clock]")).toBeNull();
  });

  it("폰 서버가 꺼져 있으면(health.eye false) 대시보드 폰 칸은 연결 QR이다", async () => {
    await mount(false);
    send(moment(2));
    await waitFor(() => expect(screen.getByRole("img", { name: "폰 연결 QR" })).toBeInTheDocument());
    expect(phonePane().querySelector("canvas[data-masks], [data-detection-label]")).toBeNull();
  });

  it("폰 서버가 켜져 있어도 첫 장 전에는 QR이고 마스크가 없다. 영상에 첫 장이 오면 QR이 없어지고 컵 마스크와 이름표가 보인다", async () => {
    await mount(true);
    send(moment(2));
    await waitFor(() => expect(screen.getByRole("img", { name: "폰 연결 QR" })).toBeInTheDocument());
    expect(phonePane().querySelector("canvas[data-masks], [data-detection-label]")).toBeNull();
    fireEvent.load(phonePane().querySelector<HTMLImageElement>("[data-eye-video] img")!);
    await waitFor(() => expect(screen.queryByRole("img", { name: "폰 연결 QR" })).toBeNull());
    // 물체 모양(seen)은 600ms 넘게 안 오면 지운다: 새 seen이 오면 마스크 canvas와 컵 이름표가 보인다. 네모 상자는 없다
    send(moment(2));
    expect(phonePane().querySelector("canvas[data-masks]")).not.toBeNull();
    expect([...phonePane().querySelectorAll("[data-detection-label]")].map((t) => t.textContent)).toEqual(["컵"]);
    expect(phonePane().querySelector('[data-detection], [data-slot="bounding-box"]')).toBeNull();
  });

  it("실제 폰 명령을 영상 위 고정 줄에 한 번만 띄우고, 해제하면 글만 지운다", async () => {
    await mount(true);
    send([{ type: "phone_command", text: "식탁으로 가 주세요" }]);
    const line = phonePane().querySelector<HTMLElement>("[data-phone-line]")!;
    expect(line).toHaveTextContent("식탁으로 가 주세요");
    expect(screen.getAllByText("식탁으로 가 주세요")).toHaveLength(1);
    expect(line.closest("[data-video]")).toBe(phonePane().querySelector("[data-video]"));
    send([{ type: "phone_command", text: null }]);
    expect(line).not.toHaveTextContent("식탁으로 가 주세요");
    expect(line).toBeInTheDocument();
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

  it("&step=2면 서버 자료 없이 그 순간이다: 단계·말·대시보드 폰 칸 눈 그림·시간 줄 카드(그 순간 때로 멈춤)·컵 이름표", async () => {
    open("&step=2");
    expect(document.querySelector("main")).toHaveAttribute("data-step", "2");
    expect(screen.getByRole("region", {name: "현재 상황"})).toHaveTextContent("컵");
    expect(phonePane().querySelector("[data-phone-text=명령]")).toHaveTextContent("컵을 들어 주세요");
    const img = phonePane().querySelector<HTMLImageElement>('img[alt="폰 카메라 영상"]')!;
    expect(img.getAttribute("src")).toBe("/debug-eye/eye-table-near.webp");
    expect(document.querySelector("[data-mode-text]")).toBeNull();
    expect(document.querySelector("[data-talk-pill]")).toBeNull();
    expect(statusCells("사용자")[0]).not.toHaveTextContent("먹거나 마시는 중");
    expect(statusCells("사용자")[0]).toHaveTextContent("자리에 없음");
    expect(statusCells("클로이드")[0]).not.toHaveTextContent("식탁으로 가기");
    expect(statusCells("클로이드")[0]).toHaveTextContent("컵 집기");
    expect(statusCells("클로이드")[1]!.querySelector("time")).toBeInTheDocument();
    expect([...phonePane().querySelectorAll("[data-detection-label]")].map((t) => t.textContent?.split(" ")[0])).toEqual(["컵"]);
    expect(phonePane().querySelector("canvas[data-masks]")).not.toBeNull();
  });

  it("대시보드 폰 칸은 가로 눈 그림(405×228)이고, 컵 모양(seen)도 그 가로 프레임 자리로 온다", async () => {
    open("&step=2");
    const img = phonePane().querySelector<HTMLImageElement>('img[alt="폰 카메라 영상"]')!;
    expect(img.getAttribute("src")).toBe("/debug-eye/eye-table-near.webp");
    expect([...phonePane().querySelectorAll("[data-detection-label]")].map((t) => t.textContent?.split(" ")[0])).toEqual(["컵"]);
  });

  it("서버에서 온 계획·말은 쓰지 않는다", async () => {
    open("&step=2");
    await waitFor(() => expect(FakeSocket.last).not.toBeNull());
    send(moment(4));
    expect(document.querySelector("main")).toHaveAttribute("data-step", "2");
    expect(screen.getByRole("region", {name: "현재 상황"})).toHaveTextContent("컵");
  });

  it("window.__dash.step(n)으로 그 순간으로 간다", () => {
    open("&step=1");
    expect(document.querySelector("main")).toHaveAttribute("data-step", "1");
    act(() => window.__dash!.step(3));
    expect(document.querySelector("main")).toHaveAttribute("data-step", "3");
    expect(phonePane().querySelector("[data-phone-text=명령]")).toHaveTextContent("싱크대");
    expect(phonePane().querySelector('img[alt="폰 카메라 영상"]')!.getAttribute("src")).toBe("/debug-eye/eye-sink.webp");
    act(() => window.__dash!.step(0));
    expect(document.querySelector("main")).toHaveAttribute("data-step", "0");
    expect(phonePane().querySelector("[data-phone-text=명령]")).toBeNull();
    expect(statusCells("사용자")[0]).toHaveTextContent("먹거나 마시는 중");
    // 옛 0번 샘플에는 실행 상태 사건도 시작한 단계도 없다.
    expect(statusCells("클로이드")[0]).toHaveTextContent("—");
    expect(screen.getAllByRole("rowheader")).toHaveLength(2);
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
    const settings = await screen.findByRole("dialog");
    expect(await within(settings).findByRole("img", { name: "폰 연결 QR" })).toBeInTheDocument();
    expect(settings).toHaveTextContent(MOBILE_URL);
  });
});
