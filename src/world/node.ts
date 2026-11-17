// node.ts — 집 상태 노드(stage-queue 묶음 2): World State를 바꾸는 곳은 이 노드 하나다. 입력은 노드 줄에 들어온 차례대로 하나씩 넣는다.
// 받는 것: /perception/scene(VLM 답, 집 상태 입력의 주인), /world/input(실행 추적의 지킴·따르기 창), /phone/heard(들은 말), /device/changes(가전 상태).
// 변화가 있으면 rev를 1 올리고 /world/state {rev, view}와 /world/changes {rev, changes}를 이 차례로 함께 낸다(대시보드는 한 번 지나기로 받는다).
// 변화 없이 보기만 바뀌는 입력(지킴·따르기 창·가전 상태)은 같은 rev로 상태만 다시 낸다. 250ms마다 tick을 넣고 같은 rev로 상태를 다시 낸다.
// 가까이 보기는 VLM 답(closer_scene·closer_end)을 넣은 뒤 /world/closer {look, ids}로 VLM 합치기 뒤의 최종 id 표를 답한다.
import { BusNode, realClock, type Bus, type Clock } from "../bus/index.js";
import type { EyePose } from "../contract/events.js";
import type { Detection, FrameMeta, Pose } from "../contract/observe.js";
import type { VlmMissing, WorldChange, YoloMissing } from "../contract/world.js";
import type { CloserPending } from "./state/closer.js";
import type { CloserPass, WorldState } from "./state/world.js";

/** 상태를 다시 내는 간격(ms, 지금 판단 타이머와 같다). */
export const WORLD_TICK_MS = 250;
/** 감지 번호 표·가까이 보기 표를 넣은 지 이만큼(ms) 지나도 VLM 답이 오지 않으면 지운다. */
const KEEP_MS = 30_000;

/** VLM 전용으로 바뀔 자리: 지금 YOLO가 World State를 바꾸는 네 곳을 토픽 대신 이 노드 줄에 넣는다(feat/vlm-objects를 합치면 쓰러짐 신호 하나만 남는다).
 *  돌려주는 값이 없다: 노드를 끝내면 줄에 남은 입력은 버리고, 끝내기가 기다릴 것이 없다. */
export interface WorldBridge {
  eye(eye: EyePose | null, atMs: number): void;
  /** 한 프레임의 감지. VLM 프레임(vlm이 false가 아님)이면 감지 번호 표를 그 VLM 답까지 둔다. */
  frame(frame: FrameMeta, dets: Detection[], poses?: Pose[]): void;
  missing(frameId: string, capturedAtMs: number, m: { yolo?: YoloMissing; vlm?: VlmMissing }): void;
  /** 잘라 본 장의 YOLO 합치기. look마다 감지 번호 표와 VLM 답을 기다리는 후보를 둔다. */
  closer(look: string, looks: readonly CloserPass[], from: string): void;
}

export interface WorldNode { node: BusNode; bridge: WorldBridge }

/** 집 상태 노드를 준비한다(구독·첫 상태 rev 0 발행까지, 시작은 띄우는 곳이 모든 노드를 준비한 뒤). */
export async function startWorldNode(o: { bus: Bus; epoch: { boot: string; home: string }; world: WorldState; clock?: Clock; tickMs?: number; log?: (s: string) => void }): Promise<WorldNode> {
  const { world } = o;
  const clock = o.clock ?? realClock;
  const node = new BusNode({ name: "world", bus: o.bus, epoch: o.epoch, clock, log: o.log });
  let rev = 0;
  const idsOf = new Map<string, { at: number; ids: Map<string, string> }>();
  const looks = new Map<string, { at: number; ids: Map<string, string>; pending?: CloserPending }>();
  const prune = () => {
    const old = clock.now() - KEEP_MS;
    for (const table of [idsOf, looks]) for (const [k, v] of table) if (v.at < old) table.delete(k);
  };
  /** 변화가 있으면 rev를 올려 상태·변화를, 없으면 state일 때만 같은 rev로 상태를 낸다. 함께 낼 답(more)도 같이 보낸다. */
  const emit = async (changes: WorldChange[], o2: { state?: boolean; more?: () => Promise<void> } = {}) => {
    const sent: Promise<void>[] = [];
    if (changes.length) rev++;
    if (changes.length || o2.state) sent.push(node.publish("/world/state", { rev, view: world.view(clock.now()) }));
    if (changes.length) sent.push(node.publish("/world/changes", { rev, changes }));
    if (o2.more) sent.push(o2.more());
    await Promise.all(sent);
  };
  const closerReply = (look: string, ids: Map<string, string> | undefined) => () => node.publish("/world/closer", { look, ids: Object.fromEntries(ids ?? []) });

  node.on("/perception/scene", async (b) => {
    switch (b.kind) {
      case "scene": {
        const ids = idsOf.get(b.frame_id)?.ids ?? new Map<string, string>();
        idsOf.delete(b.frame_id);
        return emit(world.applyScene(b.frame_id, b.observed_ms, b.scene, ids));
      }
      case "missing":
        idsOf.delete(b.frame_id);
        return emit(world.applyMissing(b.frame_id, b.observed_ms, { vlm: b.missing }));
      case "closer_scene": {
        const l = looks.get(b.look);
        looks.delete(b.look);
        const ids = l?.ids ?? new Map<string, string>();
        return emit(world.applyCloserScene(b.frame_id, b.observed_ms, b.scene, ids, l?.pending), { more: closerReply(b.look, ids) });
      }
      case "closer_end": {
        const l = looks.get(b.look);
        looks.delete(b.look);
        if (l?.pending) world.endCloser(l.pending);
        return emit([], { more: closerReply(b.look, l?.ids) });
      }
      case "top":
        return emit(world.applyTop(b.object_id, b.frame_id, b.observed_ms, b.value));
    }
  });
  node.on("/world/input", (b) => {
    if (b.kind === "guard") world.guard(b.id, b.at_ms, b.on);
    else world.contentsAction(b.id, b.at_ms, b.on);
    return emit([], { state: true });
  });
  node.on("/phone/heard", (b) => emit(world.heard(b.text, b.observed_ms)));
  node.on("/device/changes", (b) => {
    const changes = world.applyDevice(b.state, clock.now());
    return emit(b.note.initial ? [] : changes, { state: true });   // 첫 상태는 변화로 내지 않는다(지금 시작 가전 상태와 같다)
  });
  node.every(o.tickMs ?? WORLD_TICK_MS, () => {
    prune();
    return emit(world.tick(clock.now()), { state: true });
  });

  // VLM 전용으로 바뀔 자리: YOLO → World State 임시 다리. 토픽 입력과 같은 노드 줄에 넣는다.
  const bridge: WorldBridge = {
    eye: (eye, atMs) => node.post(() => { world.setEye(eye, atMs); }),
    frame: (frame, dets, poses) => node.post(() => {
      const r = world.applyDetections(frame, dets, poses);
      if (frame.vlm !== false) idsOf.set(frame.id, { at: clock.now(), ids: r.ids });
      return emit(r.changes);
    }),
    missing: (frameId, capturedAtMs, m) => node.post(() => emit(world.applyMissing(frameId, capturedAtMs, m))),
    closer: (look, passes, from) => node.post(() => {
      const r = world.applyCloser(passes, from);
      looks.set(look, { at: clock.now(), ids: r.ids, pending: r.pending });
      return emit(r.changes);
    }),
  };

  await node.prepare();
  await node.publish("/world/state", { rev, view: world.view(clock.now()) });
  return { node, bridge };
}
