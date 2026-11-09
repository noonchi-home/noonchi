// 실제 폰 화면 뿌리(PhoneApp): 제어(controller.ts)의 상태를 그대로 그리고, AR 덮개 div를 DOM 오버레이 뿌리로, canvas 그림(draw.ts)을 controller에 잇는다.
// 평소 AR에는 조준점이 없고, 명령이 떠 있으면 그 대상 하나에 작은 고리(이름표 없음). 미어캣 → 설정 → 물건 자리 맞추기를 고르면 조준점이 보인다.
import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { twin } from "../../src/design/tokens.ts";
import { createPhoneController } from "../src/phone/controller";
import { PhoneApp } from "../src/phone/PhoneApp";

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
  push(m: unknown) { for (const f of this.on.message ?? []) f({ data: JSON.stringify(m) }); }
}

type Fn = (...a: any[]) => void;
const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
function fakeSession() {
  const on: Record<string, Fn[]> = {};
  let raf: Fn | null = null;
  return {
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
/** 조준점이 바닥에 닿고(hit) 자세가 있는 XR 프레임. down이면 45° 아래를 본다(hit-test 점이 없으면 어림 바닥). */
const frame = (hit = true, down = false) => ({
  getHitTestResults: () => (hit ? [{ getPose: () => ({ transform: { position: { x: 0, y: 0, z: -1 }, orientation: { x: 0, y: 0, z: 0, w: 1 } } }) }] : []),
  getViewerPose: () => ({
    emulatedPosition: false,
    transform: {
      position: { x: 0, y: 1.5, z: 0 },
      orientation: down ? { x: -Math.sin(Math.PI / 8), y: 0, z: 0, w: Math.cos(Math.PI / 8) } : { x: 0, y: 0, z: 0, w: 1 },
    },
    views: [{ projectionMatrix: identity, transform: { inverse: { matrix: identity } } }],
  }),
});
const gl = { FRAMEBUFFER: 1, COLOR_BUFFER_BIT: 2, bindFramebuffer() {}, clearColor() {}, clear() {} };

/** canvas 2d 그림을 적는 가짜 ctx(jsdom에는 canvas 그림이 없다). */
function paintLog() {
  const ops: { op: string; [k: string]: unknown }[] = [];
  const ctx = {
    lineWidth: 0, strokeStyle: "", fillStyle: "", font: "", textAlign: "", textBaseline: "", lineJoin: "",
    setTransform() {}, beginPath() {}, closePath() {}, lineTo() {}, fill() {},
    moveTo(x: number, y: number) { ops.push({ op: "move", x, y }); },
    roundRect(x: number, y: number) { ops.push({ op: "round", x, y }); },
    stroke() { ops.push({ op: "stroke", color: ctx.strokeStyle }); },
    clearRect() { ops.push({ op: "clear" }); },
    arc(x: number, y: number) { ops.push({ op: "arc", x, y }); },
    fillText(text: string) { ops.push({ op: "text", text }); },
    measureText(t: string) { return { width: t.length * 10 }; },
  };
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(function (this: HTMLCanvasElement) {
    ops.push({ op: "ctx", canvas: this });
    return ctx as never;
  });
  return ops;
}

const made: { close(): void }[] = [];
afterEach(() => { while (made.length) made.pop()!.close(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function arApp() {
  const session = fakeSession();
  const requested: { domOverlay: { root: unknown } }[] = [];
  const c = createPhoneController({
    location: { protocol: "https:", host: "pc.ts.net:8443", search: "" }, Socket: FakeSocket, Recognition: null,
    speak: (_t, done) => done(), secure: true, xr: { isSessionSupported: async () => true },
    arDeps: { xr: () => ({ requestSession: async (_m: string, o: { domOverlay: { root: unknown } }) => { requested.push(o); return session; } }), gl: () => gl, layer: () => ({}), binding: () => null },
  });
  made.push(c);
  const r = render(<PhoneApp controller={c} />);
  act(() => FakeSocket.last.open());
  const overlay = r.container.querySelector<HTMLElement>("[data-phone-overlay]")!;
  const start = async () => {
    await userEvent.click(await screen.findByRole("button", { name: "AR 시작" }));
    await vi.waitFor(() => expect(overlay.hidden).toBe(false));
    await vi.waitFor(() => expect(session.looping()).toBe(true));
  };
  return { c, session, requested, ws: FakeSocket.last, overlay, start, ...r };
}
const START = { label: "거실·복도 테이블 앞", facing: "거실·복도 TV수납장" };
const status = { type: "status", aligned: true, sync: { state: "aligned", source: "walls", start: START, started: true, anchors: 0, wall_points: 60, residual_m: 0.05 } };
const command = { type: "command", id: "plan:pam-1", step: "plan:pam-1:2", text: "컵을 들어 주세요", vision: "컵 · 식탁 위", choices: [{ id: "done", label: "완료" }], speak: false };
/** 화면 가운데(조준점 자리) 고리. */
const centerArcs = (ops: { op: string; [k: string]: unknown }[]) => ops.filter((o) => o.op === "arc" && o.x === innerWidth / 2 && o.y === innerHeight / 2);

describe("실제 폰 화면 뿌리(PhoneApp)", () => {
  it("상태 메시지가 오면 첫 안내에 시작 위치 이름, AR이 없으면 까닭, 글을 보내면 서버로 say", async () => {
    const c = createPhoneController({
      location: { protocol: "http:", host: "127.0.0.1:8521", search: "" }, Socket: FakeSocket, Recognition: null,
      speak: () => {}, secure: true, xr: { isSessionSupported: async () => false },
    });
    made.push(c);
    render(<PhoneApp controller={c} />);
    act(() => {
      FakeSocket.last.open();
      FakeSocket.last.push({ ...status, aligned: false, sync: { ...status.sync, state: "none", source: null, started: false, wall_points: 0, residual_m: null } });
    });
    const main = within(screen.getByRole("main"));
    expect(main.getAllByRole("listitem")[0]).toHaveTextContent("거실·복도 테이블 앞에 서서 거실·복도 TV수납장 쪽을 보고 여기서 시작을 눌러요");
    expect(await main.findByText("이 브라우저는 AR을 지원하지 않아요. 안드로이드 크롬으로 여세요.")).toBeInTheDocument();
    await userEvent.type(main.getByRole("textbox", { name: "클로이드에게 할 말" }), "TV 켜줘");
    await userEvent.click(main.getByRole("button", { name: "보내기" }));
    expect(FakeSocket.last.sent).toContainEqual({ type: "say", text: "TV 켜줘" });
  });

  it("AR 시작: 덮개 div를 DOM 오버레이 뿌리로 세션을 연다. 평소에는 조준점이 없고, 명령이 떠 있으면 명령 대상 하나에 이름표 없는 고리(에이전트 초점은 그리지 않음)", async () => {
    const ops = paintLog();
    const { session, requested, ws, overlay, start } = arApp();
    act(() => ws.push(status));
    await start();
    expect(requested.map((o) => o.domOverlay.root)).toEqual([overlay]);
    act(() => {
      ws.push({ type: "focus", targets: [{ id: "cup", label: "컵", ar: [0.2, -0.2, -0.5] }, { id: "tv", label: "TV", ar: [-0.4, 0.3, -0.5] }], ttl_ms: 8000 });
      session.step(100, frame());
    });
    expect(ops.filter((o) => o.op === "arc")).toEqual([]);
    act(() => {
      ws.push({ ...command, target: { id: "cup", label: "컵", ar: [0.2, -0.2, -0.5] } });
      session.step(200, frame());
    });
    const canvas = overlay.querySelector("canvas")!;
    expect(ops.filter((o) => o.op === "ctx").every((o) => o.canvas === canvas)).toBe(true);
    const arcs = ops.filter((o) => o.op === "arc");
    expect(arcs).toHaveLength(5);
    expect(arcs.every((a) => a.x === 0.6 * innerWidth && a.y === 0.6 * innerHeight)).toBe(true);
    expect(centerArcs(ops)).toEqual([]);
    expect(ops.filter((o) => o.op === "text" || o.op === "round")).toEqual([]);
  });

  it("미어캣 → 설정 → 물건 자리 맞추기를 고르면 조준점이 보이고, 바닥에 닿으면 초록이 된다", async () => {
    const ops = paintLog();
    const { session, ws, start } = arApp();
    act(() => ws.push(status));
    await start();
    act(() => session.step(100, frame(false)));
    expect(centerArcs(ops)).toEqual([]);
    await userEvent.click(screen.getByRole("button", { name: "설정" }));
    await userEvent.click(within(screen.getByRole("alertdialog", { name: "설정" })).getByRole("button", { name: "물건 자리 맞추기" }));
    expect(centerArcs(ops)).toHaveLength(5);
    expect(ops.filter((o) => o.op === "stroke").at(-1)!.color).toBe(twin.phoneFocus.aim.miss);
    act(() => session.step(200, frame(true)));
    expect(ops.filter((o) => o.op === "stroke").at(-1)!.color).toBe(twin.phoneFocus.aim.hit);
    expect(screen.getByText("바닥에 닿음")).toBeInTheDocument();
    // hit-test 점이 없어도 아래를 보면 어림 바닥에 닿는다: 조준점은 aim.estimated, 「완료」는 그대로
    act(() => session.step(300, frame(false, true)));
    expect(ops.filter((o) => o.op === "stroke").at(-1)!.color).toBe(twin.phoneFocus.aim.estimated);
    expect(screen.getByText("어림잡은 바닥에 닿음")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "완료" })).toBeEnabled();
  });

  it("세로 화면의 화면 밖 화살표는 그릴 때 잰 위 줄(미어캣·명령) 아래에 둔다", async () => {
    vi.stubGlobal("innerWidth", 390);
    vi.stubGlobal("innerHeight", 844);
    const ops = paintLog();
    const { session, ws, overlay, start } = arApp();
    act(() => { ws.push(status); ws.push(command); });
    const top = overlay.querySelector<HTMLElement>("[data-phone-zone=top]")!;
    vi.spyOn(top, "getBoundingClientRect").mockReturnValue({ top: 0, bottom: 72, height: 72, left: 16, right: 374, width: 358 } as DOMRect);
    await start();
    // 머리 위(화면 밖 위쪽) 명령 대상
    act(() => {
      ws.push({ ...command, target: { id: "aircon", label: "에어컨", ar: [0, 3, -1] } });
      session.step(100, frame());
    });
    const tip = ops.filter((o) => o.op === "move").at(-1)!;
    expect(tip.y).toBeGreaterThanOrEqual(72 + 8);
  });

  it("덮개를 열 때 한 번 지운다. 조준점이 없을 때는 바닥 닿음이 바뀌어도 다시 그리지 않는다. 다시 열면 지난 그림 대신 새로 그린다", async () => {
    const ops = paintLog();
    const { session, start } = arApp();
    const clears = () => ops.filter((o) => o.op === "clear").length;
    await start();
    expect(clears()).toBe(1);
    act(() => { for (const [time, hit] of [[100, true], [200, false], [300, true]] as const) session.step(time, frame(hit)); });
    expect(clears()).toBe(1);
    act(() => session.end());
    await start();
    expect(clears()).toBe(2);
  });
});
