// node.ts — 기록 노드: 기록 DB 줄·녹화(history.ts), 잘려 놓친 SENSOR 수를 1분마다 bus_gap 줄로. prepare까지 하고 start는 띄우는 곳이 부른다.
import { BusNode, TOPICS, realClock, type Bus, type Clock, type TopicName } from "../bus/index.js";
import type { HistoryDb } from "../brain/index.js";
import type { Bag } from "./bag.js";
import { historyRoutes } from "./history.js";

/** keepHeard: KEEP_HEARD_TEXT(들은 말 원문을 남김, 기본 꺼짐). */
export async function startRecorder(o: { bus: Bus; epoch: { boot: string; home: string }; db: HistoryDb; bag?: Bag; clock?: Clock; keepHeard?: boolean }): Promise<BusNode> {
  const clock = o.clock ?? realClock;
  const node = new BusNode({ name: "recorder", bus: o.bus, epoch: o.epoch, clock });
  o.db.forgetOtherBoots(o.epoch.boot);
  historyRoutes(node, o.db, { bag: o.bag, now: () => clock.now(), keepHeard: o.keepHeard });
  const sensors = (Object.keys(TOPICS) as TopicName[]).filter((t) => (TOPICS[t].qos as { kind: string; record?: boolean }).record);
  const told = new Map<TopicName, number>();
  node.every(60_000, () => {
    for (const t of sensors) {
      const n = node.lost(t) - (told.get(t) ?? 0);
      if (n <= 0) continue;
      o.db.add("bus_gap", clock.now(), `잘려 놓친 ${t} ${n}개`, { data: { topic: t, lost: n } });
      told.set(t, node.lost(t));
    }
  });
  await node.prepare();
  return node;
}
