import { useLayoutEffect, useState, type RefObject } from "react";

export interface BoxSize { width: number; height: number }

/** 그림(w×h)을 상자에 contain(다 보이게) 또는 cover(꽉 채우게)로 놓을 때의 배율과 왼쪽 위 자리. */
export function fitBox(image: BoxSize, box: BoxSize, mode: "contain" | "cover" = "contain"): { scale: number; left: number; top: number } {
  if (!image.width || !image.height || !box.width || !box.height) return { scale: 0, left: 0, top: 0 };
  const sx = box.width / image.width;
  const sy = box.height / image.height;
  const scale = mode === "contain" ? Math.min(sx, sy) : Math.max(sx, sy);
  return { scale, left: (box.width - image.width * scale) / 2, top: (box.height - image.height * scale) / 2 };
}

/** 그림 픽셀 점 → 상자 안 자리(fitBox 결과로). */
export const toBox = (fit: ReturnType<typeof fitBox>, [u, v]: [number, number]) => ({ x: fit.left + u * fit.scale, y: fit.top + v * fit.scale });

/** 요소 크기(ResizeObserver). 처음 그릴 때는 getBoundingClientRect로 읽는다. */
export function useBoxSize(ref: RefObject<HTMLElement | null>, useClientWidth = false): BoxSize {
  const [size, setSize] = useState<BoxSize>({ width: 0, height: 0 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const read = () => {
      const r = el.getBoundingClientRect();
      const width = useClientWidth ? el.clientWidth || r.width : r.width;
      setSize((s) => (s.width === width && s.height === r.height ? s : { width, height: r.height }));
    };
    read();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref, useClientWidth]);
  return size;
}
