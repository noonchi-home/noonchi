// 폰 화면 뿌리(PhoneApp): 제어(controller.ts)의 상태를 그대로 그리고, 화면 단추가 서버로 말을 보낸다.
// AR 시작: PhoneApp이 덮개 div를 DOM 오버레이 뿌리로, canvas 그림(draw.ts)을 조준점·초점으로 controller에 잇는지 가짜 XR로 본다.
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
/** 가짜 XR 세션: requestAnimationFrame으로 받은 고리를 step으로 한 번씩 돌린다. */
function fakeSession() {
  const on: Record<string, Fn[]> = {};
  let raf: Fn | null = null;
  return {
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
/** 조준점이 바닥(0,0,-1)에 닿고 자세가 있는 XR 프레임. */
const frame = () => ({
  getHitTestResults: () => [{ getPose: () => ({ transform: { position: { x: 0, y: 0, z: -1 }, orientation: { x: 0, y: 0, z: 0, w: 1 } } }) }],
  getViewerPose: () => ({
    emulatedPosition: false,
    transform: { position: { x: 0, y: 1.5, z: 0 }, orientation: { x: 0, y: 0, z: 0, w: 1 } },
    views: [{ projectionMatrix: identity, transform: { inverse: { matrix: identity } } }],
  }),
});
const gl = { FRAMEBUFFER: 1, COLOR_BUFFER_BIT: 2, bindFramebuffer() {}, clearColor() {}, clear() {} };

/** canvas 2d 그림을 적는 가짜 ctx(jsdom에는 canvas 그림이 없다). */
function paintLog() {
  const ops: { op: string; [k: string]: unknown }[] = [];
  const ctx = {
    lineWidth: 0, strokeStyle: "", fillStyle: "", font: "", textAlign: "", textBaseline: "", lineJoin: "",
    setTransform() {}, beginPath() {}, closePath() {}, moveTo() {}, lineTo() {}, fill() {},
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
    speak: () => {}, secure: true, xr: { isSessionSupported: async () => true },
    arDeps: { xr: () => ({ requestSession: async (_m: string, o: { domOverlay: { root: unknown } }) => { requested.push(o); return session; } }), gl: () => gl, layer: () => ({}), binding: () => null },
  });
  made.push(c);
  const r = render(<PhoneApp controller={c} />);
  act(() => FakeSocket.last.open());
  return { c, session, requested, ws: FakeSocket.last, ...r };
}

describe("폰 화면 뿌리(PhoneApp)", () => {
  it("상태 메시지가 오면 첫 안내에 기준점 이름, AR이 없으면 까닭, 글을 보내면 서버로 say", async () => {
    const c = createPhoneController({
      location: { protocol: "http:", host: "127.0.0.1:8521", search: "" }, Socket: FakeSocket, Recognition: null,
      speak: () => {}, secure: true, xr: { isSessionSupported: async () => false },
    });
    made.push(c);
    render(<PhoneApp controller={c} />);
    act(() => {
      FakeSocket.last.open();
      FakeSocket.last.push({ type: "status", mode: "floor", revision: 1, anchors: [{ id: "a", label: "거실 창가", recorded: false }], aligned: false, mismatch_m: null });
    });
    const main = within(screen.getByRole("main"));
    expect(main.getAllByRole("listitem")[0]).toHaveTextContent("거실 창가 바닥에 차례로 조준점을 맞추고 지점 기록을 눌러요");
    expect(await main.findByText("이 브라우저는 AR을 지원하지 않아요. 안드로이드 크롬으로 여세요.")).toBeInTheDocument();
    await userEvent.type(main.getByRole("textbox", { name: "클로이드에게 할 말" }), "TV 켜줘");
    await userEvent.click(main.getByRole("button", { name: "보내기" }));
    expect(FakeSocket.last.sent).toContainEqual({ type: "say", text: "TV 켜줘" });
    expect(main.getByText('🎙 "TV 켜줘" … 생각 중').closest("[role=status]")).not.toBeNull();
  });

  it("AR 시작: 덮개 div를 DOM 오버레이 뿌리로 세션을 열고 덮개를 보인다. 조준점·초점은 덮개 canvas에 그린다", async () => {
    const ops = paintLog();
    const { session, requested, ws, container } = arApp();
    const overlay = container.querySelector<HTMLElement>("[data-phone-overlay]")!;
    const canvas = overlay.querySelector("canvas")!;
    expect(overlay.hidden).toBe(true);
    await userEvent.click(await screen.findByRole("button", { name: "AR 시작" }));
    await vi.waitFor(() => expect(overlay.hidden).toBe(false));
    expect(requested.map((o) => o.domOverlay.root)).toEqual([overlay]);
    act(() => {
      ws.push({ type: "focus", targets: [{ id: "cup", label: "컵", ar: [0, 0, -0.5] }], ttl_ms: 8000 });
      session.step(100, frame());
    });
    expect(ops.filter((o) => o.op === "ctx").every((o) => o.canvas === canvas)).toBe(true);
    // 조준점(화면 가운데 고리)과 초점 이름표
    expect(ops.some((o) => o.op === "arc" && o.x === innerWidth / 2 && o.y === innerHeight / 2)).toBe(true);
    expect(ops.filter((o) => o.op === "text").map((o) => o.text)).toContain("클로이드 주목 · 컵");
  });

  it("세로 화면의 화면 밖 화살표는 그릴 때 잰 위 줄 아래에 둔다(말풍선 글을 가리지 않는다)", async () => {
    vi.stubGlobal("innerWidth", 390);
    vi.stubGlobal("innerHeight", 844);
    const ops = paintLog();
    const { session, ws, container } = arApp();
    const overlay = container.querySelector<HTMLElement>("[data-phone-overlay]")!;
    const top = overlay.querySelector<HTMLElement>("[data-phone-zone=top]")!;
    // 말풍선 한 줄이 뜬 위 줄: 64~128px
    vi.spyOn(top, "getBoundingClientRect").mockReturnValue({ top: 64, bottom: 128, height: 64, left: 16, right: 374, width: 358 } as DOMRect);
    await userEvent.click(await screen.findByRole("button", { name: "AR 시작" }));
    await vi.waitFor(() => expect(overlay.hidden).toBe(false));
    // 머리 위(화면 밖 위쪽) 에어컨
    act(() => {
      ws.push({ type: "focus", targets: [{ id: "aircon", label: "에어컨", ar: [0, 3, -1] }], ttl_ms: 8000 });
      session.step(100, frame());
    });
    const label = ops.filter((o) => o.op === "round").at(-1)!;
    expect(label.y).toBe(128 + 8 + 28 + 4);
  });

  it("덮개를 열 때 한 번 그린다(조준점이 바로 보임). 초점이 없고 조준점이 그대로인 프레임은 다시 그리지 않는다. 다시 열면 지난 그림 대신 새로 그린다", async () => {
    const ops = paintLog();
    const { c, session, container } = arApp();
    const overlay = container.querySelector<HTMLElement>("[data-phone-overlay]")!;
    const clears = () => ops.filter((o) => o.op === "clear").length;
    /** 마지막 조준점 심 색(조준점 고리 다섯 겹 중 마지막). */
    const aim = () => ops.filter((o) => o.op === "stroke").at(-1)?.color;
    await userEvent.click(await screen.findByRole("button", { name: "AR 시작" }));
    await vi.waitFor(() => expect(overlay.hidden).toBe(false));
    expect(clears()).toBe(1);
    expect(aim()).toBe(twin.phoneFocus.aim.miss);
    act(() => { for (const time of [100, 200, 300, 400]) session.step(time, frame()); });
    // 조준점이 바닥에 닿은 첫 프레임만 다시 그린다
    expect(clears()).toBe(2);
    expect(aim()).toBe(twin.phoneFocus.aim.hit);
    act(() => c.actions.stopAr());
    await vi.waitFor(() => expect(overlay.hidden).toBe(true));
    expect(clears()).toBe(2);
    await userEvent.click(screen.getByRole("button", { name: "AR 시작" }));
    await vi.waitFor(() => expect(overlay.hidden).toBe(false));
    expect(clears()).toBe(3);
    expect(aim()).toBe(twin.phoneFocus.aim.miss);
  });
});
