// 실제 폰 화면 상태: 서버 메시지·AR·듣기가 바꾸는 값과, 화면 글을 만드는 순수 함수. 타이머·보내기는 controller.ts가 맡는다.
// 실제 폰은 에이전트의 손이다: 위에는 지금 할 명령 한 줄(handOf top), 아래 엄지 자리에는 비전 상태 한 줄과 그 바로 아래 답 단추(thumb).
// 엄지 자리 차례: 시작 위치 맞추기·물건 자리 맞추기 > 안전 명령(끄기 안내·부탁, 서버 grade safety) > 승인 대기(가전) > 명령·질문.
// 안전 명령이 승인 대기를 가리는 동안 서버는 승인 시간 제한을 멈추고(src/agent/policy.ts pause), 안내가 풀리면 승인 대기가 다시 보인다. 일이 멈추는 문제는 모달(problemOf), 추적 약함·잠깐 알릴 말은 비전 상태 줄.
// 엄지 자리 카드가 없으면(기다리기·가전 단계라 명령이 없을 때) 잠깐 알릴 말은 위 줄에 보인다(명령을 가리지 않는다).
// 위치 맞춤(서버 status.sync, src/phone/sync): 시작 위치가 있으면 AR을 켤 때 「여기서 시작」을 띄우고, 어림인 동안 명령의 비전 상태 줄 앞에 「위치 맞추는 중」.
// 집에 시작 위치가 없으면 AR 중 「설정 화면에서 시작 위치를 정해 주세요」 모달이 뜬다.
import type { ApprovalAnswer, HeardAt } from "../../../src/contract/phone.ts";
import type { ListenState } from "./core/talk.js";

export type { ListenState };
export type Support =
  | { kind: "checking" }
  | { kind: "insecure" }
  | { kind: "no-ar" }
  | { kind: "ready" }
  | { kind: "failed"; message: string };
export interface Choice { id: string; label: string }
/** 승인 대기(가전 명령·외부 연락). choices: 답(승인·거절)마다 단추 하나. 가전이 없는 외부 연락(보호자 연락)은 deviceLabel이 빈 글이다. */
export interface Pending { token: string; deviceLabel: string; reason: string; choices: Choice[] }

/** 승인 대기 한 줄: 「기기: 까닭」, 가전이 없으면 까닭만. */
export const pendingLine = (p: Pick<Pending, "deviceLabel" | "reason">): string => (p.deviceLabel ? `${p.deviceLabel}: ${p.reason}` : p.reason);
/** 서버가 보낸 지금 명령·질문(src/contract/phone.ts PhoneCommand에서 speak를 빼고 대상은 id만). target: 화면 밖·칸에 가릴 때 세모로 가리킬 명령 대상 id(없으면 null). */
export interface Command { id: string; step: string; text: string; vision: string | null; choices: Choice[]; target: string | null; safety?: true }
/** 화면 위 초점 표시 하나(core/project.js focusMarks와 같은 모양). */
export interface FocusMark { id: string; label: string; u: number; v: number; off: boolean; angle: number; walking?: boolean; stand?: boolean }
/** 엄지 자리를 차지하는 일: 물건 자리 맞추기(「여기」 말하기), 시작 위치 맞추기(「여기서 시작」). */
export type Setup = "place" | "start";
/** 서버 위치 맞춤 상태(status.sync). state: none 변환 없음, estimated 어림, aligned 맞춤. source video: 영상 입력 모드의 고정 카메라. */
export interface SyncView {
  state: "none" | "estimated" | "aligned";
  source: "start" | "objects" | "walls" | "video" | null;
  /** 이 집 시작 위치 이름(없으면 null). */
  start: { label: string; facing: string } | null;
  started: boolean;
  anchors: number;
  wallPoints: number;
  residualM: number | null;
}
/** 일이 멈추는 문제: 연결 끊김, 마이크 꺼짐, 시작 위치 없음. */
export type Problem = "offline" | "mic" | "start";

export interface PhoneView {
  support: Support;
  /** AR 중(덮개가 보인다). */
  ar: boolean;
  connected: boolean;
  listening: ListenState;
  aligned: boolean;
  /** 추적 약함. */
  limited: boolean;
  /** 조준점이 바닥에 닿음. */
  hit: boolean;
  /** 닿은 바닥이 어림 바닥(hit-test 점이 없어 시선과 어림 바닥 면이 만나는 점). 「여기」는 그대로 된다. */
  hitEstimated: boolean;
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
  /** 서버 위치 맞춤 상태. 상태 전이면 null. */
  sync: SyncView | null;
}

/** 화면의 단추가 부르는 것(controller.ts가 만든다). */
export interface PhoneActions {
  startAr(): void;
  /** 물건 자리 맞추기: 조준점을 켜고 「여기」 말하기를 기다린다. */
  startPlace(): void;
  /** 시작 위치에서 다시 맞추기: 「여기서 시작」을 띄운다. */
  startFromSpot(): void;
  /** 「여기서 시작」: 지금 자세를 시작 위치로 보낸다. */
  confirmStart(): void;
  endSetup(): void;
  setSettings(open: boolean): void;
  /** 마이크 켜기: 듣기를 다시 켠다(브라우저가 되면 권한을 다시 묻는다). */
  micOn(): void;
  say(text: string): void;
  /** 승인 답 단추: 그 승인 대기의 토큰과 답. */
  confirm(token: string, choice: ApprovalAnswer): void;
  /** 답 단추: 받은 명령의 id·step 그대로. */
  answer(id: string, step: string, choice: string): void;
}

export const initialView = (): PhoneView => ({
  support: { kind: "checking" }, ar: false, connected: false, listening: "off", aligned: false,
  limited: false, hit: false, hitEstimated: false, cameraOff: false, note: null, reply: null, pending: [], command: null, setup: null, settingsOpen: false, sync: null,
});

export const WEAK_TEXT = "추적이 약해요";
export const START_BUTTON = "여기서 시작";
export const ALIGNING_TEXT = "위치 맞추는 중";
export const RESTART_FROM_SPOT = "시작 위치에서 다시 맞추기";

/** 시작 위치 맞추기 위 한 줄. */
export const startLine = (start: { label: string; facing: string }) =>
  start.facing ? `${start.label}에 서서 ${start.facing} 쪽을 봐 주세요` : `${start.label}에 서서 정한 방향을 봐 주세요`;

/** 늘 듣기에서 「여기서 시작」 답: 말 전체가 시작일 때만(앞의 응·네, 끝의 할게·해·해요·요는 된다). */
export function isStartWord(text: string): boolean {
  const t = text.trim().replace(/[.!?~,\s]+$/u, "");
  return /^(?:(?:응|네|어)\s*)?(?:여기서\s*)?시작(?:할게|할게요|해|해요|하자|요)?$/u.test(t);
}
export const PLACE_LINE = '물건 아래 바닥을 가리키고 "냉장고 여기로"라고 말해 주세요';
export const PROBLEM_TEXT: Record<Problem, { title: string; fix: string | null }> = {
  offline: { title: "다시 연결하는 중", fix: null },
  mic: { title: "마이크가 꺼져 있어요", fix: "마이크 켜기" },
  start: { title: "설정 화면에서 시작 위치를 정해 주세요", fix: null },
};

export type Thumb =
  | { kind: "start" }
  | { kind: "place" }
  | { kind: "pending"; item: Pending }
  | { kind: "command"; command: Command };
export type Tone = "plain" | "ok" | "warn" | "error";
export interface Hand { top: string | null; thumb: Thumb | null; vision: { text: string; tone: Tone } | null }

const floorLine = (v: PhoneView) => (!v.hit ? "바닥에 안 닿음" : v.hitEstimated ? "어림잡은 바닥에 닿음" : "바닥에 닿음");

/** 위 한 줄·엄지 자리·비전 상태 줄. */
export function handOf(v: PhoneView): Hand {
  const pending = v.pending[0];
  const start = v.setup === "start" ? v.sync?.start ?? null : null;
  const thumb: Thumb | null = start ? { kind: "start" }
    : v.setup === "place" ? { kind: "place" }
    : v.command?.safety ? { kind: "command", command: v.command }
    : pending ? { kind: "pending", item: pending }
    : v.command ? { kind: "command", command: v.command }
    : null;
  if (!thumb) return { top: v.note, thumb: null, vision: null };
  const top = thumb.kind === "start" ? startLine(start!)
    : thumb.kind === "place" ? PLACE_LINE
    : thumb.kind === "pending" ? pendingLine(thumb.item)
    : thumb.command.text;
  const tone: Tone = !v.hit ? "plain" : v.hitEstimated ? "warn" : "ok";
  const base = thumb.kind === "place" ? { text: floorLine(v), tone }
    : thumb.kind === "command" && thumb.command.vision
      ? { text: v.sync?.state === "estimated" ? `${ALIGNING_TEXT} · ${thumb.command.vision}` : thumb.command.vision, tone: "plain" as const }
    : null;
  const vision = v.note ? { text: v.note, tone: "warn" as const } : v.limited ? { text: WEAK_TEXT, tone: "warn" as const } : base;
  return { top, thumb, vision };
}

/** 말의 at(src/contract/phone.ts HeardAt): 화면에 실제로 보이는 것만 싣는다. 화면 그리기와 같은 handOf로 정한다.
 *  AR 중: 엄지 자리가 명령이면 그 명령(계획 id·단계 id), 승인 대기면 그 token 하나(뒤에 숨은 명령은 싣지 않는다), 맞추기 중이면 둘 다 없음.
 *  처음 화면(AR 전): 명령 줄이 없어 명령은 싣지 않고, 목록에 보인 승인 대기 token을 모두 싣는다. */
export function heardAtOf(v: PhoneView): HeardAt {
  if (!v.ar) return { kind: "none", pending: v.pending.map((p) => p.token) };
  const t = handOf(v).thumb;
  if (t?.kind === "command") return { kind: "command", id: t.command.id, step: t.command.step, pending: [] };
  return { kind: "none", pending: t?.kind === "pending" ? [t.item.token] : [] };
}

/** 일이 멈추는 문제(AR 중에만, 하나): 연결 끊김 → 마이크 꺼짐 → 시작 위치 없음(집에 시작 위치가 없고 아직 아무 변환도 없을 때). */
export function problemOf(v: PhoneView): Problem | null {
  if (!v.ar) return null;
  if (!v.connected) return "offline";
  if (v.listening === "denied") return "mic";
  if (v.sync && !v.sync.start && v.sync.state === "none") return "start";
  return null;
}

/** 설정 「기준」 줄: 이번 맞춤에 쓴 것. 없으면 null. */
function basisOf(s: SyncView): string | null {
  if (s.state === "none") return null;
  const parts = [s.started ? "시작 위치" : null, s.anchors > 0 ? `물건 ${s.anchors}` : null, s.wallPoints > 0 ? `벽 ${s.wallPoints}점` : null].filter(Boolean);
  return parts.length ? parts.join(" · ") : null;
}

/** 설정 모달의 상태 줄: 연결·듣기·위치(·기준), 카메라 화면을 못 보내면 카메라. */
export function settingsRows(v: PhoneView): { name: string; value: string; tone: Tone }[] {
  const basis = v.sync ? basisOf(v.sync) : null;
  const listen = v.listening === "on" || v.listening === "paused" ? { value: "켜짐", tone: "ok" as const }
    : { value: "꺼짐", tone: v.listening === "denied" ? ("error" as const) : ("plain" as const) };
  return [
    { name: "연결", ...(v.connected ? { value: "됨", tone: "ok" as const } : { value: "끊김", tone: "error" as const }) },
    { name: "듣기", ...listen },
    {
      name: "위치",
      ...(v.aligned
        ? { value: `맞음 · ${Math.round((v.sync?.residualM ?? 0) * 100)}cm`, tone: "ok" as const }
        : v.sync?.state === "estimated" ? { value: "어림", tone: "warn" as const }
        : { value: "안 맞음", tone: "warn" as const }),
    },
    ...(basis ? [{ name: "기준", value: basis, tone: "plain" as const }] : []),
    ...(v.cameraOff ? [{ name: "카메라", value: "못 보냄", tone: "warn" as const }] : []),
  ];
}

/** 처음 화면 AR 지원 줄. start: 이 집에 시작 위치가 있다. */
export function supportText(s: Support, start = false): string {
  switch (s.kind) {
    case "checking": return "AR 지원을 확인하는 중…";
    case "insecure": return "보안 연결이 아니라 AR을 켤 수 없어요. https 주소로 여세요.";
    case "no-ar": return "이 브라우저는 AR을 지원하지 않아요. 안드로이드 크롬으로 여세요.";
    case "ready": return start ? "준비됐어요. 시작 위치에서 AR을 시작하세요." : "준비됐어요. AR을 시작하세요.";
    case "failed": return `AR을 시작하지 못했어요: ${s.message}`;
  }
}

/** 서버 status.sync 모양(src/phone/session.ts SyncStatus). */
export interface SyncWire {
  state: SyncView["state"]; source: SyncView["source"]; start: SyncView["start"]; started: boolean; anchors: number; wall_points: number; residual_m: number | null;
}

/** 서버 상태(status) → 맞춤·위치 맞춤. AR 중 시작 위치가 있고 이번 AR에서 아직 시작하지 않았으면(변환 없음) 시작 위치 맞추기를 연다.
 *  시작 위치가 지워지면 닫는다. 「여기서 시작」을 보내면 controller.ts가 닫는다(다시 맞추기를 연 동안 오는 상태로는 닫지 않는다).
 *  autoStart false(영상 입력 모드: 시작 자세를 스스로 보낸다)면 저절로 열지 않는다.
 *  영상 모드: 자세 흉내 */
export function onStatus(v: PhoneView, s: { aligned: boolean; sync?: SyncWire }, opts: { autoStart?: boolean } = {}): PhoneView {
  const sync: SyncView | null = s.sync
    ? { state: s.sync.state, source: s.sync.source, start: s.sync.start, started: s.sync.started, anchors: s.sync.anchors, wallPoints: s.sync.wall_points, residualM: s.sync.residual_m }
    : null;
  let setup = v.setup;
  if (setup === "start" && !sync?.start) setup = null;
  // 영상 모드: 자세 흉내
  if (setup === null && (opts.autoStart ?? true) && v.ar && sync?.start && !sync.started && sync.state === "none") setup = "start";
  return { ...v, aligned: s.aligned, sync, setup };
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
