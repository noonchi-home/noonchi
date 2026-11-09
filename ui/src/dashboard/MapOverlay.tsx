import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { DeviceView } from "../../../src/contract/events.ts";
import { BubbleLayer } from "../bubbles/BubbleLayer";
import { deviceSummary } from "../bubbles/summary";
import type { Check } from "../checks/checks";
import { LineDrawSvg, type LineTone, type MarkTone } from "../components/ui/line-draw-svg";
import { Status } from "../components/ui/status";
import type { TwinEngine } from "../twin3d/engine";
import { plateTransform, type MapCamera } from "../twin3d/view";
import type { Px } from "./camera";
import { edgeFade } from "./checks";
import type { BoxSize } from "./fit";
import type { TwinFrame } from "./frame";
import { otherRooms, roomsPath, type RoomShape } from "./home";
import { useFadeIn } from "./motion";
import { legAheadOf, mapScene, type Box } from "./scene";

/** 밝힌 방 묶음 이름(순서와 상관없음). */
const roomsKey = (rooms: string[]) => [...rooms].sort().join("+");
/** 꺾은선 → SVG path d. */
const lineOf = (pts: Px[]) => (pts.length ? `M${pts.map(([u, v]) => `${u.toFixed(1)},${v.toFixed(1)}`).join("L")}` : "");

/**
 * 3D 트윈 위 표시 판. 구운 보기 그림 픽셀(image) 크기의 판(data-map-plate) 하나에 같은 그림 픽셀 그림(LineDrawSvg)으로
 * 밝히지 않는 방 어둡게 칠한 층, 밝힌 방 테두리, 지나온 길·남은 길·지금 구간, 목적지, 확인한 것 점, 클로이드(점·머리 방향)를 겹쳐 놓는다.
 * 판 transform은 엔진이 그림을 그릴 때마다 그 지도 카메라로 바꾼다(React 상태를 거치지 않아 3D 그림과 같은 그림에 움직인다).
 * 어둡게 한 층은 계획의 밝힌 방 묶음(roomSets)마다 미리 만들고 지금 묶음만 opacity 1이다: 밝힌 방이 바뀌어도 새 모양을 그리지 않는다.
 * 선 굵기는 카메라가 다 옮긴 뒤 한 번 새 배율에 맞춘다. 방 이름표·확인한 기기 말풍선은 판 밖 상자 px에 두고(scene.ts가 고른다),
 * 카메라가 다 옮긴 뒤 떠오른다. 보기만 한다: 마우스를 받지 않는다.
 */
export function MapOverlay({ frame, checks, shapes, roomSets, image, size, cam, engine, devices, objects, moveMs, blocked, avoid }: {
  frame: TwinFrame;
  /** 확인 목록(frame.marks와 같은 목록). */
  checks: Check[];
  shapes: RoomShape[];
  /** 계획 단계마다 밝힐 방 묶음. */
  roomSets: string[][];
  /** 구운 보기 그림 크기(px). */
  image: BoxSize;
  /** 트윈 칸 크기(레이아웃 px). */
  size: BoxSize;
  /** 카메라가 옮겨 갈 지도 카메라. 말풍선·이름표 자리와 선 굵기를 정한다. */
  cam: MapCamera;
  engine: Pick<TwinEngine, "onView" | "current"> | null;
  devices: Map<string, DeviceView>;
  /** 물건 id → 이름. */
  objects: Map<string, string>;
  /** 카메라를 옮기는 시간(ms). 0이면 바로. */
  moveMs: number;
  /** 지도 위에 얹어 지도를 가리는 자리(상자 px): 말풍선 카드·마스코트. */
  blocked: Box[];
  /** 말풍선이 덮지 않을 패널(CSS 선택자). */
  avoid?: string;
}) {
  const plate = useRef<HTMLDivElement>(null);
  const marks = useRef<HTMLDivElement>(null);
  const sizeRef = useRef(size);
  sizeRef.current = size;
  const camRef = useRef(cam);
  camRef.current = cam;

  // 판 transform: 처음과 창 크기가 바뀔 때 지금 카메라로 놓고, 그 뒤로는 엔진이 그릴 때마다 바꾼다
  useLayoutEffect(() => {
    const el = plate.current;
    if (!el) return;
    el.style.transform = plateTransform(engine?.current() ?? camRef.current, size);
    if (!engine) return;
    return engine.onView((c) => { el.style.transform = plateTransform(c, sizeRef.current); });
  }, [engine, size.width, size.height]);
  useLayoutEffect(() => {
    if (!engine && plate.current) plate.current.style.transform = plateTransform(cam, size);
  }, [engine, cam.cx, cam.cy, cam.scale, size.width, size.height]);

  // 선 굵기(그림 px당 화면 px의 역수)는 카메라가 다 옮긴 뒤 한 번 맞춘다
  const want = cam.scale > 0 ? 1 / cam.scale : 1;
  const [k, setK] = useState(want);
  useEffect(() => {
    if (moveMs <= 0) { setK(want); return; }
    const id = window.setTimeout(() => setK(want), moveMs);
    return () => window.clearTimeout(id);
  }, [want, moveMs]);

  useFadeIn(marks, plateTransform(cam, size), moveMs > 0, moveMs);

  // 밝힌 방 묶음마다 어둡게 한 층(지금 묶음만 보인다). 밝힐 방이 없으면 모두 숨긴다
  const dims = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of [...roomSets, frame.rooms]) {
      if (!r.length) continue;
      const id = roomsKey(r);
      if (!m.has(id)) m.set(id, roomsPath(otherRooms(r, shapes), shapes));
    }
    return [...m];
  }, [roomSets, frame.rooms, shapes]);
  const lit = frame.rooms.length ? roomsKey(frame.rooms) : null;
  const litPath = useMemo(() => roomsPath(frame.rooms, shapes), [frame.rooms, shapes]);
  const { robot, route, target } = frame;
  const legAhead = useMemo(() => legAheadOf(frame), [frame]);
  const { points, checks: shownChecks, labels, keep } = mapScene(frame, checks, shapes, size, cam, blocked, legAhead);
  const markTone = (id: string): MarkTone => {
    const d = devices.get(id);
    return d ? deviceSummary(d).tone : "object";
  };

  const draw = (tone: LineTone, more: { path?: string; at?: Px; mark?: MarkTone; angle?: number } = {}) => (
    <LineDrawSvg tone={tone} width={image.width} height={image.height} strokeScale={k} className="absolute inset-0 h-full w-full" {...more} />
  );
  const lines: [string, Px[], LineTone][] = [["passed", route.done, "routePassed"], ["ahead", route.ahead, "routeAhead"], ["leg-ahead", legAhead, "route"]];
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      <div ref={plate} data-map-plate className="absolute left-0 top-0 origin-top-left will-change-transform" style={{ width: image.width, height: image.height }}>
        {dims.map(([id, d]) => (
          <div key={id} data-map-dim={id} className="absolute inset-0 will-change-[opacity]" style={{ opacity: id === lit ? 1 : 0 }}>
            {draw("dimRoom", { path: d })}
          </div>
        ))}
        {litPath && <div data-room-edge className="absolute inset-0">{draw("roomEdge", { path: litPath })}</div>}
        {lines.map(([id, pts, tone]) => pts.length > 1 && <div key={id} data-line={id} className="absolute inset-0">{draw(tone, { path: lineOf(pts) })}</div>)}
        {target && <div data-target className="absolute inset-0">{draw("destination", { at: target })}</div>}
        {frame.marks.map((m) => {
          // 상자 가장자리에 걸린 표시는 반쪽만 보이지 않게 흐리게 지운다
          const p = points.get(m.id);
          return (
            <div key={m.id} data-mark={m.id} className="absolute inset-0" style={{ opacity: p ? edgeFade(p, size, 9) : 1 }}>
              {draw("checkDot", { at: m.px, mark: markTone(m.id) })}
            </div>
          );
        })}
        {robot && <div data-robot className="absolute inset-0">{draw("cloid", { at: robot.px, angle: robot.angle })}</div>}
      </div>
      <div ref={marks} className="absolute inset-0">
        {labels.map((l) => (
          <div key={l.id} data-room={l.id} className="absolute -translate-x-1/2 -translate-y-1/2" style={{ left: l.at.x, top: l.at.y }}>
            <Status>{l.label}</Status>
          </div>
        ))}
        <BubbleLayer checks={shownChecks} devices={devices} objects={objects} points={points} avoid={avoid} keep={keep} />
      </div>
    </div>
  );
}
