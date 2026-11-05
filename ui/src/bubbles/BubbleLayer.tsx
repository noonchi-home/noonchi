import type { DeviceView } from "../../../src/contract/events.ts";
import { cn } from "../lib/utils";
import { Surface } from "../look/Surface";
import type { ScreenPoint } from "../twin/use-anchors";
import { deviceSummary, type Tone } from "./summary";

/** 상태 점과 글 색. 테두리는 실선만 쓴다(점선 금지). */
const DOT: Record<Tone, string> = { on: "bg-green", off: "bg-ink-3", alert: "bg-red", unknown: "bg-orange" };
const LINE: Record<Tone, string> = { on: "text-ink-2", off: "text-ink-3", alert: "text-red", unknown: "text-ink-3" };
const RING: Record<Tone, string> = { on: "", off: "", alert: "ring-1 ring-red", unknown: "" };

/** 겹칠 때 위아래: 모름이 맨 아래, 경고가 그 위, 방금 다룬 기기가 맨 위(마우스를 올린 말풍선은 그보다 위). */
const LAYER: Record<Tone, string> = { unknown: "z-0", off: "z-10", on: "z-10", alert: "z-20" };

/**
 * 모든 기기 위에 상태 말풍선을 항상 띄운다. 꼬리 끝이 points의 기기 자리에 온다(밝은 심 + 어두운 테두리라 바닥 밝기와 상관없이 보인다).
 * 말풍선 판은 모양마다 다르다: 부품 모양은 흰 카드, 유리 모양은 Liquid Glass(Surface).
 * 층은 크기가 0이라 빈 곳의 마우스는 3D로 가고, 말풍선만 마우스를 받는다(꺼진 기기는 올리면 상태가 펼쳐진다).
 */
export function BubbleLayer({ devices, points, focusId }: { devices: Map<string, DeviceView>; points: Map<string, ScreenPoint>; focusId?: string | null }) {
  return (
    <div className="absolute left-0 top-0 h-0 w-0" aria-label="가전 상태">
      {[...devices.values()].map((d) => {
        const p = points.get(d.id);
        if (!p?.visible) return null;
        const s = deviceSummary(d);
        const big = d.id === focusId;
        return (
          <div
            key={d.id}
            data-device={d.id}
            data-focus={big ? "true" : undefined}
            className={cn("group pointer-events-auto absolute w-max -translate-x-1/2 -translate-y-full hover:z-40", big ? "z-30" : LAYER[s.tone])}
            style={{ left: p.x, top: p.y }}
          >
            <Surface kind="bubble" className={cn("origin-bottom px-2 py-1 text-xs leading-tight text-ink transition-transform", RING[s.tone], big && "scale-125")}>
              <div className="flex items-center gap-1.5 font-medium">
                <span aria-hidden="true" className={cn("size-1.5 shrink-0 rounded-full", DOT[s.tone])} />
                {s.title}
              </div>
              <div className={cn("font-normal", LINE[s.tone], s.tone === "off" && !big && "hidden group-hover:block")}>{s.line}</div>
            </Surface>
            <div className="mx-auto h-2.5 w-0.5 rounded-full bg-white ring-1 ring-ink/50" />
          </div>
        );
      })}
    </div>
  );
}
