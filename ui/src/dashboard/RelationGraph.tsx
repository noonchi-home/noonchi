import { useLayoutEffect, useRef, useState } from "react";
import { LineDrawSvg } from "../components/ui/line-draw-svg";
import { Status, StatusIndicator, StatusLabel } from "../components/ui/status";
import type { RelationGraphData, RelationNode } from "./relations";
import { WORDS } from "./words";

/** 왼쪽은 관찰·대상, 오른쪽은 실행 단계·목적지. 같은 편에 한 점만 있으면 가운데 둔다. */
function positions(nodes: RelationNode[]) {
  const result = new Map<RelationNode["id"], [number, number]>();
  const left = nodes.filter(n => n.id === "observation" || n.id === "target");
  const right = nodes.filter(n => n.id === "step" || n.id === "destination");
  const both = left.length > 0 && right.length > 0;
  result.set("focus", [both || (!left.length && !right.length) ? 0.5 : left.length ? 0.73 : 0.27, 0.50]);
  for (const column of [left, right]) {
    const x = column === left ? (both ? 0.16 : 0.28) : (both ? 0.84 : 0.73);
    column.forEach((node, i) => result.set(node.id, [x, column.length === 1 ? 0.50 : i === 0 ? 0.24 : 0.76]));
  }
  return result;
}

export function RelationGraph({ graph }: { graph: RelationGraphData }) {
  const container = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 360, height: 138 });
  const empty = graph.nodes.length === 0;
  useLayoutEffect(() => {
    const el = container.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const resize = new ResizeObserver(([entry]) => {
      if (entry && entry.contentRect.width > 0 && entry.contentRect.height > 0) {
        setSize({ width: entry.contentRect.width, height: entry.contentRect.height });
      }
    });
    resize.observe(el);
    return () => resize.disconnect();
  }, [empty]);
  if (empty) {
    return <div className="flex h-full min-h-16 items-center justify-center"><Status><StatusIndicator/><StatusLabel>{WORDS.waiting}</StatusLabel></Status></div>;
  }
  const points = positions(graph.nodes);
  const text = (id: RelationNode["id"]) => {
    const node = graph.nodes.find(n => n.id === id)!;
    return `${node.role} ${node.label}`;
  };
  const summary = graph.edges.length ? graph.edges.map(e => `${text(e.from)}, ${text(e.to)}`).join(". ") : text("focus");
  return (
    <div ref={container} role="img" aria-label={summary} className="relative h-full min-h-24 w-full overflow-hidden">
      {graph.edges.map(edge => {
        const [x, y] = points.get(edge.from)!;
        const [u, v] = points.get(edge.to)!;
        const path = `M ${x * size.width} ${y * size.height} L ${u * size.width} ${v * size.height}`;
        return <LineDrawSvg key={edge.from + edge.to} path={path} width={size.width} height={size.height}
          tone="routeAheadEdge" strokeWidth={1.5} className="pointer-events-none absolute inset-0 h-full w-full" />;
      })}
      {graph.nodes.map(node => {
        const [x, y] = points.get(node.id)!;
        return <div key={node.id} className="absolute flex max-w-[32%] -translate-x-1/2 -translate-y-1/2 justify-center"
          style={{ left: `${x * 100}%`, top: `${y * 100}%` }} title={text(node.id)}>
          <Status variant={node.id === "focus" ? "brand" : "default"} className="min-w-0 max-w-full">
            <StatusIndicator/><StatusLabel className="truncate">{node.label}</StatusLabel>
          </Status>
        </div>;
      })}
    </div>
  );
}
