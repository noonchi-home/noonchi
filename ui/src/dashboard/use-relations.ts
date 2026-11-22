import { useEffect, useMemo, useReducer } from "react";
import type { WorldView } from "../../../src/contract/world";
import { FACT_FRESH_MS } from "../../../src/world/vocab";
import type { DashData } from "./data";
import { relationsOf, type RelationGraphData } from "./relations";

const empty: RelationGraphData = { nodes: [], edges: [], anchors: [] };

/** 새 메시지가 없어도 마지막 근거의 유효 시간이 지나면 그래프와 공간 표지를 함께 갱신한다. */
export function useRelations(dash: DashData, world: WorldView | null, names: ReadonlyMap<string, string> | undefined, connected: boolean, fixedMs?: number) {
  const [version, refresh] = useReducer((v: number) => v + 1, 0);
  const { plan, decision, goal } = dash;
  const result = useMemo(() => {
    if (!connected) return { graph: empty, until: Infinity };
    const now = fixedMs ?? Date.now();
    const graph = relationsOf({ plan, decision, goal }, world, now, names);
    const dates = [decision?.at_ms, world?.eye?.at_ms, ...(world?.objects.map(o => o.last_seen_ms) ?? [])];
    let until = Infinity;
    for (const stamp of dates) {
      if (stamp === undefined) continue;
      const expires = stamp + FACT_FRESH_MS + 1;
      if (expires > now) until = Math.min(until, expires);
    }
    return { graph, until };
  }, [plan, decision, goal, world, names, connected, fixedMs, version]);
  useEffect(() => {
    if (fixedMs !== undefined || !Number.isFinite(result.until)) return;
    const timer = setTimeout(refresh, Math.max(0, result.until - Date.now()));
    return () => clearTimeout(timer);
  }, [result.until, fixedMs]);
  return result.graph;
}
