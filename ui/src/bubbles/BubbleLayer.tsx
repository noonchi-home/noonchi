import { CircleHelp, TriangleAlert } from "lucide-react";
import { useState } from "react";
import type { DeviceView } from "../../../src/contract/events.ts";
import type { Check, CheckVerb } from "../checks/checks";
import { Avatar, AvatarFallback } from "../components/ui/avatar";
import { Status, StatusIndicator } from "../components/ui/status";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "../components/ui/tooltip";
import { cn } from "../lib/utils";
import type { ScreenPoint } from "../twin/use-anchors";
import { deviceSummary, type Tone } from "./summary";

/** 번호 동그라미 색(21st.dev Avatar tone). 상태는 색만으로 말하지 않는다: 경고는 TriangleAlert, 모름은 CircleHelp를 번호 옆에 둔다. */
const ORDER: Record<Tone, "ok" | "off" | "error" | "warn"> = { on: "ok", off: "off", alert: "error", unknown: "warn" };
/** verb 칩(21st.dev Status variant). */
const VERB: Record<CheckVerb, "default" | "success" | "warning" | "error" | "brand"> = {
  확인: "default", 바꿈: "success", "승인 대기": "warning", 실패: "error", 취소: "default", 지켜봄: "brand",
};

/** 겹칠 때 위아래: 모름이 맨 아래, 경고가 그 위, 방금 다룬 기기가 맨 위. */
const LAYER: Record<Tone, string> = { unknown: "z-0", off: "z-10", on: "z-10", alert: "z-20" };

/** 말풍선 크기: md는 작은 화면, lg는 트윈이 큰 화면(대시보드). */
export type BubbleSize = "md" | "lg";

type Shown = { id: string; title: string; line?: string; tone?: Tone; order?: number };

function shownOf(c: Check, devices: Map<string, DeviceView>, objects: Map<string, string>): Shown | null {
  if (c.deviceId) {
    const d = devices.get(c.deviceId);
    if (!d) return null;
    const s = deviceSummary(d);
    return { id: d.id, title: s.title, line: s.line, tone: s.tone, order: c.order };
  }
  const name = c.objectId ? objects.get(c.objectId) : undefined;
  if (!c.objectId || !name) return null;
  return { id: c.objectId, title: name, line: c.note };
}

/**
 * 말풍선 하나: 기기 자리(p)에 둔 0×0 상자. 판은 21st.dev Tooltip(화살표 끝이 기기 자리)이고, 상자 안(container)에 그려 상자와 함께 움직인다.
 * 늘 열어 두고 마우스를 받지 않는다.
 */
function Bubble({ s, verb, p, big, size }: { s: Shown; verb: CheckVerb; p: ScreenPoint; big: boolean; size: BubbleSize }) {
  const [box, setBox] = useState<HTMLDivElement | null>(null);
  return (
    <div
      ref={setBox}
      data-check={s.id}
      data-focus={big ? "true" : undefined}
      className={cn("pointer-events-none absolute h-0 w-0 transform-gpu", big ? "z-30 scale-125" : s.tone ? LAYER[s.tone] : "z-10")}
      style={{ left: p.x, top: p.y }}
    >
      <Tooltip open>
        <TooltipTrigger asChild><span aria-hidden="true" className="block size-0" /></TooltipTrigger>
        {box && (
          <TooltipContent
            container={box} side="top" sideOffset={0} avoidCollisions={false} showArrow tone="twin" size={size} focus={big}
            aria-label={[s.title, verb, s.line].filter(Boolean).join(" ")}
            className="pointer-events-none w-max max-w-none motion-reduce:animate-none"
          >
            <div className="flex items-center gap-1.5">
              {s.order !== undefined && s.tone ? (
                <>
                  <Avatar data-order size={size}><AvatarFallback tone={ORDER[s.tone]}>{s.order}</AvatarFallback></Avatar>
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

/**
 * 에이전트가 판단하면서 확인한 기기·물건(checks)에만 말풍선을 띄운다. 화살표 끝이 points의 자리에 온다.
 * 기기 = 번호 + 이름 + verb + 지금 상태 한 줄, 물건(식탁) = 이름 + verb + 판정 요약.
 * 말풍선은 보기만 한다: 층과 말풍선 모두 마우스를 받지 않아 클릭·끌기가 3D 트윈으로 간다.
 */
export function BubbleLayer({ checks, devices, objects = new Map(), points, focusId, size = "md" }: {
  checks: Check[];
  devices: Map<string, DeviceView>;
  /** 물건 id → 이름(식탁). */
  objects?: Map<string, string>;
  points: Map<string, ScreenPoint>;
  focusId?: string | null;
  size?: BubbleSize;
}) {
  return (
    <TooltipProvider delayDuration={0}>
      <div className="pointer-events-none absolute left-0 top-0 h-0 w-0" aria-label="확인한 것">
        {checks.map((c) => {
          const s = shownOf(c, devices, objects);
          const p = s && points.get(s.id);
          if (!s || !p?.visible) return null;
          const big = c.deviceId !== undefined && c.deviceId === focusId;
          return <Bubble key={c.key} s={s} verb={c.verb} p={p} big={big} size={size} />;
        })}
      </div>
    </TooltipProvider>
  );
}
