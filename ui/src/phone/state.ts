// 폰 화면 상태: 서버 메시지·AR·말하기가 바꾸는 값과, 화면 글을 만드는 순수 함수(옮기기 전 web/phone/phone.js의 render·renderStatus·showRequest·showAction에서 옮겼다).
// 타이머(알림·판단 줄·잠깐 알릴 말)와 보내기는 controller.ts가 맡는다.

export type AlignMode = "floor" | "touch";
export type Support =
  | { kind: "checking" }
  | { kind: "insecure" }
  | { kind: "no-ar" }
  | { kind: "ready" }
  | { kind: "failed"; message: string };
export interface Anchor { id: string; label: string; recorded: boolean }
export interface Pending { token: string; deviceLabel: string; reason: string }
export interface Choice { id: string; label: string }
export interface BrainAction { id: string; text: string; would: string | null; choices: Choice[] }
/** 화면 위 초점 표시 하나(core/project.js focusMarks와 같은 모양). */
export interface FocusMark { id: string; label: string; u: number; v: number; off: boolean; angle: number }
/** 누르고 말하기 단추 자리: 처음 화면, AR 아래 단추. */
export type TalkSpot = "intro" | "ar";

export interface PhoneView {
  support: Support;
  /** 음성 인식이 있다(없으면 말하기 단추 없이 글 입력만). */
  speech: boolean;
  /** AR 중(덮개가 보인다). */
  ar: boolean;
  mode: AlignMode;
  /** 서버 상태 전이면 null. */
  anchors: Anchor[] | null;
  aligned: boolean;
  status: { text: string; title: string };
  fps: string;
  perfDetail: string;
  /** 처음 화면 답 줄. 아직 말이 없으면 null. */
  reply: string | null;
  toast: string | null;
  pending: Pending[];
  brainLine: string | null;
  request: { id: string; text: string } | null;
  action: BrainAction | null;
  menuOpen: boolean;
  listening: TalkSpot | null;
}

/** 화면의 단추가 부르는 것(controller.ts가 만든다). */
export interface PhoneActions {
  startAr(): void;
  stopAr(): void;
  takePhoto(): void;
  recordAnchor(id: string): void;
  resetAnchors(): void;
  setMenu(open: boolean): void;
  say(text: string): void;
  confirm(token: string): void;
  cancel(token: string): void;
  brainReply(id: string, choice: string): void;
  talkDown(spot: TalkSpot): void;
  talkUp(spot: TalkSpot): void;
}

export const initialView = (speech: boolean): PhoneView => ({
  support: { kind: "checking" }, speech, ar: false, mode: "floor", anchors: null, aligned: false,
  status: { text: "바닥을 비춰 주세요", title: "" }, fps: "0 fps", perfDetail: "측정 전",
  reply: null, toast: null, pending: [], brainLine: null, request: null, action: null, menuOpen: false, listening: null,
});

export interface StatusInput { aligned: boolean; mode: AlignMode; mismatchM: number | null; limited: boolean; anchorCount: string; note: string | null }

/** 위 상태 줄: 맞춤 상태·거리 차이·추적 약함. 잠깐 알릴 말(note)이 있으면 그 말, title은 늘 맞춤 상태. */
export function statusLine(s: StatusInput): { text: string; title: string } {
  const base = s.aligned
    ? `${s.mode === "touch" ? "근사 " : ""}맞춤 ✓ · 거리 차이 ${Math.round((s.mismatchM ?? 0) * 100)}cm${s.limited ? " · 추적 약함" : ""}`
    : s.mode === "touch"
      ? `맞추기 전 · 벽 지점 ${s.anchorCount} 기록`
      : `맞추기 전 · 창가 기준 방향만 · 기준점 ${s.anchorCount} 기록`;
  return { text: s.note ?? base, title: base };
}

/** 기록한 수/전체(예 1/2). */
export const anchorCount = (anchors: Anchor[]) => `${anchors.filter((a) => a.recorded).length}/${anchors.length}`;

/** 처음 화면 첫 안내의 기준점 이름. 상태 전이면 「방 모서리」. */
export function anchorNames(mode: AlignMode, anchors: Anchor[] | null): string {
  if (!anchors) return "방 모서리";
  return anchors.map((a) => (mode === "touch" ? `${a.id} ${a.label}` : a.label)).join(", ");
}

/** AR 위 기준점 단추 글. */
export function anchorLabel(mode: AlignMode, a: Anchor): string {
  return mode === "touch"
    ? `${a.recorded ? "✓ " : ""}${a.id} ${a.label} 아래 바닥 조준하고 기록`
    : `${a.recorded ? "✓ " : ""}${a.label} 지점 기록`;
}

/** 처음 화면 AR 지원 줄. */
export function supportText(s: Support): string {
  switch (s.kind) {
    case "checking": return "AR 지원을 확인하는 중…";
    case "insecure": return "보안 연결이 아니라 AR을 켤 수 없어요. https 주소로 여세요.";
    case "no-ar": return "이 브라우저는 AR을 지원하지 않아요. 안드로이드 크롬으로 여세요.";
    case "ready": return "준비됐어요. 첫 기준점 근처에서 AR을 시작하세요.";
    case "failed": return `AR을 시작하지 못했어요: ${s.message}`;
  }
}

/** 사진을 보낸 뒤 알림. */
export function photoSavedText(msg: { answer?: unknown; aligned?: unknown }): string {
  return msg.answer ? "요청한 컵 사진을 보냈어요" : msg.aligned ? "사진을 위치와 함께 보냈어요" : "위치 없이 사진을 보냈어요";
}

/** 행동 부탁 카드의 「클로이드라면」 줄. would가 없으면 null. */
export const wouldLine = (would: string | null) => (would ? `클로이드라면: ${would} · 기기 명령은 보내지 않아요` : null);

/** 서버 상태(status) → 방식·기준점·맞춤. 상태 줄은 controller가 잠깐 알릴 말과 함께 다시 만든다. */
export function onStatus(v: PhoneView, s: { mode?: AlignMode; anchors: Anchor[]; aligned: boolean }): PhoneView {
  return { ...v, mode: s.mode ?? "floor", anchors: s.anchors, aligned: s.aligned };
}

/** 사진 요청(request): 거둘 때(active false)까지 둔다. 다른 요청을 거두는 말은 무시한다. */
export function onRequest(v: PhoneView, msg: { id: string; text: string; active: boolean }): PhoneView {
  if (!msg.active && msg.id !== v.request?.id) return v;
  return { ...v, request: msg.active ? { id: msg.id, text: msg.text } : null };
}

/** 행동 부탁·질문(action, 모의): 같은 부탁을 거둘 때만 지운다. */
export function onAction(v: PhoneView, msg: { id: string; text?: string; would?: string | null; choices?: Choice[]; active: boolean }): PhoneView {
  if (!msg.active) return msg.id === v.action?.id ? { ...v, action: null } : v;
  return { ...v, action: { id: msg.id, text: msg.text ?? "", would: msg.would ?? null, choices: msg.choices ?? [] } };
}

/** 작은 저장소(useSyncExternalStore용). */
export function createStore<T>(initial: T) {
  let value = initial;
  const subs = new Set<() => void>();
  return {
    get: () => value,
    set(next: T | ((v: T) => T)) {
      value = typeof next === "function" ? (next as (v: T) => T)(value) : next;
      for (const fn of subs) fn();
    },
    subscribe(fn: () => void) {
      subs.add(fn);
      return () => { subs.delete(fn); };
    },
  };
}
