// 설정 4단계 시작 위치 고르기: 3D 트윈(같은 출처 iframe의 뷰어, ui/src/lib/twin-viewer.ts)에서 누른 픽셀 → 바닥 평면 점, 평면 점 → 트윈 칸 픽셀.
// 뷰어 카메라를 그대로 쓴다(three 광선이 높이 0 면과 만나는 점). 화면(PositionStep.tsx)은 이 값으로 부품을 놓기만 한다.
import { useEffect, useRef, useState, type RefObject } from "react";
import { projectPoint } from "../lib/twin-project";
import type { AptViewer } from "../lib/twin-viewer";

export type Pos = [number, number];
type Rect = { left: number; top: number; width: number; height: number };

/** 보는 방향을 보여 줄 화살표 길이(m). */
export const ARROW_M = 1.2;
/** 화면에서 화살표가 이보다 짧으면(집 전체를 멀리서 볼 때) 같은 방향으로 이만큼(px) 늘려 그린다. */
const MIN_ARROW_PX = 72;
/** 누름으로 보는 픽셀 움직임·시간 한도(넘으면 카메라 돌리기로 본다). */
const CLICK_PX = 6;
const CLICK_MS = 600;

const round3 = (v: number) => Math.round(v * 1000) / 1000 + 0;
const cameraOf = (v: AptViewer) => (v.view.cctv ? v.cctvCamera : v.camera);

/** 캔버스 안 픽셀(그 캔버스가 든 문서의 clientX·Y) → 바닥 평면 점 [x, y]. 광선이 바닥과 만나지 않으면 null. */
export function floorAt(v: AptViewer, rect: Rect, clientX: number, clientY: number): Pos | null {
  if (!(rect.width > 0 && rect.height > 0)) return null;
  const { THREE } = v;
  const ndc = new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
  const ray = new THREE.Raycaster();
  ray.setFromCamera(ndc, cameraOf(v));
  const hit = ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), new THREE.Vector3());
  return hit ? [round3(hit.x), round3(hit.z)] : null;
}

/** 평면 점 → 캔버스 안 픽셀(왼쪽 위 원점). */
export function screenOf(v: AptViewer, rect: Rect, p: Pos): { x: number; y: number; visible: boolean } {
  const cam = cameraOf(v);
  const m = new v.THREE.Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
  return projectPoint(m.elements, [p[0], 0, p[1]], rect.width, rect.height);
}

/** from에서 to를 보는 평면 방향(도, 0 = +x, 90 = +y, 0~360). */
export function yawOf(from: Pos, to: Pos): number {
  const d = (Math.atan2(to[1] - from[1], to[0] - from[0]) * 180) / Math.PI;
  return Math.round((((d % 360) + 360) % 360) * 10) / 10 % 360;
}

/** p에서 yaw 방향으로 m만큼 간 점. */
export function ahead(p: Pos, yawDeg: number, m = ARROW_M): Pos {
  const a = (yawDeg * Math.PI) / 180;
  return [p[0] + Math.cos(a) * m, p[1] + Math.sin(a) * m];
}

/** 뷰어 캔버스의 누름(조금도 끌지 않은 짧은 누름)만 바닥 점으로 알린다. 끌면 뷰어가 카메라를 돌린다. */
export function useFloorClicks(v: AptViewer | null, onFloor: (p: Pos) => void): void {
  const cb = useRef(onFloor);
  cb.current = onFloor;
  useEffect(() => {
    const canvas = v?.renderer?.domElement;
    if (!v || !canvas) return;
    let down: { x: number; y: number; at: number } | null = null;
    const onDown = (e: MouseEvent) => { down = { x: e.clientX, y: e.clientY, at: Date.now() }; };
    const onUp = (e: MouseEvent) => {
      const d = down;
      down = null;
      if (!d || Math.hypot(e.clientX - d.x, e.clientY - d.y) > CLICK_PX || Date.now() - d.at > CLICK_MS) return;
      const p = floorAt(v, canvas.getBoundingClientRect(), e.clientX, e.clientY);
      if (p) cb.current(p);
    };
    canvas.addEventListener("pointerdown", onDown);
    canvas.addEventListener("pointerup", onUp);
    return () => {
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointerup", onUp);
    };
  }, [v]);
}

export interface Overlay {
  /** 트윈 칸 크기(px). */
  width: number;
  height: number;
  /** 트윈 칸 안 픽셀: 시작 자리, 화살표 끝. 점이 없으면 null. */
  spot: { x: number; y: number; visible: boolean } | null;
  tip: { x: number; y: number; visible: boolean } | null;
}

/** 트윈 칸 안 iframe 캔버스 자리(트윈 칸 기준 px). */
export function canvasBox(v: AptViewer, frame: HTMLIFrameElement, box: HTMLElement): Rect {
  const f = frame.getBoundingClientRect(), b = box.getBoundingClientRect(), c = v.renderer.domElement.getBoundingClientRect();
  return { left: f.left - b.left + c.left, top: f.top - b.top + c.top, width: c.width, height: c.height };
}

/** 트윈 칸 픽셀(clientX·Y는 화면 문서 기준) → 바닥 평면 점. 화살표 끝을 끌 때 쓴다. */
export function floorAtBox(v: AptViewer, frame: HTMLIFrameElement, box: HTMLElement, clientX: number, clientY: number): Pos | null {
  const r = canvasBox(v, frame, box), b = box.getBoundingClientRect();
  return floorAt(v, { left: b.left + r.left, top: b.top + r.top, width: r.width, height: r.height }, clientX, clientY);
}

/** 그림마다 시작 자리·화살표 끝을 트윈 칸 픽셀로 옮긴다(카메라를 돌리거나 칸 크기가 바뀌어도 따라간다). 바뀐 게 없으면 다시 그리지 않는다. */
export function useOverlay(v: AptViewer | null, frame: RefObject<HTMLIFrameElement | null>, box: RefObject<HTMLElement | null>, spot: Pos | null, yawDeg: number): Overlay {
  const [out, setOut] = useState<Overlay>({ width: 0, height: 0, spot: null, tip: null });
  useEffect(() => {
    if (!v) return;
    let raf = 0;
    let last = "";
    const tick = () => {
      const f = frame.current, b = box.current;
      if (f && b && v.renderer?.domElement) {
        const r = canvasBox(v, f, b);
        const at = (p: Pos) => {
          const s = screenOf(v, r, p);
          return { x: Math.round(r.left + s.x), y: Math.round(r.top + s.y), visible: s.visible };
        };
        const size = b.getBoundingClientRect();
        const s = spot ? at(spot) : null;
        const next: Overlay = { width: Math.round(size.width), height: Math.round(size.height), spot: s, tip: spot && s ? stretch(s, at(ahead(spot, yawDeg))) : null };
        const key = JSON.stringify(next);
        if (key !== last) { last = key; setOut(next); }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [v, frame, box, spot?.[0], spot?.[1], yawDeg]);
  return out;
}

/** 화살표 끝이 화면에서 MIN_ARROW_PX보다 가까우면 같은 방향으로 그만큼 민다. */
function stretch(spot: { x: number; y: number }, tip: { x: number; y: number; visible: boolean }): { x: number; y: number; visible: boolean } {
  const dx = tip.x - spot.x, dy = tip.y - spot.y, len = Math.hypot(dx, dy);
  if (len >= MIN_ARROW_PX || len < 1e-6) return tip;
  const k = MIN_ARROW_PX / len;
  return { x: Math.round(spot.x + dx * k), y: Math.round(spot.y + dy * k), visible: tip.visible };
}

/** 화살표 그림(트윈 칸 픽셀 SVG path): 자리 → 끝, 끝에 머리 두 줄. */
export function arrowPath(o: Overlay): string {
  if (!o.spot || !o.tip) return "";
  const { x: x1, y: y1 } = o.spot, { x: x2, y: y2 } = o.tip;
  const len = Math.hypot(x2 - x1, y2 - y1);
  if (len < 4) return "";
  const ux = (x2 - x1) / len, uy = (y2 - y1) / len, head = Math.min(14, len / 2.5);
  const wing = (s: number) => `${(x2 - ux * head - uy * head * 0.6 * s).toFixed(1)},${(y2 - uy * head + ux * head * 0.6 * s).toFixed(1)}`;
  return `M${x1},${y1}L${x2},${y2}M${wing(1)}L${x2},${y2}L${wing(-1)}`;
}

/** 화면에서 시계 방향으로 돌리는 평면 각 부호: 평면 각이 늘 때 화면에서 시계 방향이면 1. */
export function clockwiseSign(o: Overlay, v: AptViewer | null, frame: HTMLIFrameElement | null, box: HTMLElement | null, spot: Pos | null, yawDeg: number): 1 | -1 {
  if (!v?.renderer?.domElement || !frame || !box || !spot || !o.spot || !o.tip) return 1;
  const r = canvasBox(v, frame, box);
  const s = screenOf(v, r, ahead(spot, yawDeg + 5));
  const a = { x: o.tip.x - o.spot.x, y: o.tip.y - o.spot.y }, b = { x: r.left + s.x - o.spot.x, y: r.top + s.y - o.spot.y };
  // 화면 좌표는 y가 아래로 커진다: 외적이 양수면 시계 방향
  return a.x * b.y - a.y * b.x >= 0 ? 1 : -1;
}
