// node.ts — 집 상태 노드(stage-queue 묶음 2): World State를 바꾸는 곳은 이 노드 하나다. 입력은 노드 줄에 들어온 차례대로 하나씩 넣는다.
// 받는 것: /perception/scene(VLM 답, 집 상태 입력의 주인. 지금은 YOLO 임시 갈래도 같은 토픽으로 와서 차례가 지켜진다: VLM 전용으로 바뀔 자리), /world/input(실행 추적의 지킴·따르기 창), /phone/heard(들은 말), /device/changes(가전 상태).
// 변화가 있으면 rev를 1 올리고 /world/state {rev, view}와 /world/changes {rev, changes}를 이 차례로 함께 낸다(대시보드는 한 번 지나기로 받는다).
// 변화 없이 보기만 바뀌는 입력(지킴·따르기 창·가전 상태)은 같은 rev로 상태만 다시 낸다. 250ms마다 tick을 넣고 같은 rev로 상태를 다시 낸다.
// 가까이 보기 묶음(closer_merge)은 VLM 답까지 들고 있고(물건은 VLM 답으로만, src/world/merge.ts), VLM 답(closer_scene)이나 답 없이 끝남(closer_end: 묶음을 버림)을 넣은 뒤
// /world/closer {look, ids}로 VLM 합치기 뒤의 최종 id 표를 답한다.
import { BusNode, msgId, realClock, type Bus, type Clock, type Envelope, type TopicName } from "../bus/index.js";
import type { Detection, FrameMeta, Pose } from "../contract/observe.js";
import type { SceneInput, WorldChange, WorldCloserMsg } from "../contract/world.js";
import type { CloserPending } from "./state/closer.js";
import type { CloserPass, WorldState } from "./state/world.js";

/** 상태를 다시 내는 간격(ms, 지금 판단 타이머와 같다). */
export const WORLD_TICK_MS = 250;
/** 감지 번호 표·가까이 보기 표를 넣은 지 이만큼(ms) 지나도 VLM 답이 오지 않으면 지운다. */
const KEEP_MS = 30_000;
/** 넣은 입력 메시지 id를 이만큼 기억한다(다시 온 메시지는 다시 넣지 않는다). */
const APPLIED_MAX = 1024;

export interface WorldNode {
  node: BusNode;
  /** 닫기 전 비우기: 받은 입력을 다 넣고 남은 출력을 다 낼 때까지 기다린다(ms쯤 지나면 false). */
  settle(ms: number): Promise<boolean>;
}

/** 입력을 World State에 넣는 곳: 감지 번호 표(프레임 → 감지 번호 → 물건 id)와 가까이 보기 표(look → 감지 번호 표·VLM 답을 기다리는 후보)를 갖는다.
 *  집 상태 노드와 관찰 흐름 시험 대역(tests/helpers/world-port.ts)이 같이 쓴다. */
export class WorldInputs {
  readonly #idsOf = new Map<string, { at: number; ids: Map<string, string> }>();
  readonly #looks = new Map<string, { at: number; ids: Map<string, string>; pending?: CloserPending }>();
  constructor(readonly world: WorldState, private readonly now: () => number) {}

  /** 한 프레임의 감지(VLM 전용으로 바뀔 자리). VLM 프레임(vlm이 false가 아님)이면 감지 번호 표를 그 VLM 답까지 둔다. */
  frame(frame: FrameMeta, dets: Detection[], poses?: Pose[]): WorldChange[] {
    const r = this.world.applyDetections(frame, dets, poses);
    if (frame.vlm !== false) this.#idsOf.set(frame.id, { at: this.now(), ids: r.ids });
    return r.changes;
  }
  /** 잘라 본 장의 YOLO 묶기(VLM 전용으로 바뀔 자리): World State는 바꾸지 않고 VLM 답까지 들고 있는다. look마다 감지 번호 표와 묶음을 둔다. */
  closer(look: string, passes: readonly CloserPass[]): WorldChange[] {
    const r = this.world.applyCloser(passes);
    this.#looks.set(look, { at: this.now(), ids: r.ids, pending: r.pending });
    return r.changes;
  }

  /** /perception/scene 입력 하나. 가까이 보기 답(closer_scene·closer_end)이면 VLM 합치기 뒤의 최종 id 표도 돌려준다. */
  scene(b: SceneInput): { changes: WorldChange[]; closer?: { look: string; ids: Map<string, string> } } {
    switch (b.kind) {
      // VLM 전용으로 바뀔 자리: YOLO 임시 갈래(feat/vlm-objects를 합치면 쓰러짐 신호 하나만 남는다)
      case "eye":
        this.world.setEye(b.eye, b.at_ms);
        return { changes: [] };
      case "frame":
        return { changes: this.frame(b.frame, b.dets, b.poses) };
      case "yolo_missing":
        return { changes: this.world.applyMissing(b.frame_id, b.observed_ms, { yolo: b.yolo, ...(b.vlm ? { vlm: b.vlm } : {}) }) };
      case "closer_merge":
        return { changes: this.closer(b.look, b.passes) };
      case "scene": {
        const ids = this.#idsOf.get(b.frame_id)?.ids ?? new Map<string, string>();
        this.#idsOf.delete(b.frame_id);
        return { changes: this.world.applyScene(b.frame_id, b.observed_ms, b.scene, ids, b.look, b.from_ms ?? b.observed_ms) };
      }
      case "missing":
        this.#idsOf.delete(b.frame_id);
        return { changes: this.world.applyMissing(b.frame_id, b.observed_ms, { vlm: b.missing }) };
      case "closer_scene": {
        const l = this.#looks.get(b.look);
        this.#looks.delete(b.look);
        const ids = l?.ids ?? new Map<string, string>();
        return { changes: this.world.applyCloserScene(b.frame_id, b.observed_ms, b.scene, ids, l?.pending, b.at), closer: { look: b.look, ids } };
      }
      case "closer_end": {
        const l = this.#looks.get(b.look);
        this.#looks.delete(b.look);
        const ids = l?.ids ?? new Map<string, string>();
        // VLM 답 없이 끝났다: 묶음을 버린다(VLM 답 없이는 넣지 않는다)
        const changes = l?.pending ? this.world.endCloser(l.pending) : [];
        return { changes, closer: { look: b.look, ids } };
      }
      case "top":
        return { changes: this.world.applyTop(b.object_id, b.frame_id, b.observed_ms, b.value) };
    }
  }

  /** 넣은 지 KEEP_MS가 지나도 VLM 답이 오지 않은 표를 지운다. 가까이 보기 묶음은 지우기 전에 끝낸다(묶음 버리기). 그 변화를 돌려준다. */
  prune(): WorldChange[] {
    const old = this.now() - KEEP_MS;
    const changes: WorldChange[] = [];
    for (const [k, v] of this.#idsOf) if (v.at < old) this.#idsOf.delete(k);
    for (const [k, v] of this.#looks) {
      if (v.at >= old) continue;
      if (v.pending) changes.push(...this.world.endCloser(v.pending));
      this.#looks.delete(k);
    }
    return changes;
  }
}

/** 집 상태 노드를 준비한다(구독·첫 상태 rev 0 발행까지, 시작은 띄우는 곳이 모든 노드를 준비한 뒤). */
export async function startWorldNode(o: { bus: Bus; epoch: { boot: string; home: string }; world: WorldState; clock?: Clock; tickMs?: number; log?: (s: string) => void }): Promise<WorldNode> {
  const { world } = o;
  const clock = o.clock ?? realClock;
  const node = new BusNode({ name: "world", bus: o.bus, epoch: o.epoch, clock, log: o.log });
  let rev = 0;
  const inputs = new WorldInputs(world, () => clock.now());
  /** 아직 다 내지 못한 출력(판본마다 변화 봉투, 가까이 보기 답 봉투). 발행이 실패하면 남아 다음 발행(같은 메시지 다시 받기·다음 입력·250ms 다시 냄)에
   *  같은 봉투(같은 메시지 id)로 다시 낸다: 통로에 들어갔는데 답만 끊긴 출력을 받는 쪽이 두 번 받지 않는다. */
  const outbox: { out: Envelope<TopicName>[]; sent: number }[] = [];
  /** 넣은 입력 메시지 id(최근 APPLIED_MAX개): 다시 온 메시지는 World State에 다시 넣지 않고 남은 출력만 다시 낸다. */
  const applied = new Set<string>();
  /** 상태(state면 늘, 남은 출력이 있어도)와 남은 출력을 낸다. 상태는 함께 내고, 남은 출력은 판본 차례로 하나씩 낸다:
   *  앞 판본이 나가야 뒤 판본을 낸다(받는 쪽은 옛 판본을 버리므로 뒤 판본이 먼저 가면 앞 판본을 잃는다). 실패하면 그 뒤를 남기고 던진다. */
  const flush = async (state: boolean) => {
    const jobs: Promise<void>[] = [];
    if (state || outbox.length) jobs.push(node.publish("/world/state", { rev, view: world.view(clock.now()) }));
    jobs.push((async () => {
      while (outbox.length) {
        const it = outbox[0]!;
        while (it.sent < it.out.length) {
          await node.send(it.out[it.sent]!);
          it.sent++;
        }
        outbox.shift();
      }
    })());
    const done = await Promise.allSettled(jobs);
    const failed = done.find((r): r is PromiseRejectedResult => r.status === "rejected");
    if (failed) throw failed.reason;
  };
  /** 넣은 결과를 낸다: 변화가 있으면 rev를 올려 그 봉투를 남은 출력에 넣고(가까이 보기 답 봉투도), 상태는 변화가 있거나 state일 때 낸다. */
  const emit = (changes: WorldChange[], o2: { state?: boolean; closer?: WorldCloserMsg } = {}) => {
    if (changes.length) rev++;
    const out: Envelope<TopicName>[] = [];
    if (changes.length) out.push(node.envelope("/world/changes", { rev, changes }));
    if (o2.closer) out.push(node.envelope("/world/closer", o2.closer));
    if (out.length) outbox.push({ out, sent: 0 });
    return flush(changes.length > 0 || !!o2.state);
  };
  /** 토픽 입력 하나: 이미 넣은 메시지면 다시 넣지 않고 남은 출력만 낸다. 넣은 뒤(발행 전)에 기억한다. */
  const once = <N extends TopicName>(e: Envelope<N>, apply: () => { changes: WorldChange[]; state?: boolean; closer?: WorldCloserMsg }) => {
    const id = msgId(e.header);
    if (applied.has(id)) return flush(false);
    const r = apply();
    applied.add(id);
    if (applied.size > APPLIED_MAX) applied.delete(applied.values().next().value!);
    return emit(r.changes, r);
  };
  node.on("/perception/scene", (b, { e }) => once(e, () => {
    const r = inputs.scene(b);
    return { changes: r.changes, ...(r.closer ? { closer: { look: r.closer.look, ids: Object.fromEntries(r.closer.ids) } } : {}) };
  }));
  node.on("/world/input", (b, { e }) => once(e, () => {
    if (b.kind === "focus") world.focus(b.id, b.focus);
    else if (b.kind === "link") world.relink(b.from, b.to, b.at_ms);
    else if (b.kind === "guard") world.guard(b.id, b.at_ms, b.on);
    else world.contentsAction(b.id, b.at_ms, b.on);
    return { changes: [], state: true };
  }));
  node.on("/phone/heard", (b, { e }) => once(e, () => ({ changes: world.heard(b.text, b.observed_ms) })));
  node.on("/device/changes", (b, { e }) => once(e, () => {
    const changes = world.applyDevice(b.state, clock.now());
    // 첫 상태는 변화로 내지 않는다(지금 시작 가전 상태와 같다). 상태를 억지로 다시 내지 않는다: 시작 때 가전 수십 개가 18KB 상태를 하나씩 내며 줄이 밀린다(250ms 다시 냄이 맡는다)
    return { changes: b.note.initial ? [] : changes };
  }));
  node.every(o.tickMs ?? WORLD_TICK_MS, () => emit([...inputs.prune(), ...world.tick(clock.now())], { state: true }));

  await node.prepare();
  await node.publish("/world/state", { rev, view: world.view(clock.now()) });
  return { node, settle: (ms) => node.settled(ms, () => outbox.length === 0) };
}
