// 집 실행 묶음의 관찰 흐름·World State 잇기(src/observe·src/world): 트윈 윗면·침대 소파(쓰러짐 의심에서 뺄 자리), World State, 관찰 흐름(YOLO·VLM),
// 주기 타이머(관찰·판단·실행 추적·보기 담당·말풍선 카드). 관찰 흐름은 BRAIN=1이고 PHONE_PORT가 있을 때만 켠다(폰 카메라가 입력).
import { join } from "node:path";
import { datasetWriter } from "../../brain/index.js";
import type { BrainLog } from "../../contract/events.js";
import { floorLookup, roomNamedAt, type LayoutEditor } from "../../layout/index.js";
import { createPipeline } from "../../observe/index.js";
import { WorldState, loadFallConfig, restsFromLayout, surfacesFromLayout, type PlaneSurface, type RestSpot } from "../../world/index.js";
import type { HomeCore } from "./core.js";

/** 트윈의 식탁·책상·조리대·싱크대 윗면(물건의 트윈 위치). 바닥 크기는 배치에 없으면 카탈로그 값(그 면의 실제 사각형). 싱크볼 점(도면 설비 anchors.basin)이 있으면 그 싱크볼도.
 *  배치가 바뀌면 다시 만든다. */
export function surfaceSource(editor: LayoutEditor | undefined): () => PlaneSurface[] {
  if (!editor) return () => [];
  let cache: PlaneSurface[] | null = null;
  editor.subscribe(() => { cache = null; });
  const pair = (v: unknown): v is [number, number] => Array.isArray(v) && v.length === 2 && v.every((n) => typeof n === "number" && Number.isFinite(n));
  return () => (cache ??= surfacesFromLayout(editor.objects().map((o) => {
    const c = editor.center(o.id);
    const basin = (o.anchors as { basin?: unknown } | undefined)?.basin;
    return {
      id: o.id, name: o.name, type: o.type, plan: o.plan.position, base: o.position[1],
      height: c ? Math.max(0, 2 * (c.position[1] - o.position[1])) : o.height ?? 0, footprint: o.footprint ?? editor.typeInfo(o.type)?.footprint,
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

/** 관찰 흐름(src/observe/pipeline.ts)을 연다: 판단·실행 기록은 emit으로, 물체 모양·World State는 대시보드로, 변화는 실행 추적·판단 호출로. 실행 추적을 만든 뒤 부른다. */
export async function startPipeline(core: HomeCore, emit: (event: BrainLog) => void): Promise<void> {
  const { ctx } = core;
  const { env, log, runtimeDir, history } = ctx;
  const world = core.world!;
  const decide = core.decider!;
  const tracking = core.tracker!;
  const { engineHeaders } = core;
  core.pipeline = await createPipeline({
    env, log, world, inject: ctx.brain, emit,
    // 물체 모양은 대시보드로만 보낸다(초당 10번이라 기록 DB·실행 기록에 넣지 않는다)
    onSeen: (e) => {
      core.lastSeen = e;
      core.app?.broadcast(e);
    },
    broadcastWorld: (w) => {
      core.app?.broadcast({ type: "world", world: w });
      core.speak();
    },
    onChanges: (c) => {
      tracking.onWorld(c);
      decide.onChanges(c);
    },
    // 주기 판단(기본 5초)은 엔진 프레임이 오는 동안만 부른다
    onFrame: () => decide.onFrame(),
    // 실행 추적이 가까이 보는 차례(찾기·내용물 보류)인 동안만 VLM 사진 간격을 1초로 줄인다
    vlmFast: () => tracking.looking(),
    // 분석한 프레임은 디스크에 쓰지 않는다. DATASET_COLLECT=1일 때만 시험 자료로 RUNTIME_DIR/dataset에 쓴다
    dataset: env.DATASET_COLLECT?.trim() === "1" ? datasetWriter(join(runtimeDir, "dataset"), history.db) : undefined,
    onDetected: (jpeg, r) => {
      const h = engineHeaders.get(jpeg);
      if (h && r.landmarks?.length) core.phone?.landmarks(h, r.landmarks);
    },
  });
}

/** 주기 타이머(250ms): 오래 이어진 가전 상태·판단·실행 추적·보기 담당·말풍선 카드. 시작 가전 상태를 World State에 넣고(변화로 내지 않는다) 가전 변화를 관찰 흐름에 잇는다. */
export function startLoop(core: HomeCore): void {
  const { signals } = core;
  const world = core.world!;
  const observed = core.pipeline!;
  const decide = core.decider!;
  const tracking = core.tracker!;
  const looking = core.looker!;
  core.decideTimer = setInterval(() => {
    observed.tick(); // 오래 이어진 가전 상태(냉장고 문 1분)
    decide.tick();
    tracking.tick();
    looking.tick();
    core.speak();
  }, 250);
  core.decideTimer.unref?.();
  for (const s of signals.states()) world.applyDevice(s, core.nowMs()); // 시작 상태는 변화로 내지 않는다
  core.unsubWorld = signals.subscribe((s) => observed.onDevice(s));
}
