// 폰 방향: 세로면 true. matchMedia("(orientation: portrait)")의 change와 창 크기 바뀜(resize)을 듣는다.
// AR 화면은 가로가 기본이고, 세로면 PhoneScreen이 「가로로 돌려 주세요」를 띄운다. 방향 고정·전체 화면은 요청하지 않는다(core/ar.js).
import { useSyncExternalStore } from "react";

const PORTRAIT = "(orientation: portrait)";

function subscribe(onChange: () => void): () => void {
  const media = window.matchMedia?.(PORTRAIT);
  media?.addEventListener?.("change", onChange);
  window.addEventListener("resize", onChange);
  return () => {
    media?.removeEventListener?.("change", onChange);
    window.removeEventListener("resize", onChange);
  };
}

const portraitNow = () => window.matchMedia?.(PORTRAIT).matches ?? false;

/** 지금 세로인지. 바뀌면 다시 그린다. */
export function usePortrait(): boolean {
  return useSyncExternalStore(subscribe, portraitNow, () => false);
}
