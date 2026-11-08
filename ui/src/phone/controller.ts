// 폰 화면 제어: 연결(core/link.js)·AR(core/ar.js)·누르고 말하기(core/talk.js)를 묶고, 서버 메시지와 단추를 화면 상태(state.ts)로 바꾼다.
// 규칙은 옮기기 전 web/phone/phone.js 그대로다: 알림 5초(답에 승인이 있으면 12초), 판단 줄 8초, 잠깐 알릴 말 4초.
// 상태 줄은 상태 메시지·잠깐 알릴 말·1초마다의 측정 때 다시 만든다. 부탁·질문이 뜨면 소리로 읽고, 답은 말이나 단추로 보낸다.
import { createAr } from "./core/ar.js";
import { createLink, phoneSocketUrl } from "./core/link.js";
import { createPressToTalk, recognition, speak as speakAloud, type PressToTalk, type RecognitionCtor } from "./core/talk.js";
import {
  anchorCount, createStore, initialView, onAction, onRequest, onStatus, photoSavedText, statusLine,
  type Anchor, type AlignMode, type Choice, type FocusMark, type Pending, type PhoneActions, type PhoneView, type TalkSpot,
} from "./state";

const TOAST_MS = 5000;
const NOTE_MS = 4000;
const BRAIN_LINE_MS = 8000;

type XrLike = { isSessionSupported(mode: string): Promise<boolean> };
export interface ControllerDeps {
  location: { protocol: string; host: string; search: string };
  /** 시험이 바꾼다. 없으면 브라우저 WebSocket. */
  Socket?: unknown;
  /** undefined면 브라우저 음성 인식, null이면 없음. */
  Recognition?: RecognitionCtor | null;
  speak?: (text: string) => void;
  now?: () => number;
  secure?: boolean;
  /** 없으면 navigator.xr. null이면 AR 없음. */
  xr?: XrLike | null;
  arDeps?: Record<string, unknown>;
}
export interface ControllerDraw { hit(on: boolean): void; marks(marks: FocusMark[]): void }
export interface PhoneController {
  view(): PhoneView;
  subscribe(fn: () => void): () => void;
  actions: PhoneActions;
  /** AR 덮개 뿌리(DOM 오버레이)와 canvas 그림을 잇는다. */
  attach(overlay: HTMLElement | null, draw: ControllerDraw): void;
  close(): void;
}

type Msg = Record<string, any>;

export function createPhoneController(deps: ControllerDeps): PhoneController {
  const now = deps.now ?? (() => performance.now());
  const speak = deps.speak ?? speakAloud;
  const Recognition = deps.Recognition === undefined ? recognition() : deps.Recognition;
  const params = new URLSearchParams(deps.location.search);
  const store = createStore<PhoneView>(initialView(Boolean(Recognition)));
  const set = (fn: (v: PhoneView) => PhoneView) => store.set(fn);
  // 상태 줄 재료와 기록에 붙일 서버 기준점 판
  let revision: number | null = null;
  let mismatchM: number | null = null;
  let note: { text: string; until: number } | null = null;
  let overlay: HTMLElement | null = null;
  let draw: ControllerDraw = { hit: () => {}, marks: () => {} };
  let toastTimer: ReturnType<typeof setTimeout> | undefined;
  let lineTimer: ReturnType<typeof setTimeout> | undefined;

  const link = createLink({ url: phoneSocketUrl(deps.location), onMessage, Socket: deps.Socket, now: undefined });
  const ar = createAr({
    link, params, deps: deps.arDeps,
    hooks: {
      onStart: () => set((v) => ({ ...v, ar: true })),
      onEnd: () => set((v) => ({ ...v, ar: false })),
      onHit: (hit) => draw.hit(hit),
      onMarks: (marks) => draw.marks(marks),
      onPerf: () => {
        const p = ar.perf();
        set((v) => ({ ...v, fps: p.fps, perfDetail: p.detail }));
        renderStatus();
      },
      note: showNote,
    },
  });
  const talk: Partial<Record<TalkSpot, PressToTalk>> = {};
  if (Recognition) {
    for (const spot of ["intro", "ar"] as const) {
      talk[spot] = createPressToTalk(Recognition, {
        onListening: (on) => set((v) => ({ ...v, listening: on ? spot : null })),
        onLine: showLine,
        onHeard: (text) => actions.say(text),
      });
    }
  }

  function renderStatus() {
    set((v) => ({
      ...v,
      status: statusLine({
        aligned: v.aligned, mode: v.mode, mismatchM, limited: ar.state.limited,
        anchorCount: v.anchors ? anchorCount(v.anchors) : "",
        note: note && now() < note.until ? note.text : null,
      }),
    }));
  }
  function showNote(text: string) {
    note = { text, until: now() + NOTE_MS };
    renderStatus();
  }
  function toast(text: string, ms = TOAST_MS) {
    set((v) => ({ ...v, toast: text }));
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => set((v) => ({ ...v, toast: null })), ms);
  }
  function showLine(text: string, ms?: number) {
    set((v) => ({ ...v, reply: text }));
    toast(text, ms);
  }

  function onMessage(msg: Msg) {
    if (msg.type === "status") {
      revision = msg.revision ?? null;
      ar.setEngineMs(msg.engine_ms);
      mismatchM = msg.mismatch_m ?? null;
      set((v) => onStatus(v, msg as { mode?: AlignMode; anchors: Anchor[]; aligned: boolean }));
      if (msg.error) showNote(msg.error);
      else renderStatus();
    } else if (msg.type === "photo_saved") toast(photoSavedText(msg));
    else if (msg.type === "reply") {
      const pending: Pending[] = msg.pending ?? [];
      showLine(msg.text, pending.length ? 12000 : TOAST_MS);
      speak(msg.text);
      set((v) => ({ ...v, pending }));
    } else if (msg.type === "focus") ar.setFocus(msg.targets, msg.ttl_ms);
    else if (msg.type === "request") {
      if (!msg.active && msg.id !== store.get().request?.id) return;
      set((v) => onRequest(v, msg as { id: string; text: string; active: boolean }));
      if (msg.active) speak(msg.text);
    } else if (msg.type === "action") {
      set((v) => onAction(v, msg as { id: string; text?: string; would?: string | null; choices?: Choice[]; active: boolean }));
      if (msg.active && msg.speak) speak(msg.text);
    } else if (msg.type === "brain_line") {
      set((v) => ({ ...v, brainLine: String(msg.text ?? "") }));
      clearTimeout(lineTimer);
      lineTimer = setTimeout(() => set((v) => ({ ...v, brainLine: null })), BRAIN_LINE_MS);
    }
  }

  /** 벽 기준점 기록: 조준점이 닿은 바닥 점(벽 바로 아래)을 그 기준점으로 보낸다. 점 자체가 바닥이라 floor도 같은 점이다. */
  function aimTouch(id: string) {
    if (!ar.state.on) return showNote("AR을 먼저 시작하세요");
    if (!ar.state.lastFloor) return showNote(`조준점이 바닥에 닿지 않았어요. ${id} 벽 바로 아래 바닥을 천천히 비춰 주세요`);
    if (link.send({ type: "anchor", id, point: ar.state.lastFloor, floor: ar.state.lastFloor, epoch: ar.state.epoch, revision })) toast(`${id} 지점을 기록했어요`, 2500);
    else showNote("서버와 연결이 끊겨 기록하지 못했어요");
  }

  const actions: PhoneActions = {
    startAr() {
      // 사용자 동작 안에서 바로 requestSession까지 간다(await 없이)
      const failed = (message: string) => set((v) => ({ ...v, support: { kind: "failed", message } }));
      if (!overlay) return failed("페이지를 새로 고쳐 주세요");
      ar.start(overlay).catch((error: Error) => failed(error.message));
    },
    stopAr: () => ar.stop(),
    takePhoto: () => ar.requestPhoto(),
    recordAnchor(id) {
      if (store.get().mode === "touch") return aimTouch(id);
      if (!ar.state.hitPoint) return showNote("조준점이 바닥에 닿지 않았어요. 바닥을 천천히 비춰 주세요");
      link.send({ type: "anchor", id, point: ar.state.hitPoint, epoch: ar.state.epoch, revision });
    },
    resetAnchors() {
      // 같은 AR 공간에서 다시 맞추기: 원점(epoch)은 그대로 두고 기록만 지운다
      link.send({ type: "reset", epoch: ar.state.epoch });
      set((v) => ({ ...v, menuOpen: false }));
    },
    setMenu: (open) => set((v) => ({ ...v, menuOpen: open })),
    say(text) {
      const t = text.trim();
      if (!t) return;
      showLine(`🎙 "${t}" … 생각 중`, 15000);
      if (!link.send({ type: "say", text: t })) showLine("서버와 연결이 끊겼어요. 잠시 뒤 다시 말해 주세요.");
    },
    confirm(token) {
      set((v) => ({ ...v, pending: v.pending.filter((p) => p.token !== token) }));
      link.send({ type: "confirm", token });
    },
    cancel(token) {
      set((v) => ({ ...v, pending: v.pending.filter((p) => p.token !== token) }));
      link.send({ type: "cancel", token });
    },
    brainReply(id, choice) {
      if (!link.send({ type: "brain_reply", id, choice })) showNote("서버와 연결이 끊겨 답을 보내지 못했어요");
      else if (choice === "done") toast("고마워요. 컵이 안 보이는지 확인할게요", 3000);
    },
    talkDown: (spot) => talk[spot]?.down(),
    talkUp: (spot) => talk[spot]?.up(),
  };

  async function checkSupport() {
    if (!(deps.secure ?? window.isSecureContext)) return set((v) => ({ ...v, support: { kind: "insecure" } }));
    const xr = "xr" in deps ? deps.xr : (navigator as Navigator & { xr?: XrLike }).xr;
    const ok = xr ? await xr.isSessionSupported("immersive-ar").catch(() => false) : false;
    set((v) => ({ ...v, support: { kind: ok ? "ready" : "no-ar" } }));
  }
  void checkSupport();

  return {
    view: store.get,
    subscribe: store.subscribe,
    actions,
    attach(root, d) {
      overlay = root;
      draw = d;
    },
    close() {
      link.close();
      ar.stop();
      clearTimeout(toastTimer);
      clearTimeout(lineTimer);
    },
  };
}
