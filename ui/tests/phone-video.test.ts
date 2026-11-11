// 영상 입력 모드(?clip=, core/video-ar.js): 실제 카메라 대신 영상을 틀고, 고정 자세·투영으로 실제 폰과 같은 길로 보낸다.
// jsdom은 영상을 틀지 못하므로 영상·JPEG 인코딩·2D 그림판은 대역(arDeps)으로 넣는다.
// 지원은 바로 됨(http·WebXR 없어도), 소리 읽기·늘 듣기 없음, reset → start fixed → pose, 화면·엔진 프레임 헤더, 명령 시각 기록,
// 맞춤 상태면 「여기서 시작」·시작 위치 모달 없음, 영상이 끝나면 프레임을 멈춘다. video-math 표도 본다.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPhoneController, type ControllerDeps, type ControllerDraw } from "../src/phone/controller";
import { createVideoAr } from "../src/phone/core/video-ar.js";
import { coverMap, pitchQuat, projectionFromFov, viewMatrix } from "../src/phone/core/video-math.js";
import { problemOf } from "../src/phone/state";
import { focusMarks } from "../src/phone/core/project.js";

class FakeSocket {
  static OPEN = 1;
  static last: FakeSocket;
  readyState = 0;
  sent: Record<string, any>[] = [];
  packets: Blob[] = [];
  private on: Record<string, ((e: any) => void)[]> = {};
  constructor(readonly url: string) { FakeSocket.last = this; }
  addEventListener(t: string, f: (e: any) => void) { (this.on[t] ??= []).push(f); }
  send(d: string | Blob) {
    if (typeof d === "string") this.sent.push(JSON.parse(d));
    else this.packets.push(d);
  }
  close() { this.readyState = 3; }
  open() { this.readyState = 1; for (const f of this.on.open ?? []) f({}); }
  /** 서버 쪽에서 끊김(폰 서버를 다시 띄움): link가 1초 뒤 새 소켓으로 다시 붙는다. */
  drop() { this.readyState = 3; for (const f of this.on.close ?? []) f({}); }
  push(m: unknown) { for (const f of this.on.message ?? []) f({ data: JSON.stringify(m) }); }
}

class Rec {
  static all: Rec[] = [];
  lang = ""; continuous = false; interimResults = true; maxAlternatives = 0;
  onresult = null; onerror = null; onend = null;
  constructor() { Rec.all.push(this); }
  start() {}
  stop() {}
  abort() {}
}

/** 대역 영상: advance(초)로 영상 시각을 옮기고 그 프레임 고리를 한 번 부른다. */
function fakeVideo() {
  let frameCb: ((now: number) => void) | null = null;
  let endedCb: (() => void) | null = null;
  const element = document.createElement("div");
  const v = {
    element,
    currentTime: 0,
    videoWidth: 720,
    videoHeight: 1280,
    ended: false,
    played: 0,
    closed: 0,
    drawTo: vi.fn(),
    play: async () => { v.played += 1; },
    nextFrame(cb: (now: number) => void) { frameCb = cb; },
    onEnded(cb: () => void) { endedCb = cb; },
    close() { v.closed += 1; element.remove(); },
    advance(s: number) {
      v.currentTime += s;
      const f = frameCb;
      frameCb = null;
      f?.(performance.now());
    },
    end() {
      v.ended = true;
      endedCb?.();
    },
  };
  return v;
}

const jpeg = () => new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])]);
const fakeEncoder = () => ({ mode: "test", encode: vi.fn(async () => jpeg()), close: vi.fn() });
const fakeCanvas = () => ({
  width: 0,
  height: 0,
  getContext: () => ({ getImageData: (_x: number, _y: number, w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4) }) }),
});

/** 패킷([u32 헤더 길이][JSON 헤더][JPEG]) → 헤더. */
async function headerOf(packet: Blob) {
  const buf = new Uint8Array(await packet.arrayBuffer());
  const n = new DataView(buf.buffer).getUint32(0);
  return JSON.parse(new TextDecoder().decode(buf.slice(4, 4 + n)));
}

const made: { close(): void }[] = [];
beforeEach(() => {
  Rec.all = [];
  delete (window as { __noonchiVideo?: unknown }).__noonchiVideo;
});
afterEach(() => { while (made.length) made.pop()!.close(); vi.useRealTimers(); vi.restoreAllMocks(); });

function make(over: Partial<ControllerDeps> = {}, search = "?clip=cup-demo.mp4", { open = true } = {}) {
  const spoken: string[] = [];
  const video = fakeVideo();
  const encoder = fakeEncoder();
  const urls: string[] = [];
  const c = createPhoneController({
    location: { protocol: "http:", host: "127.0.0.1:8210", search },
    Socket: FakeSocket, Recognition: Rec as never, speak: (s, done) => { spoken.push(s); done(); },
    secure: false, xr: null,
    arDeps: {
      createVideo: (url: string) => { urls.push(url); return video; },
      createEncoder: () => encoder,
      createCanvas: fakeCanvas,
      screen: () => ({ width: 390, height: 844 }),
    },
    ...over,
  });
  made.push(c);
  const ws = FakeSocket.last;
  if (open) ws.open();
  const sent = () => ws.sent.filter((m) => m.type !== "clock");
  const marks: { id: string; u: number; v: number; off: boolean; angle: number }[][] = [];
  const draw: ControllerDraw = { start: () => {}, aim: () => {}, hit: () => {}, marks: (m) => marks.push(m) };
  // 덮개 뿌리: 실제 페이지처럼 body 안에 둔다(영상은 그 앞에 깔린다)
  const overlay = document.createElement("div");
  document.body.append(overlay);
  c.attach(overlay, draw);
  const startAr = async () => {
    c.actions.startAr();
    await vi.waitFor(() => expect(c.view().ar).toBe(true));
  };
  /** 서버 시계 답: 시계 맞춤 표본 하나(오프셋 1000 ms). */
  const clock = () => {
    const ping = ws.sent.find((m) => m.type === "clock")!;
    ws.push({ type: "clock", t0: ping.t0, server: ping.t0 + 1000 });
  };
  return { c, ws, sent, spoken, video, encoder, urls, marks, overlay, startAr, clock };
}

const START = { label: "식탁 옆", facing: "식탁" };
const sync = (over: Record<string, unknown> = {}) => ({ state: "none", source: null, start: START, started: false, anchors: 0, wall_points: 0, residual_m: null, ...over });
const command = (over: Record<string, unknown> = {}) => ({
  type: "command", id: "plan:pam-1", step: "plan:pam-1:1", text: "식탁으로 가 주세요", vision: "식탁까지 2.1m", choices: [{ id: "done", label: "완료" }], target: null, speak: true, ...over,
});
const flush = () => new Promise((r) => setTimeout(r, 0));
const phoneNow = () => performance.timeOrigin + performance.now();
const ALIGNED = { type: "status", aligned: true, sync: sync({ state: "aligned", source: "video", started: true }) };
/** 풀 때까지 재생을 기다리는 대역 play. */
function gate() {
  let release!: () => void;
  const wait = new Promise<void>((r) => { release = r; });
  return { play: async () => { await wait; }, release };
}

describe("영상 입력 모드: 연결·지원", () => {
  it("?clip=이면 http·WebXR 없이도 지원이 바로 준비. 영상 주소는 /phone/videos/<이름>", async () => {
    const { c, urls, startAr } = make();
    await vi.waitFor(() => expect(c.view().support).toEqual({ kind: "ready" }));
    await startAr();
    expect(urls).toEqual(["/phone/videos/cup-demo.mp4"]);
  });

  it("clip이 없으면 지금처럼 보안 연결이 아니면 insecure", () => {
    const { c } = make({}, "");
    expect(c.view().support).toEqual({ kind: "insecure" });
  });

  it("음성 인식을 만들지 않고(듣기 꺼짐), 명령이 와도 소리로 읽지 않는다", async () => {
    const { c, ws, spoken, startAr } = make();
    await startAr();
    ws.push(command());
    expect(Rec.all).toHaveLength(0);
    expect(c.view().listening).toBe("off");
    expect(spoken).toEqual([]);
    expect(c.view().command?.text).toBe("식탁으로 가 주세요");
  });

  it("영상은 덮개 앞(문서 순서상 먼저)에 놓고, AR을 끝내면 치운다", async () => {
    const { c, video, overlay, startAr } = make();
    await startAr();
    expect(video.element.isConnected).toBe(true);
    expect(video.element.compareDocumentPosition(overlay) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    c.close();
    expect(video.closed).toBe(1);
    expect(c.view().ar).toBe(false);
  });

  it("재생을 기다리는 동안 「AR 시작」을 두 번 눌러도 영상은 하나만 열고 reset·start도 한 번", async () => {
    const { c, urls, video, sent } = make();
    const g = gate();
    video.play = g.play;
    c.actions.startAr();
    c.actions.startAr();
    g.release();
    await vi.waitFor(() => expect(c.view().ar).toBe(true));
    await flush();
    expect(urls).toEqual(["/phone/videos/cup-demo.mp4"]);
    expect(sent().filter((m) => m.type === "reset")).toHaveLength(1);
    expect(sent().filter((m) => m.type === "start")).toHaveLength(1);
  });

  it("영상을 열지 못하면 처음 화면에 까닭", async () => {
    const video = fakeVideo();
    video.play = async () => { throw new Error("no source"); };
    const { c } = make({ arDeps: { createVideo: () => video, createEncoder: fakeEncoder, createCanvas: fakeCanvas } });
    c.actions.startAr();
    await vi.waitFor(() => expect(c.view().support).toEqual({ kind: "failed", message: "영상을 열지 못했어요" }));
    expect(c.view().ar).toBe(false);
  });
});

describe("영상 입력 모드: 보내기", () => {
  it("AR 시작이면 reset → start{fixed, 시작 자리 높이 1.4m, 아래 25°} 차례로 보내고, 그 뒤 pose가 같은 자세로 온다", async () => {
    const { sent, startAr } = make();
    await startAr();
    await vi.waitFor(() => expect(sent().filter((m) => m.type === "pose").length).toBeGreaterThanOrEqual(2));
    const msgs = sent();
    const q = pitchQuat(-25);
    expect(msgs[0]).toEqual({ type: "reset", epoch: expect.any(String) });
    expect(msgs[1]).toEqual({ type: "start", position: [0, 1.4, 0], orientation: q, epoch: msgs[0]!.epoch, fixed: true });
    const poses = msgs.slice(2);
    expect(poses.every((m) => m.type === "pose")).toBe(true);
    for (const p of poses) expect(p).toMatchObject({ position: [0, 1.4, 0], orientation: q, tracking: "ok", epoch: msgs[0]!.epoch });
  });

  it("주소 칸 fov·pitch·h로 자세를 바꾼다", async () => {
    const { sent, startAr } = make({}, "?clip=cup-demo.mp4&pitch=-40&h=1.2");
    await startAr();
    expect(sent()[1]).toMatchObject({ type: "start", position: [0, 1.2, 0], orientation: pitchQuat(-40), fixed: true });
  });

  it("바닥은 AR y 0: pose floor_y는 높이(h)와 상관없이 0이고, 조준점은 시선이 y 0 바닥과 만나는 점", async () => {
    for (const [h, pitch] of [[0.5, -25], [3, -60]] as const) {
      const { sent, startAr } = make({}, `?clip=cup-demo.mp4&h=${h}&pitch=${pitch}`);
      await startAr();
      const pose = sent().find((m) => m.type === "pose")!;
      expect(pose.floor_y).toBe(0);
      expect(pose.hit_estimated).toBe(true);
      const run = h / Math.tan((-pitch * Math.PI) / 180);
      expect(pose.hit[0]).toBeCloseTo(0, 6);
      expect(pose.hit[1]).toBe(0);
      expect(pose.hit[2]).toBeCloseTo(-run, 6);
    }
  });

  it("engine_ms 2000에 영상이 0.5초씩 6번 나아가면 엔진 프레임 1~2장(고정 자세·투영·촬영 시각), 화면 프레임은 그보다 많다", async () => {
    const { ws, video, startAr, clock } = make();
    clock();
    await startAr();
    ws.push({ type: "status", aligned: true, engine_ms: 2000, sync: sync({ state: "aligned", source: "video", started: true }) });
    for (let i = 0; i < 6; i++) {
      video.advance(0.5);
      await flush();
    }
    const headers = await Promise.all(ws.packets.map(headerOf));
    const engine = headers.filter((h) => h.kind === "engine");
    const frames = headers.filter((h) => h.kind === "frame");
    expect(engine.length).toBeGreaterThanOrEqual(1);
    expect(engine.length).toBeLessThanOrEqual(2);
    expect(frames.length).toBeGreaterThan(engine.length);
    const epoch = ws.sent.find((m) => m.type === "reset")!.epoch;
    for (const h of engine) {
      expect(h.projection).toEqual(projectionFromFov(60, 720 / 1280));
      expect(h).toMatchObject({ position: [0, 1.4, 0], orientation: pitchQuat(-25), tracking: "ok", epoch, width: 360, height: 640 });
      expect(typeof h.captured_at).toBe("number");
      expect(typeof h.time_err_ms).toBe("number");
    }
    // 화면 프레임: 긴 변 780
    expect(frames[0]).toMatchObject({ width: 439, height: 780, position: [0, 1.4, 0], epoch });
    expect(video.drawTo).toHaveBeenCalled();
  });

  it("영상이 끝나면 프레임을 더 보내지 않는다(반복 없음)", async () => {
    const { ws, video, startAr } = make();
    await startAr();
    video.advance(0.5);
    await flush();
    const before = ws.packets.length;
    expect(before).toBeGreaterThan(0);
    video.end();
    video.advance(0.5);
    video.advance(0.5);
    await flush();
    expect(ws.packets.length).toBe(before);
    expect(window.__noonchiVideo?.ended).toBe(true);
  });
});

describe("영상 입력 모드: 시작 자세 다시 보내기", () => {
  const starts = (ws: FakeSocket) => ws.sent.filter((m) => m.type === "start");

  it("소켓이 붙기 전에 시작해도, 붙은 뒤 서버 sync가 none이면 같은 epoch로 start fixed를 다시 보낸다", async () => {
    const { ws, startAr } = make({}, undefined, { open: false });
    await startAr();
    expect(starts(ws)).toEqual([]);
    ws.open();
    ws.push({ type: "status", aligned: false, sync: sync() });
    expect(starts(ws)).toEqual([{ type: "start", position: [0, 1.4, 0], orientation: pitchQuat(-25), epoch: expect.any(String), fixed: true }]);
    await vi.waitFor(() => expect(ws.sent.some((m) => m.type === "pose")).toBe(true));
    expect(ws.sent.find((m) => m.type === "pose")!.epoch).toBe(starts(ws)[0]!.epoch);
  });

  it("start 답을 기다리는 동안 온 none(reset 답)에는 다시 보내지 않고, 맞춘 뒤 서버가 맞춤을 잃으면 다시 보낸다. 시작 자리가 없으면 보내지 않는다", async () => {
    const { ws, startAr } = make();
    await startAr();
    ws.push({ type: "status", aligned: false, sync: sync() });
    expect(starts(ws)).toHaveLength(1);
    ws.push(ALIGNED);
    ws.push({ type: "status", aligned: false, sync: sync() });
    expect(starts(ws)).toHaveLength(2);
    ws.push(ALIGNED);
    ws.push({ type: "status", aligned: false, sync: sync({ start: null }) });
    expect(starts(ws)).toHaveLength(2);
  });

  it("다시 붙으면(폰 서버를 다시 띄움) 새 연결의 none 상태에 start fixed를 다시 보낸다", async () => {
    const { ws, startAr } = make();
    await startAr();
    const epoch = ws.sent.find((m) => m.type === "reset")!.epoch;
    ws.drop();
    await vi.waitFor(() => expect(FakeSocket.last).not.toBe(ws), { timeout: 3000 });
    const next = FakeSocket.last;
    next.open();
    next.push({ type: "status", aligned: false, sync: sync() });
    expect(starts(next)).toEqual([{ type: "start", position: [0, 1.4, 0], orientation: pitchQuat(-25), epoch, fixed: true }]);
  });

  it("AR 전에는 none 상태가 와도 보내지 않는다", () => {
    const { c, ws } = make();
    ws.push({ type: "status", aligned: false, sync: sync() });
    expect(starts(ws)).toEqual([]);
    expect(c.view().ar).toBe(false);
  });
});

describe("영상 AR: 재생을 기다리는 동안 다시 시작·끝냄", () => {
  function direct() {
    const sent: Record<string, any>[] = [];
    const link = {
      send: (m: Record<string, any>) => { sent.push(m); return true; },
      socket: () => ({ readyState: 1, bufferedAmount: 0, send() {} }),
      stamp: () => ({}),
      open: () => true,
      close() {},
    };
    const g = gate();
    const videos: ReturnType<typeof fakeVideo>[] = [];
    const hooks = { onStart: vi.fn(), onEnd: vi.fn(), onHit() {}, onMarks() {}, onPerf() {}, note: vi.fn() };
    const ar = createVideoAr({
      link: link as never, params: new URLSearchParams(), hooks,
      deps: {
        clipUrl: "/phone/videos/x.mp4",
        createVideo: () => { const v = fakeVideo(); v.play = g.play; videos.push(v); return v; },
        createEncoder: fakeEncoder, createCanvas: fakeCanvas, screen: () => ({ width: 390, height: 844 }),
      },
    });
    return { ar, sent, videos, hooks, release: g.release };
  }

  it("두 번 시작하면 영상은 하나. 끝내면 그 영상을 닫고 그 뒤 pose를 보내지 않는다", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    const { ar, sent, videos, hooks, release } = direct();
    const a = ar.start({});
    const b = ar.start({});
    release();
    await Promise.all([a, b]);
    expect(videos).toHaveLength(1);
    expect(hooks.onStart).toHaveBeenCalledTimes(1);
    ar.stop();
    expect(videos[0]!.closed).toBe(1);
    expect(hooks.onEnd).toHaveBeenCalledTimes(1);
    const n = sent.length;
    vi.advanceTimersByTime(1000);
    expect(sent.length).toBe(n);
  });

  it("재생을 기다리는 동안 끝내면 그 영상을 닫고 시작하지 않는다(보내는 것 없음)", async () => {
    const { ar, sent, videos, hooks, release } = direct();
    const a = ar.start({});
    ar.stop();
    release();
    await a;
    await flush();
    expect(videos).toHaveLength(1);
    expect(videos[0]!.closed).toBe(1);
    expect(videos[0]!.element.isConnected).toBe(false);
    expect(hooks.onStart).not.toHaveBeenCalled();
    expect(sent).toEqual([]);
    expect(ar.state.on).toBe(false);
  });
});

describe("영상 입력 모드: 명령 시각 기록·화면", () => {
  it("명령을 받으면 그때 영상 시각과 글을 window.__noonchiVideo에 남긴다(같은 단계의 비전 상태만 바뀐 것은 한 번)", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const { c, ws, video, startAr } = make();
    await startAr();
    expect(typeof window.__noonchiVideo?.t0).toBe("number");
    video.advance(41.2);
    ws.push(command());
    ws.push(command({ vision: "식탁까지 1.0m", speak: false }));
    video.advance(3);
    ws.push(command({ step: "plan:pam-1:2", text: "컵을 들어 주세요" }));
    expect(window.__noonchiVideo!.commands).toEqual([
      { video_ms: 41200, id: "plan:pam-1", step: "plan:pam-1:1", text: "식탁으로 가 주세요" },
      { video_ms: 44200, id: "plan:pam-1", step: "plan:pam-1:2", text: "컵을 들어 주세요" },
    ]);
    expect(info.mock.calls.some((a) => String(a[0]).startsWith("[video]"))).toBe(true);
    expect((c as unknown as { view(): unknown }).view()).toBeTruthy();
  });

  it("t0: 시계를 맞추기 전에는 폰 시계의 재생 시작 시각, 맞춘 뒤 첫 프레임에서 서버 시계(오프셋 1000 ms)로 고친다", async () => {
    const { ws, video, startAr } = make();
    const b0 = phoneNow();
    await startAr();
    const a0 = phoneNow();
    const phoneT0 = window.__noonchiVideo!.t0!;
    expect(phoneT0).toBeGreaterThanOrEqual(Math.floor(b0) - 1);
    expect(phoneT0).toBeLessThanOrEqual(Math.ceil(a0) + 1);
    // 시계를 맞추기 전 프레임은 그대로 둔다
    video.advance(0.25);
    expect(window.__noonchiVideo!.t0).toBe(phoneT0);
    // 왕복 0으로 오프셋 1000 ms
    const ping = ws.sent.filter((m) => m.type === "clock").at(-1)!;
    ws.push({ type: "clock", t0: ping.t0, server: (ping.t0 + phoneNow()) / 2 + 1000 });
    const b1 = phoneNow();
    video.advance(0.25);
    const a1 = phoneNow();
    // 영상 0.5초 지점 프레임의 서버 시각 − 500
    const t0 = window.__noonchiVideo!.t0!;
    expect(t0).toBeGreaterThanOrEqual(Math.floor(b1 + 1000 - 500) - 2);
    expect(t0).toBeLessThanOrEqual(Math.ceil(a1 + 1000 - 500) + 2);
  });

  it("서버 sync가 맞춤(video)이면 「여기서 시작」 카드도, 시작 위치 모달도 뜨지 않는다. 맞추기 전 상태가 먼저 와도 열지 않는다", async () => {
    const { c, ws, startAr } = make();
    await startAr();
    ws.push({ type: "status", aligned: false, sync: sync() });
    expect(c.view().setup).toBeNull();
    ws.push({ type: "status", aligned: true, sync: sync({ state: "aligned", source: "video", started: true }) });
    expect(c.view().setup).toBeNull();
    expect(c.view().sync?.source).toBe("video");
    expect(problemOf(c.view())).toBeNull();
  });

  it("명령 대상 고리: 고정 자세·투영으로 잡고 화면 덮기(cover)로 옮긴다. 시선 가운데 대상은 화면 가운데", async () => {
    const { ws, video, marks, startAr } = make();
    await startAr();
    // 카메라(0,1.4,0)에서 아래 25°로 2m 앞
    const a = (-25 * Math.PI) / 180;
    const ahead: [number, number, number] = [0, 1.4 + 2 * Math.sin(a), -2 * Math.cos(a)];
    ws.push({ type: "status", aligned: true, sync: sync({ state: "aligned", source: "video", started: true }) });
    ws.push(command({ speak: false, target: { id: "table", label: "식탁", ar: ahead } }));
    video.advance(0.5);
    const m = marks.at(-1)!;
    expect(m.map((x) => x.id)).toEqual(["table"]);
    expect(m[0]!.u).toBeCloseTo(0.5, 5);
    expect(m[0]!.v).toBeCloseTo(0.5, 5);
    expect(m[0]!.off).toBe(false);
  });

  it("명령 대상 고리: 옆으로 비낀 대상은 화면 덮기 배율(세로가 꽉 차 가로 ×1.217)로 옮기고, 영상 안이지만 잘린 자리는 가장자리 세모", async () => {
    const { ws, video, marks, startAr } = make();
    await startAr();
    // 카메라(0,1.4,0)에서 아래 25°로 2m 앞, 영상 가로 자리 u(세로 가운데)에 보이는 점
    const p = projectionFromFov(60, 720 / 1280);
    const a = (-25 * Math.PI) / 180;
    const atVideoU = (u: number): [number, number, number] => [((2 * u - 1) * 2) / p[0]!, 1.4 + 2 * Math.sin(a), -2 * Math.cos(a)];
    const sx = (720 * (844 / 1280)) / 390;
    ws.push(ALIGNED);
    ws.push(command({ speak: false, target: { id: "cup", label: "컵", ar: atVideoU(0.3) } }));
    video.advance(0.5);
    const side = marks.at(-1)!;
    expect(side.map((x) => x.id)).toEqual(["cup"]);
    expect(side[0]!.u).toBeCloseTo(0.5 + (0.3 - 0.5) * sx, 5);
    expect(side[0]!.v).toBeCloseTo(0.5, 5);
    expect(side[0]!.off).toBe(false);
    // 영상 u 0.05 → 화면 u −0.048: 잘려 보이지 않는다
    ws.push(command({ step: "plan:pam-1:2", text: "컵을 들어 주세요", speak: false, target: { id: "sink", label: "싱크대", ar: atVideoU(0.05) } }));
    video.advance(0.5);
    const cut = marks.at(-1)!;
    expect(cut.map((x) => x.id)).toEqual(["sink"]);
    expect(0.5 + (0.05 - 0.5) * sx).toBeLessThan(0);
    expect(cut[0]!.off).toBe(true);
    expect(cut[0]!.u).toBeCloseTo(0.08, 5);
    expect(cut[0]!.v).toBeCloseTo(0.5, 5);
    expect(Math.abs(cut[0]!.angle)).toBeCloseTo(180, 3);
  });
});

describe("video-math", () => {
  it("projectionFromFov(60, 9/16): [5]는 1/tan(30°), [0]은 그것을 비율로 나눈 값, 열 우선 원근", () => {
    const p = projectionFromFov(60, 9 / 16);
    expect(p).toHaveLength(16);
    expect(p[5]).toBeCloseTo(1 / Math.tan(Math.PI / 6), 10);
    expect(p[0]).toBeCloseTo(1 / Math.tan(Math.PI / 6) / (9 / 16), 10);
    expect(p[11]).toBe(-1);
    expect(p[15]).toBe(0);
  });

  it("pitchQuat: x축으로 돌린다(음수면 아래)", () => {
    expect(pitchQuat(0)).toEqual([0, 0, 0, 1]);
    const q = pitchQuat(-90);
    expect(q[0]).toBeCloseTo(-Math.SQRT1_2, 10);
    expect(q[3]).toBeCloseTo(Math.SQRT1_2, 10);
  });

  it("coverMap(720,1280, 390,844): 가운데는 가운데, 세로가 꽉 차고 옆이 잘린다", () => {
    const m = coverMap(720, 1280, 390, 844);
    expect(m(0.5, 0.5)).toEqual([0.5, 0.5]);
    const [u0, v0] = m(0, 0);
    expect(v0).toBeCloseTo(0, 10);
    expect(u0).toBeLessThan(0);
  });

  it("viewMatrix: 시선 앞 점은 화면 가운데로 투영된다", () => {
    const q = pitchQuat(-25);
    const a = (-25 * Math.PI) / 180;
    const [m] = focusMarks([{ id: "x", label: "x", ar: [0, 1.4 + 3 * Math.sin(a), -3 * Math.cos(a)] }], projectionFromFov(60, 9 / 16), viewMatrix([0, 1.4, 0], q));
    expect(m!.u).toBeCloseTo(0.5, 6);
    expect(m!.v).toBeCloseTo(0.5, 6);
  });
});
