// 영상 입력 모드(?clip=, core/video-ar.js): 실제 카메라 대신 영상을 틀고, 고정 자세·투영으로 실제 폰과 같은 길로 보낸다.
// jsdom은 영상을 틀지 못하므로 영상·JPEG 인코딩·2D 그림판은 대역(arDeps)으로 넣는다.
// 지원은 바로 됨(http·WebXR 없어도), 소리 읽기·늘 듣기 없음, reset → start fixed → pose, 화면·엔진 프레임 헤더, 명령 시각 기록,
// 맞춤 상태면 「여기서 시작」·시작 위치 모달 없음, 영상이 끝나면 프레임을 멈춘다. 단계 영상(step=)·go 단계 걷기·집기·놓기 대상 바라보기. video-math 표도 본다.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPhoneController, type ControllerDeps, type ControllerDraw } from "../src/phone/controller";
import { createVideoAr, videoParams } from "../src/phone/core/video-ar.js";
import { coverMap, lookAt, pitchQuat, projectionFromFov, viewMatrix, walkGoal, yawPitchQuat } from "../src/phone/core/video-math.js";
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
    ws.push(goTable());
    await after(1500);
    const next = videos[1]!;
    expect(window.__noonchiVideo!.ended).toBe(false);
    expect(window.__noonchiVideo!.clips).toEqual([{ video_ms: 40000, clip: "go-table.mp4" }]);
    expect(info.mock.calls.some((a) => a[0] === "[video] 00:40.0 단계 영상 go-table.mp4")).toBe(true);
    await after(0);
    const before = ws.packets.length;
    next.advance(2);
    await after(0);
    expect(ws.packets.length).toBeGreaterThan(before);
    ws.push(pickCup());
    expect(window.__noonchiVideo!.commands.at(-1)).toMatchObject({ video_ms: 42000, step: "plan:pam-1:2" });
    await after(1500);
    expect(window.__noonchiVideo!.clips.at(-1)).toEqual({ video_ms: 42000, clip: "pick-cup.mp4" });
    expect(next.closed).toBe(1);
    // 끝난 단계 영상도 이어 센 시각으로 남긴다
    videos[2]!.advance(5);
    videos[2]!.end();
    expect(info.mock.calls.some((a) => a[0] === "[video] 00:47.0 영상 끝")).toBe(true);
    expect(window.__noonchiVideo!.ended).toBe(true);
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
