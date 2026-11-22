import { Fragment } from "react";
import { LineDrawSvg } from "../components/ui/line-draw-svg";
import { Status, StatusLabel } from "../components/ui/status";
import { toScreen, type Camera } from "./camera";
import type { BoxSize } from "./fit";
import type { TwinFrame } from "./frame";
import { avoidBoxes, LABEL, placeLabel, type Box } from "./labels";
import type { MapScene } from "./scene";
import { thingId } from "./checks";

/** 방 이름, 폰, 단계 번호와 설명, 확인 말풍선은 그대로 두고 새 이름표만 비킨다. */
export function SpatialRelations({ frame, cam, size, scene, blocked }: {
  frame: TwinFrame; cam: Camera; size: BoxSize; scene: MapScene; blocked: Box[];
}) {
  if (!frame.relations?.length || cam.scale <= 0) return null;
  const screen = (p: [number, number]) => toScreen(cam, size, p);
  const bubbleAt = scene.checks.flatMap(c => {
    const at = scene.points.get(thingId(c));
    return at ? [at] : [];
  });
  const avoid = [...blocked, ...avoidBoxes(bubbleAt, frame.planned.stops.map(s => screen(s.px)))];
  for (const r of scene.keep) avoid.push({ x0: r.left, y0: r.top, x1: r.right, y1: r.bottom });
  for (const { at } of scene.labels) avoid.push({
    x0: at.x - LABEL.w / 2, y0: at.y - LABEL.h / 2, x1: at.x + LABEL.w / 2, y1: at.y + LABEL.h / 2,
  });
  const step = frame.planned.step;
  if (step) {
    const p = screen(step.px);
    avoid.push({ x0: p.x + 12, y0: p.y - 16, x1: p.x + 32 + step.text.length * 13, y1: p.y + 16 });
  }
  if (frame.planned.person) {
    const p = screen(frame.planned.person.px);
    avoid.push({ x0: p.x - 80, y0: p.y - 32, x1: p.x + 80, y1: p.y });
  }
  return <>{frame.relations.map(relation => {
    const origin = screen(relation.px);
    if (origin.x < 0 || origin.y < 0 || origin.x > size.width || origin.y > size.height) return null;
    if (relation.id === "destination" && step?.text.includes(relation.label)) return null;
    const point = placeLabel({ x: origin.x, y: origin.y - 27 }, avoid, size);
    if (!point) return null;
    return <Fragment key={relation.id}>
      <LineDrawSvg width={size.width} height={size.height}
        path={`M ${origin.x} ${origin.y} L ${point.x} ${point.y}`} strokeWidth={2} tone="checkDotRing"
        className="absolute inset-0 h-full w-full" />
      <div data-relation-label={relation.id} className="absolute -translate-x-1/2 -translate-y-1/2"
        style={{ left: point.x, top: point.y, maxWidth: LABEL.w }}>
        <Status variant="brand" className="max-w-full"><StatusLabel className="truncate">{relation.label}</StatusLabel></Status>
      </div>
    </Fragment>;
  })}</>;
}
