// 폰 화면 제어(controller.ts)를 가짜 소켓·가짜 음성·가짜 XR로 돌린다. 옮기기 전 phone.js 규칙 그대로인지 본다:
// 알림 5초(승인이 있으면 12초), 잠깐 알릴 말 4초, 부탁은 소리로 읽고, 답은 말이나 단추로 보낸다. 마스코트 말풍선 글은 서버가 바꿀 때까지 둔다.
import { afterEach, describe, expect, it, vi } from "vitest";
import { createPhoneController, type ControllerDeps } from "../src/phone/controller";
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
  push(m: unknown) { for (const f of this.on.message ?? []) f({ data: JSON.stringify(m) }); }
}

function fakeSession() {
  const ends: (() => void)[] = [];
  return {
    renderState: { baseLayer: { framebuffer: null } },
    updateRenderState() {},
    requestReferenceSpace: async () => ({ addEventListener() {} }),
    requestHitTestSource: async () => ({}),
    addEventListener: (t: string, f: () => void) => { if (t === "end") ends.push(f); },
    requestAnimationFrame() {},
    end() { for (const f of ends) f(); },
  };
}
const gl = { FRAMEBUFFER: 1, COLOR_BUFFER_BIT: 2, bindFramebuffer() {}, clearColor() {}, clear() {} };

let t = 0;
const made: { close(): void }[] = [];
afterEach(() => { while (made.length) made.pop()!.close(); vi.useRealTimers(); t = 0; });

function make(over: Partial<ControllerDeps> = {}) {
  const spoken: string[] = [];
  const c = createPhoneController({
    location: { protocol: "https:", host: "pc.ts.net:8443", search: "" },
    Socket: FakeSocket, Recognition: null, speak: (s) => spoken.push(s), now: () => t,
    secure: true, xr: { isSessionSupported: async () => true }, ...over,
  });
  made.push(c);
  const ws = FakeSocket.last;
  ws.open();
  const sent = () => ws.sent.filter((m) => m.type !== "clock");
  return { c, ws, spoken, sent };
}
const anchors = [{ id: "a", label: "거실 창가", recorded: true }, { id: "b", label: "현관", recorded: false }];
const status = (over: Record<string, unknown> = {}) => ({ type: "status", mode: "floor", revision: 3, anchors, aligned: false, mismatch_m: null, ...over });

describe("폰 화면 제어(controller.ts)", () => {
  it("https 주소면 wss로 /phone/events에 붙는다", () => {
    expect(make().ws.url).toBe("wss://pc.ts.net:8443/phone/events");
  });

  it("AR 지원: 보안 연결·immersive-ar면 준비, 아니면 그 까닭", async () => {
    const ok = make();
    await vi.waitFor(() => expect(ok.c.view().support).toEqual({ kind: "ready" }));
    expect(make({ secure: false }).c.view().support).toEqual({ kind: "insecure" });
    const none = make({ xr: null });
    await vi.waitFor(() => expect(none.c.view().support).toEqual({ kind: "no-ar" }));
    const no = make({ xr: { isSessionSupported: async () => false } });
    await vi.waitFor(() => expect(no.c.view().support).toEqual({ kind: "no-ar" }));
  });

  it("상태 메시지: 기준점·맞춤과 상태 줄. 잠깐 알릴 말은 4초, title은 늘 맞춤 상태", () => {
    t = 1000;
    const { c, ws } = make();
    ws.push(status());
    expect(c.view().anchors).toEqual(anchors);
    expect(c.view().status).toEqual({ text: "맞추기 전 · 창가 기준 방향만 · 기준점 1/2 기록", title: "맞추기 전 · 창가 기준 방향만 · 기준점 1/2 기록" });
    c.actions.recordAnchor("a");
    expect(c.view().status.text).toBe("조준점이 바닥에 닿지 않았어요. 바닥을 천천히 비춰 주세요");
    t = 5001;
    ws.push(status({ aligned: true, mismatch_m: 0.12 }));
    expect(c.view().status.text).toBe("맞춤 ✓ · 거리 차이 12cm");
    ws.push(status({ error: "기준점이 너무 가까워요" }));
    expect(c.view().status.text).toBe("기준점이 너무 가까워요");
  });

  it("벽 기준점: AR 전에는 먼저 시작하라고 하고 보내지 않는다", () => {
    const { c, ws, sent } = make();
    ws.push(status({ mode: "touch" }));
    c.actions.recordAnchor("A");
    expect(c.view().status.text).toBe("AR을 먼저 시작하세요");
    expect(sent()).toEqual([]);
  });

  it("말하기: 빈 말은 보내지 않고, 보내면 「생각 중」 줄 15초. 연결이 끊기면 다시 말하라고", () => {
    vi.useFakeTimers();
    const { c, ws, sent } = make();
    c.actions.say("   ");
    expect(sent()).toEqual([]);
    c.actions.say(" TV 켜줘 ");
    expect(sent()).toEqual([{ type: "say", text: "TV 켜줘" }]);
    expect([c.view().reply, c.view().toast]).toEqual(['🎙 "TV 켜줘" … 생각 중', '🎙 "TV 켜줘" … 생각 중']);
    vi.advanceTimersByTime(15000);
    expect(c.view().toast).toBeNull();
    ws.readyState = 3;
    c.actions.say("불 꺼줘");
    expect(c.view().reply).toBe("서버와 연결이 끊겼어요. 잠시 뒤 다시 말해 주세요.");
  });

  it("답: 소리로 읽고 승인 대기를 보인다. 승인이 있으면 알림 12초. 승인·취소는 그 줄을 지우고 보낸다", () => {
    vi.useFakeTimers();
    const { c, ws, spoken, sent } = make();
    ws.push({ type: "reply", text: "현관문 잠금 해제는 승인이 필요해요.", pending: [{ token: "t1", deviceLabel: "현관문", reason: "현관문 잠금 해제" }, { token: "t2", deviceLabel: "창문", reason: "창문 열기" }] });
    expect(spoken).toEqual(["현관문 잠금 해제는 승인이 필요해요."]);
    expect(c.view().pending.map((p) => p.token)).toEqual(["t1", "t2"]);
    vi.advanceTimersByTime(11999);
    expect(c.view().toast).not.toBeNull();
    vi.advanceTimersByTime(1);
    expect(c.view().toast).toBeNull();
    c.actions.confirm("t1");
    c.actions.cancel("t2");
    expect(c.view().pending).toEqual([]);
    expect(sent()).toEqual([{ type: "confirm", token: "t1" }, { type: "cancel", token: "t2" }]);
  });

  it("사진 요청: 거둘 때까지 보이고 소리로 읽는다. 다른 요청을 거두는 말은 무시한다", () => {
    const { c, ws, spoken } = make();
    ws.push({ type: "request", id: "r1", text: "컵 안을 비춰 주세요", active: true });
    expect(c.view().request).toEqual({ id: "r1", text: "컵 안을 비춰 주세요" });
    ws.push({ type: "request", id: "r0", text: "", active: false });
    expect(c.view().request).not.toBeNull();
    ws.push({ type: "request", id: "r1", text: "컵 안을 비춰 주세요", active: false });
    expect(c.view().request).toBeNull();
    expect(spoken).toEqual(["컵 안을 비춰 주세요"]);
  });

  it("행동 부탁: speak면 읽고, 고르면 brain_reply. done이면 고맙다는 알림 3초. 연결이 끊기면 상태 줄", () => {
    vi.useFakeTimers();
    const { c, ws, spoken, sent } = make();
    const choices = [{ id: "done", label: "치웠어요" }, { id: "later", label: "나중에" }];
    ws.push({ type: "action", id: "a1", text: "식탁 위 컵을 치워 주세요", would: "로봇이 식탁의 컵을 싱크대로 옮긴다", choices, active: true, speak: true });
    expect(c.view().action).toEqual({ id: "a1", text: "식탁 위 컵을 치워 주세요", would: "로봇이 식탁의 컵을 싱크대로 옮긴다", choices });
    expect(spoken).toEqual(["식탁 위 컵을 치워 주세요"]);
    c.actions.brainReply("a1", "done");
    expect(sent()).toEqual([{ type: "brain_reply", id: "a1", choice: "done" }]);
    expect(c.view().toast).toBe("고마워요. 컵이 안 보이는지 확인할게요");
    vi.advanceTimersByTime(3000);
    expect(c.view().toast).toBeNull();
    ws.push({ type: "action", id: "a0", active: false });
    expect(c.view().action).not.toBeNull();
    ws.push({ type: "action", id: "a1", active: false });
    expect(c.view().action).toBeNull();
    ws.readyState = 3;
    c.actions.brainReply("a1", "later");
    expect(c.view().status.text).toBe("서버와 연결이 끊겨 답을 보내지 못했어요");
  });

  it("마스코트 말풍선 글은 다음 brain_line까지 남고 빈 글이면 지운다. 사진 보냄 알림은 위치·요청에 따라", () => {
    vi.useFakeTimers();
    const { c, ws } = make();
    ws.push({ type: "brain_line", text: "식탁 위 컵을 보고 있어요" });
    expect(c.view().brainLine).toBe("식탁 위 컵을 보고 있어요");
    vi.advanceTimersByTime(60_000);
    expect(c.view().brainLine).toBe("식탁 위 컵을 보고 있어요");
    ws.push({ type: "brain_line", text: "자리를 비워 컵을 치운다" });
    expect(c.view().brainLine).toBe("자리를 비워 컵을 치운다");
    ws.push({ type: "brain_line", text: "" });
    expect(c.view().brainLine).toBeNull();
    ws.push({ type: "photo_saved", id: "p1", aligned: true });
    expect(c.view().toast).toBe("사진을 위치와 함께 보냈어요");
    ws.push({ type: "photo_saved", id: "p2", aligned: false });
    expect(c.view().toast).toBe("위치 없이 사진을 보냈어요");
    ws.push({ type: "photo_saved", id: "p3", answer: true });
    expect(c.view().toast).toBe("요청한 컵 사진을 보냈어요");
  });

  it("메뉴: 열고, 기준점 다시 찍기는 같은 원점 이름으로 reset을 보내고 메뉴를 닫는다", () => {
    const { c, sent } = make();
    c.actions.setMenu(true);
    expect(c.view().menuOpen).toBe(true);
    c.actions.resetAnchors();
    expect(sent()).toEqual([{ type: "reset", epoch: null }]);
    expect(c.view().menuOpen).toBe(false);
  });

  it("AR 시작·끝: 덮개를 보이고 숨긴다. 시작이 실패하면 처음 화면에 까닭", async () => {
    const session = fakeSession();
    const { c, sent } = make({ arDeps: { xr: () => ({ requestSession: async () => session }), gl: () => gl, layer: () => ({}), binding: () => null } });
    c.attach(document.createElement("div"), { start() {}, hit() {}, marks() {} });
    c.actions.startAr();
    await vi.waitFor(() => expect(sent().some((m) => m.type === "reset" && typeof m.epoch === "string")).toBe(true));
    expect(c.view().ar).toBe(true);
    c.actions.stopAr();
    expect(c.view().ar).toBe(false);
    const bad = make({ arDeps: { xr: () => ({ requestSession: async () => { throw new Error("거부됨"); } }) } });
    bad.c.attach(document.createElement("div"), { start() {}, hit() {}, marks() {} });
    bad.c.actions.startAr();
    await vi.waitFor(() => expect(supportText(bad.c.view().support)).toBe("AR을 시작하지 못했어요: 거부됨"));
  });

  it("덮개 뿌리를 잇기 전에 AR 시작을 누르면 세션을 열지 않고 처음 화면에 까닭", async () => {
    const requestSession = vi.fn();
    const { c } = make({ arDeps: { xr: () => ({ requestSession }) } });
    await vi.waitFor(() => expect(c.view().support).toEqual({ kind: "ready" }));
    c.actions.startAr();
    expect(requestSession).not.toHaveBeenCalled();
    expect(supportText(c.view().support)).toBe("AR을 시작하지 못했어요: 페이지를 새로 고쳐 주세요");
  });

  it("누르고 말하기: 누르는 동안 그 자리 단추만 듣는 중, 떼면 들은 말을 보낸다", () => {
    class Rec {
      static last: Rec;
      lang = ""; interimResults = false; maxAlternatives = 0;
      onresult: ((e: unknown) => void) | null = null; onerror: ((e: unknown) => void) | null = null; onend: (() => void) | null = null;
      constructor() { Rec.last = this; }
      start() {}
      stop() { this.onend?.(); }
    }
    const { c, sent } = make({ Recognition: Rec as never });
    expect(c.view().speech).toBe(true);
    c.actions.talkDown("ar");
    expect(c.view().listening).toBe("ar");
    Rec.last.onresult!({ results: [[{ transcript: "불 꺼줘" }]] });
    c.actions.talkUp("ar");
    expect(c.view().listening).toBeNull();
    expect(sent()).toEqual([{ type: "say", text: "불 꺼줘" }]);
  });
});
