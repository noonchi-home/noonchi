// 영상 모드(?clip=)와 실제 모드는 카메라 입력만 다르다: 같은 서버 메시지·같은 단추를 넣으면 소리로 읽는 말, 서버로 보내는 답,
// 엄지 자리(handOf)·승인 대기 목록이 하나도 다르지 않아야 한다. 명령 소리 읽기·단추 답·승인·명령 줄 차례·끄기 안내를 한 대본으로 돌린다.
// AR을 연 뒤에는 말에 at(그때 떠 있던 명령·보인 승인 대기)이 실리니, 같은 대본 사이사이 말을 넣어 at까지 견준다(실제 모드는 가짜 WebXR 세션, 영상 모드는 대역 영상).
// 영상 모드에서 소리 읽기·답·승인·at 같은 동작을 따로 두면(예전의 소리 끄기 갈래) 이 시험이 실패한다(tests/video-mode-parity.test.ts는 갈래 자리를 본다).
// 서버 쪽(영상 연결 ?video=와 실제 연결의 명령·단계 끝·World State 반영)은 tests/video-real-e2e.test.ts가 견준다.
import { afterEach, describe, expect, it, vi } from "vitest";
import { createPhoneController, type ControllerDeps, type PhoneController } from "../src/phone/controller";
import { handOf } from "../src/phone/state";

class FakeSocket {
  static OPEN = 1;
  static last: FakeSocket;
  readyState = 0;
  sent: Record<string, unknown>[] = [];
  private on: Record<string, ((e: unknown) => void)[]> = {};
  constructor(readonly url: string) { FakeSocket.last = this; }
  addEventListener(t: string, f: (e: unknown) => void) { (this.on[t] ??= []).push(f); }
  send(d: string | Blob) { if (typeof d === "string") this.sent.push(JSON.parse(d)); }
  close() { this.readyState = 3; }
  open() { this.readyState = 1; for (const f of this.on.open ?? []) f({}); }
  push(m: unknown) { for (const f of this.on.message ?? []) f({ data: JSON.stringify(m) }); }
}

type Fn = (...a: any[]) => void;
/** 가짜 WebXR 세션(실제 모드 AR): 프레임은 돌리지 않는다. */
function fakeSession() {
  const on: Record<string, Fn[]> = {};
  return {
    renderState: { baseLayer: { framebuffer: null } },
    updateRenderState() {},
    requestReferenceSpace: async () => ({ addEventListener() {} }),
    requestHitTestSource: async () => ({}),
    addEventListener: (t: string, f: Fn) => { (on[t] ??= []).push(f); },
    requestAnimationFrame() {},
    end() { for (const f of on.end ?? []) f(); },
  };
}
const gl = { FRAMEBUFFER: 1, COLOR_BUFFER_BIT: 2, bindFramebuffer() {}, clearColor() {}, clear() {} };
/** 대역 영상(영상 모드 AR): 재생만 되고 프레임 고리는 돌리지 않는다. */
function fakeVideo() {
  const element = document.createElement("div");
  return {
    element, currentTime: 0, videoWidth: 1280, videoHeight: 720, ended: false,
    drawTo() {}, play: async () => {}, nextFrame() {}, onEnded() {}, close() { element.remove(); },
  };
}
const jpeg = () => new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])]);

const made: PhoneController[] = [];
afterEach(() => { while (made.length) made.pop()!.close(); });

const APPROVE = [{ id: "approve", label: "승인" }, { id: "reject", label: "거절" }];
const DOOR = { token: "t1", deviceLabel: "현관문", reason: "현관문 잠금 해제", choices: APPROVE };
const OFF = { type: "command", id: "plan:pam-0", step: "off:plan:pam-0:induction_1:1", text: "인덕션을 꺼 주세요", vision: null, choices: [{ id: "done", label: "완료" }], target: null, speak: true, grade: "safety" };
const GO = { type: "command", id: "plan:pam-1", step: "plan:pam-1:1", text: "식탁으로 가 주세요", vision: "식탁까지 2.1m", choices: [{ id: "done", label: "완료" }], target: null, speak: true, kind: "go" };
const ASK = { type: "command", id: "plan:pam-2", step: "plan:pam-2:1", text: "컵을 치울까요?", vision: null, choices: [{ id: "clear", label: "치워 주세요" }, { id: "keep", label: "그대로 둬요" }], target: null, speak: true, grade: "question" };

/** 모드마다 AR 대역: 실제 모드는 가짜 WebXR 세션, 영상 모드는 대역 영상·인코더·그림판. */
function arDepsFor(video: boolean): Partial<ControllerDeps> {
  if (video) {
    return {
      secure: false, xr: null,
      arDeps: {
        createVideo: () => fakeVideo(),
        createEncoder: () => ({ mode: "test", encode: async () => jpeg(), close() {} }),
        createCanvas: () => ({ width: 0, height: 0, getContext: () => ({ getImageData: (_x: number, _y: number, w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4) }) }) }),
        screen: () => ({ width: 844, height: 390 }),
      },
    } as Partial<ControllerDeps>;
  }
  const session = fakeSession();
  return {
    secure: true, xr: { isSessionSupported: async () => true },
    arDeps: { xr: () => ({ requestSession: async () => session }), gl: () => gl, layer: () => ({}), binding: () => null },
  } as Partial<ControllerDeps>;
}

/**
 * 한 대본을 돌려 단계마다 소리로 읽은 말·보낸 답·엄지 자리·승인 대기 목록을 모은다.
 * ar이면 AR을 연 뒤 같은 대본을 돌리고, 사이사이 말(「응」)을 보내 그 말의 at을 함께 모은다.
 */
async function run(search: string, ar = false) {
  const spoken: string[] = [];
  const c = createPhoneController({
    location: { protocol: "http:", host: "127.0.0.1:8210", search },
    Socket: FakeSocket, Recognition: null, speak: (s, done) => { spoken.push(s); done(); }, hush: () => {}, secure: false, xr: null,
    ...(ar ? arDepsFor(search.includes("clip=")) : {}),
  });
  made.push(c);
  const ws = FakeSocket.last;
  ws.open();
  if (ar) {
    const overlay = document.createElement("div");
    document.body.append(overlay);
    c.attach(overlay, { start() {}, aim() {}, hit() {}, marks() {} });
    await vi.waitFor(() => expect(c.view().support).toEqual({ kind: "ready" }));
    c.actions.startAr();
    await vi.waitFor(() => expect(c.view().ar).toBe(true));
  }
  const out: unknown[] = [];
  const answers = () => ws.sent.filter((m) => ["say", "answer", "confirm", "cancel"].includes(String(m.type)));
  const snap = (step: string) => {
    if (ar) c.actions.say("응");
    const h = handOf(c.view());
    out.push({ step, spoken: [...spoken], answers: answers(), top: h.top, thumb: h.thumb?.kind ?? null, vision: h.vision, pending: c.view().pending.map((p) => p.token) });
  };
  ws.push(GO); snap("명령");
  ws.push({ type: "reply", text: "현관문 잠금 해제는 승인이 필요해요.", pending: [DOOR] }); snap("승인 대기");
  c.actions.confirm("t1", "approve"); snap("승인 단추");
  ws.push({ type: "reply", text: "현관문을 열었어요" }); snap("승인 답");
  ws.push(OFF); snap("끄기 안내");
  c.actions.answer(OFF.id, OFF.step, "done"); snap("끄기 안내 완료 단추");
  ws.push({ ...OFF, text: "인덕션이 보이게 폰을 가까이 대 주세요", choices: [] }); snap("보이게 해 달라는 부탁");
  ws.push({ type: "command_clear", id: OFF.id }); snap("끄기 안내 지움");
  c.actions.answer(GO.id, GO.step, "done"); snap("명령 완료 단추");
  ws.push(ASK); snap("질문");
  c.actions.answer(ASK.id, ASK.step, "clear"); snap("질문 답");
  ws.push({ type: "command_clear" }); snap("명령 지움");
  return out;
}

describe("영상 모드는 실제 모드와 같은 지시·소리·답을 낸다", () => {
  it("명령 소리 읽기·단추 답·승인·명령 줄 차례·끄기 안내가 실제 모드와 하나도 다르지 않다", async () => {
    const real = await run("");
    const video = await run("?clip=cup-demo.mp4");
    expect(video).toEqual(real);
    // 대본이 실제로 소리·답·승인·끄기 안내를 거쳤는지(빈 대본끼리 같아 통과하지 않게)
    const last = real.at(-1) as { spoken: string[]; answers: unknown[] };
    expect(last.spoken).toContain("인덕션을 꺼 주세요");
    expect(last.spoken).toContain("컵을 치울까요?");
    expect(last.answers).toContainEqual({ type: "confirm", token: "t1", choice: "approve" });
    expect(last.answers).toContainEqual({ type: "answer", id: OFF.id, step: OFF.step, choice: "done" });
  });

  it("AR을 연 뒤에도 같은 대본에서 말의 at(그때 떠 있던 명령·보인 승인 대기)까지 실제 모드와 같다", async () => {
    const real = await run("", true);
    const video = await run("?clip=cup-demo.mp4", true);
    expect(video).toEqual(real);
    // AR 중이라 at이 명령·승인 대기를 가리킨다(AR 밖이면 늘 none)
    const ats = ((real.at(-1) as { answers: { type: string; at?: unknown }[] }).answers).filter((m) => m.type === "say").map((m) => m.at);
    expect(ats).toContainEqual({ kind: "command", id: GO.id, step: GO.step, pending: [] });
    expect(ats).toContainEqual({ kind: "none", pending: ["t1"] });
    expect(ats).toContainEqual({ kind: "command", id: OFF.id, step: OFF.step, pending: [] });
    expect(ats).toContainEqual({ kind: "command", id: ASK.id, step: ASK.step, pending: [] });
  });
});
