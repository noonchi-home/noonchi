// 실제 폰 제어(controller.ts)를 가짜 소켓·가짜 음성 인식·가짜 XR로 돌린다.
// 늘 듣기(AR 중 이어서 듣고, 끝나면 다시 켜고, 명령을 소리로 읽는 동안 멈춤), 명령·질문·승인, 연결·마이크·기준점 문제, 기준점 찍기·물건 자리 맞추기,
// 명령 대상 고리(명령이 떠 있을 때 첫 대상 하나)와 조준점(찍기·맞추기 때만)을 본다.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPhoneController, type ControllerDeps, type ControllerDraw } from "../src/phone/controller";
import { supportText } from "../src/phone/state";

class FakeSocket {
  static OPEN = 1;
  static last: FakeSocket;
  readyState = 0;
  sent: Record<string, any>[] = [];
  private on: Record<string, ((e: any) => void)[]> = {};
  constructor(readonly url: string) { FakeSocket.last = this; }
  addEventListener(t: string, f: (e: any) => void) { (this.on[t] ??= []).push(f); }
  send(d: string) { this.sent.push(JSON.parse(d)); }
  close() { this.readyState = 3; }
  open() { this.readyState = 1; for (const f of this.on.open ?? []) f({}); }
  /** 서버가 끊음: close 이벤트까지. */
  drop() { this.readyState = 3; for (const f of this.on.close ?? []) f({}); }
  push(m: unknown) { for (const f of this.on.message ?? []) f({ data: JSON.stringify(m) }); }
}

class Rec {
  static all: Rec[] = [];
  lang = ""; continuous = false; interimResults = true; maxAlternatives = 0;
  onresult: ((e: unknown) => void) | null = null;
  onerror: ((e: { error: string }) => void) | null = null;
  onend: (() => void) | null = null;
  started = 0;
  aborted = 0;
  constructor() { Rec.all.push(this); }
  start() { this.started += 1; }
  stop() { this.onend?.(); }
  abort() { this.aborted += 1; this.onend?.(); }
  hear(transcript: string) { this.onresult?.({ resultIndex: 0, results: [Object.assign([{ transcript }], { isFinal: true })] }); }
}
const rec = () => Rec.all.at(-1)!;

type Fn = (...a: any[]) => void;
const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
/** 가짜 XR 세션: requestAnimationFrame으로 받은 고리를 step으로 한 번씩 돌린다. */
function fakeSession() {
  const on: Record<string, Fn[]> = {};
  let raf: Fn | null = null;
  return {
    /** 첫 프레임 고리를 받았다(AR 시작이 끝남). */
    looping: () => raf !== null,
    renderState: { baseLayer: { framebuffer: null } },
    updateRenderState() {},
    requestReferenceSpace: async () => ({ addEventListener() {} }),
    requestHitTestSource: async () => ({}),
    addEventListener: (t: string, f: Fn) => { (on[t] ??= []).push(f); },
    requestAnimationFrame(f: Fn) { raf = f; },
    end() { for (const f of on.end ?? []) f(); },
    step(time: number, frame: unknown) { const f = raf; raf = null; f?.(time, frame); },
  };
}
/** 조준점이 바닥(0,0,-1)에 닿는 XR 프레임. emulated면 추적 약함. */
const frame = (emulated = false) => ({
  getHitTestResults: () => [{ getPose: () => ({ transform: { position: { x: 0, y: 0, z: -1 }, orientation: { x: 0, y: 0, z: 0, w: 1 } } }) }],
  getViewerPose: () => ({
    emulatedPosition: emulated,
    transform: { position: { x: 0, y: 1.5, z: 0 }, orientation: { x: 0, y: 0, z: 0, w: 1 } },
    views: [{ projectionMatrix: identity, transform: { inverse: { matrix: identity } } }],
  }),
});
/** hit-test 점이 없고 45° 아래를 보는 XR 프레임: 조준점은 폰 1.5m 아래 어림 바닥 (0, 0, -1.5). */
const looseFloor = () => ({
  getHitTestResults: () => [],
  getViewerPose: () => ({
    emulatedPosition: false,
    transform: { position: { x: 0, y: 1.5, z: 0 }, orientation: { x: -Math.sin(Math.PI / 8), y: 0, z: 0, w: Math.cos(Math.PI / 8) } },
    views: [{ projectionMatrix: identity, transform: { inverse: { matrix: identity } } }],
  }),
});
const gl = { FRAMEBUFFER: 1, COLOR_BUFFER_BIT: 2, bindFramebuffer() {}, clearColor() {}, clear() {} };

const made: { close(): void }[] = [];
beforeEach(() => { Rec.all = []; });
afterEach(() => { while (made.length) made.pop()!.close(); vi.useRealTimers(); });

function make(over: Partial<ControllerDeps> = {}) {
  const spoken: string[] = [];
  const dones: (() => void)[] = [];
  const session = fakeSession();
  const c = createPhoneController({
    location: { protocol: "https:", host: "pc.ts.net:8443", search: "" },
    Socket: FakeSocket, Recognition: Rec as never, speak: (s, done) => { spoken.push(s); dones.push(done); },
    secure: true, xr: { isSessionSupported: async () => true },
    arDeps: { xr: () => ({ requestSession: async () => session }), gl: () => gl, layer: () => ({}), binding: () => null },
    ...over,
  });
  made.push(c);
  const ws = FakeSocket.last;
  ws.open();
  const sent = () => ws.sent.filter((m) => m.type !== "clock");
  const drawn: string[] = [];
  const marks: { id: string; label: string }[][] = [];
  const draw: ControllerDraw = { start: () => drawn.push("start"), aim: (on) => drawn.push(`aim ${on}`), hit: () => {}, marks: (m) => marks.push(m) };
  c.attach(document.createElement("div"), draw);
  /** AR을 연다(가짜 세션). */
  const startAr = async () => {
    c.actions.startAr();
    await vi.waitFor(() => expect(session.looping()).toBe(true));
  };
  return { c, ws, spoken, dones, sent, session, drawn, marks, startAr };
}
const anchors = [{ id: "a", label: "거실 창가", recorded: true }, { id: "b", label: "현관", recorded: false }];
const status = (over: Record<string, unknown> = {}) => ({ type: "status", mode: "floor", revision: 3, anchors, aligned: false, mismatch_m: null, ...over });
const done = [{ id: "done", label: "완료" }];
const command = (over: Record<string, unknown> = {}) => ({ type: "command", id: "plan:pam-1", step: "plan:pam-1:2", text: "컵을 들어 주세요", vision: "컵 · 식탁 위", choices: done, target: null, speak: true, ...over });
const CUP = { id: "cup_1", label: "컵", ar: [0, 0, -0.5] };

describe("연결·지원", () => {
  it("https 주소면 wss로 /phone/events에 붙는다", () => {
    expect(make().ws.url).toBe("wss://pc.ts.net:8443/phone/events");
  });

  it("AR 지원: 보안 연결·immersive-ar면 준비, 아니면 그 까닭", async () => {
    const ok = make();
    await vi.waitFor(() => expect(ok.c.view().support).toEqual({ kind: "ready" }));
    expect(make({ secure: false }).c.view().support).toEqual({ kind: "insecure" });
    const none = make({ xr: null });
    await vi.waitFor(() => expect(none.c.view().support).toEqual({ kind: "no-ar" }));
  });

  it("붙으면 connected, 끊기면 false(다시 연결하는 중), 1초 뒤 다시 붙으면 true", () => {
    vi.useFakeTimers();
    const { c, ws } = make();
    expect(c.view().connected).toBe(true);
    ws.drop();
    expect(c.view().connected).toBe(false);
    vi.advanceTimersByTime(1000);
    FakeSocket.last.open();
    expect(c.view().connected).toBe(true);
  });

  it("상태 메시지: 기준점·맞춤·거리 차이. 오류는 잠깐 알릴 말(4초)", () => {
    vi.useFakeTimers();
    const { c, ws } = make();
    ws.push(status({ aligned: true, mismatch_m: 0.12 }));
    expect([c.view().anchors, c.view().aligned, c.view().mismatchM]).toEqual([anchors, true, 0.12]);
    ws.push(status({ error: "기준점이 너무 가까워요" }));
    expect(c.view().note).toBe("기준점이 너무 가까워요");
    vi.advanceTimersByTime(4000);
    expect(c.view().note).toBeNull();
  });
});

describe("늘 듣기", () => {
  it("AR을 열면 듣기를 켜고, 들은 말을 say로 보낸다. 인식이 끝나면 다시 켜고, AR이 끝나면 끈다", async () => {
    vi.useFakeTimers();
    const { c, sent, session, startAr } = make();
    expect(Rec.all).toHaveLength(0);
    await startAr();
    expect(c.view().listening).toBe("on");
    expect(rec().continuous).toBe(true);
    rec().hear("다 했어");
    expect(sent()).toContainEqual({ type: "say", text: "다 했어" });
    rec().stop();
    vi.advanceTimersByTime(300);
    expect(Rec.all).toHaveLength(2);
    session.end();
    expect(c.view().listening).toBe("off");
    expect(rec().aborted).toBe(1);
  });

  it("명령을 소리로 읽는 동안은 듣기를 멈추고, 다 읽으면 다시 켠다. 비전 상태만 바뀐 명령은 읽지 않는다", async () => {
    const { c, ws, spoken, dones, startAr } = make();
    await startAr();
    const first = rec();
    ws.push(command());
    expect(spoken).toEqual(["컵을 들어 주세요"]);
    expect(c.view().listening).toBe("paused");
    expect(first.aborted).toBe(1);
    ws.push(command({ vision: "컵 · 손에 있음", speak: false }));
    expect(spoken).toEqual(["컵을 들어 주세요"]);
    expect(c.view().command?.vision).toBe("컵 · 손에 있음");
    dones[0]!();
    expect(c.view().listening).toBe("on");
    expect(Rec.all).toHaveLength(2);
  });

  it("읽기가 겹치면 마지막 읽기가 끝나야 다시 듣는다. 끝 알림이 안 와도 정해진 시간 뒤 다시 듣는다", async () => {
    vi.useFakeTimers();
    const { c, ws, dones, startAr } = make();
    await startAr();
    ws.push(command());
    ws.push(command({ step: "plan:pam-1:3", text: "싱크대로 가 주세요" }));
    dones[0]!();
    expect(c.view().listening).toBe("paused");
    dones[1]!();
    expect(c.view().listening).toBe("on");
    ws.push(command({ step: "plan:pam-1:4", text: "컵을 싱크대에 넣어 주세요" }));
    expect(c.view().listening).toBe("paused");
    vi.advanceTimersByTime(2000 + "컵을 싱크대에 넣어 주세요".length * 300);
    expect(c.view().listening).toBe("on");
  });

  it("마이크 권한이 없으면 denied(마이크가 꺼져 있어요). micOn이면 다시 켠다", async () => {
    const { c, startAr } = make();
    await startAr();
    rec().onerror!({ error: "not-allowed" });
    rec().onend!();
    expect(c.view().listening).toBe("denied");
    c.actions.micOn();
    expect(c.view().listening).toBe("on");
    expect(Rec.all).toHaveLength(2);
  });

  it("음성 인식이 없는 브라우저는 듣기 꺼짐", async () => {
    const { c, startAr } = make({ Recognition: null });
    await startAr();
    expect(c.view().listening).toBe("off");
  });
});

describe("명령·질문·승인", () => {
  it("명령: 지금 명령으로 두고, 답은 받은 id·step 그대로. 연결이 끊기면 잠깐 알릴 말", () => {
    const { c, ws, sent } = make();
    ws.push(command());
    expect(c.view().command).toEqual({ id: "plan:pam-1", step: "plan:pam-1:2", text: "컵을 들어 주세요", vision: "컵 · 식탁 위", choices: done, target: null });
    c.actions.answer("plan:pam-1", "plan:pam-1:2", "done");
    expect(sent()).toEqual([{ type: "answer", id: "plan:pam-1", step: "plan:pam-1:2", choice: "done" }]);
    ws.readyState = 3;
    c.actions.answer("plan:pam-1", "plan:pam-1:2", "done");
    expect(c.view().note).toBe("서버와 연결이 끊겨 답을 보내지 못했어요");
  });

  it("지우기는 그 명령일 때만, id가 없으면 무엇이든", () => {
    const { c, ws } = make();
    ws.push(command());
    ws.push({ type: "command_clear", id: "plan:pam-0" });
    expect(c.view().command).not.toBeNull();
    ws.push({ type: "command_clear", id: "plan:pam-1" });
    expect(c.view().command).toBeNull();
    ws.push(command({ id: "plan:pam-2" }));
    ws.push({ type: "command_clear" });
    expect(c.view().command).toBeNull();
  });

  it("말의 답: 글이 있으면 처음 화면 답 줄과 소리, 빈 글이면 지운다. 승인 대기와 답(승인·거절)", () => {
    const { c, ws, spoken, sent } = make();
    c.actions.say(" TV 켜줘 ");
    expect(sent()).toEqual([{ type: "say", text: "TV 켜줘" }]);
    const approve = { id: "approve", label: "승인" };
    const reject = { id: "reject", label: "거절" };
    ws.push({ type: "reply", text: "현관문 잠금 해제는 승인이 필요해요.", pending: [{ token: "t1", deviceLabel: "현관문", reason: "현관문 잠금 해제", choices: [approve, reject] }, { token: "t2", deviceLabel: "창문", reason: "창문 열기", choices: [approve, reject] }] });
    expect([c.view().reply, spoken]).toEqual(["현관문 잠금 해제는 승인이 필요해요.", ["현관문 잠금 해제는 승인이 필요해요."]]);
    c.actions.confirm("t1", "reject");
    c.actions.confirm("t2", "approve");
    expect(c.view().pending).toEqual([]);
    expect(sent().slice(1)).toEqual([{ type: "confirm", token: "t1", choice: "reject" }, { type: "confirm", token: "t2", choice: "approve" }]);
    ws.push({ type: "reply", text: "", pending: [] });
    expect([c.view().reply, spoken.length]).toEqual([null, 1]);
  });

  it("pending 칸이 없는 답(말로 한 「완료」·승인·취소의 답)은 승인 대기 목록을 그대로 둔다", () => {
    const { c, ws } = make();
    const door = { token: "t1", deviceLabel: "현관문", reason: "현관문 잠금 해제" };
    ws.push({ type: "reply", text: "승인이 필요해요.", pending: [door] });
    ws.push({ type: "reply", text: "" });
    expect(c.view().pending).toEqual([door]);
    ws.push({ type: "reply", text: "취소했어요.", pending: [] });
    expect(c.view().pending).toEqual([]);
  });

  it("빈 말은 보내지 않는다", () => {
    const { c, sent } = make();
    c.actions.say("   ");
    expect(sent()).toEqual([]);
  });
});

describe("기준점 찍기·물건 자리 맞추기·설정", () => {
  it("startAnchors: 같은 원점 이름으로 reset을 보내고 찍기를 연다(설정은 닫는다). 맞춘 상태가 오면 끝난다", () => {
    const { c, ws, sent, drawn } = make();
    c.actions.setSettings(true);
    expect(c.view().settingsOpen).toBe(true);
    c.actions.startAnchors();
    expect(sent()).toEqual([{ type: "reset", epoch: null }]);
    expect([c.view().setup, c.view().settingsOpen]).toEqual(["anchors", false]);
    expect(drawn).toEqual(["aim true"]);
    ws.push(status({ aligned: true, mismatch_m: 0.05 }));
    expect(c.view().setup).toBeNull();
    expect(drawn).toEqual(["aim true", "aim false"]);
  });

  it("기록: AR 전에는 먼저 시작하라고 하고 보내지 않는다", () => {
    const { c, ws, sent } = make();
    ws.push(status({ mode: "touch" }));
    c.actions.recordAnchor("A");
    expect(c.view().note).toBe("AR을 먼저 시작하세요");
    expect(sent()).toEqual([]);
  });

  it("기록(바닥 기준점): 조준점이 바닥에 닿은 점을 그 기준점으로 보낸다", async () => {
    const { c, ws, sent, session, startAr } = make();
    await startAr();
    ws.push(status());
    c.actions.startAnchors();
    session.step(100, frame());
    expect([c.view().hit, c.view().hitEstimated]).toEqual([true, false]);
    c.actions.recordAnchor("b");
    expect(sent().at(-1)).toMatchObject({ type: "anchor", id: "b", point: [0, 0, -1], estimated: false, revision: 3 });
  });

  it("기록(벽 기준점): 조준점이 어림 바닥이어도 그 점을 기록하고, 어림이라고 같이 보낸다", async () => {
    const { c, ws, sent, session, startAr } = make();
    await startAr();
    ws.push(status({ mode: "touch", anchors: [{ id: "A", label: "거실 구석", recorded: false }, { id: "B", label: "거실 맞은편 구석", recorded: false }] }));
    c.actions.startAnchors();
    session.step(100, looseFloor());
    expect([c.view().hit, c.view().hitEstimated]).toEqual([true, true]);
    c.actions.recordAnchor("A");
    const m = sent().at(-1)!;
    expect(m).toMatchObject({ type: "anchor", id: "A", estimated: true, revision: 3 });
    expect(m.floor).toEqual(m.point);
    (m.point as number[]).forEach((v, i) => expect(v).toBeCloseTo([0, 0, -1.5][i]!, 6));
    // hit-test 점이 생기면 어림이 아니다
    session.step(200, frame());
    expect([c.view().hit, c.view().hitEstimated]).toEqual([true, false]);
  });

  it("물건 자리 맞추기: 열면 조준점, endSetup이면 닫는다", () => {
    const { c, drawn } = make();
    c.actions.setSettings(true);
    c.actions.startPlace();
    expect([c.view().setup, c.view().settingsOpen]).toEqual(["place", false]);
    c.actions.endSetup();
    expect(c.view().setup).toBeNull();
    expect(drawn).toEqual(["aim true", "aim false"]);
  });
});

describe("AR 화면 그림", () => {
  it("명령 대상 고리: 명령에 실린 대상 하나에만 그린다. 에이전트 초점(다른 물건)은 그리지 않는다", async () => {
    const { ws, session, marks, startAr } = make();
    await startAr();
    ws.push(status({ aligned: true }));
    ws.push({ type: "focus", targets: [{ id: "tv", label: "TV", ar: [0.2, 0, -0.5] }], ttl_ms: 8000 });
    session.step(100, frame());
    expect(marks.at(-1)).toEqual([]);
    ws.push(command({ speak: false, target: CUP }));
    session.step(200, frame());
    expect(marks.at(-1)!.map((m) => m.id)).toEqual(["cup_1"]);
    // 명령 중에 온 에이전트 초점은 고리를 바꾸지 않는다
    ws.push({ type: "focus", targets: [{ id: "tv", label: "TV", ar: [0.2, 0, -0.5] }], ttl_ms: 8000 });
    session.step(300, frame());
    expect(marks.at(-1)!.map((m) => m.id)).toEqual(["cup_1"]);
    // 대상이 없는 명령(맞추기 전·질문)이나 명령을 지우면 고리 없음
    ws.push(command({ speak: false, target: null }));
    session.step(400, frame());
    expect(marks.at(-1)).toEqual([]);
    ws.push(command({ speak: false, target: CUP }));
    ws.push({ type: "command_clear", id: "plan:pam-1" });
    ws.push({ type: "focus", targets: [{ id: "tv", label: "TV", ar: [0.2, 0, -0.5] }], ttl_ms: 8000 });
    session.step(500, frame());
    expect(marks.at(-1)).toEqual([]);
  });

  it("명령 대상 고리: 승인 대기가 위 줄·엄지 자리를 차지하거나 기준점 찍기 중에는 없다", async () => {
    const { c, ws, session, marks, startAr } = make();
    await startAr();
    ws.push(status({ aligned: true }));
    ws.push(command({ speak: false, target: CUP }));
    session.step(200, frame());
    expect(marks.at(-1)!.map((m) => m.label)).toEqual(["컵"]);
    ws.push({ type: "reply", text: "", pending: [{ token: "t1", deviceLabel: "현관문", reason: "현관문 잠금 해제" }] });
    session.step(250, frame());
    expect(marks.at(-1)).toEqual([]);
    ws.push({ type: "reply", text: "", pending: [] });
    c.actions.startAnchors();
    session.step(300, frame());
    expect(marks.at(-1)).toEqual([]);
  });

  it("AR을 켜고 3초 안에 카메라 화면이 없으면 cameraOff(설정 줄 「카메라 · 못 보냄」). 다시 켜면 지운다", async () => {
    vi.useFakeTimers();
    const { c, session, startAr } = make();
    await startAr();
    expect(c.view().cameraOff).toBe(false);
    vi.advanceTimersByTime(3000);
    expect(c.view()).toMatchObject({ cameraOff: true, note: "카메라 화면을 보낼 수 없어요. 위치만 보내요" });
    vi.advanceTimersByTime(4000);
    expect(c.view()).toMatchObject({ cameraOff: true, note: null });
    session.end();
    await startAr();
    expect(c.view().cameraOff).toBe(false);
  });

  it("추적이 약하면 limited(비전 상태 줄 「추적이 약해요」), 돌아오면 false", async () => {
    const { c, session, startAr } = make();
    await startAr();
    session.step(100, frame(true));
    expect(c.view().limited).toBe(true);
    session.step(200, frame(false));
    expect(c.view().limited).toBe(false);
  });

  it("AR 시작·끝: 덮개를 보이고 숨긴다(찍기·설정은 닫는다). 시작이 실패하면 처음 화면에 까닭", async () => {
    const { c, session, drawn, startAr } = make();
    await startAr();
    expect(drawn[0]).toBe("start");
    c.actions.startPlace();
    session.end();
    expect([c.view().ar, c.view().setup, c.view().settingsOpen]).toEqual([false, null, false]);
    const bad = make({ arDeps: { xr: () => ({ requestSession: async () => { throw new Error("거부됨"); } }) } });
    bad.c.actions.startAr();
    await vi.waitFor(() => expect(supportText(bad.c.view().support)).toBe("AR을 시작하지 못했어요: 거부됨"));
  });

  it("덮개 뿌리를 잇기 전에 AR 시작을 누르면 세션을 열지 않고 처음 화면에 까닭", async () => {
    const requestSession = vi.fn();
    const c = createPhoneController({
      location: { protocol: "https:", host: "pc.ts.net:8443", search: "" }, Socket: FakeSocket, Recognition: null, speak: () => {},
      secure: true, xr: { isSessionSupported: async () => true }, arDeps: { xr: () => ({ requestSession }) },
    });
    made.push(c);
    await vi.waitFor(() => expect(c.view().support).toEqual({ kind: "ready" }));
    c.actions.startAr();
    expect(requestSession).not.toHaveBeenCalled();
    expect(supportText(c.view().support)).toBe("AR을 시작하지 못했어요: 페이지를 새로 고쳐 주세요");
  });
});

describe("위치 맞춤: 「여기서 시작」", () => {
  const start = { label: "거실·복도 테이블 앞", facing: "거실·복도 TV수납장" };
  const sync = (over: Record<string, unknown> = {}) => ({ state: "none", source: null, start, started: false, anchors: 0, wall_points: 0, residual_m: null, ...over });

  it("시작 위치가 있으면 AR을 켤 때 시작 위치 맞추기가 열리고, 「여기서 시작」은 지금 자세·원점으로 start를 보낸다", async () => {
    const { c, ws, sent, session, startAr } = make();
    ws.push(status({ sync: sync() }));
    expect(c.view().setup).toBeNull();
    await startAr();
    ws.push(status({ sync: sync() }));
    expect(c.view().setup).toBe("start");
    session.step(100, frame());
    c.actions.confirmStart();
    const msg = sent().filter((m) => m.type === "start").at(-1)!;
    expect(msg).toEqual({ type: "start", position: [0, 1.5, 0], orientation: [0, 0, 0, 1], epoch: expect.any(String) });
    expect(msg.epoch).toBe(sent().find((m) => m.type === "reset")!.epoch);
    ws.push(status({ sync: sync({ state: "estimated", source: "start", started: true }) }));
    expect(c.view().setup).toBeNull();
  });

  it("시작 위치 맞추기 중 말 「여기서 시작」은 start로 보내고 에이전트로 보내지 않는다. 다른 말은 그대로 say", async () => {
    const { c, ws, sent, session, startAr } = make();
    await startAr();
    ws.push(status({ sync: sync() }));
    session.step(100, frame());
    rec().hear("여기서 시작할게");
    expect(sent().filter((m) => m.type === "start")).toHaveLength(1);
    expect(sent().filter((m) => m.type === "say")).toHaveLength(0);
    rec().hear("TV 켜 줘");
    expect(sent().filter((m) => m.type === "say").map((m) => m.text)).toEqual(["TV 켜 줘"]);
  });

  it("자세가 아직 없으면 보내지 않고 알린다. 설정의 「시작 위치에서 다시 맞추기」는 시작 위치 맞추기를 연다", async () => {
    const { c, ws, sent, startAr } = make();
    await startAr();
    ws.push(status({ sync: sync({ state: "aligned", source: "walls", started: true }), aligned: true }));
    c.actions.setSettings(true);
    c.actions.startFromSpot();
    expect([c.view().setup, c.view().settingsOpen]).toEqual(["start", false]);
    c.actions.confirmStart();
    expect(sent().filter((m) => m.type === "start")).toHaveLength(0);
    expect(c.view().note).toContain("폰 위치");
  });

  it("자세에 실제 hit 면 법선과 어림 바닥 높이를 싣는다(어림 조준점이면 법선 없음)", async () => {
    const { ws, sent, session, startAr } = make();
    void ws;
    await startAr();
    session.step(100, frame());
    expect(sent().filter((m) => m.type === "pose").at(-1)).toMatchObject({ hit: [0, 0, -1], hit_normal: [0, 1, 0], floor_y: 0, hit_estimated: false });
    session.step(250, looseFloor());
    const loose = sent().filter((m) => m.type === "pose").at(-1)!;
    expect(loose.hit_estimated).toBe(true);
    expect(loose.hit_normal).toBeUndefined();
  });
});
