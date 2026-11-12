import { useLayoutEffect, useRef, useSyncExternalStore } from "react";
import { Status } from "../components/ui/status";
import { placeDetections } from "./detections";
import type { BoxSize } from "./fit";
import { MASK_COLORS, paintMasks, shapeBoxes, shapesOf, tileCanvas, type MaskCtx, type SeenStore } from "./masks";

/**
 * 대시보드 폰 칸 영상 위 물체 모양 층: 마지막 seen의 마스크를 canvas 한 장에 칠하고(masks.ts paintMasks, 종류 무리마다 토큰 색),
 * 마스크 테두리 위에 이름·신뢰도 이름표(Status)를 붙인다. 네모 테두리는 그리지 않는다.
 * seen 저장소만 듣는다: 초당 10번 와도 이 층만 다시 그린다. 위쪽 카드 아래(ceiling)에만 그린다.
 * fallback: seen에 프레임 크기가 없을 때 쓸 그림 크기(가짜 단계 그림).
 */
export function MaskLayer({ seen, fallback, size, ceiling }: { seen: SeenStore; fallback: BoxSize | null; size: BoxSize; ceiling: number }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const event = useSyncExternalStore(seen.subscribe, seen.get, seen.get);
  const image = event?.frame ?? fallback;
  const shapes = event ? shapesOf(event) : [];
  useLayoutEffect(() => {
    const el = canvas.current;
    if (!el) return;
    // 화면 픽셀 배율만큼 크게 그린다(칸 크기가 바뀔 때만 canvas 크기를 고친다: 고치면 그림이 지워진다)
    const ratio = window.devicePixelRatio || 1;
    const w = Math.round(size.width * ratio), h = Math.round(size.height * ratio);
    if (el.width !== w) el.width = w;
    if (el.height !== h) el.height = h;
    const ctx = el.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    paintMasks(ctx as MaskCtx<CanvasImageSource>, image ? shapes : [], image ?? size, size, ceiling, MASK_COLORS, tileCanvas);
    // shapes는 event에서 나온다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [event, image?.width, image?.height, size.width, size.height, ceiling]);
  const placed = image ? placeDetections(shapeBoxes(shapes), image, size, ceiling) : [];
  return (
    <>
      <canvas ref={canvas} data-masks aria-hidden="true" className="absolute inset-0 size-full" />
      {placed.map((d, i) => (
        <Status key={`${d.label}-${i}`} variant="scrim" data-detection-label className="absolute" style={{ left: d.tag.left, top: d.tag.top }}>
          {d.text}
        </Status>
      ))}
    </>
  );
}
