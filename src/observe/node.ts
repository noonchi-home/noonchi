// node.ts — 인식 노드(stage-queue 묶음 2): 관찰 흐름(src/observe/pipeline.ts)이 World State에 넣을 것을 /perception/scene 하나로 차례대로 낸다(사진 없음).
// 입력은 낸 차례대로 하나씩 보낸다: 발행이 실패하면 같은 봉투(같은 메시지 id)로 RETRY_MS 뒤 다시 보내고, 성공하기 전에는 뒤 입력을 붙잡아 둔다
// (frame·closer_merge 없이 뒤의 VLM 답만 가지 않는다). 미니맵 물체 모양은 /perception/detections로 낸다(가장 새 것만 보면 되어 다시 보내지 않는다). 가까이 보기의 찾은 물건 id는 /world/closer 답을 look으로 맞춘다:
// closer_merge를 낼 때 기다림을 열고, VLM 답(closer_scene·closer_end)을 낸 뒤 기한(CLOSER_WAIT_MS)이 지나면 timeout, 노드를 끝내면 closed로 끝낸다.
// 가까이 보기 대상 고르기·위에서 보기 쌍 찾기는 자기 /world/state 구독의 가장 새 보기를 읽는다.
import { BusNode, RETRY_MS, realClock, type Bus, type Clock, type Envelope } from "../bus/index.js";
import type { SeenEvent } from "../contract/events.js";
import type { SceneInput, WorldView } from "../contract/world.js";
import type { WorldPort } from "./pipeline.js";

/** VLM 답을 낸 뒤 /world/closer 답을 기다리는 시간(ms). */
export const CLOSER_WAIT_MS = 2000;

type Ids = Map<string, string> | "timeout" | "closed";
type Wait = { done: Promise<Ids>; resolve: (v: Ids) => void; timer: (() => void) | null; settled: boolean };

export interface PerceptionNode {
  node: BusNode;
  /** 관찰 흐름에 넘기는 World State 길. */
  port: WorldPort;
  /** 미니맵 물체 모양 하나를 /perception/detections로 낸다(근거 시각은 촬영 시각). */
  seen(e: SeenEvent): void;
}

/** 인식 노드를 준비한다(구독까지, 시작은 띄우는 곳이 모든 노드를 준비한 뒤). */
export async function startPerceptionNode(o: { bus: Bus; epoch: { boot: string; home: string }; clock?: Clock; log?: (s: string) => void; closerWaitMs?: number }): Promise<PerceptionNode> {
  const clock = o.clock ?? realClock;
  const log = o.log ?? ((s: string) => console.error(s));
  const waitMs = o.closerWaitMs ?? CLOSER_WAIT_MS;
  const node = new BusNode({ name: "perception", bus: o.bus, epoch: o.epoch, clock, log });
  let latest: WorldView | null = null;
  const waits = new Map<string, Wait>();
  const finish = (look: string, v: Ids) => {
    const w = waits.get(look);
    if (!w || w.settled) return;
    w.settled = true;
    w.timer?.();
    w.resolve(v);
  };
  /** look 하나의 답 기다림을 연다. 노드 수명에 묶여(spawn) 끝내면 closed로 끝나고, 끝내기가 기다리지 않는다. */
  const open = (look: string) => {
    const w: Wait = { done: Promise.resolve("closed"), resolve: () => {}, timer: null, settled: false };
    w.done = node.spawn((signal) => new Promise<Ids>((resolve) => {
      w.resolve = resolve;
      if (signal.aborted) return resolve("closed");
      signal.addEventListener("abort", () => finish(look, "closed"), { once: true });
    })).catch((): Ids => "closed");
    waits.set(look, w);
  };
  node.on("/world/state", (b) => { latest = b.view; });
  node.on("/world/closer", (b) => { finish(b.look, new Map(Object.entries(b.ids))); });
  const publish = (what: string, p: Promise<void>) => { p.catch((e: Error) => log(`[인식] ${what} 발행 실패: ${e.message}`)); };
  /** 보낼 입력 봉투(낸 차례). 앞 것이 나가야 뒤 것을 보낸다. */
  const outbox: Envelope<"/perception/scene">[] = [];
  let pumping = false;
  const pump = async () => {
    if (pumping) return;
    pumping = true;
    try {
      while (outbox.length) {
        try {
          await node.send(outbox[0]!);
          outbox.shift();
        } catch (e) {
          if (closed) { outbox.length = 0; return; }
          log(`[인식] /perception/scene ${outbox[0]!.body.kind} 발행 실패, 다시 보내요: ${(e as Error).message}`);
          await new Promise<void>((r) => { clock.after(RETRY_MS, r); });
        }
      }
    } finally {
      pumping = false;
    }
  };
  let closed = false;
  node.spawn((signal) => new Promise<void>((r) => { signal.addEventListener("abort", () => { closed = true; r(); }, { once: true }); }));
  const port: WorldPort = {
    send: (i: SceneInput) => {
      if (i.kind === "closer_merge") open(i.look);
      if (i.kind === "closer_scene" || i.kind === "closer_end") {
        const w = waits.get(i.look);
        if (w && !w.settled && !w.timer) w.timer = clock.after(waitMs, () => finish(i.look, "timeout"));
      }
      try {
        outbox.push(node.envelope("/perception/scene", i));
      } catch (e) {
        return log(`[인식] /perception/scene ${i.kind}를 낼 수 없어요: ${(e as Error).message}`);
      }
      void pump();
    },
    closerIds: (look) => {
      const w = waits.get(look);
      if (!w) return Promise.resolve("closed");
      return w.done.finally(() => waits.delete(look));
    },
    view: () => latest,
  };
  await node.prepare();
  return {
    node, port,
    seen: (e) => publish("/perception/detections", node.publish("/perception/detections", { observed_ms: e.captured_at_ms, frame_id: e.frame_id, frame: e.frame, shapes: e.shapes })),
  };
}
