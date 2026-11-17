// 영상 입력 모드(?clip=, core/video-ar.js): 실제 카메라 대신 영상을 틀고, 고정 자세·투영으로 실제 폰과 같은 길로 보낸다.
// jsdom은 영상을 틀지 못하므로 영상·JPEG 인코딩·2D 그림판은 대역(arDeps)으로 넣는다.
// 지원은 바로 됨(http·WebXR 없어도), 명령은 실제 폰처럼 소리로 읽고 늘 듣기만 끔, reset → start fixed → pose, 화면·엔진 프레임 헤더, 명령 시각 기록,
// 맞춤 상태면 「여기서 시작」·시작 위치 모달 없음, 영상이 끝나면 프레임을 멈춘다. 단계 영상(step=)·go 단계 걷기·집기·놓기 대상 바라보기. video-math 표도 본다.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPhoneController, type ControllerDeps, type ControllerDraw } from "../src/phone/controller";
import { SYNC_MAX, createSyncLog, createVideoAr, videoParams } from "../src/phone/core/video-ar.js";
import { aboveGoal, coverMap, lookAt, pitchQuat, projectionFromFov, viewMatrix, walkGoal, yawOf, yawPitchQuat } from "../src/phone/core/video-math.js";
import { handOf, problemOf } from "../src/phone/state";
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
    /** 영상 시각을 s초 앞으로 하고 그 프레임을 now(performance 시각)에 알린다: 벽시계와 영상 시각이 다르게 가는 것(멈칫)을 흉내 낸다. */
    frameAt(s: number, now: number) {
      v.currentTime += s;
      const f = frameCb;
      frameCb = null;
      f?.(now);
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

/** later: 두 번째부터 만드는 영상(단계 영상)에 덮어쓸 칸(크기 등). */
function make(over: Partial<ControllerDeps> = {}, search = "?clip=cup-demo.mp4", { open = true, later = {} as Partial<ReturnType<typeof fakeVideo>> } = {}) {
  const spoken: string[] = [];
  const video = fakeVideo();
  const videos = [video];
  const encoder = fakeEncoder();
  const urls: string[] = [];
  const c = createPhoneController({
    location: { protocol: "http:", host: "127.0.0.1:8210", search },
    Socket: FakeSocket, Recognition: Rec as never, speak: (s, done) => { spoken.push(s); done(); },
    secure: false, xr: null,
    arDeps: {
      createVideo: (url: string) => {
        urls.push(url);
        if (urls.length === 1) return video;
        const v = Object.assign(fakeVideo(), later);
        videos.push(v);
        return v;
      },
      createEncoder: () => encoder,
      createCanvas: fakeCanvas,
      screen: () => ({ width: 390, height: 844 }),
    },
    ...over,
  });
  made.push(c);
  const ws = FakeSocket.last;
  if (open) ws.open();
  const sent = () => ws.sent.filter((m) => m.type !== "clock" && m.type !== "hello");
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
  return { c, ws, sent, spoken, video, videos, encoder, urls, marks, overlay, startAr, clock };
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

  it("B 명령이 떠 있을 때 reply가 오면 실제 폰처럼 명령·reply를 차례로 읽고 명령을 한 번 다시 읽으며, 엄지 자리 비전 상태 줄이 20초 동안 그 글(warn)이었다가 B 비전 상태로 돌아온다", () => {
    vi.useFakeTimers();
    const { c, ws, spoken } = make();
    ws.push(command());
    ws.push({ type: "reply", text: "인덕션이 다시 켜졌어요. 꺼 주세요" });
    expect(spoken).toEqual(["식탁으로 가 주세요", "인덕션이 다시 켜졌어요. 꺼 주세요", "식탁으로 가 주세요"]);
    expect(handOf(c.view())).toMatchObject({ top: "식탁으로 가 주세요", vision: { text: "인덕션이 다시 켜졌어요. 꺼 주세요", tone: "warn" } });
    vi.advanceTimersByTime(20_001);
    expect(handOf(c.view()).vision).toEqual({ text: "식탁까지 2.1m", tone: "plain" });
  });

  it("음성 인식만 만들지 않고(듣기 꺼짐), 명령은 실제 폰처럼 소리로 읽는다", async () => {
    const { c, ws, spoken, startAr } = make();
    await startAr();
    ws.push(command());
    expect(Rec.all).toHaveLength(0);
    expect(c.view().listening).toBe("off");
    expect(spoken).toEqual(["식탁으로 가 주세요"]);
    expect(c.view().command?.text).toBe("식탁으로 가 주세요");
  });

  it("소리 끝 알림이 오지 않아도(헤드리스 판정) 말 줄의 시간 상한으로 다음 말을 읽는다", async () => {
    vi.useFakeTimers();
    const said: string[] = [];
    const { ws } = make({ speak: (s) => { said.push(s); } });
    ws.push(command());
    ws.push({ type: "reply", text: "인덕션이 다시 켜졌어요. 꺼 주세요" });
    expect(said).toEqual(["식탁으로 가 주세요"]);
    vi.advanceTimersByTime(2000 + "식탁으로 가 주세요".length * 300);
    expect(said).toEqual(["식탁으로 가 주세요", "인덕션이 다시 켜졌어요. 꺼 주세요"]);
    vi.advanceTimersByTime(2000 + "인덕션이 다시 켜졌어요. 꺼 주세요".length * 300);
    expect(said).toEqual(["식탁으로 가 주세요", "인덕션이 다시 켜졌어요. 꺼 주세요", "식탁으로 가 주세요"]);
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

  it("engine_ms 100이면 영상 1초(50ms씩 20번) 동안 엔진 프레임이 9~10장 나간다", async () => {
    const { ws, video, startAr, clock } = make();
    clock();
    await startAr();
    ws.push({ type: "status", aligned: true, engine_ms: 100, sync: sync({ state: "aligned", source: "video", started: true }) });
    for (let i = 0; i < 20; i++) {
      video.advance(0.05);
      await flush();
    }
    const engine = (await Promise.all(ws.packets.map(headerOf))).filter((h) => h.kind === "engine");
    expect(engine.length).toBeGreaterThanOrEqual(9);
    expect(engine.length).toBeLessThanOrEqual(10);
  });

  it("앞 엔진 프레임 인코딩이 안 끝났으면 그 차례의 엔진 프레임은 건너뛰고 쌓지 않는다. 끝나면 다음 차례부터 다시 보낸다", async () => {
    const { ws, video, encoder, startAr, clock } = make();
    clock();
    await startAr();
    // 엔진 프레임(품질 0.8) 인코딩만 붙잡아 둔다
    const held: (() => void)[] = [];
    encoder.encode.mockImplementation(((_p: unknown, _w: number, _h: number, quality: number) => (
      quality === 0.8 ? new Promise<Blob>((ok) => held.push(() => ok(jpeg()))) : Promise.resolve(jpeg())
    )) as never);
    const engineJobs = () => encoder.encode.mock.calls.filter((c) => (c as unknown[])[3] === 0.8).length;
    ws.push({ type: "status", aligned: true, engine_ms: 100, sync: sync({ state: "aligned", source: "video", started: true }) });
    for (let i = 0; i < 20; i++) {
      video.advance(0.05);
      await flush();
    }
    expect(engineJobs()).toBe(1); // 1초 동안 열 번의 차례 가운데 첫 장만 인코딩에 들어갔다
    const frames = (await Promise.all(ws.packets.map(headerOf))).filter((h) => h.kind === "frame");
    expect(frames.length).toBeGreaterThan(5); // 표시 프레임은 그대로 나간다
    held.shift()!();
    await flush();
    for (let i = 0; i < 4; i++) {
      video.advance(0.05);
      await flush();
    }
    expect(engineJobs()).toBe(2); // 풀린 뒤 다음 차례 한 장(밀린 차례를 몰아 보내지 않는다)
    expect((await Promise.all(ws.packets.map(headerOf))).filter((h) => h.kind === "engine")).toHaveLength(1);
  });

  it("첫 영상이 끝나면 다시 틀지 않고(반복 없음) 영상 프레임 고리는 멈춘다. 그 뒤 프레임은 붙잡은 장면뿐이다", async () => {
    const { ws, video, startAr } = make();
    await startAr();
    video.advance(0.5);
    await flush();
    expect(ws.packets.length).toBeGreaterThan(0);
    video.end();
    const scheduled = vi.spyOn(video, "nextFrame");
    video.advance(0.5);
    await flush();
    expect(scheduled).not.toHaveBeenCalled();
    expect(video.played).toBe(1);
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

  describe("전체 화면(실제 AR immersive-ar는 그 자체로 전체 화면이라 영상 모드도 AR 시작 때 요청한다)", () => {
    const root = document.documentElement as unknown as Record<string, unknown>;
    const doc = document as unknown as Record<string, unknown>;
    let full: Element | null = null;
    const lock = vi.fn();
    beforeEach(() => {
      full = null;
      lock.mockClear();
      Object.defineProperty(document, "fullscreenElement", { configurable: true, get: () => full });
      Object.defineProperty(window.screen, "orientation", { configurable: true, value: { lock } });
    });
    afterEach(() => {
      delete root.requestFullscreen;
      delete doc.exitFullscreen;
      delete doc.fullscreenElement;
      delete (window.screen as unknown as Record<string, unknown>).orientation;
    });

    it("AR 시작(누른 순간) 페이지 전체 화면을 요청하고(navigationUI hide), 끝내면 푼다. 화면 방향은 고정하지 않는다", async () => {
      const request = vi.fn(async () => { full = document.documentElement; });
      const exit = vi.fn(async () => { full = null; });
      root.requestFullscreen = request;
      doc.exitFullscreen = exit;
      const { ar, videos, hooks, release } = direct();
      const started = ar.start({});
      expect(request).toHaveBeenCalledWith({ navigationUI: "hide" });
      release();
      await started;
      expect(videos).toHaveLength(1);
      expect(hooks.onStart).toHaveBeenCalledTimes(1);
      ar.stop();
      expect(exit).toHaveBeenCalledTimes(1);
      expect(lock).not.toHaveBeenCalled();
    });

    it("전체 화면을 지원하지 않거나 거절하거나 옵션을 못 받아도 영상은 그대로 시작하고, 전체 화면이 아니면 끝낼 때 풀지 않는다", async () => {
      const exit = vi.fn(async () => { full = null; });
      doc.exitFullscreen = exit;
      const noOptions = vi.fn((o?: unknown) => {
        if (o) throw new TypeError("options");
        full = document.documentElement;
        return Promise.resolve();
      });
      for (const request of [undefined, vi.fn(async () => { throw new Error("denied"); }), noOptions]) {
        full = null;
        if (request) root.requestFullscreen = request;
        else delete root.requestFullscreen;
        const { ar, videos, sent, hooks, release } = direct();
        const started = ar.start({});
        release();
        await started;
        expect(videos).toHaveLength(1);
        expect(hooks.onStart).toHaveBeenCalledTimes(1);
        expect(sent.some((m) => m.type === "start")).toBe(true);
        ar.stop();
      }
      // 옵션을 못 받는 브라우저는 옵션 없이 다시 요청해 전체 화면이 되고, 그때만 끝낼 때 푼다
      expect(noOptions.mock.calls).toEqual([[{ navigationUI: "hide" }], []]);
      expect(exit).toHaveBeenCalledTimes(1);
    });

    it("전체 화면 요청이 끝나기 전에 AR을 끝내면, 그 요청이 나중에 성공해도 바로 푼다. 다시 시작한 AR의 요청은 풀지 않는다", async () => {
      const pending: (() => void)[] = [];
      const request = vi.fn(() => new Promise<void>((resolve) => { pending.push(() => { full = document.documentElement; resolve(); }); }));
      const exit = vi.fn(async () => { full = null; });
      root.requestFullscreen = request;
      doc.exitFullscreen = exit;
      const settle = async (n: number) => {
        pending[n]!();
        for (let i = 0; i < 5; i++) await Promise.resolve();
      };
      const { ar, release } = direct();
      release();
      await ar.start({});
      ar.stop();
      expect(exit).not.toHaveBeenCalled();
      await settle(0);
      expect(exit).toHaveBeenCalledTimes(1);
      expect(full).toBeNull();
      // 끝낸 AR의 요청이 늦게 와도 다시 시작한 AR의 전체 화면은 그대로 둔다
      await ar.start({});
      ar.stop();
      await ar.start({});
      await settle(1);
      expect(exit).toHaveBeenCalledTimes(1);
      await settle(2);
      expect(full).toBe(document.documentElement);
      ar.stop();
      expect(exit).toHaveBeenCalledTimes(2);
    });

    it("실제 모드(ar.js)는 DOM 오버레이와 겹쳐 전체 화면을 요청하지 않는다", () => {
      const src = readFileSync(join(process.cwd(), "src", "phone", "core", "ar.js"), "utf8");
      expect(src).not.toMatch(/requestFullscreen/);
    });
  });

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

  it("docs/reference.md 영상 모드 설명은 단계 영상이 받는 종류(do 포함), 같은 칸의 차례 쓰기, 마지막 장면 붙잡기, 기록 칸(hold·at)을 적는다", () => {
    const doc = readFileSync(join(process.cwd(), "..", "docs", "reference.md"), "utf8");
    const kinds = ["go", "pick", "place", "do"].filter((k) => videoParams(new URLSearchParams(`clip=a.mp4&step=${k}:cup:a.mp4`))?.steps.length === 1);
    expect(kinds).toEqual(["go", "pick", "place", "do"]);
    expect(doc).toContain(`(여러 개, 종류 ${kinds.join("·")})`);
    expect(doc).toContain("같은 종류·낱말 칸이 여럿이면 적은 차례대로 쓴다");
    expect(doc).toContain("단계 영상이 끝나면 마지막 장면을 붙잡는다");
    expect(doc).toContain("첫 영상도 끝나면 마지막 장면을 붙잡는다");
    expect(doc).not.toContain("영상이 끝나면 프레임을 멈춘다");
    expect(doc).toMatch(/window\.__noonchiVideo = \{ t0, ended, hold, commands: .*clips: .*, at \}/);
  });

  it("말의 at 기록(at)은 화면이 바뀔 때마다 실제 폰 말과 같은 heardAtOf로 다시 쓴다: 안전 명령이 승인 카드를 가린 동안에는 승인 token을 싣지 않는다", async () => {
    const { ws, startAr } = make();
    await startAr();
    const DOOR = { token: "t1", deviceLabel: "현관문", reason: "현관문 잠금 해제", choices: [{ id: "approve", label: "승인" }, { id: "reject", label: "거절" }] };
    ws.push({ type: "reply", text: "", pending: [DOOR] });
    expect(window.__noonchiVideo!.at).toEqual({ kind: "none", pending: ["t1"] });
    ws.push(command({ id: "plan:pam-0", step: "off:plan:pam-0:induction_1:1", text: "인덕션을 꺼 주세요", grade: "safety" }));
    expect(window.__noonchiVideo!.at).toEqual({ kind: "command", id: "plan:pam-0", step: "off:plan:pam-0:induction_1:1", pending: [] });
    ws.push({ type: "command_clear", id: "plan:pam-0" });
    expect(window.__noonchiVideo!.at).toEqual({ kind: "none", pending: ["t1"] });
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

  // 2026-11-17 cup-empty --fake: 헤드리스 크롬에서 영상이 처음 17초 동안 여러 번 멈칫해(waiting) 영상 시각이 서버 시계보다 6.6초 늦어졌는데
  // 기록에는 첫 프레임의 t0 하나뿐이라, 판정 도구가 서버 사건을 폰 명령보다 약 8초 늦게 찍었다
  it("sync: 시계를 맞춘 뒤 프레임마다 서버 시각↔영상 시각을 견주고, 1:1로 이어 셀 수 없게 어긋나면(멈칫) 바로 앞 프레임 짝과 그 짝을 남긴다", async () => {
    const { ws, video, startAr } = make();
    await startAr();
    const ping = ws.sent.filter((m) => m.type === "clock").at(-1)!;
    ws.push({ type: "clock", t0: ping.t0, server: (ping.t0 + phoneNow()) / 2 + 1000 });
    const base = performance.now();
    video.frameAt(0.1, base);
    video.frameAt(0.1, base + 100);
    video.frameAt(0.1, base + 200);
    // 2초 멈칫: 벽시계 2.1초 동안 영상 0.1초
    video.frameAt(0.1, base + 2300);
    video.frameAt(0.1, base + 2400);
    const sync = window.__noonchiVideo!.sync!;
    // 멈칫 앞 끝(300)과 멈칫 뒤(400·500)를 짝으로 둔다
    expect(sync.map((p) => p[1]).slice(0, 3)).toEqual([100, 300, 400]);
    expect(sync[2]![0] - sync[1]![0]).toBeGreaterThanOrEqual(2099);
    expect(sync[2]![0] - sync[1]![0]).toBeLessThanOrEqual(2101);
    // 첫 짝은 t0와 같은 관계다(서버 시각 − 영상 시각)
    expect(Math.abs(sync[0]![0] - sync[0]![1] - window.__noonchiVideo!.t0!)).toBeLessThanOrEqual(1);
  });

  // Codex(f5ff586): 짝이 영상 프레임이 올 때만 남아, 멈칫하는 도중에 판정이 끝나면 마지막 구간을 1:1로 이어 세어 멈춘 시간을 놓쳤다
  it("sync: 프레임이 오지 않는 멈칫도 일정 간격(0.25초)으로 짝을 남기고, 끝낼 때 지금 짝을 남긴다", async () => {
    const link = {
      send: () => true, socket: () => ({ readyState: 1, bufferedAmount: 0, send() {} }), open: () => true, close() {},
      // 서버 시계 = 폰 시계 + 1000
      stamp: (ms: number) => ({ captured_at: Math.round(ms) + 1000 }),
    };
    const video = fakeVideo();
    const hooks = { onStart: vi.fn(), onEnd: vi.fn(), onHit() {}, onMarks() {}, onPerf() {}, note: vi.fn() };
    const ar = createVideoAr({
      link: link as never, params: new URLSearchParams(), hooks,
      deps: { clipUrl: "/phone/videos/x.mp4", createVideo: () => video, createEncoder: fakeEncoder, createCanvas: fakeCanvas, screen: () => ({ width: 390, height: 844 }) },
    });
    await ar.start({});
    video.frameAt(0.1, performance.now());
    expect(window.__noonchiVideo!.sync).toHaveLength(1);
    // 프레임 없이 0.7초(영상 시각은 0.1초 그대로)
    await new Promise((r) => setTimeout(r, 700));
    const stall = window.__noonchiVideo!.sync.at(-1)!;
    expect(stall[1]).toBe(100);
    expect(stall[0] - window.__noonchiVideo!.sync[0]![0]).toBeGreaterThanOrEqual(450);
    // 멈춘 동안의 짝은 같은 직선이라 양 끝점만 둔다(첫 짝 + 멈춤 끝)
    expect(window.__noonchiVideo!.sync).toHaveLength(2);
    await new Promise((r) => setTimeout(r, 120));
    ar.stop();
    const end = window.__noonchiVideo!.sync.at(-1)!;
    expect(end[1]).toBe(100);
    expect(phoneNow() + 1000 - end[0]).toBeLessThanOrEqual(60);
  });

  // Codex(9738b45): 시계 응답 전에 영상이 멈추면 다음 프레임이 올 때까지 주기·끝 짝도 건너뛰었다
  it("sync: 시계를 맞춘 뒤 프레임이 오지 않아도(멈칫) 주기 견주기가 t0를 서버 시계로 고치고 짝을 남긴다", async () => {
    let synced = false;
    const link = {
      send: () => true, socket: () => ({ readyState: 1, bufferedAmount: 0, send() {} }), open: () => true, close() {},
      // 시계 응답 전에는 서버 시각이 없다. 응답 뒤 서버 시계 = 폰 시계 + 1000
      stamp: (ms: number) => (synced ? { captured_at: Math.round(ms) + 1000 } : {}),
    };
    const video = fakeVideo();
    const hooks = { onStart: vi.fn(), onEnd: vi.fn(), onHit() {}, onMarks() {}, onPerf() {}, note: vi.fn() };
    const ar = createVideoAr({
      link: link as never, params: new URLSearchParams(), hooks,
      deps: { clipUrl: "/phone/videos/x.mp4", createVideo: () => video, createEncoder: fakeEncoder, createCanvas: fakeCanvas, screen: () => ({ width: 390, height: 844 }) },
    });
    await ar.start({});
    video.frameAt(0.1, performance.now());
    expect(window.__noonchiVideo!.sync).toHaveLength(0);
    synced = true;
    // 시계 응답 뒤 프레임 없이 0.6초
    await new Promise((r) => setTimeout(r, 600));
    const rec = window.__noonchiVideo!;
    expect(rec.sync.length).toBeGreaterThanOrEqual(1);
    expect(rec.sync.at(-1)![1]).toBe(100);
    // t0는 서버 시계로 고쳤다(첫 짝과 같은 관계)
    expect(Math.abs(rec.sync[0]![0] - rec.sync[0]![1] - rec.t0!)).toBeLessThanOrEqual(1);
    expect(Math.abs(rec.t0! - (phoneNow() + 1000 - 100))).toBeLessThanOrEqual(700);
    ar.stop();
  });

  describe("짝 줄이기(createSyncLog): 판정 도구가 옮길 때(짝 사이는 잇고 앞뒤는 1:1) 모든 표본의 오차가 50ms 안이다", () => {
    /** 짝으로 서버 시각 at의 영상 시각(scripts/video-check.ts videoClock과 같은 셈). */
    const mapAt = (sync: [number, number][], at: number) => {
      if (at <= sync[0]![0]) return sync[0]![1] - (sync[0]![0] - at);
      for (let i = 1; i < sync.length; i++) {
        const [a1, v1] = sync[i]!;
        if (at > a1) continue;
        const [a, v] = sync[i - 1]!;
        return a1 === a ? v1 : v + ((at - a) * (v1 - v)) / (a1 - a);
      }
      const [an, vn] = sync.at(-1)!;
      return vn + (at - an);
    };
    const run = (samples: [number, number][]) => {
      const sync: [number, number][] = [];
      const log = createSyncLog(sync);
      for (const [at, ms] of samples) log.note(at, ms);
      const worst = Math.max(...samples.map(([at, ms]) => Math.abs(mapAt(sync, at) - Math.round(ms))));
      return { sync, worst };
    };
    // Codex(9738b45): 멈춘 동안 같은 영상 시각의 짝을 초당 4개씩 쌓아, 1시간이면 약 14 400개를 판정기가 매초 읽었다
    it("1:1 3초 → 1분 멈춤(0.25초마다) → 1:1 2초: 짝 네 개 안", () => {
      const samples: [number, number][] = [[1000, 0]];
      for (let t = 1040; t <= 4000; t += 40) samples.push([t, t - 1000]);
      for (let t = 4250; t <= 64_000; t += 250) samples.push([t, 3000]);
      for (let t = 64_040; t <= 66_000; t += 40) samples.push([t, 3000 + (t - 64_000)]);
      const { sync, worst } = run(samples);
      expect(sync.length).toBeLessThanOrEqual(4);
      expect(worst).toBeLessThanOrEqual(51);
    });
    // Codex(c7fc7f3): 새 짝의 오차만 보고 끝점을 계속 바꿔 지운 표본의 오차가 쌓였다(20초 동안 속도가 서서히 줄면 가운데가 2.5초 틀어짐)
    it("20초 동안 재생 속도가 1에서 0.5로 서서히 줄어도(25fps) 모든 표본이 50ms 안이다", () => {
      const samples: [number, number][] = [];
      for (let t = 0; t <= 20_000; t += 40) samples.push([1_000_000 + t, t - (t * t) / 80_000]);
      const { sync, worst } = run(samples);
      expect(worst).toBeLessThanOrEqual(51);
      expect(sync.length).toBeLessThan(60);
    });
    // Codex(b89b077): 상한을 넘으면 앞쪽 짝을 버려, 판정 도구가 처음 서버 사건을 첫 남은 짝에서 1:1로 옮기며 쌓인 멈춤 시간만큼 틀렸다
    it("짝 수가 상한(SYNC_MAX)에 닿으면 앞 짝을 버리지 않고 「짝 넘침」을 한 번 알린 뒤 더 쌓지 않는다", () => {
      const samples: [number, number][] = [];
      for (let i = 0; i < SYNC_MAX * 3; i++) samples.push([i * 100, i * 100 + (i % 2 ? 300 : 0)]);
      const sync: [number, number][] = [];
      const full = vi.fn();
      const log = createSyncLog(sync, full);
      for (const [at, ms] of samples) log.note(at, ms);
      expect(sync).toHaveLength(SYNC_MAX);
      expect(sync[0]).toEqual(samples[0]);
      expect(full).toHaveBeenCalledTimes(1);
      const before = JSON.stringify(sync);
      log.note(samples.at(-1)![0] + 100, samples.at(-1)![1] + 100);
      expect(JSON.stringify(sync)).toBe(before);
    });
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

describe("영상 입력 모드: 단계 영상·걷기", () => {
  const STEPS = "?clip=cup-empty.mp4&step=go:table:go-table.mp4&step=pick:cup:pick-cup.mp4&step=go:sink:go-sink.mp4&step=place:sink:place-sink.mp4";
  const TABLE = { id: "dining_table_1", label: "식탁", ar: [0, 0.75, -1.5] };
  const CUP = { id: "cup_3", label: "컵", ar: [0.1, 0.8, -1.4] };
  const SINK = { id: "sink_1", label: "싱크대", ar: [1.2, 0.9, -1.6] };
  const goTable = (over: Record<string, unknown> = {}) => command({ kind: "go", target: TABLE, speak: false, ...over });
  const pickCup = (over: Record<string, unknown> = {}) =>
    command({ step: "plan:pam-1:2", text: "컵을 들어 주세요", vision: "컵 · 식탁 위", kind: "pick", target: CUP, speak: false, ...over });
  // 반응 시간(setTimeout)과 자세 타이머(100ms setInterval)를 시험이 옮긴다
  const fakeTimers = () => vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
  const after = (ms: number) => vi.advanceTimersByTimeAsync(ms);
  const lastPose = (sent: () => Record<string, any>[]) => sent().filter((m) => m.type === "pose").at(-1)!;
  const closeTo = (got: number[], want: number[]) => {
    expect(got).toHaveLength(want.length);
    got.forEach((x, i) => expect(x).toBeCloseTo(want[i]!, 6));
  };

  it("videoParams: step=<종류>:<낱말>:<영상>을 차례로 읽고 모양이 틀린 칸은 버린다. react는 초(0~10, 기본 1.5)를 ms로", () => {
    const p = new URLSearchParams("clip=cup-empty.mp4");
    for (const s of [
      "go:table:go-table.mp4", "pick:cup:pick-cup.webm", "jump:table:a.mp4", "go:Table:a.mp4", "go:table:../x.mp4", "go:table:a.mov",
      "go:table", "go:table:a.mp4:b", `place:sink:${"a".repeat(65)}.mp4`, "place:dining_table:place-sink.mp4", "go::a.mp4", "do:cup:pour-water.mp4",
    ]) p.append("step", s);
    expect(videoParams(p)!.steps).toEqual([
      { kind: "go", word: "table", clipUrl: "/phone/videos/go-table.mp4" },
      { kind: "pick", word: "cup", clipUrl: "/phone/videos/pick-cup.webm" },
      { kind: "place", word: "dining_table", clipUrl: "/phone/videos/place-sink.mp4" },
      { kind: "do", word: "cup", clipUrl: "/phone/videos/pour-water.mp4" },
    ]);
    expect(videoParams(new URLSearchParams("clip=a.mp4"))).toMatchObject({ steps: [], reactMs: 1500 });
    for (const [raw, ms] of [["0.4", 400], ["0", 0], ["-1", 0], ["99", 10000], ["x", 1500], ["", 1500]] as const) {
      expect(videoParams(new URLSearchParams(`clip=a.mp4&react=${raw}`))!.reactMs).toBe(ms);
    }
  });

  describe("같은 대상 단계 영상 차례·마지막 장면 붙잡기", () => {
    const MW = { id: "microwave_kitchen", label: "전자레인지", ar: [0.5, 1.0, -1.2] };
    const ORDER = "?clip=mw-start.mp4&step=do:microwave:a.mp4&step=do:microwave:b.mp4&step=do:microwave:c.mp4";
    const doMw = (step: string, text: string) => command({ step, text, kind: "do", target: MW, speak: false });
    const rec = () => (window as unknown as { __noonchiVideo: { hold: { clip: string; since: number } | null; clips: { video_ms: number; clip: string; duration_ms?: number }[] } }).__noonchiVideo;

    it("do:microwave:a·b·c가 있으면 전자레인지 대상 do 명령 셋에 a·b·c를 차례로 튼다. 같은 명령이 다시 와도(비전 상태만 바뀜) 다음 칸으로 넘기지 않는다", async () => {
      fakeTimers();
      const { ws, urls, startAr } = make({}, ORDER);
      await startAr();
      ws.push(ALIGNED);
      ws.push(doMw("plan:pam-1:2", "전자레인지 문을 열어 주세요"));
      await after(1500);
      ws.push({ ...doMw("plan:pam-1:2", "전자레인지 문을 열어 주세요"), vision: "전자레인지 문 열림" });
      await after(1500);
      expect(urls.slice(1)).toEqual(["/phone/videos/a.mp4"]);
      ws.push(doMw("plan:pam-1:4", "전자레인지 문을 닫아 주세요"));
      await after(1500);
      ws.push(doMw("plan:pam-1:5", "전자레인지를 켜 주세요"));
      await after(1500);
      expect(urls.slice(1)).toEqual(["/phone/videos/a.mp4", "/phone/videos/b.mp4", "/phone/videos/c.mp4"]);
      // 칸이 다 떨어지면 지금 영상을 둔다
      ws.push(doMw("plan:pam-1:8", "전자레인지 문을 열어 주세요"));
      await after(1500);
      expect(urls).toHaveLength(4);
    });

    it("칸이 하나면 지금처럼 맞는 새 명령마다 그 영상을 다시 튼다", async () => {
      fakeTimers();
      const { ws, urls, startAr } = make({}, "?clip=mw-start.mp4&step=do:microwave:a.mp4");
      await startAr();
      ws.push(ALIGNED);
      ws.push(doMw("plan:pam-1:2", "전자레인지 문을 열어 주세요"));
      await after(1500);
      ws.push(doMw("plan:pam-1:4", "전자레인지 문을 닫아 주세요"));
      await after(1500);
      expect(urls.slice(1)).toEqual(["/phone/videos/a.mp4", "/phone/videos/a.mp4"]);
    });

    it("단계 영상이 끝나면 hold가 그 영상·시각이 되고 5초 동안 엔진 프레임이 계속 나가며 그 영상의 마지막 장면을 그린다. 다음 단계 영상이 오면 hold가 null. clips에 duration_ms가 있다", async () => {
      fakeTimers();
      const { ws, videos, startAr } = make({}, ORDER, { later: { duration: 12 } as never });
      await startAr();
      ws.push({ ...ALIGNED, engine_ms: 500 });
      ws.push(doMw("plan:pam-1:2", "전자레인지 문을 열어 주세요"));
      await after(1500);
      const a = videos[1]!;
      expect(rec().clips.at(-1)).toMatchObject({ clip: "a.mp4", duration_ms: 12_000 });
      a.advance(12);
      await after(0);
      a.end();
      expect(rec().hold).toEqual({ clip: "a.mp4", since: expect.any(Number) });
      expect((window as unknown as { __noonchiVideo: { ended: boolean } }).__noonchiVideo.ended).toBe(false);
      const engineBefore = (await Promise.all(ws.packets.map(headerOf))).filter((h) => h.kind === "engine").length;
      const drawsBefore = a.drawTo.mock.calls.length;
      await after(5000);
      const engines = (await Promise.all(ws.packets.map(headerOf))).filter((h) => h.kind === "engine");
      const engineAfter = engines.length;
      expect(engineAfter - engineBefore).toBeGreaterThanOrEqual(8);
      // 붙잡은 장면은 held로 보내 서버가 같은 사진도 간격마다 새 관찰로 받게 한다. 붙잡기 전 프레임에는 없다
      expect(engines.slice(engineBefore).every((h) => h.held === true)).toBe(true);
      expect(engines.slice(0, engineBefore).some((h) => "held" in h)).toBe(false);
      expect(a.drawTo.mock.calls.length).toBeGreaterThan(drawsBefore);
      ws.push(doMw("plan:pam-1:4", "전자레인지 문을 닫아 주세요"));
      await after(1500);
      expect(rec().hold).toBeNull();
      expect(rec().clips.map((c) => c.clip)).toEqual(["a.mp4", "b.mp4"]);
    });

    it("첫 영상이 끝나도 단계 영상처럼 마지막 장면을 붙잡는다: ended는 참(첫 영상 끝), hold는 첫 영상·시각, 5초 동안 엔진 프레임이 held로 계속 나간다. 단계 영상이 오면 hold가 null(실제 폰처럼 계속 보여 판단 뒤 대상 다시 확인이 된다)", async () => {
      fakeTimers();
      const { ws, video, startAr } = make({}, ORDER);
      await startAr();
      ws.push({ ...ALIGNED, engine_ms: 500 });
      video.advance(32.5);
      await after(0);
      video.end();
      expect((window as unknown as { __noonchiVideo: { ended: boolean } }).__noonchiVideo.ended).toBe(true);
      expect(rec().hold).toEqual({ clip: "mw-start.mp4", since: 32500 });
      const engineBefore = (await Promise.all(ws.packets.map(headerOf))).filter((h) => h.kind === "engine").length;
      const drawsBefore = video.drawTo.mock.calls.length;
      await after(5000);
      const engines = (await Promise.all(ws.packets.map(headerOf))).filter((h) => h.kind === "engine");
      expect(engines.length - engineBefore).toBeGreaterThanOrEqual(8);
      expect(engines.slice(engineBefore).every((h) => h.held === true)).toBe(true);
      expect(video.drawTo.mock.calls.length).toBeGreaterThan(drawsBefore);
      expect(video.played).toBe(1);
      ws.push(doMw("plan:pam-1:2", "전자레인지 문을 열어 주세요"));
      await after(1500);
      expect(rec().hold).toBeNull();
      expect(rec().clips.map((c) => c.clip)).toEqual(["a.mp4"]);
    });

    it("붙잡는 동안 타이머는 프레임만 보내고 다음 프레임을 예약하지 않는다(예약 콜백이 늘지 않는다)", async () => {
      fakeTimers();
      const { ws, videos, startAr } = make({}, ORDER);
      await startAr();
      ws.push({ ...ALIGNED, engine_ms: 500 });
      ws.push(doMw("plan:pam-1:2", "전자레인지 문을 열어 주세요"));
      await after(1500);
      const a = videos[1]!;
      a.advance(1);
      await after(0);
      const scheduled = vi.spyOn(a, "nextFrame");
      a.end();
      const engineBefore = (await Promise.all(ws.packets.map(headerOf))).filter((h) => h.kind === "engine").length;
      await after(5000);
      const engineAfter = (await Promise.all(ws.packets.map(headerOf))).filter((h) => h.kind === "engine").length;
      expect(engineAfter - engineBefore).toBeGreaterThanOrEqual(8);
      expect(scheduled).not.toHaveBeenCalled();
    });
  });

  it("go 명령(대상 dining_table_1)이 오면 1.5초 뒤 go-table.mp4를 만들어 덮개 앞에 깔고 튼다. 그 전에는 바꾸지 않고, 바꾸면 앞 영상을 닫는다", async () => {
    fakeTimers();
    const { ws, urls, videos, overlay, startAr } = make({}, STEPS);
    await startAr();
    ws.push(ALIGNED);
    ws.push(goTable());
    await after(1400);
    expect(urls).toEqual(["/phone/videos/cup-empty.mp4"]);
    await after(100);
    expect(urls).toEqual(["/phone/videos/cup-empty.mp4", "/phone/videos/go-table.mp4"]);
    const next = videos[1]!;
    expect(next.played).toBe(1);
    expect(next.element.isConnected).toBe(true);
    expect(next.element.compareDocumentPosition(overlay) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(videos[0]!.closed).toBe(1);
    expect(videos[0]!.element.isConnected).toBe(false);
  });

  it("go 단계 영상으로 바꾸면 자세가 초당 0.8m로 대상 쪽으로 걸어 대상 0.6m 앞([0, 1.4, −0.9])에서 멈춘다. 높이·pitch는 그대로, 엔진·화면 프레임 머리도 새 자리", async () => {
    fakeTimers();
    const { ws, sent, videos, startAr } = make({}, STEPS);
    await startAr();
    ws.push({ ...ALIGNED, engine_ms: 500 });
    ws.push(goTable());
    await after(1500);
    const n = sent().filter((m) => m.type === "pose").length;
    await after(1000);
    // 자세 10번(1초) 동안 한 번에 0.08m씩(초당 0.8m) 식탁 쪽(−z)으로, 높이는 1.4m 그대로
    const walked = sent().filter((m) => m.type === "pose").slice(n);
    expect(walked).toHaveLength(10);
    walked.slice(1).forEach((p, i) => expect(walked[i]!.position[2] - p.position[2]).toBeCloseTo(0.08, 6));
    for (const p of walked) {
      expect(p.position[0]).toBeCloseTo(0, 6);
      expect(p.position[1]).toBeCloseTo(1.4, 6);
      closeTo(p.orientation, pitchQuat(-25));
    }
    await after(1000);
    closeTo(lastPose(sent).position, [0, 1.4, -0.9]);
    await after(1000);
    closeTo(lastPose(sent).position, [0, 1.4, -0.9]);
    closeTo(lastPose(sent).orientation, pitchQuat(-25));
    // 시작 자세는 그대로(AR 원점은 움직이지 않는다)
    expect(sent().filter((m) => m.type === "start").every((m) => m.position.join() === "0,1.4,0")).toBe(true);
    videos[1]!.advance(0.5);
    await after(0);
    const headers = await Promise.all(ws.packets.map(headerOf));
    const engine = headers.filter((h) => h.kind === "engine").at(-1)!;
    const frame = headers.filter((h) => h.kind === "frame").at(-1)!;
    closeTo(engine.position, [0, 1.4, -0.9]);
    closeTo(frame.position, [0, 1.4, -0.9]);
    closeTo(engine.orientation, pitchQuat(-25));
  });

  it("옆에 있는 대상으로 걸으면 대상 쪽으로 돌아 본다: 멈춘 뒤 대상 고리가 화면 가로 가운데, 숙인 각은 그대로", async () => {
    fakeTimers();
    const { ws, sent, videos, marks, startAr } = make({}, STEPS);
    await startAr();
    ws.push(ALIGNED);
    ws.push(command({ step: "plan:pam-1:3", text: "싱크대로 가 주세요", vision: "싱크대까지 2.0m", kind: "go", target: SINK, speak: false }));
    await after(1500 + 3000);
    // 거리 2m에서 1.4m 걸어 [0.84, 1.4, −1.12]
    closeTo(lastPose(sent).position, [0.84, 1.4, -1.12]);
    closeTo(lastPose(sent).orientation, yawPitchQuat(Math.atan2(-1.2, 1.6), -25));
    videos[1]!.advance(0.5);
    const m = marks.at(-1)!;
    expect(m.map((x) => x.id)).toEqual(["sink_1"]);
    expect(m[0]!.u).toBeCloseTo(0.5, 5);
    expect(m[0]!.off).toBe(false);
  });

  it("pick 명령은 1.5초 뒤 pick-cup.mp4로 바꾸고, 그 자리에서 컵 쪽으로 돌고 숙여 컵 고리가 화면 가운데. 엔진 프레임 머리도 새 자세, 다시 보내는 start는 처음 자세", async () => {
    fakeTimers();
    const { ws, sent, urls, videos, marks, startAr } = make({}, STEPS);
    await startAr();
    ws.push({ ...ALIGNED, engine_ms: 500 });
    ws.push(pickCup());
    await after(1400);
    expect(lastPose(sent).orientation).toEqual(pitchQuat(-25));
    await after(100);
    expect(urls.at(-1)).toBe("/phone/videos/pick-cup.mp4");
    await after(2000);
    // 컵 [0.1, 0.8, −1.4]: 수평 √1.97m 앞, 0.6m 아래
    const look = yawPitchQuat(Math.atan2(-0.1, 1.4), (Math.atan2(-0.6, Math.hypot(0.1, 1.4)) * 180) / Math.PI);
    expect(lastPose(sent).position).toEqual([0, 1.4, 0]);
    closeTo(lastPose(sent).orientation, look);
    videos[1]!.advance(0.5);
    await after(0);
    const m = marks.at(-1)!;
    expect(m.map((x) => x.id)).toEqual(["cup_3"]);
    expect(m[0]!.u).toBeCloseTo(0.5, 5);
    expect(m[0]!.v).toBeCloseTo(0.5, 5);
    const engine = (await Promise.all(ws.packets.map(headerOf))).filter((h) => h.kind === "engine").at(-1)!;
    closeTo(engine.orientation, look);
    ws.push({ type: "status", aligned: false, sync: sync() });
    expect(sent().filter((x) => x.type === "start").at(-1)).toMatchObject({ position: [0, 1.4, 0], orientation: pitchQuat(-25) });
  });

  it("do 명령(대상 id에 cup)이 오면 1.5초 뒤 pour-water.mp4로 바꿔 틀고, 걷지 않고 그 자리에서 대상을 본다. 같은 낱말의 pick 칸으로는 바꾸지 않는다", async () => {
    fakeTimers();
    const { ws, sent, urls, videos, marks, startAr } = make({}, `${STEPS}&step=do:cup:pour-water.mp4`);
    await startAr();
    ws.push({ ...ALIGNED, engine_ms: 500 });
    ws.push(command({ step: "plan:pam-1:4", text: "컵에 물을 따라 주세요", vision: "컵 · 비어 있음", kind: "do", target: CUP, speak: false }));
    await after(1400);
    expect(urls).toEqual(["/phone/videos/cup-empty.mp4"]);
    await after(100);
    expect(urls).toEqual(["/phone/videos/cup-empty.mp4", "/phone/videos/pour-water.mp4"]);
    expect(videos[1]!.played).toBe(1);
    expect(videos[0]!.closed).toBe(1);
    await after(2000);
    const look = yawPitchQuat(Math.atan2(-0.1, 1.4), (Math.atan2(-0.6, Math.hypot(0.1, 1.4)) * 180) / Math.PI);
    // 걷지 않는다: 자리는 그대로, 방향만 컵 쪽
    for (const p of sent().filter((m) => m.type === "pose")) expect(p.position).toEqual([0, 1.4, 0]);
    closeTo(lastPose(sent).orientation, look);
    videos[1]!.advance(0.5);
    await after(0);
    const m = marks.at(-1)!;
    expect(m.map((x) => x.id)).toEqual(["cup_3"]);
    expect(m[0]!.u).toBeCloseTo(0.5, 5);
  });

  describe("가까이 가서 보기(near_m·view above)", () => {
    const PEEK_STEPS = "?clip=cup-empty.mp4&step=go:cup:go-cup.mp4&step=do:cup:above-cup.mp4";
    const goCup = (over: Record<string, unknown> = {}) =>
      command({ step: "plan:pam-1:peek:cup_3:2:go:1", text: "컵 가까이 가 주세요", vision: "컵까지 1.4m", choices: [], kind: "go", near_m: 0.5, target: CUP, speak: true, ...over });
    const aboveCup = (over: Record<string, unknown> = {}) =>
      command({ step: "plan:pam-1:peek:cup_3:2:above:2", text: "컵 안이 보이게 위에서 비춰 주세요", vision: "컵 · 안이 안 보임", choices: [], kind: "do", view: "above", target: CUP, speak: true, ...over });
    const flatTo = (p: number[], t: number[]) => Math.hypot(p[0]! - t[0]!, p[2]! - t[2]!);

    it("go 명령에 near_m 0.5가 있으면 go-cup.mp4로 바꾸고 컵 0.4m 앞까지 걷는다(없으면 0.6m)", async () => {
      fakeTimers();
      const { ws, sent, urls, startAr } = make({}, PEEK_STEPS);
      await startAr();
      ws.push(ALIGNED);
      ws.push(goCup());
      await after(5000);
      expect(urls).toEqual(["/phone/videos/cup-empty.mp4", "/phone/videos/go-cup.mp4"]);
      expect(flatTo(lastPose(sent).position, CUP.ar)).toBeCloseTo(0.4, 6);
      const plain = make({}, PEEK_STEPS);
      await plain.startAr();
      plain.ws.push(ALIGNED);
      plain.ws.push(goCup({ near_m: undefined }));
      await after(5000);
      expect(flatTo(lastPose(plain.sent).position, CUP.ar)).toBeCloseTo(0.6, 6);
    });

    it("do 명령이 view above면 above-cup.mp4로 바꾸고 폰을 컵 입구 바로 위(수평 2cm, 위 40cm)로 옮겨 컵을 내려다본다", async () => {
      fakeTimers();
      const { ws, sent, urls, startAr } = make({}, PEEK_STEPS);
      await startAr();
      ws.push(ALIGNED);
      ws.push(aboveCup());
      await after(2000);
      expect(urls).toEqual(["/phone/videos/cup-empty.mp4", "/phone/videos/above-cup.mp4"]);
      const want = aboveGoal([0, 1.4, 0], CUP.ar as [number, number, number], 0.02, 0.4)!;
      closeTo(lastPose(sent).position, want.goal);
      closeTo(lastPose(sent).orientation, yawPitchQuat(want.yaw, want.pitchDeg));
      expect(flatTo(lastPose(sent).position, CUP.ar)).toBeCloseTo(0.02, 6);
      expect(lastPose(sent).position[1]).toBeCloseTo(1.2, 6);
    });

    it("반응 시간 전에 그 명령이 지워지면(command_clear) 영상을 바꾸지 않고 걷지 않는다. 걷는 중에 지워지면 그 자리에 멈춘다", async () => {
      fakeTimers();
      const { ws, sent, urls, startAr } = make({}, PEEK_STEPS);
      await startAr();
      ws.push(ALIGNED);
      ws.push(goCup());
      await after(1000);
      ws.push({ type: "command_clear", id: "plan:pam-1" });
      await after(3000);
      expect(urls).toEqual(["/phone/videos/cup-empty.mp4"]);
      for (const p of sent().filter((m) => m.type === "pose")) expect(p.position).toEqual([0, 1.4, 0]);
      const w = make({}, PEEK_STEPS);
      await w.startAr();
      w.ws.push(ALIGNED);
      w.ws.push(goCup());
      await after(2000);
      w.ws.push({ type: "command_clear", id: "plan:pam-1" });
      await after(100);
      const stop = lastPose(w.sent).position;
      await after(2000);
      closeTo(lastPose(w.sent).position, stop);
      expect(flatTo(stop, CUP.ar)).toBeGreaterThan(0.5);
    });

    it("컵 바로 위(수평 1cm 안)에서 위에서 비추기를 받아도 지금 보는 쪽을 써서 컵 위로 옮겨 내려다본다", async () => {
      fakeTimers();
      const { ws, sent, startAr } = make({}, PEEK_STEPS);
      await startAr();
      ws.push(ALIGNED);
      const below = { ...CUP, ar: [0, 0.8, 0] };
      ws.push(aboveCup({ target: below }));
      await after(2000);
      closeTo(lastPose(sent).position, [0, 1.2, 0.02]);
      const want = aboveGoal([0, 1.4, 0], below.ar, 0.02, 0.4, 0)!;
      closeTo(lastPose(sent).orientation, yawPitchQuat(want.yaw, want.pitchDeg));
    });

    it("맞는 단계 영상이 없는 새 명령(승인 질문 등)이 오면 앞 명령의 예약된 바꾸기와 걷기를 멈춘다. 같은 명령이 다시 오면(비전 상태만 바뀜) 멈추지 않는다", async () => {
      fakeTimers();
      const { ws, sent, urls, startAr } = make({}, PEEK_STEPS);
      await startAr();
      ws.push(ALIGNED);
      ws.push(goCup());
      await after(1000);
      ws.push(command({ step: "plan:pam-1:approve", text: "물 채우기를 할까요?", vision: null, choices: [{ id: "approve", label: "승인" }, { id: "reject", label: "거절" }], target: null }));
      await after(3000);
      expect(urls).toEqual(["/phone/videos/cup-empty.mp4"]);
      for (const p of sent().filter((m) => m.type === "pose")) expect(p.position).toEqual([0, 1.4, 0]);
      const w = make({}, PEEK_STEPS);
      await w.startAr();
      w.ws.push(ALIGNED);
      w.ws.push(goCup());
      await after(2000);
      w.ws.push(goCup({ vision: "컵까지 1.0m", speak: false }));
      await after(200);
      const mid = lastPose(w.sent).position;
      w.ws.push(command({ step: "plan:pam-1:approve", text: "물 채우기를 할까요?", vision: null, choices: [], target: null }));
      await after(2000);
      expect(flatTo(mid, CUP.ar)).toBeLessThan(flatTo([0, 1.4, 0], CUP.ar));
      closeTo(lastPose(w.sent).position, lastPose(w.sent).position);
      const stopAt = lastPose(w.sent).position;
      await after(1000);
      closeTo(lastPose(w.sent).position, stopAt);
      expect(flatTo(stopAt, CUP.ar)).toBeGreaterThan(0.45);
    });

    it("지운 명령과 같은 id·단계가 다시 오면 다시 예약해 바꾼다(예약만 하고 지운 것은 끝난 것이 아니다)", async () => {
      fakeTimers();
      const { ws, urls, startAr } = make({}, PEEK_STEPS);
      await startAr();
      ws.push(ALIGNED);
      ws.push(goCup());
      await after(1000);
      ws.push({ type: "command_clear", id: "plan:pam-1" });
      ws.push(goCup());
      await after(2000);
      expect(urls).toEqual(["/phone/videos/cup-empty.mp4", "/phone/videos/go-cup.mp4"]);
    });

    it("단계 영상을 열지 못하면(재생 실패) 예약이 풀려, 같은 명령이 다시 오면 다시 바꿔 본다", async () => {
      fakeTimers();
      const { ws, urls, startAr } = make({}, PEEK_STEPS, { later: { play: async () => { throw new Error("열 수 없음"); } } });
      await startAr();
      ws.push(ALIGNED);
      ws.push(goCup());
      await after(2000);
      expect(urls).toEqual(["/phone/videos/cup-empty.mp4", "/phone/videos/go-cup.mp4"]);
      ws.push(goCup({ vision: "컵까지 1.2m", speak: false }));
      await after(2000);
      expect(urls).toEqual(["/phone/videos/cup-empty.mp4", "/phone/videos/go-cup.mp4", "/phone/videos/go-cup.mp4"]);
    });

    it("시간 초과 질문 뒤 「계속」으로 같은 go 명령이 다시 오면 영상 칸을 더 쓰지 않고 걷기만 다시 시작한다", async () => {
      fakeTimers();
      const { ws, sent, urls, startAr } = make({}, PEEK_STEPS);
      await startAr();
      ws.push(ALIGNED);
      ws.push(goCup());
      await after(2000);
      ws.push(command({ step: "plan:pam-1:peek:cup_3:2:go:1:again", text: "계속할까요?", vision: null, choices: [], target: null }));
      await after(1000);
      const stopped = lastPose(sent).position;
      expect(flatTo(stopped, CUP.ar)).toBeGreaterThan(0.45);
      ws.push(goCup());
      await after(5000);
      expect(flatTo(lastPose(sent).position, CUP.ar)).toBeCloseTo(0.4, 6);
      expect(urls).toEqual(["/phone/videos/cup-empty.mp4", "/phone/videos/go-cup.mp4"]);
    });

    it("취소된 바꾸기는 단계 영상 칸을 쓰지 않는다: 같은 do:cup 칸이 둘이면 위에서 비추기를 지우고 다시 받아도 첫 칸을 튼다", async () => {
      fakeTimers();
      const { ws, urls, startAr } = make({}, "?clip=cup-empty.mp4&step=do:cup:above-a.mp4&step=do:cup:above-b.mp4");
      await startAr();
      ws.push(ALIGNED);
      ws.push(aboveCup());
      await after(1000);
      ws.push({ type: "command_clear", id: "plan:pam-1" });
      ws.push(aboveCup({ step: "plan:pam-1:peek:cup_3:2:above:3" }));
      await after(2000);
      expect(urls).toEqual(["/phone/videos/cup-empty.mp4", "/phone/videos/above-a.mp4"]);
      ws.push(aboveCup({ step: "plan:pam-1:peek:cup_3:2:above:4" }));
      await after(2000);
      expect(urls).toEqual(["/phone/videos/cup-empty.mp4", "/phone/videos/above-a.mp4", "/phone/videos/above-b.mp4"]);
    });

    it("새 영상 재생을 기다리는 동안 명령이 지워지면, 재생이 끝난 뒤 새 영상을 닫고 앞 영상과 자세를 그대로 둔다", async () => {
      fakeTimers();
      const g = gate();
      const { ws, sent, videos, startAr } = make({}, PEEK_STEPS, { later: { play: g.play } });
      await startAr();
      ws.push(ALIGNED);
      ws.push(goCup());
      await after(1500);
      expect(videos).toHaveLength(2);
      ws.push({ type: "command_clear", id: "plan:pam-1" });
      g.release();
      await after(2000);
      expect(videos[1]!.closed).toBe(1);
      expect(videos[0]!.closed).toBe(0);
      for (const p of sent().filter((m) => m.type === "pose")) expect(p.position).toEqual([0, 1.4, 0]);
    });
  });

  it("do 칸이 없으면 do 명령에는 영상을 바꾸지 않는다", async () => {
    fakeTimers();
    const { ws, urls, startAr } = make({}, STEPS);
    await startAr();
    ws.push(ALIGNED);
    ws.push(command({ step: "plan:pam-1:4", text: "컵에 물을 따라 주세요", vision: "컵 · 비어 있음", kind: "do", target: CUP, speak: false }));
    await after(3000);
    expect(urls).toEqual(["/phone/videos/cup-empty.mp4"]);
  });

  it("집기 뒤 go는 숙인 각 −25°로 걷고, place 명령이면 멈춘 자리에서 싱크대 윗면 쪽으로 숙여 고리가 화면 가운데", async () => {
    fakeTimers();
    const { ws, sent, videos, marks, startAr } = make({}, STEPS);
    await startAr();
    ws.push(ALIGNED);
    ws.push(pickCup());
    await after(1500);
    ws.push(command({ step: "plan:pam-1:3", text: "싱크대로 가 주세요", vision: "싱크대까지 2.0m", kind: "go", target: SINK, speak: false }));
    await after(1500 + 3000);
    const yaw = Math.atan2(-1.2, 1.6);
    closeTo(lastPose(sent).position, [0.84, 1.4, -1.12]);
    closeTo(lastPose(sent).orientation, yawPitchQuat(yaw, -25));
    ws.push(command({ step: "plan:pam-1:4", text: "컵을 싱크대에 넣어 주세요", vision: "컵 · 손에 있음", kind: "place", target: SINK, speak: false }));
    // 바꾼 자세는 다음 pose(100ms마다)에 실린다
    await after(1500 + 200);
    // 싱크대 [1.2, 0.9, −1.6]: 수평 0.6m 앞, 0.5m 아래
    closeTo(lastPose(sent).position, [0.84, 1.4, -1.12]);
    closeTo(lastPose(sent).orientation, yawPitchQuat(yaw, (Math.atan2(-0.5, 0.6) * 180) / Math.PI));
    videos[3]!.advance(0.5);
    const m = marks.at(-1)!;
    expect(m.map((x) => x.id)).toEqual(["sink_1"]);
    expect(m[0]!.u).toBeCloseTo(0.5, 5);
    expect(m[0]!.v).toBeCloseTo(0.5, 5);
  });

  it("걷는 중에 pick 영상으로 바꾸면 걷기를 멈추고 그 자리에서 컵을 본다", async () => {
    fakeTimers();
    const { ws, sent, startAr } = make({}, `${STEPS}&react=0`);
    await startAr();
    ws.push(ALIGNED);
    ws.push(goTable());
    await after(500);
    const at = lastPose(sent).position as number[];
    expect(at[2]).toBeLessThan(-0.2);
    expect(at[2]).toBeGreaterThan(-0.6);
    ws.push(pickCup());
    await after(1000);
    closeTo(lastPose(sent).position, at);
    const dz = -1.4 - at[2]!;
    closeTo(lastPose(sent).orientation, yawPitchQuat(Math.atan2(-0.1, -dz), (Math.atan2(-0.6, Math.hypot(0.1, dz)) * 180) / Math.PI));
  });

  /** 단계 영상 play를 부른 차례대로 따로 풀거나(release) 실패시킨다(fail). */
  const plays = () => {
    const list: { release: () => void; fail: () => void }[] = [];
    const play = () => new Promise<void>((resolve, reject) => { list.push({ release: resolve, fail: () => reject(new Error("열지 못함")) }); });
    return { play, list };
  };

  it("pick 단계 영상이 틀어지기 전에는 자세를 바꾸지 않아 앞 영상 프레임은 앞 자세로 간다. 틀어지면 영상과 자세를 함께 바꾼다", async () => {
    fakeTimers();
    const p = plays();
    const { ws, sent, video, videos, startAr } = make({}, STEPS, { later: { play: p.play } });
    await startAr();
    ws.push({ ...ALIGNED, engine_ms: 500 });
    ws.push(pickCup());
    await after(1500 + 500);
    expect(p.list).toHaveLength(1);
    closeTo(lastPose(sent).orientation, pitchQuat(-25));
    const before = ws.packets.length;
    video.advance(0.6);
    await after(0);
    const old = (await Promise.all(ws.packets.slice(before).map(headerOf))).find((h) => h.kind === "engine")!;
    closeTo(old.orientation, pitchQuat(-25));
    p.list[0]!.release();
    await after(200);
    const look = yawPitchQuat(Math.atan2(-0.1, 1.4), (Math.atan2(-0.6, Math.hypot(0.1, 1.4)) * 180) / Math.PI);
    closeTo(lastPose(sent).orientation, look);
    const n = ws.packets.length;
    videos[1]!.advance(0.6);
    await after(0);
    const fresh = (await Promise.all(ws.packets.slice(n).map(headerOf))).find((h) => h.kind === "engine")!;
    closeTo(fresh.orientation, look);
  });

  it("go 단계 영상이 틀어지기 전에는 걷지 않고, 틀어지면 걷기 시작한다", async () => {
    fakeTimers();
    const p = plays();
    const { ws, sent, startAr } = make({}, STEPS, { later: { play: p.play } });
    await startAr();
    ws.push(ALIGNED);
    ws.push(goTable());
    await after(1500 + 1000);
    expect(lastPose(sent).position).toEqual([0, 1.4, 0]);
    expect(lastPose(sent).orientation).toEqual(pitchQuat(-25));
    p.list[0]!.release();
    await after(1000);
    expect(lastPose(sent).position[2]).toBeLessThan(-0.6);
  });

  it("단계 영상을 열지 못하면 영상도 자세도 그대로다(걷지도 돌지도 않는다)", async () => {
    fakeTimers();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const p = plays();
    const { ws, sent, video, startAr } = make({}, STEPS, { later: { play: p.play } });
    await startAr();
    ws.push(ALIGNED);
    ws.push(goTable());
    await after(1500);
    p.list[0]!.fail();
    ws.push(pickCup());
    await after(1500);
    p.list[1]!.fail();
    await after(1000);
    expect(warn.mock.calls.filter((a) => String(a[0]).startsWith("[video] 단계 영상을 열지 못했어요"))).toHaveLength(2);
    expect(video.closed).toBe(0);
    expect(lastPose(sent).position).toEqual([0, 1.4, 0]);
    expect(lastPose(sent).orientation).toEqual(pitchQuat(-25));
  });

  it("앞서 건 단계 영상이 더 새 바꾸기보다 늦게 틀어지면 그 영상도 그 자세(걷기)도 쓰지 않는다", async () => {
    fakeTimers();
    const p = plays();
    const { ws, sent, videos, startAr } = make({}, STEPS, { later: { play: p.play } });
    await startAr();
    ws.push(ALIGNED);
    ws.push(goTable());
    await after(1500);
    ws.push(pickCup());
    await after(1500);
    expect(p.list).toHaveLength(2);
    p.list[1]!.release();
    await after(200);
    const look = yawPitchQuat(Math.atan2(-0.1, 1.4), (Math.atan2(-0.6, Math.hypot(0.1, 1.4)) * 180) / Math.PI);
    p.list[0]!.release();
    await after(1000);
    expect(videos[1]!.closed).toBe(1);
    expect(videos[2]!.closed).toBe(0);
    expect(lastPose(sent).position).toEqual([0, 1.4, 0]);
    closeTo(lastPose(sent).orientation, look);
  });

  it("대상이 바로 아래(수평 1cm 안)면 단계 영상만 바꾸고 자세는 그대로", async () => {
    fakeTimers();
    const { ws, sent, urls, startAr } = make({}, STEPS);
    await startAr();
    ws.push(ALIGNED);
    ws.push(pickCup({ target: { ...CUP, ar: [0.005, 0.8, -0.005] } }));
    await after(2000);
    expect(urls.at(-1)).toBe("/phone/videos/pick-cup.mp4");
    expect(lastPose(sent).position).toEqual([0, 1.4, 0]);
    expect(lastPose(sent).orientation).toEqual(pitchQuat(-25));
  });

  it("같은 id·step 명령이 비전 줄만 바뀌어 다시 와도 한 번만 바꾼다. 종류가 없거나 다르거나, 대상이 없거나 대상 id에 낱말이 없으면 바꾸지 않는다", async () => {
    fakeTimers();
    const { ws, urls, startAr } = make({}, STEPS);
    await startAr();
    ws.push(ALIGNED);
    ws.push(command({ kind: "go", target: null, speak: false }));
    ws.push(command({ target: TABLE, speak: false }));
    ws.push(command({ kind: "place", target: TABLE, speak: false }));
    ws.push(command({ kind: "go", target: { id: "sofa_1", label: "소파", ar: [1, 0.4, -2] }, speak: false }));
    await after(3000);
    expect(urls).toEqual(["/phone/videos/cup-empty.mp4"]);
    // 대상이 붙어 같은 명령이 다시 오면(기준점을 맞춘 뒤) 그때 바꾼다
    ws.push(goTable());
    await after(200);
    ws.push(goTable({ vision: "식탁까지 1.0m" }));
    await after(3000);
    ws.push(goTable({ vision: "식탁까지 0.8m" }));
    await after(3000);
    expect(urls).toEqual(["/phone/videos/cup-empty.mp4", "/phone/videos/go-table.mp4"]);
  });

  it("바꾼 뒤 영상 시각은 앞 영상 시각에서 이어 세고, record.clips에 바꾼 시각·이름을 남기고, 끝난 영상 뒤에도 ended를 풀고 프레임을 다시 보낸다", async () => {
    fakeTimers();
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const { ws, video, videos, startAr } = make({}, STEPS);
    await startAr();
    expect(window.__noonchiVideo!.clips).toEqual([]);
    video.advance(40);
    video.end();
    expect(window.__noonchiVideo!.ended).toBe(true);
    expect(info.mock.calls.some((a) => a[0] === "[video] 00:40.0 첫 영상 끝 · 마지막 장면 붙잡기 cup-empty.mp4")).toBe(true);
    ws.push(goTable());
    await after(1500);
    const next = videos[1]!;
    expect(window.__noonchiVideo!.ended).toBe(false);
    // 첫 영상 마지막 장면을 붙잡는 동안(약 1.5초)에도 영상 시각은 흐른다
    const go = window.__noonchiVideo!.clips[0]!;
    expect(go.clip).toBe("go-table.mp4");
    expect(go.video_ms).toBeGreaterThan(41_400);
    expect(go.video_ms).toBeLessThanOrEqual(41_500);
    const at = go.video_ms;
    expect(info.mock.calls.some((a) => a[0] === `[video] 00:${(at / 1000).toFixed(1)} 단계 영상 go-table.mp4`)).toBe(true);
    await after(0);
    const before = ws.packets.length;
    next.advance(2);
    await after(0);
    expect(ws.packets.length).toBeGreaterThan(before);
    ws.push(pickCup());
    expect(window.__noonchiVideo!.commands.at(-1)).toMatchObject({ video_ms: at + 2000, step: "plan:pam-1:2" });
    await after(1500);
    expect(window.__noonchiVideo!.clips.at(-1)).toEqual({ video_ms: at + 2000, clip: "pick-cup.mp4" });
    expect(next.closed).toBe(1);
    // 끝난 단계 영상도 이어 센 시각으로 남긴다: 마지막 장면을 붙잡고(hold) ended는 첫 영상 때만 참이다
    videos[2]!.advance(5);
    videos[2]!.end();
    expect(info.mock.calls.some((a) => a[0] === `[video] 00:${((at + 7000) / 1000).toFixed(1)} 단계 영상 끝 · 마지막 장면 붙잡기 pick-cup.mp4`)).toBe(true);
    expect(window.__noonchiVideo!.ended).toBe(false);
    expect(window.__noonchiVideo!.hold).toEqual({ clip: "pick-cup.mp4", since: at + 7000 });
  });

  it("크기가 다른 단계 영상(가로 1280×720)이면 투영·프레임 크기를 다시 정한다", async () => {
    fakeTimers();
    const { ws, videos, startAr } = make({}, STEPS, { later: { videoWidth: 1280, videoHeight: 720 } });
    await startAr();
    ws.push({ ...ALIGNED, engine_ms: 500 });
    ws.push(pickCup());
    await after(1500);
    await after(0);
    const before = ws.packets.length;
    videos[1]!.advance(0.5);
    await after(0);
    const headers = await Promise.all(ws.packets.slice(before).map(headerOf));
    const engine = headers.find((h) => h.kind === "engine")!;
    const frame = headers.find((h) => h.kind === "frame")!;
    expect(engine.projection).toEqual(projectionFromFov(60, 1280 / 720));
    expect(engine).toMatchObject({ width: 480, height: 270 });
    expect(frame).toMatchObject({ width: 780, height: 439 });
  });

  it("AR을 끝내면 기다리던 단계 영상 바꾸기를 하지 않고, 다시 시작하면 시작 자세·처음 보는 명령으로 다시 센다", async () => {
    fakeTimers();
    const sent: Record<string, any>[] = [];
    const link = {
      send: (m: Record<string, any>) => { sent.push(m); return true; },
      socket: () => ({ readyState: 1, bufferedAmount: 0, send() {} }),
      stamp: () => ({}),
      open: () => true,
      close() {},
    };
    const urls: string[] = [];
    const hooks = { onStart() {}, onEnd() {}, onHit() {}, onMarks() {}, onPerf() {}, note() {} };
    const ar = createVideoAr({
      link: link as never, params: new URLSearchParams(), hooks,
      deps: {
        ...videoParams(new URLSearchParams(STEPS))!,
        createVideo: (url: string) => { urls.push(url); return fakeVideo(); },
        createEncoder: fakeEncoder, createCanvas: fakeCanvas, screen: () => ({ width: 390, height: 844 }),
      },
    });
    await ar.start({});
    ar.command(goTable() as never);
    await after(2000);
    expect(urls).toEqual(["/phone/videos/cup-empty.mp4", "/phone/videos/go-table.mp4"]);
    expect(ar.state.position![2]).toBeLessThan(-0.3);
    ar.command(pickCup() as never);
    ar.stop();
    await after(3000);
    expect(urls).toHaveLength(2);
    await ar.start({});
    expect(ar.state.position).toEqual([0, 1.4, 0]);
    expect(sent.filter((m) => m.type === "pose").at(-1)!.position).toEqual([0, 1.4, 0]);
    ar.command(goTable() as never);
    await after(1500);
    expect(urls).toEqual(["/phone/videos/cup-empty.mp4", "/phone/videos/go-table.mp4", "/phone/videos/cup-empty.mp4", "/phone/videos/go-table.mp4"]);
  });

  describe("자세 흉내는 단계 영상과 따로: 맞는 칸이 없으면 go만 걷고, 그 밖은 화면이 돌지 않으므로 자세도 그대로 둔다", () => {
    const NO_STEPS = "?clip=cup-empty.mp4&step=pick:cup:pick-cup.mp4";
    const SPOT = { id: "find_cup", label: "식탁", ar: [0.1, 0.8, -1.4] };
    const flatTo = (p: number[], t: number[]) => Math.hypot(p[0]! - t[0]!, p[2]! - t[2]!);
    const aimSpot = (over: Record<string, unknown> = {}) =>
      command({ id: "find:1", step: "find:1:aim:2", text: "식탁 위를 비춰 주세요", vision: "식탁까지 0.8m", choices: [], kind: "do", target: SPOT, speak: true, ...over });

    // 2026-11-17 머그 실제 녹화(wide-mug.real2): 칸이 없는 비추기에 자세만 대상 쪽으로 돌려 사진(그대로인 영상)과 자세가 어긋났고,
    // 가까이 보기가 대상 자리 대신 커튼을 잘라 봐 컵을 못 찾았다
    it("칸이 없는 do·pick·place 명령은 영상도 자세도 그대로 둔다(view above도). 대상이 이미 화면 안이면 그 사진으로 서버가 비추기를 끝낸다", async () => {
      fakeTimers();
      const { ws, sent, urls, startAr } = make({}, NO_STEPS);
      await startAr();
      ws.push(ALIGNED);
      ws.push(aimSpot());
      await after(3000);
      ws.push(aimSpot({ step: "find:1:aim:3", view: "above" }));
      await after(3000);
      ws.push(command({ id: "plan:pam-1", step: "plan:pam-1:4", text: "컵을 싱크대에 넣어 주세요", kind: "place", target: SPOT, speak: false }));
      await after(3000);
      for (const p of sent().filter((m) => m.type === "pose")) {
        expect(p.position).toEqual([0, 1.4, 0]);
        expect(p.orientation).toEqual(pitchQuat(-25));
      }
      expect(urls).toEqual(["/phone/videos/cup-empty.mp4"]);
    });

    it("칸이 없는 go 명령(near_m 1.0)은 반응 시간 뒤 영상은 그대로 두고 대상 0.6m 앞까지 걷는다", async () => {
      fakeTimers();
      const { ws, sent, urls, startAr } = make({}, NO_STEPS);
      await startAr();
      ws.push(ALIGNED);
      ws.push(command({ id: "find:1", step: "find:1:go:1", text: "식탁으로 가 주세요", choices: [], kind: "go", near_m: 1, target: SPOT, speak: true }));
      await after(1400);
      expect(lastPose(sent).position).toEqual([0, 1.4, 0]);
      await after(3600);
      expect(flatTo(lastPose(sent).position, SPOT.ar)).toBeCloseTo(0.6, 6);
      expect(urls).toEqual(["/phone/videos/cup-empty.mp4"]);
    });

    it("같은 명령이 다시 와도(비전 상태만 바뀜) 다시 시작하지 않고, 새 명령·지우기면 예약된 자세 바꾸기를 멈춘다", async () => {
      fakeTimers();
      const { ws, sent, startAr } = make({}, NO_STEPS);
      await startAr();
      ws.push(ALIGNED);
      ws.push(command({ id: "find:1", step: "find:1:go:1", text: "식탁으로 가 주세요", choices: [], kind: "go", near_m: 1, target: SPOT, speak: true }));
      await after(2000);   // 반응 1.5초 뒤 0.5초 걸음(초당 0.8m)
      const mid = lastPose(sent).position;
      expect(flatTo(mid, SPOT.ar)).toBeGreaterThan(0.7);
      ws.push(command({ id: "find:1", step: "find:1:go:1", text: "식탁으로 가 주세요", vision: "식탁까지 1.0m", choices: [], kind: "go", near_m: 1, target: SPOT, speak: false }));
      await after(100);
      expect(flatTo(lastPose(sent).position, SPOT.ar)).toBeLessThan(flatTo(mid, SPOT.ar));
      ws.push({ type: "command_clear", id: "find:1" });
      await after(100);
      const stopped = lastPose(sent).position;
      await after(2000);
      expect(lastPose(sent).position).toEqual(stopped);
      // 예약 중 지우기: 걷지 않는다
      const b = make({}, NO_STEPS);
      await b.startAr();
      b.ws.push(ALIGNED);
      b.ws.push(command({ id: "find:1", step: "find:1:go:1", text: "식탁으로 가 주세요", choices: [], kind: "go", near_m: 1, target: SPOT, speak: true }));
      await after(500);
      b.ws.push({ type: "command_clear", id: "find:1" });
      await after(3000);
      expect(lastPose(b.sent).position).toEqual([0, 1.4, 0]);
    });

    it("질문·승인(대상 없음)은 자세를 바꾸지 않는다", async () => {
      fakeTimers();
      const { ws, sent, startAr } = make({}, NO_STEPS);
      await startAr();
      ws.push(ALIGNED);
      ws.push(command({ id: "plan:pam-1", step: "plan:pam-1:approve", text: "컵 치우기를 할까요?", choices: [{ id: "approve", label: "승인" }, { id: "reject", label: "거절" }], target: null, speak: true }));
      await after(3000);
      expect(lastPose(sent).position).toEqual([0, 1.4, 0]);
      expect(lastPose(sent).orientation).toEqual(pitchQuat(-25));
    });
  });
});

describe("video-math", () => {
  /** q·v·q* (쿼터니언 [x, y, z, w]으로 벡터를 돌림). */
  const rotate = ([x, y, z, w]: number[], [vx, vy, vz]: number[]) => {
    const tx = 2 * (y! * vz! - z! * vy!);
    const ty = 2 * (z! * vx! - x! * vz!);
    const tz = 2 * (x! * vy! - y! * vx!);
    return [vx! + w! * tx + (y! * tz - z! * ty), vy! + w! * ty + (z! * tx - x! * tz), vz! + w! * tz + (x! * ty - y! * tx)];
  };

  it("yawPitchQuat: yaw 0이면 pitchQuat와 같고, 시선(−z)은 yaw만큼 AR +y로 돌고 pitch만큼 숙인다. 오른쪽 축은 수평(옆으로 기울지 않음)", () => {
    yawPitchQuat(0, -25).forEach((x, i) => expect(x).toBeCloseTo(pitchQuat(-25)[i]!, 10));
    const p = (-25 * Math.PI) / 180;
    for (const yaw of [0, Math.PI / 2, -Math.PI / 2, Math.PI, 0.6, -2.2]) {
      const q = yawPitchQuat(yaw, -25);
      const want = [-Math.sin(yaw) * Math.cos(p), Math.sin(p), -Math.cos(yaw) * Math.cos(p)];
      rotate(q, [0, 0, -1]).forEach((x, i) => expect(x).toBeCloseTo(want[i]!, 10));
      expect(rotate(q, [1, 0, 0])[1]).toBeCloseTo(0, 10);
      expect(Math.hypot(...q)).toBeCloseTo(1, 10);
    }
  });

  it("walkGoal: 바닥 평면(x, z)에서 대상 stopM 앞에서 멈추고 높이는 출발 높이, yaw는 대상 쪽. 이미 stopM 안이면 null", () => {
    const rows: [number[], number[], number, number[] | null][] = [
      [[0, 1.4, 0], [0, 0.75, -1.5], 0.6, [0, 1.4, -0.9]],
      [[0, 1.4, 0], [2, 0.9, 0], 0.5, [1.5, 1.4, 0]],
      [[1, 1.2, 1], [-2, 0, 5], 1, [-1.4, 1.2, 4.2]],
      [[0, 1.4, 0], [0.3, 0, -0.4], 0.6, null],
      [[0, 1.4, 0], [0.36, 3, -0.48], 0.6, null],
    ];
    for (const [from, target, stop, goal] of rows) {
      const w = walkGoal(from as [number, number, number], target as [number, number, number], stop);
      if (goal === null) {
        expect(w).toBeNull();
        continue;
      }
      w!.goal.forEach((x, i) => expect(x).toBeCloseTo(goal[i]!, 10));
      expect(w!.yaw).toBeCloseTo(Math.atan2(-(target[0]! - from[0]!), -(target[2]! - from[2]!)), 10);
      // 그 yaw의 시선은 바닥 평면에서 대상 쪽
      const f = rotate(yawPitchQuat(w!.yaw, 0), [0, 0, -1]);
      const dx = target[0]! - w!.goal[0]!;
      const dz = target[2]! - w!.goal[2]!;
      expect(Math.hypot(dx, dz)).toBeCloseTo(stop, 10);
      expect(f[0]).toBeCloseTo(dx / stop, 10);
      expect(f[2]).toBeCloseTo(dz / stop, 10);
    }
  });

  it("lookAt: target을 보는 yaw(walkGoal과 같은 규칙)와 숙인 각(도, 아래가 음수). 그 자세의 시선(−z)은 target 쪽", () => {
    const rows: [number[], number[]][] = [
      [[0, 1.4, 0], [0, 0.4, -1]],
      [[0, 1.4, 0], [1, 1.4, 0]],
      [[1, 1.2, 1], [-2, 0, 5]],
      [[0.84, 1.4, -1.12], [1.2, 0.9, -1.6]],
      [[0, 1, 0], [0, 2, 1]],
    ];
    for (const [from, target] of rows) {
      const l = lookAt(from, target)!;
      const d = [target[0]! - from[0]!, target[1]! - from[1]!, target[2]! - from[2]!];
      expect(l.yaw).toBeCloseTo(Math.atan2(-d[0]!, -d[2]!), 10);
      expect(l.pitchDeg).toBeCloseTo((Math.atan2(d[1]!, Math.hypot(d[0]!, d[2]!)) * 180) / Math.PI, 10);
      const n = Math.hypot(...d);
      rotate(yawPitchQuat(l.yaw, l.pitchDeg), [0, 0, -1]).forEach((x, i) => expect(x).toBeCloseTo(d[i]! / n, 10));
    }
    expect(lookAt([0, 1.4, 0], [0, 0.4, -1])!.pitchDeg).toBeCloseTo(-45, 10);
    expect(lookAt([0, 1, 0], [0, 2, 1])!.pitchDeg).toBeCloseTo(45, 10);
  });

  it("aboveGoal: 대상에서 지금 자리 쪽으로 수평 backM, 대상 위 upM에 서서 대상을 내려다본다(수평 2cm·위 40cm면 숙인 각 약 87°)", () => {
    const a = aboveGoal([0, 1.4, 0], [0, 0.8, -1.4], 0.02, 0.4)!;
    a.goal.forEach((x, i) => expect(x).toBeCloseTo([0, 1.2, -1.38][i]!, 10));
    expect(a.pitchDeg).toBeCloseTo((Math.atan2(-0.4, 0.02) * 180) / Math.PI, 10);
    expect(a.pitchDeg).toBeLessThan(-87);
    const l = lookAt(a.goal, [0, 0.8, -1.4])!;
    expect(a.yaw).toBeCloseTo(l.yaw, 10);
    // 대상 바로 위(수평 1cm 안)에 서 있으면 지금 보는 쪽(yaw) 반대로 물러나 앞의 대상을 내려다본다
    const top = aboveGoal([0, 1.4, -1.4], [0, 0.8, -1.4], 0.02, 0.4, 0)!;
    top.goal.forEach((x, i) => expect(x).toBeCloseTo([0, 1.2, -1.38][i]!, 10));
    expect(top.pitchDeg).toBeLessThan(-87);
    expect(top.yaw).toBeCloseTo(0, 10);
    const side = aboveGoal([0.004, 1.4, 0], [0, 0.8, 0], 0.02, 0.4, Math.PI / 2)!;
    side.goal.forEach((x, i) => expect(x).toBeCloseTo([0.02, 1.2, 0][i]!, 10));
    expect(side.yaw).toBeCloseTo(Math.PI / 2, 10);
    for (const yaw of [0, 1, -2.5, Math.PI / 2]) expect(yawOf(yawPitchQuat(yaw, -30))).toBeCloseTo(yaw, 10);
  });

  it("lookAt: 수평 1cm 안(yaw를 못 정함)이거나 수가 아닌 값이면 null, 숙인 각은 ±89°까지", () => {
    for (const target of [[0, 0.8, 0], [0.006, 0, -0.006], [0, 3, 0]]) expect(lookAt([0, 1.4, 0], target)).toBeNull();
    for (const [from, target] of [[[0, 1.4, 0], [Number.NaN, 0, -1]], [[0, Infinity, 0], [0, 0, -1]], [[0, 1.4, 0], [0, 0]]] as const) {
      expect(lookAt(from, target)).toBeNull();
    }
    expect(lookAt([0, 1.4, 0], [0.011, 0, 0])!.pitchDeg).toBe(-89);
    expect(lookAt([0, 0, 0], [0.011, 2, 0])!.pitchDeg).toBe(89);
  });

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
