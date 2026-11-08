// 실제 폰 제어: 연결(core/link.js)·AR(core/ar.js)·늘 듣기와 소리(core/talk.js)를 묶고, 서버 메시지와 단추를 화면 상태(state.ts)로 바꾼다.
// 듣기는 AR 중 늘 켜 두고(끝나면 다시 켬), 명령·답을 소리로 읽는 동안은 멈췄다가 다 읽으면(끝 알림, 오지 않으면 정해진 시간 뒤) 다시 켠다.
// 들은 말은 그대로 서버로 간다(say: 명령의 답이면 서버가 그 답으로 받고, 아니면 에이전트로). 명령·질문(command, src/contract/phone.ts)이 speak로 오면 읽는다.
// 답 단추는 받은 명령의 id·step으로 answer를 보낸다. 말의 답(reply)이 빈 글이면 보이지도 읽지도 않는다. 잠깐 알릴 말은 4초.
// 명령 대상 고리: 명령에 실린 대상(target, AR 자리) 하나만, 위 줄·엄지 자리에 그 명령이 보일 때만(handOf) 그린다. 에이전트 초점(focus)은
// 명령이 없을 때만 AR에 넘긴다(대시보드로 가는 화면 프레임에만 그려지고 실제 폰 화면에는 그리지 않는다). 조준점은 찍기·맞추기 때만(draw.aim).
import type { PhoneCommand, PhoneCommandClear } from "../../../src/contract/phone.ts";
import { createAr } from "./core/ar.js";
import { createLink, phoneSocketUrl } from "./core/link.js";
import { createListener, recognition, speak as speakAloud, type RecognitionCtor } from "./core/talk.js";
import {
  createStore, handOf, initialView, onStatus,
  type Anchor, type AlignMode, type FocusMark, type Pending, type PhoneActions, type PhoneView,
} from "./state";

const NOTE_MS = 4000;
/** 명령 대상 초점은 명령이 지워질 때까지(command_clear) 둔다. */
const COMMAND_FOCUS_MS = 3_600_000;
/** 소리 끝 알림이 오지 않을 때 다시 듣기까지: 2초 + 글자마다 0.3초. */
const speakMs = (text: string) => 2000 + text.length * 300;

type XrLike = { isSessionSupported(mode: string): Promise<boolean> };
export interface ControllerDeps {
  location: { protocol: string; host: string; search: string };
  /** 시험이 바꾼다. 없으면 브라우저 WebSocket. */
  Socket?: unknown;
  /** undefined면 브라우저 음성 인식, null이면 없음. */
  Recognition?: RecognitionCtor | null;
  /** 소리로 읽기. 다 읽으면 done. */
  speak?: (text: string, done: () => void) => void;
  secure?: boolean;
  /** 없으면 navigator.xr. null이면 AR 없음. */
  xr?: XrLike | null;
  arDeps?: Record<string, unknown>;
}
/** canvas 그림: start는 덮개를 열 때 한 번(지난 세션 그림을 지운다), aim은 조준점 켜고 끄기, hit·marks는 XR 프레임마다. */
export interface ControllerDraw { start(): void; aim(on: boolean): void; hit(on: boolean): void; marks(marks: FocusMark[]): void }
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
  const speak = deps.speak ?? speakAloud;
  const Recognition = deps.Recognition === undefined ? recognition() : deps.Recognition;
  const params = new URLSearchParams(deps.location.search);
  const store = createStore<PhoneView>(initialView());
  const set = (fn: (v: PhoneView) => PhoneView) => store.set(fn);
  /** 기록에 붙일 서버 기준점 판. */
  let revision: number | null = null;
  let overlay: HTMLElement | null = null;
  let draw: ControllerDraw = { start: () => {}, aim: () => {}, hit: () => {}, marks: () => {} };
  let noteTimer: ReturnType<typeof setTimeout> | undefined;
  let talkTimer: ReturnType<typeof setTimeout> | undefined;
  let talkTurn = 0;
  let aim = false;

  // 조준점은 찍기·맞추기 때만: setup이 바뀌면 그림에 알린다
  store.subscribe(() => {
    const on = store.get().setup !== null;
    if (on === aim) return;
    aim = on;
    draw.aim(on);
  });

  const link = createLink({
    url: phoneSocketUrl(deps.location), onMessage, Socket: deps.Socket, now: undefined,
    onOpen: () => set((v) => ({ ...v, connected: true })),
    onClose: () => set((v) => ({ ...v, connected: false })),
  });
  const listener = Recognition
    ? createListener(Recognition, { onState: (s) => set((v) => ({ ...v, listening: s })), onHeard: (text) => actions.say(text) })
    : null;

  /** XR 프레임마다: 바닥 닿음·추적 약함이 바뀔 때만 화면 상태를 바꾼다. */
  function syncFrame(hit?: boolean) {
    const v = store.get();
    const next = { hit: hit ?? v.hit, limited: ar.state.limited };
    if (next.hit !== v.hit || next.limited !== v.limited) set((w) => ({ ...w, ...next }));
  }
  const ar = createAr({
    link, params, deps: deps.arDeps,
    hooks: {
      onStart: () => {
        draw.start();
        set((v) => ({ ...v, ar: true }));
        listener?.start();
      },
      onEnd: () => {
        listener?.stop();
        set((v) => ({ ...v, ar: false, setup: null, settingsOpen: false, limited: false, hit: false }));
      },
      onHit: (hit) => {
        draw.hit(hit);
        syncFrame(hit);
      },
      onMarks: (marks) => {
        // 위 줄·엄지 자리에 명령이 보일 때만(승인 대기·찍기·맞추기가 차지하면 그리지 않는다), 그 명령 대상 하나만
        const t = handOf(store.get()).thumb;
        const target = t?.kind === "command" ? t.command.target : null;
        draw.marks(target ? marks.filter((m) => m.id === target).slice(0, 1) : []);
        syncFrame();
      },
      onPerf: () => syncFrame(),
      note: showNote,
    },
  });

  function showNote(text: string) {
    set((v) => ({ ...v, note: text }));
    clearTimeout(noteTimer);
    noteTimer = setTimeout(() => set((v) => ({ ...v, note: null })), NOTE_MS);
  }

  /** 소리로 읽는 동안 듣기를 멈춘다. 마지막으로 시작한 읽기가 끝나야 다시 켠다. */
  function sayAloud(text: string) {
    const turn = ++talkTurn;
    listener?.pause();
    const done = () => {
      if (turn !== talkTurn) return;
      talkTurn += 1;
      clearTimeout(talkTimer);
      listener?.resume();
    };
    clearTimeout(talkTimer);
    talkTimer = setTimeout(done, speakMs(text));
    speak(text, done);
  }

  function onMessage(msg: Msg) {
    if (msg.type === "status") {
      revision = msg.revision ?? null;
      ar.setEngineMs(msg.engine_ms);
      set((v) => ({ ...onStatus(v, msg as { mode?: AlignMode; anchors: Anchor[]; aligned: boolean; mismatch_m?: number | null }), connected: true }));
      if (msg.error) showNote(msg.error);
    } else if (msg.type === "reply") {
      // pending 칸이 없으면(명령의 답·승인·취소의 답) 승인 대기 목록을 그대로 둔다
      const pending: Pending[] | undefined = msg.pending;
      const text = String(msg.text ?? "");
      set((v) => ({ ...v, reply: text || null, pending: pending ?? v.pending }));
      if (text) sayAloud(text);
    } else if (msg.type === "focus") {
      if (!store.get().command) ar.setFocus(msg.targets, msg.ttl_ms);
    } else if (msg.type === "command") {
      const m = msg as PhoneCommand;
      set((v) => ({ ...v, command: { id: m.id, step: m.step, text: m.text, vision: m.vision, choices: m.choices, target: m.target?.id ?? null } }));
      ar.setFocus(m.target ? [m.target] : [], COMMAND_FOCUS_MS);
      if (m.speak) sayAloud(m.text);
    } else if (msg.type === "command_clear") {
      const m = msg as PhoneCommandClear;
      if (m.id !== undefined && m.id !== store.get().command?.id) return;
      set((v) => ({ ...v, command: null }));
      ar.setFocus([], 0);
    }
  }

  /** 벽 기준점 기록: 조준점이 닿은 바닥 점(벽 바로 아래)을 그 기준점으로 보낸다. 점 자체가 바닥이라 floor도 같은 점이다. */
  function aimTouch(id: string) {
    if (!ar.state.on) return showNote("AR을 먼저 시작하세요");
    if (!ar.state.lastFloor) return showNote(`조준점이 바닥에 닿지 않았어요. ${id} 벽 바로 아래 바닥을 천천히 비춰 주세요`);
    if (!link.send({ type: "anchor", id, point: ar.state.lastFloor, floor: ar.state.lastFloor, epoch: ar.state.epoch, revision })) showNote("서버와 연결이 끊겨 기록하지 못했어요");
  }

  const actions: PhoneActions = {
    startAr() {
      // 사용자 동작 안에서 바로 requestSession까지 간다(await 없이)
      const failed = (message: string) => set((v) => ({ ...v, support: { kind: "failed", message } }));
      if (!overlay) return failed("페이지를 새로 고쳐 주세요");
      ar.start(overlay).catch((error: Error) => failed(error.message));
    },
    recordAnchor(id) {
      if (store.get().mode === "touch") return aimTouch(id);
      if (!ar.state.on) return showNote("AR을 먼저 시작하세요");
      if (!ar.state.hitPoint) return showNote("조준점이 바닥에 닿지 않았어요. 바닥을 천천히 비춰 주세요");
      if (!link.send({ type: "anchor", id, point: ar.state.hitPoint, epoch: ar.state.epoch, revision })) showNote("서버와 연결이 끊겨 기록하지 못했어요");
    },
    startAnchors() {
      // 같은 AR 공간에서 다시 맞추기: 원점(epoch)은 그대로 두고 기록만 지운다
      link.send({ type: "reset", epoch: ar.state.epoch });
      set((v) => ({ ...v, setup: "anchors", settingsOpen: false }));
    },
    startPlace: () => set((v) => ({ ...v, setup: "place", settingsOpen: false })),
    endSetup: () => set((v) => ({ ...v, setup: null })),
    setSettings: (open) => set((v) => ({ ...v, settingsOpen: open })),
    micOn: () => listener?.start(),
    say(text) {
      const t = text.trim();
      if (!t) return;
      set((v) => ({ ...v, reply: `🎙 "${t}" … 생각 중` }));
      if (!link.send({ type: "say", text: t })) set((v) => ({ ...v, reply: "서버와 연결이 끊겼어요. 잠시 뒤 다시 말해 주세요." }));
    },
    confirm(token) {
      set((v) => ({ ...v, pending: v.pending.filter((p) => p.token !== token) }));
      link.send({ type: "confirm", token });
    },
    cancel(token) {
      set((v) => ({ ...v, pending: v.pending.filter((p) => p.token !== token) }));
      link.send({ type: "cancel", token });
    },
    answer(id, step, choice) {
      if (!link.send({ type: "answer", id, step, choice })) showNote("서버와 연결이 끊겨 답을 보내지 못했어요");
    },
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
      listener?.stop();
      clearTimeout(noteTimer);
      clearTimeout(talkTimer);
    },
  };
}
