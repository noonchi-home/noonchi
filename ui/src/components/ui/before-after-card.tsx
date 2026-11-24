// 21st.dev「Image Comparison Slider」(id 31523, wensity/before-after-card) 받은 코드.
// 바꾼 것: 실제 사진 두 장과 기준 비율을 받도록 했다. 흑백 처리·그라데이션·자동 시연·세로 비교는 빼고, 색을 공통 토큰으로 바꿨다.
import { motion, useMotionValue, useTransform } from "motion/react";
import { useRef, useState, type KeyboardEvent, type PointerEvent } from "react";

interface BeforeAfterCardProps {
  beforeSrc: string;
  afterSrc: string;
  beforeAlt: string;
  afterAlt: string;
  width: number;
  height: number;
}

export function BeforeAfterCard({ beforeSrc, afterSrc, beforeAlt, afterAlt, width, height }: BeforeAfterCardProps) {
  const wipe = useMotionValue(50);
  const line = useTransform(wipe, (value) => `${value}%`);
  const clipPath = useTransform(wipe, (value) => `inset(0 ${100 - value}% 0 0)`);
  const pointer = useRef<number | null>(null);
  const [value, setValue] = useState(50);

  function commit(percent: number) {
    const next = Math.min(100, Math.max(0, percent));
    wipe.set(next);
    setValue(Math.round(next));
  }

  function fromPointer(event: PointerEvent<HTMLDivElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    if (rect.width > 0) commit((event.clientX - rect.left) * 100 / rect.width);
  }

  function startDrag(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0 || pointer.current !== null) return;
    pointer.current = event.pointerId;
    event.currentTarget.focus({ preventScroll: true });
    event.currentTarget.setPointerCapture?.(event.pointerId);
    fromPointer(event);
  }

  function endDrag(event: PointerEvent<HTMLDivElement>) {
    if (pointer.current !== event.pointerId) return;
    pointer.current = null;
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const current = wipe.get();
    let next: number;
    switch (event.key) {
      case "ArrowLeft":
      case "ArrowDown": next = current - 2; break;
      case "ArrowRight":
      case "ArrowUp": next = current + 2; break;
      case "PageDown": next = current - 10; break;
      case "PageUp": next = current + 10; break;
      case "Home": next = 0; break;
      case "End": next = 100; break;
      default: return;
    }
    event.preventDefault();
    commit(next);
  }

  return <figure className="w-full">
    <div role="slider" tabIndex={0} aria-label="기준 뷰와 찍은 사진 비교" aria-orientation="horizontal"
      aria-valuemin={0} aria-valuemax={100} aria-valuenow={value} aria-valuetext={`찍은 사진 ${value}%`}
      onPointerDown={startDrag} onPointerMove={(event) => { if (event.pointerId === pointer.current) fromPointer(event); }}
      onPointerUp={endDrag} onPointerCancel={endDrag} onLostPointerCapture={endDrag} onKeyDown={onKeyDown}
      className="relative isolate w-full cursor-ew-resize touch-pan-y select-none overflow-hidden rounded-lg bg-muted outline-none ring-1 ring-border shadow-sm focus-visible:ring-2 focus-visible:ring-ring"
      style={{ aspectRatio: `${width} / ${height}` }}>
      <div className="absolute inset-0">
        <img src={beforeSrc} alt={beforeAlt} draggable={false} decoding="async" referrerPolicy="no-referrer"
          className="h-full w-full object-cover" />
      </div>
      <motion.div className="absolute inset-0" style={{ clipPath }}>
        <img src={afterSrc} alt={afterAlt} draggable={false} decoding="async" className="h-full w-full object-cover" />
      </motion.div>
      <span aria-hidden="true" className="pointer-events-none absolute right-3.5 bottom-3.5 z-10 rounded-md bg-scrim-phone px-1.5 py-0.5 text-[11px] text-on-scrim">기준 뷰</span>
      <span aria-hidden="true" className="pointer-events-none absolute bottom-3.5 left-3.5 z-10 rounded-md bg-scrim-phone px-1.5 py-0.5 text-[11px] text-on-scrim">찍은 사진</span>
      <motion.div aria-hidden className="pointer-events-none absolute inset-y-0 z-20 w-0.5 bg-background shadow-sm" style={{ left: line, x: "-50%" }} />
      <motion.div aria-hidden className="pointer-events-none absolute top-1/2 z-30 flex size-10 items-center justify-center rounded-full bg-background text-foreground shadow-sm ring-1 ring-border"
        style={{ left: line, x: "-50%", y: "-50%" }}>
        <svg width="16" height="12" viewBox="0 0 16 12" aria-hidden="true">
          <path d="M1.25 6L5.75 1.75V10.25L1.25 6Z" fill="currentColor" />
          <path d="M14.75 6L10.25 1.75V10.25L14.75 6Z" fill="currentColor" />
        </svg>
      </motion.div>
    </div>
  </figure>;
}
