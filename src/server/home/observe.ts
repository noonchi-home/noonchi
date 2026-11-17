// 집 실행 묶음의 관찰 흐름·World State 잇기(src/observe·src/world): 트윈 윗면·침대 소파(쓰러짐 의심에서 뺄 자리), World State, 관찰 흐름(YOLO·VLM),
// 주기 타이머(관찰·판단·실행 추적·보기 담당·말풍선 카드). 관찰 흐름은 BRAIN=1이고 PHONE_PORT가 있을 때만 켠다(폰 카메라가 입력).
import { join } from "node:path";
import { datasetWriter } from "../../brain/index.js";
import { BusNode } from "../../bus/index.js";
import type { BrainLog, SeenEvent } from "../../contract/events.js";
import type { WorldChange } from "../../contract/world.js";
import { floorLookup, roomNamedAt, type LayoutEditor } from "../../layout/index.js";
import { createPipeline, startPerceptionNode } from "../../observe/index.js";
import { WorldState, loadFallConfig, restsFromLayout, startWorldMirror, startWorldNode, surfacesFromLayout, type PlaneSurface, type RestSpot } from "../../world/index.js";
import { HEARD_MARK } from "../../world/labels.js";
import type { HomeCore } from "./core.js";

/** 트윈의 식탁·책상·조리대·싱크대 윗면(물건의 트윈 위치). 싱크볼 점(도면 설비 anchors.basin)이 있으면 그 싱크볼도. 배치가 바뀌면 다시 만든다. */
function surfaceSource(editor: LayoutEditor | undefined): () => PlaneSurface[] {
  if (!editor) return () => [];
  let cache: PlaneSurface[] | null = null;
  editor.subscribe(() => { cache = null; });
  const pair = (v: unknown): v is [number, number] => Array.isArray(v) && v.length === 2 && v.every((n) => typeof n === "number" && Number.isFinite(n));
  return () => (cache ??= surfacesFromLayout(editor.objects().map((o) => {
    const c = editor.center(o.id);
    const basin = (o.anchors as { basin?: unknown } | undefined)?.basin;
    return {
      id: o.id, name: o.name, type: o.type, plan: o.plan.position, base: o.position[1],
      height: c ? Math.max(0, 2 * (c.position[1] - o.position[1])) : o.height ?? 0, footprint: o.footprint,
      facing_deg: o.plan.facing_deg, ...(pair(basin) ? { basin } : {}),
    };
  })));
}

/** 트윈의 침대·소파: 그 위에 누운 것은 쓰러짐 의심(src/world/fall.ts)이 아니다. 바닥 크기는 배치에 없으면 카탈로그, 누울 면 높이는 카탈로그 첫 면(매트리스).
 *  배치가 바뀌면 다시 만든다. */
export function restSource(editor: LayoutEditor | undefined): () => RestSpot[] {
  if (!editor) return () => [];
  let cache: RestSpot[] | null = null;
  editor.subscribe(() => { cache = null; });
  return () => (cache ??= restsFromLayout(editor.objects().map((o) => {
    const info = editor.typeInfo(o.type);
    const footprint = o.footprint ?? info?.footprint;
    const surface = info?.surfaces?.[0]?.height;
    return {
      id: o.id, name: o.name, type: o.type, plan: o.plan.position, base: o.position[1], facing_deg: o.plan.facing_deg,
      ...(footprint ? { footprint } : {}), ...(surface !== undefined ? { surface } : {}),
    };
  })));
}

/** 트윈 윗면과 World State(BRAIN=1이고 PHONE_PORT가 있을 때). 카메라로 본 가전 상태는 허브로 넘기고, 침대·소파는 쓰러짐 의심에서 뺀다. */
export function startWorld(core: HomeCore): void {
  const { ctx, twin, signals, layout, specOf } = core;
  const { env, log } = ctx;
  // 관찰 흐름(BRAIN=1): 폰 엔진 프레임마다 YOLO·VLM이 분석하고 World State가 합친다(src/observe/pipeline.ts)
  const brainWanted = /^(1|true|on)$/i.test(env.BRAIN?.trim() ?? "");
  // 트윈 윗면(식탁·싱크대): World State가 물건을 놓고, 명령 대상·가까이 보기는 자리의 윗면 가운데를 본다
  const surfaces = surfaceSource(layout?.editor);
  if (brainWanted && !core.phoneOn) log("[경고] BRAIN=1은 PHONE_PORT가 있어야 합니다(폰 카메라가 입력). 관찰 흐름을 끕니다.");
  // 카메라로 본 가전 상태는 허브로 넘긴다(src/devices/hub/signals.ts observe): 실제 출처가 없으면 기기 상태가 되고, 실제 상태와 다르면 처음 한 번 로그에 남긴다
  const world = brainWanted && core.phoneOn
    ? new WorldState({
      surfaces, floorAt: floorLookup(core.plan.rooms), roomAt: roomNamedAt(core.floorPlan, twin.rooms), devices: () => signals.list(), fall: loadFallConfig(env), rests: restSource(layout?.editor),
      locate: (id) => { const c = layout?.editor.center(id); return c ? [c.position[0], c.position[2]] : null; },
      place: (id) => layout?.editor.center(id)?.position ?? null,
      see: (id, seen, at, evidence) => {
        const r = signals.observe(id, seen, at, evidence);
        if (r.kind === "mismatch") log(`카메라로 본 값이 기기 값과 달라 기기 값을 둡니다: ${specOf.get(id)?.label ?? id} 카메라 ${JSON.stringify(seen)} · 기기 ${JSON.stringify(r.real)}`);
        return r;
      },
    })
    : null;
  core.surfaces = surfaces;
  core.world = world;
}

/** 프레임마다 생기는 분석 없음은 observe 기록으로 남기므로 world_change로 다시 보내지 않는다. */
const PER_FRAME = new Set(["vlm_missing", "yolo_missing"]);

/** 거울이 받은 집 상태 변화를 통로 전 관찰 흐름과 같은 차례로 넘긴다: world_change 기록(프레임마다 분석 없음 빼고) → 실행 추적 → 판단.
 *  들은 말(heard)은 판단에만 넘기고 실행 추적에는 넘기지 않으며, 기록·대시보드에는 표시(HEARD_MARK, KEEP_HEARD_TEXT면 말 그대로)만 남긴다. */
export function routeWorldChanges(core: Pick<HomeCore, "nowMs" | "keepHeard" | "tracker" | "decider">, emit: (event: BrainLog) => void, changes: WorldChange[]): void {
  const seen = changes.filter((c) => c.kind !== "heard");
  for (const c of seen) if (!PER_FRAME.has(c.kind)) emit({ type: "world_change", at_ms: core.nowMs(), kind: c.kind, text: c.text });
  for (const c of changes) if (c.kind === "heard") emit({ type: "world_change", at_ms: core.nowMs(), kind: "heard", text: core.keepHeard ? c.text : HEARD_MARK });
  if (seen.length) core.tracker?.onWorld(seen);
  core.decider?.onChanges(changes);
}

/** 거울이 첫 상태를 받기를 기다리는 시간(ms). 넘으면 집을 띄우지 않는다. */
const FIRST_STATE_MS = 5000;

/** 노드를 띄운다(stage-queue 묶음 2): 집 상태(World State를 바꾸는 곳 하나), 인식, 거울(act: 실행 추적·판단·말풍선·대시보드가 읽고 /world/input을 낸다),
 *  폰(들은 말을 내고 미니맵 모양을 대시보드로), 가전(/device/changes). 모두 준비한 뒤 시작하고, 거울이 첫 상태를 받을 때까지 기다린다.
 *  가전 시작 상태는 첫 상태(변화로 내지 않음)로, 그 뒤 바뀜은 변화로 넣는다. 실행 추적을 만든 뒤, 관찰 흐름을 열기 전에 부른다. */
export async function startNodes(core: HomeCore, emit: (event: BrainLog) => void): Promise<void> {
  const { ctx, signals, specOf } = core;
  const { bus, log } = ctx;
  const epoch = core.epoch;
  const clock = core.busClock();
  core.worldNode = await startWorldNode({ bus, epoch, world: core.world!, clock, log });
  core.perception = await startPerceptionNode({ bus, epoch, clock, log });
  let first: () => void = () => {};
  const ready = new Promise<void>((r) => { first = r; });
  core.mirror = await startWorldMirror({
    bus, epoch, name: "act", clock, log,
    onChanges: (changes) => routeWorldChanges(core, emit, changes),
    onView: (view) => {
      first();
      core.app?.broadcast({ type: "world", world: view });
      core.speak();
    },
  });
  const phone = new BusNode({ name: "phone", bus, epoch, clock, log });
  // 미니맵 물체 모양(가장 새 것)은 대시보드로만 보낸다(초당 10번이라 기록 DB·실행 기록에 넣지 않는다)
  phone.on("/perception/detections", (b) => {
    const e: SeenEvent = { type: "seen", at_ms: core.nowMs(), frame_id: b.frame_id, captured_at_ms: b.observed_ms, frame: b.frame, shapes: b.shapes };
    core.lastSeen = e;
    core.app?.broadcast(e);
  });
  const devices = new BusNode({ name: "devices", bus, epoch, clock, log });
  core.phoneNode = phone;
  core.devicesNode = devices;
  await phone.prepare();
  await devices.prepare();
  for (const n of [core.worldNode.node, core.perception.node, core.mirror.node, phone, devices]) n.start();
  const send = (s: Parameters<Parameters<typeof signals.subscribe>[0]>[0], initial: boolean) => {
    const spec = specOf.get(s.id);
    const note = { ...(initial ? { initial: true } : {}), ...(spec ? { label: spec.label, kind: spec.kind } : {}) };
    devices.publish("/device/changes", { id: s.id, state: s, note }).catch((e: Error) => log(`[경고] 가전 상태를 집 상태에 넣지 못했어요: ${e.message}`));
  };
  for (const s of signals.states()) send(s, true); // 시작 상태는 변화로 내지 않는다
  core.unsubWorld = signals.subscribe((s) => send(s, false));
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<"late">((r) => { timer = setTimeout(() => r("late"), FIRST_STATE_MS); });
  const got = await Promise.race([ready.then(() => "ok" as const), late]);
  clearTimeout(timer);
  if (got === "late") throw new Error(`집 상태 노드의 첫 상태를 ${FIRST_STATE_MS}ms 안에 받지 못했어요`);
}

/** 노드를 끝낸다: 새 일을 만드는 쪽(인식) → 집 상태 → 거울·폰·가전 차례. 관찰 흐름을 닫은 뒤 부른다. */
export async function stopNodes(core: HomeCore): Promise<void> {
  for (const n of [core.perception?.node, core.worldNode?.node, core.mirror?.node, core.phoneNode, core.devicesNode]) await n?.stop();
}

/** 관찰 흐름(src/observe/pipeline.ts)을 연다: 판단·실행 기록은 emit으로, 물체 모양·World State는 대시보드로, 변화는 실행 추적·판단 호출로. 실행 추적을 만든 뒤 부른다. */
export async function startPipeline(core: HomeCore, emit: (event: BrainLog) => void): Promise<void> {
  const { ctx } = core;
  const { env, log, runtimeDir, history } = ctx;
  const decide = core.decider!;
  const perception = core.perception!;
  const { engineHeaders } = core;
  core.pipeline = await createPipeline({
    env, log, world: perception.port, inject: ctx.brain, emit,
    // 물체 모양은 /perception/detections로(폰 노드가 대시보드로만 보낸다)
    onSeen: (e) => perception.seen(e),
    // 주기 판단(기본 5초)은 엔진 프레임이 오는 동안만 부른다
    onFrame: () => decide.onFrame(),
    // 분석한 프레임은 디스크에 쓰지 않는다. DATASET_COLLECT=1일 때만 시험 자료로 RUNTIME_DIR/dataset에 쓴다
    dataset: env.DATASET_COLLECT?.trim() === "1" ? datasetWriter(join(runtimeDir, "dataset"), history.db) : undefined,
    onDetected: (jpeg, r) => {
      const h = engineHeaders.get(jpeg);
      if (h && r.landmarks?.length) core.phone?.landmarks(h, r.landmarks);
    },
  });
}

/** 주기 타이머(250ms): 판단·실행 추적·보기 담당·말풍선 카드. 오래 이어진 가전 상태(냉장고 문 1분)와 가전 상태는 집 상태 노드가 맡는다. */
export function startLoop(core: HomeCore): void {
  const decide = core.decider!;
  const tracking = core.tracker!;
  const looking = core.looker!;
  core.decideTimer = setInterval(() => {
    decide.tick();
    tracking.tick();
    looking.tick();
    core.speak();
  }, 250);
  core.decideTimer.unref?.();
}
