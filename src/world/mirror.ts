// mirror.ts — 거울(stage-queue 묶음 2): 집 상태 노드가 낸 /world/state(STATE)·/world/changes(RELIABLE)를 받아 읽는 쪽에 준다.
// view()는 가장 새 보기다(250ms 다시 냄 포함, 지금보다 최대 250ms + 지나는 시간 늦다). 변화는 그 판본 이상의 상태를 가진 뒤에 onChanges로 온다(withState).
// onView는 판본(rev)이 바뀔 때만 부른다: 대시보드 방송이 지금보다 늘지 않는다(250ms 다시 냄은 부르지 않음).
import { BusNode, type Bus, type Clock, type NodeName } from "../bus/index.js";
import type { WorldChange, WorldStateMsg, WorldView } from "../contract/world.js";

export interface WorldMirror {
  node: BusNode;
  /** 가장 새 보기(아직 상태를 못 받았으면 null). */
  view(): WorldView | null;
  /** 가장 새 판본(아직 상태를 못 받았으면 null). */
  rev(): number | null;
}

/** 거울을 준비한다(구독까지, 시작은 띄우는 곳이 모든 노드를 준비한 뒤). name은 /world/changes를 받는 그룹 이름이다. */
export async function startWorldMirror(o: {
  bus: Bus; epoch: { boot: string; home: string }; name: NodeName; clock?: Clock; log?: (s: string) => void;
  onChanges?: (changes: WorldChange[], view: WorldView) => void | Promise<void>;
  onView?: (view: WorldView) => void | Promise<void>;
}): Promise<WorldMirror> {
  const node = new BusNode({ name: o.name, bus: o.bus, epoch: o.epoch, clock: o.clock, log: o.log });
  let latest: WorldStateMsg | null = null;
  let shown: number | null = null;
  node.withState("/world/changes", "/world/state",
    (c, s) => o.onChanges?.(c.changes, s.view),
    async (s) => {
      latest = s;
      if (s.rev === shown) return;
      await o.onView?.(s.view);
      shown = s.rev;   // 보인 뒤에만 센다: 실패하면 같은 rev가 다시 올 때(250ms 다시 냄) 다시 부른다
    });
  await node.prepare();
  return { node, view: () => latest?.view ?? null, rev: () => latest?.rev ?? null };
}
