import { useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { DeviceView } from "../../../src/contract/events.ts";
import type { TraceState } from "../../../src/contract/trace.ts";
import { BubbleLayer } from "./bubbles/BubbleLayer";
import { deviceSummary } from "./bubbles/summary";
import type { Check } from "./checks/checks";
import { LineDrawSvg } from "../components/ui/line-draw-svg";
import { Status } from "../components/ui/status";
import { type TwinEngine, plateTransform, type MapCamera } from "../twin";
import { edgeFade } from "./checks";
import type { BoxSize } from "./fit";
import { withTraceChecks, type TwinFrame } from "./frame";
import { otherRooms, roomsPath, type RoomShape } from "./home";
import { placeTag } from "./labels";
import { PreDrawing, useFadeIn } from "./motion";
import { checkDotLayers, dimLayer, goalRingLayers, lineLayers, roomEdgeLayer, type Layer, type MarkTone } from "./marks";
import { toScreen, type Px } from "./camera";
import { LABEL_BOX, mapScene, type Box } from "./scene";

/** 트레이스 이름표 색(21st.dev Status variant): 진행 중 brand, 끝 기본, 실패 error, 취소 기본. 실행 보류는 warning. */
const TAG_VARIANT: Record<TraceState, "brand" | "default" | "error"> = { pending: "brand", done: "default", failed: "error", cancelled: "default" };

/** 밝힌 방 묶음 이름(순서와 상관없음). */
const roomsKey = (rooms: string[]) => [...rooms].sort().join("+");
/** 꺾은선 → SVG path d. */
const lineOf = (pts: Px[]) => (pts.length > 1 ? `M${pts.map(([u, v]) => `${u.toFixed(1)},${v.toFixed(1)}`).join("L")}` : "");
/** 미리 그린 길(목표가 준비된 계획)의 흐림(opacity). 시작(사람이 떠남)이면 1이다. */
export const PRE_FADE = 0.35;

/**
 * 3D 트윈 위 표시 판. 구운 보기 그림 픽셀(image) 크기의 판(data-map-plate) 하나에 같은 그림 픽셀 그림(LineDrawSvg)으로
 * 밝히지 않는 방 어둡게 칠한 층, 밝힌 방 테두리, 가전 확인 점, 트레이스 표시를 겹쳐 놓는다.
 * 트윈에는 집·클로이드 원뿔·밝힌 방·가전 상태·트레이스 표시만 있다(2026-11-25 사용자 결정 5-1). 길·고리도 트레이스 줄에서만 나온다:
 * - 이동 안내 줄: 그 단계 구간(진행 중이면 진한 지금 구간, 끝났으면 지나온 길)과 진행 중이면 구간 끝 「이동 안내 · …」 이름표.
 * - 목표 준비·사용자 자리 이탈 줄: 대상 위 작은 빨간 고리(세 겹)와 미리 만든 계획의 길(준비됨은 흐림, 시작은 진함), 「목표 준비 · …」 이름표.
 * - 집기·배치·수행 안내·물건 상태 변화·근접 관찰·실행 보류 줄: 그 자리 점과 「줄 이름 · 결과」 이름표(Status). 근접 관찰 진행 중이면 클로이드 원뿔에서 대상까지 선.
 * - 가전 줄: 그 가전 말풍선 칩 글.
 * 단계 번호·남은 길·사람 이름표·관계 이름표·지금 단계 이름표·두뇌 말풍선은 그리지 않는다. 이름표는 글을 자르지 않고 칸 안으로 옮긴다(labels.ts placeTag).
 * 클로이드(맞춘 눈)는 판에 그리지 않고 엔진 장면의 3D 원뿔이 따른다. frame.robot은 카메라 맞춤·말풍선 비킬 자리에만 쓴다.
 * 판 transform은 엔진이 그림을 그릴 때마다 그 지도 카메라로 바꾼다(React 상태를 거치지 않아 3D 그림과 같은 그림에 움직인다).
 * 어둡게 한 층은 계획의 밝힌 방 묶음(roomSets)마다 미리 만들고 지금 묶음만 opacity 1이다: 밝힌 방이 바뀌어도 새 모양을 그리지 않는다.
 * 선 굵기는 카메라가 다 옮긴 뒤 한 번 새 배율에 맞춘다. 방 이름표·확인한 기기 말풍선은 판 밖 상자 px에 두고(scene.ts가 고른다),
 * 카메라가 다 옮긴 뒤 떠오른다. 화면이 뜰 때 미리 그려 보는 동안(PreDrawing)만 이름표·말풍선 층을 단계가 바뀔 때처럼 따로 합성해 그려 둔다. 보기만 한다: 마우스를 받지 않는다.
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

  // 화면이 뜰 때 미리 그려 보는 동안 이름표·말풍선 층을 단계가 바뀔 때처럼 따로 합성해 그려 본다(opacity는 1 그대로라 보이는 것은 같다)
  const predraw = useContext(PreDrawing);
  useLayoutEffect(() => {
    const el = marks.current;
    if (!predraw || !el || typeof el.animate !== "function") return;
    const a = el.animate([{ opacity: 1 }, { opacity: 1 }], { duration: 1000 });
    return () => a.cancel();
  }, [predraw]);

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
  const { planned } = frame;
  // 트레이스 가전 표시는 그 가전 말풍선의 칩 글이다
  const bubbleChecks = useMemo(() => withTraceChecks(checks, frame.trace), [checks, frame.trace]);
  const scene = mapScene(frame, bubbleChecks, shapes, size, cam, blocked);
  const { points, checks: shownChecks, labels, keep } = scene;
  const screenAt = (p: Px) => toScreen(cam, size, p);
  // 트레이스 이름표: 가전 말풍선이 아닌 표시마다 「줄 이름 · 결과」(이동 구간은 진행 중일 때만). 칸 안에 끝까지 보이게 둔다
  // 가린 자리·클로이드 원뿔·방 이름표와 겹치지 않게 비킨다
  const around = (p: { x: number; y: number }, w: number, h: number): Box => ({ x0: p.x - w / 2, y0: p.y - h / 2, x1: p.x + w / 2, y1: p.y + h / 2 });
  const taken: Box[] = [
    ...blocked, ...keep.map((r) => ({ x0: r.left, y0: r.top, x1: r.right, y1: r.bottom })), ...labels.map((l) => around(l.at, LABEL_BOX.w, LABEL_BOX.h)),
  ];
  const tags = frame.trace
    .filter((m) => m.kind !== "device" && (m.kind !== "leg" || m.state === "pending"))
    .map((m) => ({ m, at: placeTag(screenAt(m.px), m.text, taken, size) }));
  const lookLines = frame.robot ? frame.trace.filter((m) => m.kind === "look" && m.state === "pending") : [];
  const legs = frame.trace.filter((m) => m.kind === "leg" && (m.path?.length ?? 0) > 1);
  const goalMark = [...frame.trace].reverse().find((m) => m.kind === "goal");
  const markTone = (id: string): MarkTone => {
    const d = devices.get(id);
    return d ? deviceSummary(d).tone : "object";
  };

  // 21st.dev Line Draw SVG 한 장에 path 하나: 겹친 장들이 표시 하나다
  const draw = (layers: Layer[]) => layers.map((l, i) => (
    <LineDrawSvg key={i} tone={l.tone} path={l.d} strokeWidth={l.width} width={image.width} height={image.height} className="absolute inset-0 h-full w-full" />
  ));
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      <div ref={plate} data-map-plate className="absolute left-0 top-0 origin-top-left will-change-transform" style={{ width: image.width, height: image.height }}>
        {dims.map(([id, d]) => (
          <div key={id} data-map-dim={id} className="absolute inset-0 will-change-[opacity]" style={{ opacity: id === lit ? 1 : 0 }}>
            {draw([dimLayer(d)])}
          </div>
        ))}
        {litPath && <div data-room-edge className="absolute inset-0">{draw([roomEdgeLayer(litPath, k)])}</div>}
        {/* 이동 안내 줄: 진행 중이면 진한 지금 구간, 끝났으면 지나온 길 */}
        {legs.map((m) => (
          <div key={m.rowId} data-line={m.state === "pending" ? "now" : "done"} data-trace-leg={m.rowId} className="absolute inset-0">
            {draw(lineLayers(m.state === "pending" ? "route" : "routePassed", lineOf(m.path!), k))}
          </div>
        ))}
        {/* 목표 준비·사용자 자리 이탈 줄: 대상 위 고리와 미리 만든 계획의 길(준비됨은 흐림, 시작은 진함) */}
        {goalMark && planned.pre && planned.pre.route.length > 1 && (
          <div data-line="pre" className="absolute inset-0 transition-opacity duration-300" style={{ opacity: planned.pre.strong ? 1 : PRE_FADE }}>{draw(lineLayers("routeAhead", lineOf(planned.pre.route), k))}</div>
        )}
        {goalMark && <div data-goal-ring={goalMark.rowId} className="absolute inset-0">{draw(goalRingLayers(goalMark.px, k))}</div>}
        {frame.marks.map((m) => {
          // 상자 가장자리에 걸린 표시는 반쪽만 보이지 않게 흐리게 지운다
          const p = points.get(m.id);
          return (
            <div key={m.id} data-mark={m.id} className="absolute inset-0" style={{ opacity: p ? edgeFade(p, size, 9) : 1 }}>
              {draw(checkDotLayers(m.px, markTone(m.id), k))}
            </div>
          );
        })}
        {/* 근접 관찰 진행 중: 클로이드 원뿔에서 대상까지 선 */}
        {lookLines.map((m) => (
          <div key={m.rowId} data-trace-line={m.rowId} className="absolute inset-0">{draw(lineLayers("route", lineOf([frame.robot!.px, m.px]), k))}</div>
        ))}
        {tags.filter(({ m }) => m.kind !== "leg" && m.kind !== "goal").map(({ m }) => (
          <div key={m.rowId} data-trace-dot={m.rowId} className="absolute inset-0">{draw(checkDotLayers(m.px, "object", k))}</div>
        ))}
      </div>
      <div ref={marks} data-map-marks className="absolute inset-0">
        {labels.map((l) => (
          <div key={l.id} data-room={l.id} className="absolute -translate-x-1/2 -translate-y-1/2" style={{ left: l.at.x, top: l.at.y }}>
            <Status>{l.label}</Status>
          </div>
        ))}
        {tags.map(({ m, at }) => (
          <div key={m.rowId} data-trace-mark={m.rowId} data-kind={m.kind} data-state={m.state} className="absolute -translate-x-1/2 -translate-y-1/2" style={{ left: at.x, top: at.y }}>
            <Status variant={m.kind === "guard" ? "warning" : TAG_VARIANT[m.state]}>{m.text}</Status>
          </div>
        ))}
        <BubbleLayer checks={shownChecks} devices={devices} objects={objects} points={points} avoid={avoid} keep={keep} />
      </div>
    </div>
  );
}
