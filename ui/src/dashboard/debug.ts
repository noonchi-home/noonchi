// 가짜 단계(?debug=steps): 서버 자료 대신 fake-run.json(scripts/twin3d/fake-run.ts)의 순간마다 메시지 묶음을 대시보드 자료·확인 목록에 넣는다.
// 순간은 0 지켜보기, 1~4 컵 치우기 계획 단계다. 트윈(집·가전 상태·배치)과 health는 서버 것 그대로 쓴다.
//   &step=N      그 순간(없으면 0, play면 2)
//   &play=MS     지도(트윈) 첫 그림 뒤 MS마다 다음 순간: 2→3→4→0→1→2…
//   &eye=0       대시보드 폰 칸 영상 없음(연결 QR)
//   &offline=1   서버 연결 끊김
//   &settings=1  설정 창을 연 채
// window.__dash.step(n)으로 바로 그 순간으로 간다. 대시보드 폰 칸은 그 순간 눈 그림(세로 405×720)이다.
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

const EYE_FRAME = { width: 405, height: 720 };
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
  };
}

/** 그 순간 대시보드 폰 칸: 눈 그림, 영상 없음(eye=0)이면 연결 QR. */
export function debugPhone(q: DebugQuery, m: Moment, url: string): PhoneSlot {
  return q.eye ? { kind: "image", src: `${import.meta.env.BASE_URL}debug-eye/eye-${m.eye}.webp`, ...EYE_FRAME } : { kind: "qr", url };
}

/**
 * 가짜 단계 순간 고르기. q.step에서 시작하고 play면 ready(지도 첫 그림) 뒤부터 그 간격마다 다음 순간으로 간다(window.__dash.step(n)으로 넘기면 거기서 다시 센다).
 * 순간이 바뀔 때마다 onMoment로 그 순간을 넘기고, 지금 순간을 돌려준다. q가 null이면 아무것도 하지 않고 null이다.
 */
export function useDebugSteps(q: DebugQuery | null, onMoment: (m: Moment) => void, ready = true): Moment | null {
  const [index, setIndex] = useState(q?.step ?? 0);
  const report = useRef(onMoment);
  report.current = onMoment;
  useEffect(() => { if (q) report.current(MOMENTS[index]!); }, [q, index]);
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
  return q ? MOMENTS[index]! : null;
}
