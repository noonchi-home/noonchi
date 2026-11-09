// 대시보드 움직임 도우미. 단계가 바뀔 때 움직이는 것(지도 카메라, 표시 나타남)은 transform·opacity만 합성기에서 움직인다.
// 판 크기·자리(레이아웃)를 바꾸지 않으니 폰 영상·지도 그림을 다시 그리지 않는다. 나중에 지도가 three.js 캔버스, 대시보드 폰 칸 그림이 영상이 되어도 같다.
import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";

/** 지도 카메라가 옮겨 가는 움직임(빨리 시작해 부드럽게 멈춤)과 그 길이(300~450ms 사이). */
export const EASE = "cubic-bezier(0.22, 1, 0.36, 1)";
export const CAMERA_MS = 380;

/**
 * transform을 from → to로 옮긴다. 움직이는 중이면 지금 보이는 자리에서 이어 간다. 움직이는 동안 will-change를 둔다
 * (지도 그림 판은 class로 늘 두어, 다 옮긴 뒤 새 배율로 다시 그리지 않는다).
 */
export function moveTransform(el: HTMLElement, from: string, to: string, ms: number, easing = EASE): Animation | null {
  if (typeof el.animate !== "function") return null;
  const running = el.getAnimations?.() ?? [];
  const start = running.length ? getComputedStyle(el).transform || from : from;
  for (const a of running) a.cancel();
  el.style.willChange = "transform";
  const anim = el.animate([{ transform: start }, { transform: to }], { duration: ms, easing });
  const clear = () => { if (!(el.getAnimations?.() ?? []).some((a) => a !== anim && a.playState === "running")) el.style.willChange = ""; };
  anim.onfinish = clear;
  anim.oncancel = clear;
  return anim;
}

/** 움직임 줄이기 설정. 처음 그릴 때 바로 읽는다(가림판이 한 번 깜빡이지 않게). */
export function useReducedMotionNow(): boolean {
  const query = "(prefers-reduced-motion: reduce)";
  const read = () => typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia(query).matches;
  const [reduced, setReduced] = useState(read);
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const media = window.matchMedia(query);
    const update = () => setReduced(media.matches);
    update();
    media.addEventListener?.("change", update);
    return () => media.removeEventListener?.("change", update);
  }, []);
  return reduced;
}

/** 가린 채 그려 보는 한 장면 길이(ms). 그 사이 GPU가 그리기 방식(셰이더)을 만들고 그림을 푼다. */
export const WARM_HOLD_MS = 120;

/** 가린 채 그려 보는 것: index면 그 단계를 바로 보인다(null이면 지금 단계). veiled 동안 트윈·대시보드 폰 칸을 가린다. */
export type WarmUp = { index: number | null; veiled: boolean };

/**
 * 화면이 뜬 뒤 가림판 아래에서 미리 그려 본다. 새 크롬 프로필에서는 GPU가 처음 그리는 것(새 폰 영상 그림, 새 YOLO 상자, 밝힌 방이 바뀐 지도)마다
 * 그리기 방식을 만드느라 0.05~0.2초 멈추는데, 그 일을 사람이 보기 전에 끝낸다. 단계마다 WARM_HOLD_MS씩 바로(움직임 없이) 보인다.
 * planned가 아니면(움직임 줄이기) 하지 않는다. ready(처음 크기를 재고 그림을 풀고 글꼴 조각을 받은 뒤)가 되면 시작한다.
 */
export function useWarmUp(planned: boolean, ready: boolean, count: number): WarmUp {
  // -1 기다림, 0..count-1 단계마다 그려 보기, count 끝
  const [phase, setPhase] = useState(planned ? -1 : count);
  useEffect(() => {
    if (phase >= count) return;
    if (!planned) { setPhase(count); return; }
    if (phase < 0) { if (ready) setPhase(0); return; }
    const id = window.setTimeout(() => setPhase(phase + 1), WARM_HOLD_MS);
    return () => window.clearTimeout(id);
  }, [planned, ready, phase, count]);
  return { index: phase >= 0 && phase < count ? phase : null, veiled: phase < count };
}

/** key가 바뀔 때마다 ref 요소를 delay 뒤 ms 동안 opacity 0 → 1로 띄운다(합성기). on이 아니면 바로 보인다. */
export function useFadeIn(ref: RefObject<HTMLElement | null>, key: string, on: boolean, delay: number, ms = 180) {
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !on || typeof el.animate !== "function") return;
    const a = el.animate([{ opacity: 0 }, { opacity: 1 }], { delay, duration: ms, easing: "ease-out", fill: "backwards" });
    return () => a.cancel();
  }, [key]); // 움직임 길이가 바뀌는 것만으로는 다시 띄우지 않는다
}

/**
 * 글에 쓰는 글꼴 조각(unicode-range로 나뉜 woff2)을 미리 받는다. text의 글자와 지금 화면 글을 덮는 조각을 모두 받으면 true.
 * 단계가 바뀔 때 처음 나오는 글자가 새 조각을 받으면 글꼴이 바뀐 글을 모두 다시 배치하고 다시 그려 단계 바뀜이 끊긴다.
 * document.fonts가 없으면(시험) 바로 true.
 */
export function useFontsLoaded(family: string, text: string): boolean {
  const [done, setDone] = useState(() => typeof document === "undefined" || typeof document.fonts?.load !== "function");
  useLayoutEffect(() => {
    if (typeof document === "undefined" || typeof document.fonts?.load !== "function") { setDone(true); return; }
    let live = true;
    setDone(false);
    const all = text + (document.body?.innerText ?? "");
    document.fonts.load(`16px "${family}"`, all).catch(() => []).then(() => document.fonts.ready).then(() => { if (live) setDone(true); });
    return () => { live = false; };
  }, [family, text]);
  return done;
}

/**
 * 그림을 처음 쓰기 전에 미리 풀어 둔다(img.decode). 단계가 바뀔 때 그림 풀기로 그림이 늦지 않게. 붙들어 두어야 풀린 것이 남는다.
 * 다 풀었으면(실패한 것도 끝난 것으로 본다) true. img.decode가 없는 곳(jsdom)에서는 바로 true.
 */
export function usePredecode(srcs: readonly string[]): boolean {
  const held = useRef<HTMLImageElement[]>([]);
  const key = srcs.join("|");
  const [done, setDone] = useState(false);
  useLayoutEffect(() => {
    if (typeof Image === "undefined" || typeof Image.prototype.decode !== "function") { setDone(true); return; }
    let live = true;
    setDone(false);
    held.current = key.split("|").filter(Boolean).map((src) => {
      const img = new Image();
      img.decoding = "async";
      img.src = src;
      return img;
    });
    Promise.allSettled(held.current.map((img) => img.decode())).then(() => { if (live) setDone(true); });
    return () => { live = false; };
  }, [key]);
  return done;
}
