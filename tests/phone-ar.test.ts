// 폰 AR(ar.js)을 가짜 XR 세션으로 돌린다. 옮기기 전 phone.js와 같은 규칙인지 본다: 시작하면 원점 이름을 새로 정해 reset,
// 자세는 0.1초마다, 조준점·초점은 hooks로, 카메라가 있으면 화면 프레임(0.55, 초점 고리)·사진(원본, 0.9)·엔진 프레임(0.8, 투영 행렬·촬영 시각).
import { afterEach, describe, expect, it, vi } from "vitest";
import { createAr } from "../ui/src/phone/core/ar.js";

type Fn = (...a: any[]) => void;
const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

/** localFloor: 크롬이 local-floor를 주면 true(아니면 그 공간을 거절한다). */
function fakeSession({ localFloor = false } = {}) {
  const on: Record<string, Fn[]> = {};
  let raf: Fn | null = null;
  return {
    requested: [] as unknown[],
    renderState: { baseLayer: { framebuffer: "fb" } },
    updateRenderState() {},
    async requestReferenceSpace(kind: string) {
      if (kind === "local-floor" && !localFloor) throw new Error("NotSupportedError");
      return { kind, addEventListener: (t: string, f: Fn) => { (on[`space-${t}`] ??= []).push(f); } };
    },
    async requestHitTestSource() { return "hits"; },
    addEventListener(t: string, f: Fn) { (on[t] ??= []).push(f); },
    requestAnimationFrame(f: Fn) { raf = f; },
    // 세션은 한 번만 끝난다(같은 가짜를 다시 열면 새 end 처리만 남는다)
    end() { const ends = on.end ?? []; on.end = []; for (const f of ends) f(); },
    fire(t: string) { for (const f of on[t] ?? []) f(); },
    step(time: number, frame: unknown) { const f = raf; raf = null; f?.(time, frame); },
  };
}

/** x축으로 deg도 돌린 폰 방향(음수면 아래를 본다). */
const pitch = (deg: number) => { const r = (deg * Math.PI) / 360; return { x: Math.sin(r), y: 0, z: 0, w: Math.cos(r) }; };

/** look: 폰 방향(기본은 수평 앞). floorY: local-floor 원점의 local 높이. */
function frame({ hit = [0, 0, -1] as number[] | null, pose = true, camera = false, limited = false, look = { x: 0, y: 0, z: 0, w: 1 }, floorY = 0 } = {}) {
  return {
    getHitTestResults: () => (hit ? [{ getPose: () => ({ transform: { position: { x: hit[0], y: hit[1], z: hit[2] }, orientation: { x: 0, y: 0, z: 0, w: 1 } } }) }] : []),
    getPose: (space: { kind: string }, base: { kind: string }) =>
      (space.kind === "local-floor" && base.kind === "local" ? { transform: { position: { x: 0, y: floorY, z: 0 } } } : null),
    getViewerPose: () => (pose ? {
      emulatedPosition: limited,
      transform: { position: { x: 0, y: 1.5, z: 0 }, orientation: look },
      views: [{ projectionMatrix: identity, transform: { inverse: { matrix: identity } }, camera: camera ? { width: 640, height: 480 } : undefined }],
    } : null),
  };
}

/** [헤더 길이 u32][JSON 헤더][JPEG] 묶음의 헤더. */
async function header(blob: Blob) {
  const b = new Uint8Array(await blob.arrayBuffer());
  const n = new DataView(b.buffer, b.byteOffset).getUint32(0);
  return JSON.parse(new TextDecoder().decode(b.subarray(4, 4 + n)));
}

function setup({ camera = false, localFloor = false } = {}) {
  const session = fakeSession({ localFloor });
  const released = { grabber: 0, gl: 0 };
  const sent: Record<string, any>[] = [];
  const socket = { readyState: 1, bufferedAmount: 0, binary: [] as Blob[], send(d: Blob) { this.binary.push(d); } };
  const link = { send: (m: Record<string, unknown>) => { sent.push(m); return true; }, socket: () => socket, open: () => true, stamp: () => ({ captured_at: 5, time_err_ms: 1 }), close() {} };
  const log: string[] = [];
  const marks: unknown[][] = [];
  const hooks = {
    onStart: () => log.push("start"), onEnd: () => log.push("end"),
    onHit: (h: boolean, estimated: boolean) => log.push(h ? (estimated ? "estimated" : "hit") : "miss"), onMarks: (m: unknown[]) => marks.push(m),
    onPerf: () => log.push("perf"), note: (text: string) => log.push(`note ${text}`),
  };
  const toJpeg = vi.fn(async (..._args: unknown[]) => new Blob([new Uint8Array([0xff, 0xd8, 0xff])]));
  const grab = vi.fn((_t: unknown, w: number, h: number) => new Uint8Array(w * h * 4));
  const deps = {
    xr: () => ({ requestSession: async (mode: string, opts: unknown) => { session.requested.push([mode, opts]); return session; } }),
    gl: () => ({
      FRAMEBUFFER: 1, COLOR_BUFFER_BIT: 2, bindFramebuffer() {}, clearColor() {}, clear() {},
      getExtension: (name: string) => (name === "WEBGL_lose_context" ? { loseContext: () => { released.gl += 1; } } : null),
    }),
    layer: () => ({}),
    binding: () => (camera ? { getCameraImage: () => "texture" } : null),
    createGrabber: () => ({
      encoderMode: "worker×2", grab, toJpeg,
      close: () => { released.grabber += 1; },
    }),
    createDisplayEncoder: () => ({ frame() {}, close() {}, describe: () => "표시 영상 시험" }),
  };
  const ar = createAr({ link, params: new URLSearchParams(""), hooks, deps });
  stops.push(() => ar.stop());
  return { ar, session, sent, socket, log, marks, toJpeg, grab, released };
}

const overlay = {};
const stops: (() => void)[] = [];
afterEach(() => { while (stops.length) stops.pop()!(); });

describe("폰 AR(ar.js)", () => {
  it("시작: DOM 오버레이·hit-test로 세션을 열고, 새 원점 이름으로 reset을 보낸다. 카메라가 없으면 「카메라 없음」", async () => {
    const t = setup();
    await t.ar.start(overlay);
    expect(t.session.requested).toEqual([["immersive-ar", { requiredFeatures: ["local", "hit-test", "dom-overlay"], optionalFeatures: ["camera-access", "local-floor"], domOverlay: { root: overlay } }]]);
    expect(t.log[0]).toBe("start");
    expect(t.ar.state.on).toBe(true);
    expect(t.ar.state.epoch).toMatch(/^[0-9a-z]+-[0-9a-z]{1,6}$/);
    expect(t.sent).toEqual([{ type: "reset", epoch: t.ar.state.epoch }]);
    expect(t.ar.state.encoder).toBe("카메라 없음");
  });

  it("자세는 0.1초마다 조준점·원점 이름과 함께. 조준점이 바닥에 닿으면 hit", async () => {
    const t = setup();
    await t.ar.start(overlay);
    for (const time of [100, 150, 200]) t.session.step(time, frame());
    const poses = t.sent.filter((m) => m.type === "pose");
    expect(poses).toHaveLength(2);
    expect(poses[0]).toEqual({ type: "pose", position: [0, 1.5, 0], orientation: [0, 0, 0, 1], tracking: "ok", hit: [0, 0, -1], hit_estimated: false, hit_normal: [0, 1, 0], floor_y: 0, epoch: t.ar.state.epoch });
    expect([t.ar.state.position, t.ar.state.orientation]).toEqual([[0, 1.5, 0], [0, 0, 0, 1]]);
    expect(t.log.filter((l) => l === "hit")).toHaveLength(3);
    t.session.step(300, frame({ hit: null }));
    expect(t.log.at(-1)).toBe("miss");
    expect(t.ar.state.hitPoint).toBeNull();
  });

  it("hit-test 점이 없으면 시선이 어림 바닥(폰 1.5m 아래)과 만나는 점을 조준점으로 쓰고, 어림이라고 알린다", async () => {
    const t = setup();
    await t.ar.start(overlay);
    t.session.step(100, frame({ hit: null, look: pitch(-45) }));
    expect(t.log.at(-1)).toBe("estimated");
    expect(t.ar.state.hitEstimated).toBe(true);
    const pose = t.sent.filter((m) => m.type === "pose").at(-1)!;
    expect(pose.hit_estimated).toBe(true);
    pose.hit.forEach((v: number, i: number) => expect(v).toBeCloseTo([0, 0, -1.5][i]!, 6));
    // hit-test 점이 생기면 그 점(어림 아님)
    t.session.step(200, frame({ look: pitch(-45) }));
    expect([t.log.at(-1), t.ar.state.hitEstimated, t.ar.state.hitPoint]).toEqual(["hit", false, [0, 0, -1]]);
    // 위를 보면 닿지 않음
    t.session.step(300, frame({ hit: null, look: pitch(10) }));
    expect([t.log.at(-1), t.ar.state.hitPoint]).toEqual(["miss", null]);
  });

  it("크롬이 local-floor를 주면 그 바닥 높이(local 좌표)로 어림한다", async () => {
    const t = setup({ localFloor: true });
    await t.ar.start(overlay);
    t.session.step(100, frame({ hit: null, look: pitch(-45), floorY: 0.2 }));
    t.ar.state.hitPoint!.forEach((v, i) => expect(v).toBeCloseTo([0, 0.2, -1.3][i]!, 6));
    expect(t.ar.state.hitEstimated).toBe(true);
  });

  it("자세가 없으면 자세·초점을 보내지 않는다. 추적이 약하면 limited", async () => {
    const t = setup();
    await t.ar.start(overlay);
    t.session.step(100, frame({ pose: false }));
    expect(t.sent.filter((m) => m.type === "pose")).toEqual([]);
    expect(t.marks).toEqual([]);
    t.session.step(200, frame({ limited: true }));
    expect(t.ar.state.limited).toBe(true);
    expect(t.sent.at(-1)).toMatchObject({ type: "pose", tracking: "limited" });
  });

  it("초점: 기간 안에는 화면 위 표시(u·v)를 hooks로, 지나면 빈 목록", async () => {
    const t = setup();
    await t.ar.start(overlay);
    t.ar.setFocus([{ id: "cup", label: "컵", ar: [0, 0, -0.5] }], 8000);
    t.session.step(100, frame());
    expect(t.marks.at(-1)).toEqual([{ id: "cup", label: "컵", u: 0.5, v: 0.5, off: false, angle: 0 }]);
    t.session.step(performance.now() + 9000, frame());
    expect(t.marks.at(-1)).toEqual([]);
  });

  it("추적 원점이 바뀌면 원점 이름을 새로 정해 reset을 보내고 다시 기록하라고 알린다", async () => {
    const t = setup();
    await t.ar.start(overlay);
    const first = t.ar.state.epoch;
    t.session.fire("space-reset");
    expect(t.ar.state.epoch).not.toBe(first);
    expect(t.sent.at(-1)).toEqual({ type: "reset", epoch: t.ar.state.epoch });
    expect(t.log).toContain("note 추적 원점이 바뀌어 맞춤을 지웠어요. 시작 위치에서 다시 맞춰 주세요");
  });

  it("끝내면 초점 표시를 지우고 덮개를 닫는다", async () => {
    const t = setup();
    await t.ar.start(overlay);
    t.ar.stop();
    expect(t.marks.at(-1)).toEqual([]);
    expect(t.log.at(-1)).toBe("end");
    expect(t.ar.state.on).toBe(false);
  });

  it("끝내면 인코딩 워커(잡기)와 WebGL 컨텍스트를 놓는다. 다시 시작하면 새로 만들고 끝낼 때 또 놓는다", async () => {
    const t = setup({ camera: true });
    await t.ar.start(overlay);
    t.ar.stop();
    expect(t.released).toEqual({ grabber: 1, gl: 1 });
    await t.ar.start(overlay);
    t.ar.stop();
    expect(t.released).toEqual({ grabber: 2, gl: 2 });
  });

  it("3초 안에 끝내면 카메라 확인 알림을 띄우지 않는다", async () => {
    vi.useFakeTimers();
    try {
      const t = setup();
      await t.ar.start(overlay);
      t.ar.stop();
      vi.advanceTimersByTime(5000);
      expect(t.log.filter((l) => l.startsWith("note"))).toEqual([]);
    } finally { vi.useRealTimers(); }
  });

  it("카메라가 있으면 화면 프레임·사진·엔진 프레임을 보낸다", async () => {
    const t = setup({ camera: true });
    await t.ar.start(overlay);
    expect(t.ar.state.encoder).toBe("worker×2");
    t.ar.setFocus([{ id: "cup", label: "컵", ar: [0, 0, -0.5] }], 8000);
    t.session.step(100, frame({ camera: true }));
    await vi.waitFor(() => expect(t.socket.binary).toHaveLength(1));
    expect(await header(t.socket.binary[0]!)).toMatchObject({ kind: "frame", width: 480, height: 360, tracking: "ok", epoch: t.ar.state.epoch, captured_at: 5, time_err_ms: 1 });
    expect(t.toJpeg.mock.calls[0]!.slice(1, 4)).toEqual([480, 360, 0.55]);
    expect(t.toJpeg.mock.calls[0]![4]).toHaveLength(1);
    t.ar.requestPhoto();
    t.session.step(110, frame({ camera: true })); // 사진은 화면 프레임 간격과 상관없이 바로
    await vi.waitFor(() => expect(t.socket.binary).toHaveLength(2));
    expect(await header(t.socket.binary[1]!)).toMatchObject({ kind: "photo", width: 640, height: 480 });
    expect(t.toJpeg.mock.calls[1]!.slice(1, 5)).toEqual([640, 480, 0.9, []]);
    t.ar.setEngineMs(1000);
    t.session.step(120, frame({ camera: true })); // 화면 프레임 간격 전: 엔진 프레임만
    await vi.waitFor(() => expect(t.socket.binary).toHaveLength(3));
    expect(await header(t.socket.binary[2]!)).toMatchObject({ kind: "engine", width: 480, height: 360, projection: identity, captured_at: 5 });
    expect(t.toJpeg.mock.calls[2]!.slice(3, 5)).toEqual([0.8, []]);
  });

  it("엔진 프레임 간격 100ms: 그림 틀이 16.7ms마다 1초 동안 오면 엔진 프레임이 9~10장 나간다", async () => {
    const t = setup({ camera: true });
    await t.ar.start(overlay);
    t.ar.setEngineMs(100);
    for (let k = 0; k < 60; k++) {
      t.session.step(1000 + (k * 1000) / 60, frame({ camera: true }));
      await new Promise((r) => setTimeout(r, 0));
    }
    const engine = t.toJpeg.mock.calls.filter((c) => c[3] === 0.8);
    expect(engine.length).toBeGreaterThanOrEqual(9);
    expect(engine.length).toBeLessThanOrEqual(10);
    const kinds = await Promise.all(t.socket.binary.map(async (b) => (await header(b)).kind));
    expect(kinds.filter((k) => k === "engine")).toHaveLength(engine.length);
  });

  it("앞 엔진 프레임 인코딩이 안 끝났으면 그 차례는 건너뛰고 쌓지 않는다. 표시 프레임은 그대로 나가고, 측정 줄에 건너뛴 수가 보인다", async () => {
    const t = setup({ camera: true });
    await t.ar.start(overlay);
    const held: (() => void)[] = [];
    t.toJpeg.mockImplementation(((..._a: unknown[]) => (
      _a[3] === 0.8 ? new Promise<Blob>((ok) => held.push(() => ok(new Blob([new Uint8Array([0xff, 0xd8, 0xff])])))) : Promise.resolve(new Blob([new Uint8Array([0xff, 0xd8, 0xff])]))
    )) as never);
    t.ar.setEngineMs(100);
    for (let k = 0; k < 60; k++) {
      t.session.step(1000 + (k * 1000) / 60, frame({ camera: true }));
      await new Promise((r) => setTimeout(r, 0));
    }
    expect(t.toJpeg.mock.calls.filter((c) => c[3] === 0.8)).toHaveLength(1);
    expect(t.toJpeg.mock.calls.filter((c) => c[3] === 0.55).length).toBeGreaterThan(8);
    expect(t.ar.perf().detail).toMatch(/분석용 사진 9$/m);
    // 풀리면 다음 차례에 한 장만 다시 보낸다
    held.shift()!();
    await new Promise((r) => setTimeout(r, 0));
    t.session.step(2000, frame({ camera: true }));
    t.session.step(2017, frame({ camera: true }));
    expect(t.toJpeg.mock.calls.filter((c) => c[3] === 0.8)).toHaveLength(2);
  });

  it("같은 그림 틀에서 표시 프레임과 엔진 프레임이 둘 다 때가 되면 카메라 그림은 한 번만 읽는다(크기가 같을 때). 사진은 크기가 달라 따로 읽는다", async () => {
    const t = setup({ camera: true });
    await t.ar.start(overlay);
    t.ar.setEngineMs(1000);
    t.session.step(100, frame({ camera: true }));
    await vi.waitFor(() => expect(t.socket.binary.length).toBe(2));
    expect(t.grab.mock.calls.length).toBe(1);
    expect(t.toJpeg.mock.calls.map((c) => c.slice(1, 4))).toEqual([[480, 360, 0.8], [480, 360, 0.55]]);
    expect(t.toJpeg.mock.calls[0]![0] === t.toJpeg.mock.calls[1]![0]).toBe(false); // 픽셀 버퍼는 따로(워커로 넘어간다)
    expect((await Promise.all(t.socket.binary.map(async (b) => (await header(b)).kind))).sort()).toEqual(["engine", "frame"]);
    t.ar.requestPhoto();
    t.session.step(1100, frame({ camera: true })); // 엔진 프레임(480×360)과 사진(640×480)
    await vi.waitFor(() => expect(t.socket.binary.length).toBe(4));
    expect(t.grab.mock.calls.length).toBe(3);
  });

  it("측정: 보낸 장 수와 자세한 줄(목표 fps·인코더·크기·표시 영상)", async () => {
    const t = setup({ camera: true });
    await t.ar.start(overlay);
    t.session.step(100, frame({ camera: true }));
    await vi.waitFor(() => expect(t.socket.binary).toHaveLength(1));
    const p = t.ar.perf();
    expect(p.fps).toBe("0.5 fps");
    expect(p.detail.split("\n")).toEqual([
      "보낸 화면 0.5 / 목표 12 fps · 장당 0.0KB",
      expect.stringMatching(/^readPixels [\d.]+ms · 인코딩 [\d.]+ms \(worker×2\)$/),
      "와이파이 대기 0KB · 크기 480×360",
      "2초간 건너뜀: 인코딩 중 0 · 버퍼 가득 0 · 순서 뒤바뀜 0 · 분석용 사진 0",
      "표시 영상 시험",
    ]);
  });
});
