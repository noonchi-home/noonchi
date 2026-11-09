// 대시보드 움직임 도우미. 단계가 바뀔 때 움직이는 것(지도 카메라, 표시 나타남)은 transform·opacity만 합성기에서 움직인다.
// 판 크기·자리(레이아웃)를 바꾸지 않으니 폰 영상·지도 그림을 다시 그리지 않는다. 나중에 지도가 three.js 캔버스, 대시보드 폰 칸 그림이 영상이 되어도 같다.
import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";

/** 지도 카메라가 옮겨 가는 움직임(빨리 시작해 부드럽게 멈춤)과 그 길이(300~450ms 사이). */
export const EASE = "cubic-bezier(0.22, 1, 0.36, 1)";
export const CAMERA_MS = 380;

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
 * 글에 쓰는 글꼴 조각(unicode-range로 나뉜 woff2)을 미리 받는다. text의 글자와 지금 화면 글을 덮는 조각을 처음 다 받으면 true이고, 그 뒤로 그대로다.
 * 단계가 바뀌어 text가 바뀌면 새 글자의 조각을 받기만 한다: false로 돌리지 않아 화면을 한 번 더 그리지 않고, 화면 글은 textContent로 읽어 배치를 다시 셈하지 않는다.
 * document.fonts가 없으면(시험) 바로 true.
 */
export function useFontsLoaded(family: string, text: string): boolean {
  const [done, setDone] = useState(() => typeof document === "undefined" || typeof document.fonts?.load !== "function");
  useLayoutEffect(() => {
    if (typeof document === "undefined" || typeof document.fonts?.load !== "function") { setDone(true); return; }
    let live = true;
    const all = text + (document.body?.textContent ?? "");
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
