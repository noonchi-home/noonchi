import type { DeviceView } from "../../../src/contract/events.ts";
import type { Check, CheckVerb } from "../checks/checks";
import { cn } from "../lib/utils";
import { Surface } from "../look/Surface";
import type { ScreenPoint } from "../twin/use-anchors";
import { deviceSummary, type Tone } from "./summary";

/** 번호 동그라미와 상태 글 색. 테두리는 실선만 쓴다(점선 금지). */
const ORDER: Record<Tone, string> = { on: "bg-green", off: "bg-ink-3", alert: "bg-red", unknown: "bg-orange" };
const LINE: Record<Tone, string> = { on: "text-ink-2", off: "text-ink-3", alert: "text-red", unknown: "text-ink-3" };
const RING: Record<Tone, string> = { on: "", off: "", alert: "ring-1 ring-red", unknown: "" };
const VERB: Record<CheckVerb, string> = {
  확인: "text-ink-2", 바꿈: "text-green", "승인 대기": "text-orange", 실패: "text-red", 취소: "text-ink-3", 지켜봄: "text-accent",
};

/** 겹칠 때 위아래: 모름이 맨 아래, 경고가 그 위, 방금 다룬 기기가 맨 위. */
const LAYER: Record<Tone, string> = { unknown: "z-0", off: "z-10", on: "z-10", alert: "z-20" };

type Shown = { id: string; title: string; line?: string; lineClass: string; tone?: Tone; order?: number };

function shownOf(c: Check, devices: Map<string, DeviceView>, objects: Map<string, string>): Shown | null {
  if (c.deviceId) {
    const d = devices.get(c.deviceId);
    if (!d) return null;
    const s = deviceSummary(d);
    return { id: d.id, title: s.title, line: s.line, lineClass: LINE[s.tone], tone: s.tone, order: c.order };
  }
  const name = c.objectId ? objects.get(c.objectId) : undefined;
  if (!c.objectId || !name) return null;
  return { id: c.objectId, title: name, line: c.note, lineClass: "text-ink-2" };
}

/**
 * 에이전트가 판단하면서 확인한 기기·물건(checks)에만 말풍선을 띄운다. 꼬리 끝이 points의 자리에 온다(밝은 심 + 어두운 테두리라 바닥 밝기와 상관없이 보인다).
 * 기기 = 번호 + 이름 + verb + 지금 상태 한 줄, 물건(식탁) = 이름 + verb + 판정 요약.
 * 말풍선 판은 모양마다 다르다: 부품 모양은 흰 카드, 유리 모양은 Liquid Glass(Surface).
 * 말풍선은 보기만 한다: 층과 말풍선 모두 마우스를 받지 않아 클릭·끌기가 3D 트윈으로 간다.
 */
export function BubbleLayer({ checks, devices, objects = new Map(), points, focusId }: {
  checks: Check[];
  devices: Map<string, DeviceView>;
  /** 물건 id → 이름(식탁). */
  objects?: Map<string, string>;
  points: Map<string, ScreenPoint>;
  focusId?: string | null;
}) {
  return (
    <div className="pointer-events-none absolute left-0 top-0 h-0 w-0" aria-label="확인한 것">
      {checks.map((c) => {
        const s = shownOf(c, devices, objects);
        const p = s && points.get(s.id);
        if (!s || !p?.visible) return null;
        const big = c.deviceId !== undefined && c.deviceId === focusId;
        return (
          <div
            key={c.key}
            data-check={s.id}
            data-focus={big ? "true" : undefined}
            className={cn("pointer-events-none absolute w-max -translate-x-1/2 -translate-y-full", big ? "z-30" : s.tone ? LAYER[s.tone] : "z-10")}
            style={{ left: p.x, top: p.y }}
          >
            <Surface kind="bubble" className={cn("origin-bottom px-2 py-1 text-xs leading-tight text-ink transition-transform", s.tone && RING[s.tone], big && "scale-125")}>
              <div className="flex items-center gap-1.5 font-medium">
                {s.order !== undefined && s.tone ? (
                  <span data-order className={cn("grid size-4 shrink-0 place-items-center rounded-full text-[10px] font-semibold text-white", ORDER[s.tone])}>{s.order}</span>
                ) : (
                  <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-accent" />
                )}
                {s.title}
                <span className={cn("font-normal", VERB[c.verb])}>{c.verb}</span>
              </div>
              {s.line && <div className={cn("font-normal", s.lineClass)}>{s.line}</div>}
            </Surface>
            <div className="mx-auto h-2.5 w-0.5 rounded-full bg-white ring-1 ring-ink/50" />
          </div>
        );
      })}
    </div>
  );
}
