// 실제 폰 화면 상태: 서버 메시지·AR·듣기가 바꾸는 값과, 화면 글을 만드는 순수 함수. 타이머·보내기는 controller.ts가 맡는다.
// 실제 폰은 에이전트의 손이다: 위에는 지금 할 명령 한 줄(handOf top), 아래 엄지 자리에는 비전 상태 한 줄과 그 바로 아래 답 단추(thumb).
// 엄지 자리 차례: 기준점 찍기·물건 자리 맞추기 > 승인 대기(실제 모드 가전) > 명령·질문. 일이 멈추는 문제는 모달(problemOf), 추적 약함·잠깐 알릴 말은 비전 상태 줄.
import type { ListenState } from "./core/talk.js";

export type { ListenState };
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
/** 서버가 보낸 지금 명령·질문(src/contract/phone.ts PhoneCommand에서 speak를 빼고 대상은 id만). target: 고리를 그릴 명령 대상 id(없으면 null). */
export interface Command { id: string; step: string; text: string; vision: string | null; choices: Choice[]; target: string | null }
/** 화면 위 초점 표시 하나(core/project.js focusMarks와 같은 모양). */
export interface FocusMark { id: string; label: string; u: number; v: number; off: boolean; angle: number }
/** 조준점을 쓰는 일: 기준점 찍기, 물건 자리 맞추기(「여기」 말하기). */
export type Setup = "anchors" | "place";
/** 일이 멈추는 문제: 연결 끊김, 마이크 꺼짐, 기준점 안 맞음. */
export type Problem = "offline" | "mic" | "align";

export interface PhoneView {
  support: Support;
  /** AR 중(덮개가 보인다). */
  ar: boolean;
  connected: boolean;
  listening: ListenState;
  mode: AlignMode;
  /** 서버 상태 전이면 null. */
  anchors: Anchor[] | null;
  aligned: boolean;
  mismatchM: number | null;
  /** 추적 약함. */
  limited: boolean;
  /** 조준점이 바닥에 닿음. */
  hit: boolean;
  /** 이번 AR에서 카메라 화면을 못 보냄(위치만 보냄). 설정 모달에 그 줄이 남는다. */
  cameraOff: boolean;
  /** 잠깐 알릴 말(비전 상태 줄, 4초). */
  note: string | null;
  /** 처음 화면 답 줄. */
  reply: string | null;
  pending: Pending[];
  command: Command | null;
  setup: Setup | null;
  settingsOpen: boolean;
}

/** 화면의 단추가 부르는 것(controller.ts가 만든다). */
export interface PhoneActions {
  startAr(): void;
  recordAnchor(id: string): void;
  /** 기준점 다시 찍기: 기록을 지우고 찍기를 연다. */
  startAnchors(): void;
  /** 물건 자리 맞추기: 조준점을 켜고 「여기」 말하기를 기다린다. */
  startPlace(): void;
  endSetup(): void;
  setSettings(open: boolean): void;
  /** 마이크 켜기: 듣기를 다시 켠다(브라우저가 되면 권한을 다시 묻는다). */
  micOn(): void;
  say(text: string): void;
  confirm(token: string): void;
  cancel(token: string): void;
  /** 답 단추: 받은 명령의 id·step 그대로. */
  answer(id: string, step: string, choice: string): void;
}

export const initialView = (): PhoneView => ({
  support: { kind: "checking" }, ar: false, connected: false, listening: "off", mode: "floor", anchors: null, aligned: false, mismatchM: null,
  limited: false, hit: false, cameraOff: false, note: null, reply: null, pending: [], command: null, setup: null, settingsOpen: false,
});

export const WEAK_TEXT = "추적이 약해요";
export const PLACE_LINE = '물건 아래 바닥을 가리키고 "냉장고 여기로"라고 말해 주세요';
export const PROBLEM_TEXT: Record<Problem, { title: string; fix: string | null }> = {
  offline: { title: "다시 연결하는 중", fix: null },
  mic: { title: "마이크가 꺼져 있어요", fix: "마이크 켜기" },
  align: { title: "기준점이 안 맞아요", fix: "기준점 다시 찍기" },
};

/** 기록한 수/전체(예 1/2). */
export const anchorCount = (anchors: Anchor[]) => `${anchors.filter((a) => a.recorded).length}/${anchors.length}`;

/** 다음에 찍을 기준점: 아직 안 찍은 첫 곳, 다 찍었으면 첫 곳. */
export const nextAnchor = (anchors: Anchor[] | null): Anchor | null => anchors?.find((a) => !a.recorded) ?? anchors?.[0] ?? null;

/** 기준점 찍기 위 한 줄. */
export const setupLine = (mode: AlignMode, a: Anchor) =>
  mode === "touch" ? `${a.id} ${a.label} 바로 아래 바닥을 가리켜 주세요` : `${a.label} 바닥을 가리켜 주세요`;

export type Thumb =
  | { kind: "record"; anchor: Anchor }
  | { kind: "place" }
  | { kind: "pending"; item: Pending }
  | { kind: "command"; command: Command };
export type Tone = "plain" | "ok" | "warn" | "error";
export interface Hand { top: string | null; thumb: Thumb | null; vision: { text: string; tone: Tone } | null }

const floorLine = (hit: boolean) => (hit ? "바닥에 닿음" : "바닥에 안 닿음");

/** 위 한 줄·엄지 자리·비전 상태 줄. */
export function handOf(v: PhoneView): Hand {
  const anchor = v.setup === "anchors" ? nextAnchor(v.anchors) : null;
  const pending = v.pending[0];
  const thumb: Thumb | null = anchor ? { kind: "record", anchor }
    : v.setup === "place" ? { kind: "place" }
    : pending ? { kind: "pending", item: pending }
    : v.command ? { kind: "command", command: v.command }
    : null;
  if (!thumb) return { top: null, thumb: null, vision: null };
  const top = thumb.kind === "record" ? setupLine(v.mode, thumb.anchor)
    : thumb.kind === "place" ? PLACE_LINE
    : thumb.kind === "pending" ? `${thumb.item.deviceLabel}: ${thumb.item.reason}`
    : thumb.command.text;
  const tone: Tone = v.hit ? "ok" : "plain";
  const base = thumb.kind === "record" ? { text: `${floorLine(v.hit)} · 기준점 ${anchorCount(v.anchors!)}`, tone }
    : thumb.kind === "place" ? { text: floorLine(v.hit), tone }
    : thumb.kind === "command" && thumb.command.vision ? { text: thumb.command.vision, tone: "plain" as const }
    : null;
  const vision = v.note ? { text: v.note, tone: "warn" as const } : v.limited ? { text: WEAK_TEXT, tone: "warn" as const } : base;
  return { top, thumb, vision };
}

/** 일이 멈추는 문제(AR 중에만, 하나): 연결 끊김 → 마이크 꺼짐 → 기준점 안 맞음(찍는 중이 아닐 때). */
export function problemOf(v: PhoneView): Problem | null {
  if (!v.ar) return null;
  if (!v.connected) return "offline";
  if (v.listening === "denied") return "mic";
  if (v.anchors && !v.aligned && v.setup !== "anchors") return "align";
  return null;
}

/** 설정 모달의 상태 줄: 연결·듣기·기준점, 카메라 화면을 못 보내면 카메라. */
export function settingsRows(v: PhoneView): { name: string; value: string; tone: Tone }[] {
  const listen = v.listening === "on" || v.listening === "paused" ? { value: "켜짐", tone: "ok" as const }
    : { value: "꺼짐", tone: v.listening === "denied" ? ("error" as const) : ("plain" as const) };
  return [
    { name: "연결", ...(v.connected ? { value: "됨", tone: "ok" as const } : { value: "끊김", tone: "error" as const }) },
    { name: "듣기", ...listen },
    {
      name: "기준점",
      ...(v.aligned
        ? { value: `맞음 · ${Math.round((v.mismatchM ?? 0) * 100)}cm`, tone: "ok" as const }
        : { value: v.anchors ? `안 맞음 · ${anchorCount(v.anchors)}` : "안 맞음", tone: "warn" as const }),
    },
    ...(v.cameraOff ? [{ name: "카메라", value: "못 보냄", tone: "warn" as const }] : []),
  ];
}

/** 처음 화면 첫 안내의 기준점 이름. 상태 전이면 「방 모서리」. */
export function anchorNames(mode: AlignMode, anchors: Anchor[] | null): string {
  if (!anchors) return "방 모서리";
  return anchors.map((a) => (mode === "touch" ? `${a.id} ${a.label}` : a.label)).join(", ");
}

/** 처음 화면 AR 지원 줄. */
export function supportText(s: Support): string {
  switch (s.kind) {
    case "checking": return "AR 지원을 확인하는 중…";
    case "insecure": return "보안 연결이 아니라 AR을 켤 수 없어요. https 주소로 여세요.";
    case "no-ar": return "이 브라우저는 AR을 지원하지 않아요. 안드로이드 크롬으로 여세요.";
    case "ready": return "준비됐어요. 폰을 세로로 들고 첫 기준점 근처에서 AR을 시작하세요.";
    case "failed": return `AR을 시작하지 못했어요: ${s.message}`;
  }
}

/** 서버 상태(status) → 방식·기준점·맞춤·거리 차이. 맞추면 기준점 찍기를 끝낸다. */
export function onStatus(v: PhoneView, s: { mode?: AlignMode; anchors: Anchor[]; aligned: boolean; mismatch_m?: number | null }): PhoneView {
  return {
    ...v, mode: s.mode ?? "floor", anchors: s.anchors, aligned: s.aligned, mismatchM: s.mismatch_m ?? null,
    setup: s.aligned && v.setup === "anchors" ? null : v.setup,
  };
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
