// 실제 폰 제어: 연결(core/link.js)·AR(core/ar.js)·늘 듣기와 소리(core/talk.js)를 묶고, 서버 메시지와 단추를 화면 상태(state.ts)로 바꾼다.
// 듣기는 AR 중 늘 켜 두고(끝나면 다시 켬), 명령·답을 소리로 읽는 동안은 멈췄다가 다 읽으면(끝 알림, 오지 않으면 정해진 시간 뒤) 다시 켠다.
// 들은 말은 그대로 서버로 간다(say: 명령의 답이면 서버가 그 답으로 받고, 아니면 에이전트로). 명령·질문(command, src/contract/phone.ts)이 speak로 오면 읽는다.
// 말에는 at(말하기 시작할 때 떠 있던 명령·보인 승인 대기 token)을 싣는다: 인식이 말 시작(speechstart)을 알리면 그때 잡아 두고, 알림 없이 온 말·글 입력은 보낼 때 것.
// 서버는 그 명령·token에만 답으로 받는다(말하는 사이 명령이 바뀌면 버린다). 서버 판본이 다르면 core/link.js가 다시 읽고, 못 읽으면 「새로 고침이 필요해요」.
// 답 단추는 받은 명령의 id·step으로 answer를, 승인 대기 답 단추는 그 토큰과 답(승인·거절)으로 confirm을 보낸다.
// 말의 답(reply)이 빈 글이면 보이지도 읽지도 않는다. 빈 글이 아니면 소리로 읽고 잠깐 알림 줄에 20초 남긴다(명령 줄은 그대로). 그 밖의 잠깐 알릴 말은 4초.
// 소리는 차례로 읽는다(sayAloud 줄): 앞 말이 끝난 뒤(끝 알림, 오지 않으면 speakMs) 다음 말을 읽는다. 명령 말에는 그 명령(계획 id·단계 id)을 붙이고,
// 새 명령·그 명령의 command_clear가 오면 아직 안 읽은 그 명령 말을 버린다. 읽기 바로 앞에는 화면 엄지 자리에 실제로 보이는 대상(handOf, 말의 at과 같은 길)과
// 견줘 다르면 건너뛴다(승인 대기 뒤에 숨은 명령은 읽지 않는다). 그렇게 못 읽은 명령 말은 가림(맞추기·승인 대기)이 풀려 그 명령이 보이는 순간 바로 읽는다.
// reply를 읽은 뒤 보이는 명령·승인 대기가 있고 줄에 그 말이 없으면 한 번 다시 읽는다(승인 대기는 위 줄 「기기: 까닭」). 듣기는 줄이 빌 때까지 멈춘다(읽는 동안 들으면 폰 스피커 소리를 인식이 듣고 그 글이 말로 서버에 간다).
// 말에는 등급이 있다: 안전(끄기 안내·다시 켜짐 경고)·질문(승인·물음, 승인 대기)은 서버가 붙이고(grade), 그 밖은 명령·일반 reply다.
// 안전·질문 말은 서버 글 틀이라 짧아 자르지 않고 끝까지 읽고, 처음 읽는 것은 시간이 모자라도 건너뛰지 않는다(듣기 멈춤이 그만큼 길어진다).
// 명령·reply는 말 하나에 많아야 TALK_MAX_MS(15초), 듣기 멈춤은 멈춘 때부터 많아야 LISTEN_PAUSE_MAX_MS(20초)다: 먼저 받는 말(안전·질문 → 명령·다시 읽기 →
// reply, 같은 차례면 뒤에 온 말) 시간을 남기고 일찍 끊거나 건너뛴다. 다 쓰면 소리를 끊고 다시 듣는다. 끊은 말의 글은 답 줄·알림 줄에 남는다.
// 카메라 화면을 못 보내면(core/ar.js 알림) 그 AR 동안 cameraOff로 두어 설정 모달에 「카메라 · 못 보냄」을 남긴다.
// 위치 맞춤: 시작 위치가 있으면 AR을 켤 때 「여기서 시작」(시작 위치 맞추기)을 띄운다(state.ts onStatus). 단추나 말 「여기서 시작」이면
// 마지막 폰 자세와 원점으로 {type:"start"}를 보낸다. 그 뒤 서버가 걸으면서 물건·벽 모양으로 맞춘다(src/phone/sync).
// 명령 대상: 명령에 실린 대상(target, AR 자리) 하나만, 위 줄·엄지 자리에 그 명령이 보일 때만(handOf) 넘긴다. 이동 중에는 갈 방향을, 화면 밖이거나 칸에 가리면 그쪽을 세모로 가리킨다(draw.ts). 에이전트 초점(focus)은
// 명령이 없을 때만 AR에 넘긴다(대시보드로 가는 화면 프레임에만 그려지고 실제 폰 화면에는 그리지 않는다). 조준점은 물건 자리 맞추기 때만(draw.aim).
// 영상 입력 모드(?clip=, core/video-ar.js): 카메라 입력만 다르고 지시·소리 읽기·완료 판단·트윈 반영은 실제 모드와 같다(tests/video-mode-parity.test.ts).
// 카메라 대신 영상을 틀고 고정 자세로 바로 맞춘다(start fixed). 지원은 바로 되고(WebXR·https 없어도), 마이크로 늘 듣기만 끈다(답은 화면 단추).
// 「여기서 시작」은 저절로 열지 않고(영상 AR이 고정 시작 자세를 스스로 보냄), 서버 맞춤이 없으면 영상 AR이 시작 자세를 다시 보낸다(syncStatus).
// 받은 명령은 그 영상 시각으로 기록하고(window.__noonchiVideo), 영상 AR에 넘겨 맞는 단계 영상(?step=)으로 바꾸고 go 단계면 자세를 걷게 한다.
import type { HeardAt, PhoneCommand, PhoneCommandClear, TalkGrade } from "../../../src/contract/phone.ts";
import { createAr, type ArHooks, type PhoneAr } from "./core/ar.js";
import { createVideoAr, logVideoAt, logVideoCommand, videoParams, type VideoArDeps } from "./core/video-ar.js";
import { createLink, phoneSocketUrl } from "./core/link.js";
import { createListener, hush as hushAloud, recognition, speak as speakAloud, type RecognitionCtor } from "./core/talk.js";
import {
  createStore, handOf, heardAtOf, initialView, isStartWord, onStatus,
  type FocusMark, type Pending, type PhoneActions, type PhoneView, type SyncWire,
} from "./state";

const NOTE_MS = 4000;
/** 말의 답(reply)을 잠깐 알림 줄에 남기는 시간. */
const REPLY_NOTE_MS = 20_000;
/** 서버 판본이 달라 다시 읽지 못했을 때(같은 탭에서 60초 안) 처음 화면 답 줄과 잠깐 알릴 말. */
const STALE_TEXT = "새로 고침이 필요해요";
/** core/ar.js가 AR을 켜고 3초 안에 카메라 화면이 없을 때 내는 말의 앞부분. */
const CAMERA_NOTE = "카메라 화면을 보낼 수 없어요";
/** 명령 대상 초점은 명령이 지워질 때까지(command_clear) 둔다. */
const COMMAND_FOCUS_MS = 3_600_000;
/** 소리 끝 알림이 오지 않을 때 다시 듣기까지: 2초 + 글자마다 0.3초. */
const speakMs = (text: string) => 2000 + text.length * 300;
/** 말 하나를 읽는 가장 긴 시간: 끝 알림이 없거나 더 길면 여기서 끊고 다음 말로 간다. */
const TALK_MAX_MS = 15_000;
/** 소리 줄 때문에 듣기를 멈추는 가장 긴 시간(멈춘 때부터): 기다리는 말이 있으면 그 차례를 남기고 지금 말을 끊고, 다 쓰면 남은 말을 버리고 다시 듣는다. */
const LISTEN_PAUSE_MAX_MS = 20_000;
/** 말 하나에 잡는 시간. */
const talkMs = (text: string) => Math.min(speakMs(text), TALK_MAX_MS);

type XrLike = { isSessionSupported(mode: string): Promise<boolean> };
export interface ControllerDeps {
  location: { protocol: string; host: string; search: string };
  /** 시험이 바꾼다. 없으면 브라우저 WebSocket. */
  Socket?: unknown;
  /** undefined면 브라우저 음성 인식, null이면 없음. */
  Recognition?: RecognitionCtor | null;
  /** 소리로 읽기. 다 읽으면 done. */
  speak?: (text: string, done: () => void) => void;
  /** 읽던 소리 끊기. 없으면 브라우저 음성 합성 cancel. */
  hush?: () => void;
  secure?: boolean;
  /** 없으면 navigator.xr. null이면 AR 없음. */
  xr?: XrLike | null;
  arDeps?: Record<string, unknown>;
}
/** canvas 그림: start는 덮개를 열 때 한 번(지난 세션 그림을 지운다), aim은 조준점 켜고 끄기(물건 자리 맞추기), hit(닿음, 어림 바닥)·marks는 XR 프레임마다. */
export interface ControllerDraw { start(): void; aim(on: boolean): void; hit(on: boolean, estimated: boolean): void; marks(marks: FocusMark[]): void }
export interface PhoneController {
  view(): PhoneView;
  subscribe(fn: () => void): () => void;
  actions: PhoneActions;
  /** AR 덮개 뿌리(DOM 오버레이)와 canvas 그림을 잇는다. */
  attach(overlay: HTMLElement | null, draw: ControllerDraw): void;
  close(): void;
}

type Msg = Record<string, any>;
/** 소리 줄의 대상: 화면 엄지 자리에 보이는 명령(계획 id·단계 id)이나 승인 대기(token). */
type TalkTarget = { kind: "command"; id: string; step: string } | { kind: "pending"; token: string };
/** 소리 등급: 안전(끄기 안내·다시 켜짐 경고)·질문(승인·물음, 승인 대기)은 서버가 붙이고(src/contract/phone.ts TalkGrade), 그 밖은 명령·일반 reply. */
type Grade = TalkGrade | "command" | "reply";
/** 소리 줄 하나: 읽을 글, 화면 대상의 말이면 그 대상(reply는 null), 등급, again: reply 뒤 다시 읽는 말. */
type Talk = { text: string; target: TalkTarget | null; grade: Grade; again?: boolean };
const sameTarget = (a: TalkTarget, b: TalkTarget | null) =>
  a.kind === "command" ? b?.kind === "command" && a.id === b.id && a.step === b.step : b?.kind === "pending" && a.token === b.token;
/** 안전·질문 말: 자르지 않고 끝까지 읽는다. 처음 읽는 말이면 듣기 멈춤 시간과 상관없이 늘 읽고(sure), 다시 읽는 말이면 끝까지 읽을 시간이 있을 때만 읽는다. */
const whole = (t: Talk) => t.grade === "safety" || t.grade === "question";
const sure = (t: Talk) => whole(t) && !t.again;
/** 시간을 먼저 받는 차례: 처음 읽는 안전·질문 → 명령·다시 읽는 말 → 일반 reply. */
const rank = (t: Talk) => (sure(t) ? 2 : t.grade === "reply" ? 0 : 1);
/** 말 하나에 잡는 시간: 안전·질문은 끝까지(speakMs), 그 밖은 TALK_MAX_MS까지. */
const needMs = (t: Talk) => (whole(t) ? speakMs(t.text) : talkMs(t.text));

export function createPhoneController(deps: ControllerDeps): PhoneController {
  const params = new URLSearchParams(deps.location.search);
  const video = videoParams(params);
  const speak = deps.speak ?? speakAloud;
  const hush = deps.hush ?? hushAloud;
  // 영상 모드: 듣기 끔. 영상에는 사람 목소리가 없어 마이크로 늘 듣기만 끈다(답은 화면 단추)
  const Recognition = video ? null : deps.Recognition === undefined ? recognition() : deps.Recognition;
  const store = createStore<PhoneView>(initialView());
  const set = (fn: (v: PhoneView) => PhoneView) => store.set(fn);
  let overlay: HTMLElement | null = null;
  let draw: ControllerDraw = { start: () => {}, aim: () => {}, hit: () => {}, marks: () => {} };
  let noteTimer: ReturnType<typeof setTimeout> | undefined;
  let talkTimer: ReturnType<typeof setTimeout> | undefined;
  let talkTurn = 0;
  /** 소리 줄: 읽을 글과 화면 대상의 말이면 그 대상. talking: 지금 읽는 말. */
  let talkQueue: Talk[] = [];
  let talking: Talk | null = null;
  /** 지금 말의 제 끝(needMs), 이번 듣기 멈춤의 끝(LISTEN_PAUSE_MAX_MS), 지금 말 끊기. */
  let talkEnd = 0;
  let pauseEnd = 0;
  let cutTalk = () => {};
  /** 아직 읽지 못한 지금 명령의 말(speak로 왔는데 맞추기·승인 대기에 가려 건너뛴 말). 읽으면·명령이 바뀌면 비운다. */
  let owed: Talk | null = null;
  /** 화면에 보이던 대상(가림이 풀렸는지 본다). */
  let shownBefore: TalkTarget | null = null;
  let shownWasSafety = false;
  /** 마지막으로 받은 명령의 소리 등급(보이는 명령을 다시 읽을 때 쓴다). */
  let lastGrade: { id: string; step: string; grade: Grade } | null = null;
  let aim = false;
  /** 말 시작 때 잡아 둔 at(그 말을 보내면 비운다). */
  let heardAt: HeardAt | null = null;

  /** 화면에 실제로 보이는 대상과 그 말(handOf, 말의 at과 같은 길): 명령이면 명령 글(받은 등급), 승인 대기면 위 줄(기기: 까닭, 질문). 맞추기 중·빈 자리면 없음. */
  function shownTalk(v: PhoneView): Talk | null {
    const { top, thumb } = handOf(v);
    if (thumb?.kind === "command") {
      const { id, step, text } = thumb.command;
      return { text, target: { kind: "command", id, step }, grade: lastGrade?.id === id && lastGrade.step === step ? lastGrade.grade : "command" };
    }
    if (thumb?.kind === "pending") return { text: top ?? "", target: { kind: "pending", token: thumb.item.token }, grade: "question" };
    return null;
  }

  // 영상 모드: 시험 기록. 말의 at 기록을 화면이 바뀔 때마다 실제 폰 말과 같은 heardAtOf로 다시 쓴다(영상 판정 --say가 그대로 싣는다)
  if (video) store.subscribe(() => logVideoAt(heardAtOf(store.get())));
  // 조준점은 물건 자리 맞추기 때만: setup이 바뀌면 그림에 알린다
  store.subscribe(() => {
    const on = store.get().setup === "place";
    if (on === aim) return;
    aim = on;
    draw.aim(on);
  });
  // 가림(맞추기·승인 대기)이 풀려 보이는 대상이 아직 못 읽은 명령이 되면 reply를 기다리지 않고 바로 줄에 넣는다.
  // 안전 명령(끄기 안내)이 풀려 가렸던 승인 대기가 다시 보이면 그 질문을 다시 읽는다
  store.subscribe(() => {
    const now = shownTalk(store.get());
    const shown = now?.target ?? null;
    if (shown === shownBefore || (shown && sameTarget(shown, shownBefore))) return;
    const wasSafety = shownWasSafety;
    shownBefore = shown;
    shownWasSafety = now?.grade === "safety";
    const queued = (target: TalkTarget) => (t: Talk | null) => !!t?.target && sameTarget(target, t.target);
    if (wasSafety && now?.target?.kind === "pending" && !queued(now.target)(talking) && !talkQueue.some(queued(now.target))) return sayAloud(now.text, now.target, now.grade);
    const o = owed;
    const has = (t: Talk | null) => !!t?.target && !!o?.target && sameTarget(o.target, t.target);
    if (!o?.target || !sameTarget(o.target, shown) || has(talking) || talkQueue.some(has)) return;
    sayAloud(o.text, o.target, o.grade);
  });

  const link = createLink({
    // 영상 모드: 카메라 입력. 소켓 주소에 트는 영상 이름을 붙여 서버가 영상 연결로 안다(붙잡은 장면 표시를 받는다)
    url: phoneSocketUrl(deps.location, video ? video.clip : null), onMessage, Socket: deps.Socket, now: undefined,
    onOpen: () => set((v) => ({ ...v, connected: true })),
    onClose: () => set((v) => ({ ...v, connected: false })),
    onStale: () => {
      set((v) => ({ ...v, reply: STALE_TEXT }));
      showNote(STALE_TEXT);
    },
  });
  const listener = Recognition
    ? createListener(Recognition, {
      onState: (s) => set((v) => ({ ...v, listening: s })),
      onSpeechStart: () => { heardAt = heardAtOf(store.get()); },
      onHeard: (text) => {
        const at = heardAt ?? heardAtOf(store.get());
        heardAt = null;
        say(text, at);
      },
    })
    : null;

  /** XR 프레임마다: 바닥 닿음(어림 바닥인지)·추적 약함이 바뀔 때만 화면 상태를 바꾼다. */
  function syncFrame(hit?: boolean, hitEstimated?: boolean) {
    const v = store.get();
    const next = { hit: hit ?? v.hit, hitEstimated: hitEstimated ?? v.hitEstimated, limited: ar.state.limited };
    if (next.hit !== v.hit || next.hitEstimated !== v.hitEstimated || next.limited !== v.limited) set((w) => ({ ...w, ...next }));
  }
  const hooks: ArHooks = {
    onStart: () => {
      draw.start();
      set((v) => ({ ...v, ar: true, cameraOff: false }));
      listener?.start();
    },
    onEnd: () => {
      listener?.stop();
      set((v) => ({ ...v, ar: false, setup: null, settingsOpen: false, limited: false, hit: false, hitEstimated: false }));
    },
    onHit: (hit, estimated) => {
      draw.hit(hit, estimated);
      syncFrame(hit, estimated);
    },
    onMarks: (marks) => {
      // 위 줄·엄지 자리에 명령이 보일 때만(승인 대기·시작 위치·물건 자리 맞추기가 차지하면 그리지 않는다), 그 명령 대상 하나만
      const t = handOf(store.get()).thumb;
      const target = t?.kind === "command" ? t.command.target : null;
      draw.marks(target ? marks.filter((m) => m.id === target).slice(0, 1) : []);
      syncFrame();
    },
    onPerf: () => syncFrame(),
    note: (text) => {
      // 카메라를 못 보내면 설정 모달 줄로 남긴다(잠깐 알릴 말은 엄지 자리 카드가 있을 때만 보인다)
      if (text.startsWith(CAMERA_NOTE)) set((v) => ({ ...v, cameraOff: true }));
      showNote(text);
    },
  };
  // 영상 모드: 카메라 입력. 같은 형(PhoneAr)의 영상 AR. 표시 영상(H.264)은 없고 화면·엔진 JPEG만 보낸다
  const ar: PhoneAr & { videoTime?(): number; syncStatus?(sync: SyncWire | undefined): void; command?(cmd: PhoneCommand): void; commandClear?(id?: string): void } = video // 영상 모드: 카메라 입력
    ? createVideoAr({ link, params, hooks, deps: { ...video, ...deps.arDeps } as VideoArDeps })
    : createAr({ link, params, hooks, deps: deps.arDeps });

  function showNote(text: string, ms = NOTE_MS) {
    set((v) => ({ ...v, note: text }));
    clearTimeout(noteTimer);
    noteTimer = setTimeout(() => set((v) => ({ ...v, note: null })), ms);
  }

  /** 소리 줄에 넣는다(target: 화면 대상의 말이면 그 대상). 읽는 동안 듣기를 멈추고(멈춘 때부터 LISTEN_PAUSE_MAX_MS까지), 앞 말이 끝나면 차례로 읽는다. */
  function sayAloud(text: string, target: TalkTarget | null, grade: Grade) {
    talkQueue.push({ text, target, grade });
    if (talking) return armTalk();
    pauseEnd = Date.now() + LISTEN_PAUSE_MAX_MS;
    listener?.pause();
    playNext();
  }

  /** 대상이 있는 말이 지금 화면에 보이는 대상(handOf)의 말인가. reply는 늘 읽는다. */
  const playable = (t: Talk) => !t.target || sameTarget(t.target, shownTalk(store.get())?.target ?? null);
  /** t보다 먼저 시간을 받는 기다리는 말들(읽을 말, 차례가 t와 같거나 높은 말)의 시간. */
  const reserveMs = (t: Talk) => talkQueue.reduce((ms, w) => ms + (playable(w) && rank(w) >= rank(t) ? needMs(w) : 0), 0);

  /** 지금 말을 끊을 때를 다시 잡는다. 안전·질문 말은 끊지 않는다(끝 알림이 없을 때만 제 끝 speakMs).
   *  명령·reply는 제 끝과, 듣기 멈춤 끝에서 먼저 받는 말들 시간을 뺀 때 중 이른 때. */
  function armTalk() {
    if (!talking) return;
    clearTimeout(talkTimer);
    const end = whole(talking) ? talkEnd : Math.min(talkEnd, pauseEnd - reserveMs(talking));
    talkTimer = setTimeout(cutTalk, Math.max(0, end - Date.now()));
  }

  /** 줄의 다음 말을 읽는다. 대상이 있는 말은 읽기 바로 앞에 화면에 보이는 대상(handOf)과 다시 견줘 다르면 건너뛴다.
   *  처음 읽는 안전·질문 말은 늘 읽는다. 다시 읽는 안전·질문 말은 듣기 멈춤 끝까지 먼저 받는 말들 시간을 빼고 끝까지 읽을 시간이 있을 때만,
   *  명령·reply는 남는 시간이 있을 때만 읽는다(같은 차례면 뒤에 온 말이 먼저). 줄이 비면(끊은 말이면 소리를 끊고) 듣기를 다시 켠다. */
  function playNext(cut = false) {
    clearTimeout(talkTimer);
    for (let next = talkQueue.shift(); next; next = talkQueue.shift()) {
      if (!playable(next)) continue;
      const now = Date.now();
      const room = pauseEnd - now - reserveMs(next);
      if (!sure(next) && (whole(next) ? room < needMs(next) : room <= 0)) continue;
      const item = next;
      talking = item;
      if (owed?.target && item.target && sameTarget(owed.target, item.target)) owed = null;
      talkEnd = now + needMs(item);
      const turn = ++talkTurn;
      const done = (cutting: boolean) => {
        if (turn !== talkTurn) return;
        talkTurn += 1;
        clearTimeout(talkTimer);
        talking = null;
        // reply를 읽은 뒤: 화면에 보이는 명령·승인 대기가 있고 줄에 그 말이 없으면 한 번 다시 읽는다(뒤에 숨은 명령은 읽지 않는다)
        const shown = shownTalk(store.get());
        if (!item.target && shown && !talkQueue.some((t) => t.target && sameTarget(t.target, shown.target))) talkQueue.push({ ...shown, again: true });
        playNext(cutting);
      };
      cutTalk = () => done(true);
      armTalk();
      speak(item.text, () => done(false));
      return;
    }
    talking = null;
    if (cut) hush();
    listener?.resume();
  }

  function onMessage(msg: Msg) {
    if (msg.type === "status") {
      ar.setEngineMs(msg.engine_ms);
      // 영상 모드: 자세 흉내. 영상 AR이 고정 시작 자세를 스스로 보내므로 「여기서 시작」을 저절로 열지 않는다
      set((v) => ({ ...onStatus(v, msg as { aligned: boolean; sync?: SyncWire }, { autoStart: !video }), connected: true }));
      ar.syncStatus?.(msg.sync);
      if (msg.error) showNote(msg.error);
    } else if (msg.type === "reply") {
      // pending 칸이 없으면(명령의 답·승인·취소의 답) 승인 대기 목록을 그대로 둔다
      const pending: Pending[] | undefined = msg.pending;
      const text = String(msg.text ?? "");
      // 글을 먼저 줄에 넣는다: 승인 대기가 풀려 숨었던 명령이 보이면 그 말은 reply 뒤에 읽는다
      if (text) {
        showNote(text, REPLY_NOTE_MS);
        sayAloud(text, null, msg.grade === "safety" ? "safety" : "reply");
      }
      set((v) => ({ ...v, reply: text || null, pending: pending ?? v.pending }));
    } else if (msg.type === "focus") {
      if (!store.get().command) ar.setFocus(msg.targets, msg.ttl_ms);
    } else if (msg.type === "command") {
      const m = msg as PhoneCommand;
      const target: TalkTarget = { kind: "command", id: m.id, step: m.step };
      // 아직 안 읽은 다른 명령 말은 버린다(같은 명령의 비전 상태만 바뀐 것은 그대로)
      talkQueue = talkQueue.filter((t) => t.target?.kind !== "command" || (t.target.id === m.id && t.target.step === m.step));
      if (owed?.target && !sameTarget(owed.target, target)) owed = null;
      lastGrade = { id: m.id, step: m.step, grade: m.grade ?? "command" };
      armTalk();
      set((v) => ({ ...v, command: { id: m.id, step: m.step, text: m.text, vision: m.vision, choices: m.choices, target: m.target?.id ?? null, ...(m.grade === "safety" ? { safety: true as const } : {}) } }));
      ar.setFocus(m.target ? [m.kind === "go" ? { ...m.target, walking: true } : m.target] : [], COMMAND_FOCUS_MS);
      if (ar.videoTime) logVideoCommand(ar.videoTime(), m);
      ar.command?.(m);
      if (m.speak) {
        owed = { text: m.text, target, grade: lastGrade.grade };
        sayAloud(m.text, target, lastGrade.grade);
      }
    } else if (msg.type === "command_clear") {
      const m = msg as PhoneCommandClear;
      ar.commandClear?.(m.id);
      // 아직 안 읽은 그 명령 말(id가 없으면 모든 명령 말)은 버린다
      talkQueue = talkQueue.filter((t) => t.target?.kind !== "command" || (m.id !== undefined && t.target.id !== m.id));
      if (owed?.target?.kind === "command" && (m.id === undefined || owed.target.id === m.id)) owed = null;
      armTalk();
      if (m.id !== undefined && m.id !== store.get().command?.id) return;
      set((v) => ({ ...v, command: null }));
      ar.setFocus([], 0);
    }
  }

  /** 들은 말·글 입력을 보낸다. at: 말할 때 떠 있던 명령·보인 승인 대기(src/contract/phone.ts HeardAt). */
  function say(text: string, at: HeardAt) {
    const t = text.trim();
    if (!t) return;
    // 시작 위치 맞추기 중 「여기서 시작」은 단추와 같다(에이전트로 보내지 않는다)
    if (store.get().setup === "start" && isStartWord(t)) return actions.confirmStart();
    set((v) => ({ ...v, reply: `🎙 "${t}" … 생각 중` }));
    if (!link.send({ type: "say", text: t, at })) set((v) => ({ ...v, reply: "서버와 연결이 끊겼어요. 잠시 뒤 다시 말해 주세요." }));
  }

  const actions: PhoneActions = {
    startAr() {
      // 사용자 동작 안에서 바로 requestSession까지 간다(await 없이)
      const failed = (message: string) => set((v) => ({ ...v, support: { kind: "failed", message } }));
      if (!overlay) return failed("페이지를 새로 고쳐 주세요");
      ar.start(overlay).catch((error: Error) => failed(error.message));
    },
    startPlace: () => set((v) => ({ ...v, setup: "place", settingsOpen: false })),
    startFromSpot: () => set((v) => ({ ...v, setup: "start", settingsOpen: false })),
    confirmStart() {
      if (!ar.state.on) return showNote("AR을 먼저 시작하세요");
      if (!ar.state.position || !ar.state.orientation) return showNote("폰 위치를 아직 몰라요. 폰을 조금 움직인 뒤 다시 눌러 주세요");
      // 영상 모드: 자세 흉내. 고정 카메라라 다시 맞춰도 바로 맞춤(fixed)
      const fixed = video ? { fixed: true } : {};
      if (!link.send({ type: "start", position: ar.state.position, orientation: ar.state.orientation, epoch: ar.state.epoch, ...fixed })) return showNote("서버와 연결이 끊겨 보내지 못했어요");
      set((v) => ({ ...v, setup: v.setup === "start" ? null : v.setup }));
    },
    endSetup: () => set((v) => ({ ...v, setup: null })),
    setSettings: (open) => set((v) => ({ ...v, settingsOpen: open })),
    micOn: () => listener?.start(),
    say: (text) => say(text, heardAtOf(store.get())),
    confirm(token, choice) {
      set((v) => ({ ...v, pending: v.pending.filter((p) => p.token !== token) }));
      link.send({ type: "confirm", token, choice });
    },
    answer(id, step, choice) {
      if (!link.send({ type: "answer", id, step, choice })) showNote("서버와 연결이 끊겨 답을 보내지 못했어요");
    },
  };

  async function checkSupport() {
    // 영상 모드: 카메라 입력. 카메라 대신 영상이라 WebXR·보안 연결 없이 된다
    if (video) return set((v) => ({ ...v, support: { kind: "ready" } }));
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
