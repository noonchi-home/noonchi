// 관찰 흐름 시험 대역: World State를 바로 부르는 WorldPort.
// 넣는 일은 집 상태 노드와 같은 WorldInputs가 하고(같은 차례, 같은 감지 번호 표·가까이 보기 표), 변화는 통로 전 관찰 흐름처럼
// world_change 기록(emit, 프레임마다 분석 없음 빼고)·onChanges·broadcastWorld로 바로 넘긴다. 가까이 보기 답은 VLM 합치기 뒤의 최종 표다.
import type { BrainLog } from "../../src/contract/events.js";
import type { WorldChange, WorldView } from "../../src/contract/world.js";
import { ObservationPipeline, type PipelineOptions, type WorldPort } from "../../src/observe/pipeline.js";
import { WorldInputs, type WorldState } from "../../src/world/index.js";
import { TOPICS } from "../../src/bus/index.js";

const PER_FRAME = new Set(["vlm_missing", "yolo_missing"]);

export function directPort(world: WorldState, o: {
  emit?: (l: BrainLog) => void; broadcastWorld?: (w: WorldView) => void; onChanges?: (c: WorldChange[]) => void; now?: () => number;
} = {}): WorldPort & { inputs: WorldInputs } {
  const now = o.now ?? (() => Date.now());
  const inputs = new WorldInputs(world, now);
  const closers = new Map<string, Map<string, string>>();
  return {
    inputs,
    send(i) {
      // 통로와 같은 몸 검사(strict): 모양이 어긋나면 통로에서는 입력이 버려지므로 시험에서는 던진다
      TOPICS["/perception/scene"].body.parse(i);
      const r = inputs.scene(i);
      if (r.closer) closers.set(r.closer.look, r.closer.ids);
      if (!r.changes.length) return;
      for (const c of r.changes) if (!PER_FRAME.has(c.kind)) o.emit?.({ type: "world_change", at_ms: now(), kind: c.kind, text: c.text });
      o.onChanges?.(r.changes);
      o.broadcastWorld?.(world.view(now()));
    },
    closerIds: async (look) => {
      const ids = closers.get(look);
      closers.delete(look);
      return ids ?? "closed";
    },
    view: () => world.view(now()),
  };
}

/** 통로 전 모양(World State를 바로 넘기고 broadcastWorld·onChanges를 받음)으로 관찰 흐름을 만든다: directPort로 잇는다. */
export function pipelineOn(o: Omit<PipelineOptions, "world"> & { world: WorldState; broadcastWorld?: (w: WorldView) => void; onChanges?: (c: WorldChange[]) => void }): ObservationPipeline {
  const { world, broadcastWorld, onChanges, ...rest } = o;
  const clock = rest.clock ?? { now: () => Date.now() };
  return new ObservationPipeline({ ...rest, world: directPort(world, { emit: rest.emit, broadcastWorld, onChanges, now: () => clock.now() }) });
}
