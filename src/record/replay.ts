// replay.ts — 격리 재생(rosbag2 재생처럼, 시뮬레이션 시계): 새 MemoryBus·가상 시계 위에 launch가 띄운 노드(가전은 dry-run)로,
// 허용 목록의 바깥 입력 토픽만 녹화의 도착 차례대로 흘린다. 메시지마다 가상 시계를 그 도착 시각까지 당기며 타이머를 하나씩 돌리고
// (타이머마다 장벽), 발행한 뒤 다시 장벽을 지난다. 통로의 다시 주기도 가상 시계로 돈다. 마지막 메시지 뒤에는 다시 주기가 다 끝나게 시계를 더 당긴다.
// 실패해도 노드를 끝내고 통로를 닫는다. 실제 통로(Redis)에는 아무것도 보내지 않는다.
import { MAX_DELIVERIES, MemoryBus, RETRY_MS, VirtualClock, type BusNode, type TopicName } from "../bus/index.js";
import type { Bag } from "./bag.js";

export const REPLAY_INPUTS: readonly TopicName[] = [
  "/perception/detections", "/perception/analysis", "/perception/scene", "/perception/look_result", "/phone/pose", "/phone/heard", "/phone/progress", "/device/changes",
];

/** 처리 장벽: 모든 노드의 줄이 비고 통로에 예약된 배달이 없는 상태가 두 번 이어질 때까지 기다린다(이어지는 발행이 몇 단계여도). */
export async function settle(bus: MemoryBus, nodes: readonly BusNode[], maxRounds = 10_000): Promise<void> {
  for (let calm = 0, round = 0; calm < 2; round++) {
    if (round > maxRounds) throw new Error("재생 장벽: 노드가 멈추지 않아요");
    await Promise.all(nodes.map((n) => n.idle()));
    await new Promise((r) => setImmediate(r));
    calm = bus.quiet() && nodes.every((n) => !n.busy()) ? calm + 1 : 0;
  }
}

export async function replay(o: { bag: Bag; from: number; to: number; launch: (bus: MemoryBus, clock: VirtualClock) => Promise<BusNode[]>; topics?: readonly TopicName[] }): Promise<{ sent: number }> {
  const rows = o.bag.range(o.from, o.to, { topics: o.topics ?? REPLAY_INPUTS });
  const clock = new VirtualClock(rows[0]?.arrivalMs ?? o.from);
  const bus = new MemoryBus({ warn: () => {}, clock });
  let nodes: BusNode[] = [];
  try {
    nodes = await o.launch(bus, clock);
    for (const n of nodes) await n.prepare();
    for (const n of nodes) n.start();
    const barrier = () => settle(bus, nodes);
    for (const { e, arrivalMs } of rows) {
      await clock.advanceTo(arrivalMs, barrier);
      await barrier();
      await bus.publish(e);
      await barrier();
    }
    await clock.advanceTo(clock.now() + RETRY_MS * MAX_DELIVERIES, barrier);
    return { sent: rows.length };
  } finally {
    for (const n of nodes) await n.stop().catch(() => {});
    await bus.close();
  }
}
