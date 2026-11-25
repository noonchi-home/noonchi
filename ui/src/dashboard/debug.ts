// 가짜 단계(?debug=steps): 서버 자료 대신 fake-run.json(scripts/twin3d/fake-run.ts)의 순간마다 메시지 묶음을 대시보드 자료·확인 목록에 넣는다.
// 순간은 0 지켜보기, 1~4 컵 치우기 계획 단계다. 트윈(집·가전 상태·배치)과 health는 서버 것 그대로 쓴다.
//   &step=N      그 순간(없으면 0, play면 2)
//   &play=MS     화면이 다 뜬 뒤(트윈 첫 그림·미리 그려 보기 뒤 data-ready) MS마다 다음 순간: 2→3→4→0→1→2…
//   &eye=0       대시보드 폰 칸 영상 없음(연결 QR)
//   &talk=find   계획 전 찾기 중: 판단은 컵 치우기(1번 순간의 판단), 메시지 상자 최신 줄이 찾기 상태 줄(말풍선 말은 빼고)
//   &mode=coach  코치 행동 중 순간(fake-run.json coach: 라면 끓이기 알려 주기 2단계, 서버 지금 모드 코치)으로 바꾼다(step과 상관없음)
//   &offline=1   서버 연결 끊김
//   &settings=1  설정 창을 연 채
// window.__dash.step(n)으로 바로 그 순간으로 간다. 대시보드 폰 칸은 그 순간 가로 눈 그림(405×228, 실제 폰도 영상도 가로만 보낸다)이다.
import { useEffect, useRef, useState } from "react";
import type { ServerMessage } from "../../../src/contract/events.ts";
import run from "./fake-run.json";
import type { PhoneSlot } from "./PhonePane";

declare global {
  interface Window { __dash?: { step(n: number): void } }
}

export type EyeFrameId = "table-far" | "table-near" | "sink" | "sink-cup";
export interface Moment { index: number; eye: EyeFrameId; messages: ServerMessage[] }
export const MOMENTS = run.moments as unknown as Moment[];
/** 코치 행동 중 순간(&mode=coach). */
export const COACH_MOMENT = run.coach as unknown as Moment;

/** 눈 그림(ui/public/debug-eye/eye-<이름>.webp) 크기: fake-run.json seen 프레임과 같다(scripts/twin3d/fake-run.ts FRAME). */
export const EYE_FRAME = { width: 405, height: 228 };

/** 메시지 상자 상태를 바꾼 가짜 순간(&talk). */
export type DebugTalk = "find";
/** 계획 전 찾기 상태 줄(서버 src/act/labels.ts FIND_THOUGHT.start와 같은 글). */
export const FIND_LINE = "컵이 안 보여서 식탁 쪽을 다시 볼게요";

/** 그 순간의 메시지 상자 상태를 바꾼다. find: 판단을 컵 치우기(1번 순간의 판단)로 바꾸고, 말풍선 말을 빼고 끝에 찾기 상태 줄 생각 메시지를 더한다. */
export function talkMoment(m: Moment, talk: DebugTalk | null): Moment {
  if (talk !== "find") return m;
  const isDecision = (x: ServerMessage) => x.type === "brain" && x.event.type === "decision";
  // 1번 순간의 마지막 판단(컵 치우기). 그 앞에는 지켜보기 판단이 와 있다
  const decision = [...MOMENTS[1]!.messages].reverse().find(isDecision);
  const at = Math.max(0, ...m.messages.flatMap((x) => (x.type === "thought" ? x.messages.map((t) => t.at_ms) : []))) + 1;
  return {
    ...m,
    messages: [...m.messages.map((x) => (isDecision(x) && decision ? decision : x)).filter((x) => x.type !== "say"),
      { type: "thought", messages: [{ id: `find@${at}:0`, text: FIND_LINE, at_ms: at, decision: "find" }] }],
  };
}

/** coach면 코치 행동 중 순간으로 바꾼다. null이면 그대로(가짜 단계 순간은 눈치 모드). */
export function modeMoment(m: Moment, mode: "coach" | null): Moment {
  return mode === "coach" ? COACH_MOMENT : m;
}

const wrap = (n: number) => ((n % MOMENTS.length) + MOMENTS.length) % MOMENTS.length;
/** 다음 순간: 2→3→4→0→1→2… */
export const nextMoment = (n: number) => wrap(n + 1);

export interface DebugQuery {
  /** 처음 순간. */
  step: number;
  /** 다음 순간으로 넘기는 간격(ms). 없으면 멈춘 채. */
  play: number | null;
  /** 대시보드 폰 칸에 눈 그림을 보이는가(false면 연결 QR). */
  eye: boolean;
  offline: boolean;
  settings: boolean;
  /** 메시지 상자 상태(&talk=find). 없으면 null. */
  talk: DebugTalk | null;
  /** 서버 지금 모드를 코치 모드로(&mode=coach). 없으면 null. */
  mode: "coach" | null;
}

/** 주소 → 가짜 단계 설정. ?debug=steps가 아니면 null. */
export function debugQuery(search: string): DebugQuery | null {
  const q = new URLSearchParams(search);
  if (q.get("debug") !== "steps") return null;
  const play = Number(q.get("play"));
  const playing = q.has("play") && Number.isFinite(play) && play > 0;
  const step = Number(q.get("step"));
  return {
    step: q.has("step") && Number.isInteger(step) ? wrap(step) : playing ? 2 : 0,
    play: playing ? play : null,
    eye: q.get("eye") !== "0",
    offline: q.get("offline") === "1",
    settings: q.get("settings") === "1",
    talk: q.get("talk") === "find" ? "find" : null,
    mode: q.get("mode") === "coach" ? "coach" : null,
  };
}

/** 그 순간 대시보드 폰 칸: 눈 그림, 영상 없음(eye=0)이면 연결 QR. */
export function debugPhone(q: DebugQuery, m: Moment, url: string): PhoneSlot {
  if (!q.eye) return { kind: "qr", url };
  return { kind: "image", src: `${import.meta.env.BASE_URL}debug-eye/eye-${m.eye}.webp`, ...EYE_FRAME };
}

/**
 * 가짜 단계 순간 고르기. q.step에서 시작하고 play면 ready(화면이 다 뜬 때) 뒤부터 그 간격마다 다음 순간으로 간다(window.__dash.step(n)으로 넘기면 거기서 다시 센다).
 * 순간이 바뀔 때마다 onMoment로 그 순간을 넘기고, 지금 순간을 돌려준다. q가 null이면 아무것도 하지 않고 null이다.
 */
export function useDebugSteps(q: DebugQuery | null, onMoment: (m: Moment) => void, ready = true): Moment | null {
  const [index, setIndex] = useState(q?.step ?? 0);
  const report = useRef(onMoment);
  report.current = onMoment;
  const at = (i: number) => modeMoment(talkMoment(MOMENTS[i]!, q?.talk ?? null), q?.mode ?? null);
  useEffect(() => { if (q) report.current(at(index)); }, [q, index]);
  useEffect(() => {
    if (!q) return;
    window.__dash = { step: (n: number) => setIndex(wrap(n)) };
    return () => { delete window.__dash; };
  }, [q]);
  useEffect(() => {
    if (!q?.play || !ready) return;
    const timer = setTimeout(() => setIndex(nextMoment), q.play);
    return () => clearTimeout(timer);
  }, [q, index, ready]);
  return q ? at(index) : null;
}
