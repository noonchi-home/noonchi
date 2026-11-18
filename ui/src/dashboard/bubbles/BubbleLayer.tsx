import { SHOW_SCORES } from "../dev";
import { CircleHelp, TriangleAlert } from "lucide-react";
import { useCallback, useLayoutEffect, useRef, useState } from "react";
import type { DeviceView } from "../../../../src/contract/events.ts";
import type { Check, CheckVerb } from "../checks/checks";
import { Avatar, AvatarFallback } from "../../components/ui/avatar";
import { Status, StatusIndicator } from "../../components/ui/status";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "../../components/ui/tooltip";
import { cn } from "../../lib/utils";
import type { ScreenPoint } from "../../twin";
import { ALIGN_EDGE, placeBubbles, type Box, type Placement, type Rect } from "./place";
import { deviceSummary, type Tone } from "./summary";

/** 번호 동그라미 색(21st.dev Avatar tone). 상태는 색만으로 말하지 않는다: 경고는 TriangleAlert, 모름은 CircleHelp를 번호 옆에 둔다. */
const ORDER: Record<Tone, "ok" | "off" | "error" | "warn"> = { on: "ok", off: "off", alert: "error", unknown: "warn" };
/** verb 칩(21st.dev Status variant). */
const VERB: Record<CheckVerb, "default" | "success" | "warning" | "error" | "brand"> = {
  확인: "default", 바꿈: "success", "승인 대기": "warning", 실패: "error", 취소: "default", 지켜봄: "brand",
};

/** 겹칠 때 위아래: 모름이 맨 아래, 경고가 그 위, 방금 다룬 기기가 맨 위. */
const LAYER: Record<Tone, string> = { unknown: "z-0", off: "z-10", on: "z-10", alert: "z-20" };

/** 말풍선 크기는 하나다: 디자인 시스템 전 크기(글 label, 번호 20px). 2026-11-08 사용자 결정. 방금 다룬 기기도 키우지 않고 테두리(focus)만 강조한다. */
const SIZE = "md";

/** 자리를 먼저 잡는 차례: 방금 다룬 기기 → 경고 → 켜짐·꺼짐 → 모름. */
const RANK: Record<Tone, number> = { alert: 1, on: 2, off: 2, unknown: 3 };

type Shown = { id: string; title: string; line?: string; tone?: Tone; order?: number };

function shownOf(c: Check, devices: Map<string, DeviceView>, objects: Map<string, string>): Shown | null {
  if (c.deviceId) {
    const d = devices.get(c.deviceId);
    if (!d) return null;
    const s = deviceSummary(d);
    return { id: d.id, title: s.title, line: s.line, tone: s.tone, order: c.order };
  }
  // 장면 이름이 없는 자리(폰 눈·World State 물건)는 그 자리 이름
  const name = c.label ?? (c.objectId ? objects.get(c.objectId) : undefined);
  if (!c.objectId || !name) return null;
  // 줄은 로봇이 믿는 상태(숫자 없음). 개발용 보기(?scores=1)에서만 YOLO 글(확신 숫자)을 보인다
  return { id: c.objectId, title: name, line: SHOW_SCORES ? c.note : c.belief };
}

/**
 * 말풍선 하나: 기기 자리(p)에 둔 0×0 상자. 판은 21st.dev Tooltip(화살표 끝이 기기 자리)이고, 상자 안(container)에 그려 상자와 함께 움직인다.
 * 늘 열어 두고 마우스를 받지 않는다.
 */
function Bubble({ s, verb, p, big, place, measure, onSize }: {
  s: Shown; verb: CheckVerb; p: ScreenPoint; big: boolean; place: Placement;
  measure: (el: HTMLElement) => Box; onSize: (id: string, box: Box) => void;
}) {
  const [box, setBox] = useState<HTMLDivElement | null>(null);
  const content = useRef<HTMLDivElement>(null);
  // 그린 판 크기를 알린다(자리 고르기에 쓴다)
  useLayoutEffect(() => { if (content.current) onSize(s.id, measure(content.current)); });
  return (
    <div
      ref={setBox}
      data-check={s.id}
      data-focus={big ? "true" : undefined}
      className={cn("pointer-events-none absolute h-0 w-0 transform-gpu", big ? "z-30" : s.tone ? LAYER[s.tone] : "z-10")}
      style={{ left: p.x, top: p.y }}
    >
      <Tooltip open>
        <TooltipTrigger asChild><span aria-hidden="true" className="block size-0" /></TooltipTrigger>
        {box && (
          <TooltipContent
            ref={content} container={box} side={place.side} align={place.align} alignOffset={place.align === "center" ? 0 : -ALIGN_EDGE} sideOffset={0}
            avoidCollisions={false} showArrow tone="twin" size={SIZE} focus={big}
            aria-label={[s.title, verb, s.line].filter(Boolean).join(" ")}
            className="pointer-events-none w-max max-w-none motion-reduce:animate-none"
          >
            <div className="flex items-center gap-1.5">
              {s.order !== undefined && s.tone ? (
                <>
                  <Avatar data-order size={SIZE}><AvatarFallback tone={ORDER[s.tone]}>{s.order}</AvatarFallback></Avatar>
                  {s.tone === "alert" && <TriangleAlert className="size-4 shrink-0" aria-hidden="true" />}
                  {s.tone === "unknown" && <CircleHelp className="size-4 shrink-0" aria-hidden="true" />}
                </>
              ) : (
                <Status variant="brand" aria-hidden="true"><StatusIndicator /></Status>
              )}
              <span>{s.title}</span>
              <Status variant={VERB[verb]}>{verb}</Status>
            </div>
            {s.line && <div data-line>{s.line}</div>}
          </TooltipContent>
        )}
      </Tooltip>
    </div>
  );
}

const naturalSize = (el: HTMLElement): Box => ({ w: el.offsetWidth, h: el.offsetHeight });
const relative = (r: DOMRect, o: DOMRect): Rect => ({ left: r.left - o.left, top: r.top - o.top, right: r.right - o.left, bottom: r.bottom - o.top });
const OPEN: Rect = { left: -Infinity, top: -Infinity, right: Infinity, bottom: Infinity };
const NONE: Rect[] = [];

/**
 * 에이전트가 판단하면서 확인한 기기·물건(checks)에만 말풍선을 띄운다. 화살표 끝이 points의 자리에 온다.
 * 기기 = 번호 + 이름 + verb + 지금 상태 한 줄, 물건(식탁) = 이름 + verb + 판정 요약.
 * 말풍선은 보기만 한다: 층과 말풍선 모두 마우스를 받지 않아 클릭·끌기가 3D 트윈으로 간다.
 * 말풍선끼리와 avoid(CSS 선택자)에 맞는 패널, keep(클로이드·목적지 표시 자리)을 비키고, 덮개(층의 부모) 안에 들게 판을 기기 위·아래·옆으로 옮긴다(place.ts).
 */
export function BubbleLayer({ checks, devices, objects = new Map(), points, focusId, avoid, keep = NONE, measure = naturalSize }: {
  checks: Check[];
  devices: Map<string, DeviceView>;
  /** 물건 id → 이름(식탁). */
  objects?: Map<string, string>;
  points: Map<string, ScreenPoint>;
  focusId?: string | null;
  /** 말풍선이 덮지 않을 패널(CSS 선택자). */
  avoid?: string;
  /** 말풍선이 덮지 않을 표시 자리(층 좌표: points와 같은 px). */
  keep?: Rect[];
  /** 말풍선 판 크기 재기(시험은 고정 크기를 넘긴다). */
  measure?: (el: HTMLElement) => Box;
}) {
  const layer = useRef<HTMLDivElement>(null);
  const [sizes, setSizes] = useState<Record<string, Box>>({});
  const onSize = useCallback((k: string, b: Box) => setSizes((old) => (old[k]?.w === b.w && old[k]?.h === b.h ? old : { ...old, [k]: b })), []);
  const [frame, setFrame] = useState<{ bounds: Rect; avoid: Rect[] }>({ bounds: OPEN, avoid: [] });
  const shown = checks.flatMap((c) => {
    const s = shownOf(c, devices, objects);
    const p = s && points.get(s.id);
    if (!s || !p?.visible) return [];
    return [{ c, s, p, big: c.deviceId !== undefined && c.deviceId === focusId }];
  });
  const order = [...shown].sort((a, b) => Number(b.big) - Number(a.big) || (a.s.tone ? RANK[a.s.tone] : 2) - (b.s.tone ? RANK[b.s.tone] : 2));
  const places = placeBubbles(order.map(({ s, p }) => ({ id: s.id, x: p.x, y: p.y, scale: 1, box: sizes[s.id] })), frame.bounds, [...frame.avoid, ...keep]);

  // 그린 뒤 덮개·패널 자리를 재고, 바뀌었으면 자리를 다시 고른다
  useLayoutEffect(() => {
    const el = layer.current;
    if (!el) return;
    const origin = el.getBoundingClientRect();
    const box = el.parentElement?.getBoundingClientRect();
    const bounds = box && box.width > 0 && box.height > 0 ? relative(box, origin) : OPEN;
    const panels = avoid ? [...el.ownerDocument.querySelectorAll(avoid)].map((p) => relative(p.getBoundingClientRect(), origin)).filter((r) => r.right > r.left && r.bottom > r.top) : [];
    const f = { bounds, avoid: panels };
    if (JSON.stringify(f) !== JSON.stringify(frame)) setFrame(f);
  });

  return (
    <TooltipProvider delayDuration={0}>
      <div ref={layer} className="pointer-events-none absolute left-0 top-0 h-0 w-0" aria-label="확인한 것">
        {shown.map(({ c, s, p, big }) => (
          <Bubble key={c.key} s={s} verb={c.verb} p={p} big={big} place={places.get(s.id)!} measure={measure} onSize={onSize} />
        ))}
      </div>
    </TooltipProvider>
  );
}
