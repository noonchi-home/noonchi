import { useMemo } from "react";
import { cn } from "../lib/utils";
import { qrPath } from "./qr";

const QUIET = 2; // 바깥 흰 여백(칸)

/** 흰 바탕 검은 칸 QR. 폰 카메라가 읽기 쉽게 색을 바꾸지 않는다. */
export function QrCode({ value, className }: { value: string; className?: string }) {
  const { size, d } = useMemo(() => qrPath(value), [value]);
  const box = size + QUIET * 2;
  return (
    <svg role="img" aria-label="폰 접속 QR" viewBox={`${-QUIET} ${-QUIET} ${box} ${box}`} shapeRendering="crispEdges" className={cn("rounded-lg", className)}>
      <rect x={-QUIET} y={-QUIET} width={box} height={box} fill="#fff" />
      <path d={d} fill="#000" />
    </svg>
  );
}
