import { openLocalizer } from "../../localize/index.js";
import { phoneCommandRoutes, phoneOwnerRoutes } from "../../phone/index.js";
import { showStatus } from "./say.js";
import { progressRoutes } from "../../act/index.js";
import { applyPhoneProgress, showPhoneCommand, syncPhoneClaims } from "./phone.js";
// 집 실행 묶음의 관찰 흐름·World State 잇기(src/observe·src/world): 트윈 윗면·침대 소파(쓰러짐 의심에서 뺄 자리), World State, 관찰 흐름(YOLO·VLM),
// 주기 타이머(관찰·판단·실행 추적·보기 담당·말풍선 카드). 관찰 흐름은 BRAIN=1이고 PHONE_PORT가 있을 때만 켠다(폰 카메라가 입력).
import { join } from "node:path";
import type { HelpRoutine } from "../../brain/index.js";
import { GoalTriggers, startGoalNode } from "../../goal/index.js";
import { managerRoutes } from "../../manage/index.js";
import { BrainPlans, planningRoutes } from "../../brain/index.js";
import { BusNode, Outbox } from "../../bus/index.js";
import { HOUSEHOLD_KINDS } from "../../devices/kinds.js";
import type { BrainLog, SeenEvent } from "../../contract/events.js";
import type { WorldChange } from "../../contract/world.js";
import { floorLookup, roomNamedAt, locateZone, type LayoutEditor } from "../../layout/index.js";
import { createPipeline, loadObserveConfig, LookClient, lookRoutes, startPerceptionNode, vlmStepMs } from "../../observe/index.js";
import { WorldState, loadFallConfig, restsFromLayout, startWorldMirror, startWorldNode, surfacesFromLayout, type PlaneSurface, type RestSpot } from "../../world/index.js";
import { historyRoutesVia } from "../../record/index.js";
import { routineReader } from "./history-writes.js";
import { HEARD_MARK } from "../../world/labels.js";
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

/** 프레임마다 생기는 분석 없음은 observe 기록으로 남기므로 world_change로 다시 보내지 않는다. */
const PER_FRAME = new Set(["vlm_missing", "yolo_missing"]);

/** 거울이 받은 집 상태 변화를 통로 전 관찰 흐름과 같은 차례로 넘긴다: world_change 기록(프레임마다 분석 없음 빼고) → 실행 추적 → 시간 줄 사람 줄(사람 변화일 때) → 판단.
 *  들은 말(heard)은 판단에만 넘기고 실행 추적에는 넘기지 않으며, 기록·대시보드에는 표시(HEARD_MARK, KEEP_HEARD_TEXT면 말 그대로)만 남긴다. */
export function routeWorldChanges(core: Pick<HomeCore, "nowMs" | "keepHeard" | "tracker" | "decider"> & Partial<Pick<HomeCore, "person" | "view">>, emit: (event: BrainLog) => void, changes: WorldChange[]): void {
  const seen = changes.filter((c) => c.kind !== "heard");
  for (const c of seen) if (!PER_FRAME.has(c.kind)) emit({ type: "world_change", at_ms: core.nowMs(), kind: c.kind, text: c.text });
  for (const c of changes) if (c.kind === "heard") emit({ type: "world_change", at_ms: core.nowMs(), kind: "heard", text: core.keepHeard ? c.text : HEARD_MARK });
  if (seen.length) core.tracker?.onWorld(seen);
  const world = seen.some((c) => c.kind.startsWith("person")) ? core.view?.() : null;
  if (world) core.person?.onWorld(world, core.nowMs());
  core.decider?.onChanges(changes);
}

/** 거울이 첫 상태를 받기를 기다리는 시간(ms). 넘으면 집을 띄우지 않는다. */
const FIRST_STATE_MS = 5000;

/** 노드를 띄운다: 집 상태(World State를 바꾸는 곳 하나), 인식, 거울(act: 실행 추적·판단·말풍선·대시보드가 읽고 /world/input을 낸다),
 *  폰(들은 말을 내고 미니맵 모양을 대시보드로), 가전(/device/changes). 모두 준비한 뒤 시작하고, 거울이 첫 상태를 받을 때까지 기다린다.
 *  가전 시작 상태는 첫 상태(변화로 내지 않음)로, 그 뒤 바뀜은 변화로 넣는다. 실행 추적을 만든 뒤, 관찰 흐름을 열기 전에 부른다. */
export async function startNodes(core: HomeCore, emit: (event: BrainLog) => void): Promise<void> {
  const { ctx, signals, specOf } = core;
  const { bus, log } = ctx;
  const epoch = core.epoch;
  const clock = core.busClock();
  core.worldNode = await startWorldNode({ bus, epoch, world: core.world!, clock, log });
  core.perception = await startPerceptionNode({ bus, epoch, clock, log, routes: (n) => lookRoutes(n, () => core.pipeline, clock) });
  let first: () => void = () => {};
  const ready = new Promise<void>((r) => { first = r; });
  let brainReady!: () => void;
  const brainStarted = new Promise<void>((r) => { brainReady = r; });
  core.brainMirror = await startWorldMirror({
    bus, epoch, name: "brain", clock, log,
    routes: (node, afterRev) => {
      core.out.brain = new Outbox(node, { clock, log });
      planningRoutes(node, core.makePlan, clock);
      node.on("/brain/nudge", ({ rev }, ctx) => afterRev(rev, ctx, () => { if (!core.closed) core.decider?.nudge(); }));
      node.on("/act/status", (s) => { core.brainStatus = s; });
      node.on("/perception/frame_seen", () => core.decider?.onFrame());
      node.every(250, () => { if (!core.closed && core.pipeline && core.brainMirror?.view()) core.decider?.tick(); });
    },
    onChanges: (changes, view, rev) => {
      core.trace?.changes(changes, rev);
      if (changes.some((c) => c.kind.startsWith("person"))) core.person?.onWorld(view, core.nowMs());
      core.decider?.onChanges(changes);
    },
    onView: () => brainReady(),
  });
  const manager = new BusNode({ name: "manager", bus, epoch, clock, log });
  core.managerNode = manager;
  core.out.manager = managerRoutes(manager, clock);
  await manager.prepare();
  const triggers = new GoalTriggers(locateZone, floorLookup(core.plan.rooms), vlmStepMs(loadObserveConfig(ctx.env)));
  // 목표 판단(src/goal/start.ts): 250ms마다와 새 rev가 오면 전부, 같은 rev에 새 집 사진만 오면 끄고 켤 TV가 있을 때 조건 사실과 TV 규칙만
  // 도움 습관(시나리오 2): 지난 30일 help 줄에서 찾은 습관 가운데 그날 기억에 화살표가 든 것만 시각 계기로 쓴다.
  // 읽기는 기록 작업 스레드가 한다(메인 스레드 DB 호출 없음): 집을 열 때 한 번 기다려 읽고, 1분이 지났거나 help 줄을 새로 쓰면 다시 읽어 바꿔 둔다.
  // 다시 읽는 동안·읽지 못하면 지난 목록을 쓴다(기록 DB에 못 써도 집은 연다)
  const reader = routineReader({ read: (at) => ctx.history.write.routines(at), now: () => core.nowMs(), log, closed: () => core.closed });
  await reader.load();
  const routines = (): HelpRoutine[] => reader.list();
  core.routines = routines;
  core.routinesChanged = reader.changed;
  const goal = await startGoalNode({
    bus, epoch, clock, log, triggers, portals: core.floorPlan.portals, routines, offsetMinutes: ctx.history.db.offsetMinutes,
    dayOf: (ms) => ctx.history.db.dayOf(ms),
    hold: () => core.finishing,
    map: () => core.scene?.stations ?? null,
    viewers: () => core.twin.devices.filter((d) => d.kind === HOUSEHOLD_KINDS.viewerPower).map((d) => d.id),
    checking: () => core.checkingVisit,
    closed: () => core.closed,
    onFacts: (facts) => { core.goalFacts = facts; },
    afterTick: () => { if (core.mirror?.view()) core.tracker?.updateGoal(); },
    routes: (node, afterRev, out) => {
      core.out.goal = out;
      core.goalPlans = new BrainPlans(out, clock, "goal:");
      core.goalPlans.routes(node);
      node.on("/goal/update", (b, ctx) => afterRev(b.rev, ctx, () => { if (!core.closed) core.tracker?.updateGoal(); }));
    },
  });
  core.goalMirror = goal.mirror;
  core.tvWatch = goal.tv;
  core.roomWatch = goal.rooms;
  core.habitWatch = goal.habits;
  core.mirror = await startWorldMirror({
    bus, epoch, name: "act", clock, log,
    routes: (node, afterRev) => {
      core.out.act = new Outbox(node, { clock, log });
      core.brainPlans = new BrainPlans(core.out.act, clock);
      core.brainPlans.routes(node);
      node.on("/manager/directive", (d, ctx) => {
        if (d.op==="revoke") { core.tracker?.onDirective(d); return; }
        return afterRev(d.rev,ctx,()=>{ if (!core.closed) core.tracker?.onDirective(d); });
      });
      node.on("/manager/order", ({ input: b, gate, resumed }, ctx) => afterRev(b.rev, ctx, (rev) => {
        if (!core.closed) {
          core.tracker?.onOrder(b.decision, gate, resumed, rev === b.rev ? b.check : undefined);
        }
        const feedback = core.followupFeedback.get(b.decision.id);
        if (feedback) {
          core.out.act?.push("/act/log", { ...feedback, at_ms: core.nowMs(), data: { ...feedback.data, observed_ms: feedback.at_ms } });
          core.followupFeedback.delete(b.decision.id);
        }
      }));
      core.looks = new LookClient(core.out.act, clock, core.trace);
      core.looks.routes(node);
      progressRoutes(node, (p) => applyPhoneProgress(core, p), () => core.nowMs());
      node.on("/phone/pose", p=>{ if(!core.closed) core.tracker?.onNavigationReading(p); });
      node.on("/phone/link", ({ ready }) => { core.phoneReady = ready; });
      node.on("/phone/owner", ({ owner }) => { core.phoneOwner = owner; });
      node.every(250, () => {
        if (!core.closed && core.looker) {
          core.tracker?.tick();
          core.looker.tick();
          core.speak();
        }
      });
    },
    onChanges: (changes) => routeWorldChanges({ tracker: core.tracker, decider: null, keepHeard: core.keepHeard, nowMs: () => core.nowMs() }, emit, changes),
    onPhoto: () => {
      const world = core.mirror?.view();
      if (world) core.beer?.see(world);
    },
    onView: (view) => {
      first();
      core.beer?.see(view);
      core.app?.broadcast({ type: "world", world: view });
      core.speak();
    },
  });
  core.localizer=await openLocalizer(core.perception.node,{name:"localize",bus,epoch,clock,log},core.twin.home.id,ctx.runtimeDir,ctx.env,log);
  const phone = new BusNode({ name: "phone", bus, epoch, clock, log });
  phone.on("/perception/localized",r=>core.localizer?.receive(r,(header,result)=>core.phone?.localized(header,result) ?? false));
  let statusReady!: () => void;
  const statusStarted = new Promise<void>((resolve) => { statusReady = resolve; });
  phoneCommandRoutes(phone, (m) => { if (!core.closed) showPhoneCommand(core, m); }, {
    plan: ({ plan }) => core.app?.broadcast({ type: "plan", plan }), status: (s) => { showStatus(core, s); statusReady(); },
  });
  phoneOwnerRoutes(phone);
  phone.on("/brain/thought", ({ type, messages }) => core.app?.broadcast({ type, messages }));
  phone.on("/brain/link_changes", (event) => core.app?.broadcast({ type: "brain", event }));
  phone.on("/act/progress_result", (r) => core.progress.receive(r));
  phone.every(250, () => syncPhoneClaims(core));
  phone.on("/phone/say", ({ text, grade }) => { if (!core.closed) core.phone?.reply(text, grade); });
  // 미니맵 물체 모양(가장 새 것)은 대시보드로만 보낸다(초당 10번이라 기록 DB·실행 기록에 넣지 않는다)
  phone.on("/perception/detections", (b) => {
    const e: SeenEvent = { type: "seen", at_ms: core.nowMs(), frame_id: b.frame_id, captured_at_ms: b.observed_ms, frame: b.frame, shapes: b.shapes };
    core.lastSeen = e;
    core.app?.broadcast(e);
  });
  const devices = new BusNode({ name: "devices", bus, epoch, clock, log });
  core.phoneNode = phone;
  core.devicesNode = devices;
  core.out = { ...core.out, phone: new Outbox(phone, { clock, log }), devices: new Outbox(devices, { clock, log }) };
  const recorder = new BusNode({ name: "recorder", bus, epoch, clock, log });
  core.machineRecorder = recorder;
  // 처리표의 지난 기동 줄 지우기: 못 지워도(기록 DB에 못 씀) 집은 연다
  await ctx.history.write.forgetOtherBoots(epoch.boot).catch((e: Error) => log(`[경고] 기록 노드 처리표를 비우지 못했어요: ${e.message}`));
  historyRoutesVia(recorder, ctx.history.write, { now: () => clock.now(), machinesOnly: true, keepHeard: core.keepHeard, log });
  await recorder.prepare();
  const deviceOut = core.out.devices!;
  await phone.prepare();
  await devices.prepare();
  for (const n of [core.worldNode.node, core.perception.node, core.mirror.node, core.brainMirror.node, core.goalMirror.node, manager, phone, devices, recorder]) n.start();
  const send = (s: Parameters<Parameters<typeof signals.subscribe>[0]>[0], initial: boolean) => {
    const spec = specOf.get(s.id);
    const power=signals.powerStamp(s.id);
    const note = { ...(power ? {power} : {}), ...(initial ? { initial: true } : {}), ...(spec ? { label: spec.label, kind: spec.kind } : {}) };
    deviceOut.push("/device/changes", { id: s.id, state: s, note });
  };
  for (const s of signals.states()) send(s, true); // 시작 상태는 변화로 내지 않는다
  let powerSeq=0;
  signals.onPowerIntent=(device_id,value,command_id)=>{
    deviceOut.push("/device/power_intent",{id:"power:"+ ++powerSeq,device_id,value,command_id,
      origin:command_id?"automation":"unknown",at_ms:clock.now()});
  };
  signals.onPowerStamp = s=>send(s,false);
  const unsubscribe=signals.subscribe(s=>send(s,false));
  core.unsubWorld=()=>{signals.onPowerIntent=undefined;signals.onPowerStamp=undefined;unsubscribe();};
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<"late">((r) => { timer = setTimeout(() => r("late"), FIRST_STATE_MS); });
  const got = await Promise.race([Promise.all([ready, brainStarted, core.actStatus ? Promise.resolve() : statusStarted]).then(() => "ok" as const), late]);
  clearTimeout(timer);
  if (got === "late") throw new Error(`집 상태 노드의 첫 상태를 ${FIRST_STATE_MS}ms 안에 받지 못했어요`);
}

/** 닫기 전 비우기 단계마다 기다리는 시간(ms). 넘으면 기다리지 않고 다음으로 간다(닫기가 걸리지 않게). */
const DRAIN_MS = 1000;

/** 노드를 멈추지 않고 비운다: 발행 줄(인식·실행 추적·폰·가전 입력) → 집 상태(받은 입력을 다 넣고 출력을 다 냄) → 거울(받은 변화를 기록·판단으로 넘김).
 *  기한(ms, 세 단계를 합친 시간)을 넘기면 false. 노드가 없으면(BRAIN 꺼짐) 비울 것이 없어 true. */
export async function drainNodes(core: HomeCore, ms = DRAIN_MS): Promise<boolean> {
  const end = Date.now() + ms;
  const left = () => Math.max(0, end - Date.now());
  const inputs = await Promise.all([core.perception?.drain(ms), core.out.act?.drain(ms), core.out.brain?.drain(ms), core.out.phone?.drain(ms), core.out.devices?.drain(ms)]);
  const world = (await core.worldNode?.settle(left())) ?? true;
  const brain = (await core.brainMirror?.node.settled(left())) ?? true;
  const mirror = (await core.mirror?.node.settled(left())) ?? true;
  const goal = (await core.goalMirror?.node.settled(left())) ?? true;
  const manager = (await core.managerNode?.settled(left())) ?? true;
  const orders = (await core.out.manager?.drain(left())) ?? true;
  const goals = (await core.out.goal?.drain(left())) ?? true;
  const applied = (await core.mirror?.node.settled(left())) ?? true;
  const transitions = (await core.out.act?.drain(left())) ?? true;
  const delivered = (await core.phoneNode?.settled(left())) ?? true;
  const recorded = (await core.machineRecorder?.settled(left())) ?? true;
  return inputs.every((x) => x !== false) && world && brain && mirror && goal && manager && orders && goals && applied && transitions && delivered && recorded;
}

/** 노드를 끝낸다. 먼저 닫기 전 비우기(drainNodes, 기한을 넘겨도 멈춘다: 닫기가 걸리지 않게)를 하고,
 *  그다음 새 일을 만드는 쪽(인식) → 집 상태 → 거울·폰·가전 차례로 끝낸다. 관찰 흐름을 닫고 가전 구독을 끊은 뒤 부른다. */
export async function stopNodes(core: HomeCore): Promise<void> {
  for (const feedback of core.followupFeedback.values()) core.out.act?.push("/act/log", feedback);
  core.followupFeedback.clear();
  await core.localizer?.close();
  await drainNodes(core, 3 * DRAIN_MS);
  for (const n of [core.perception?.node, core.worldNode?.node, core.brainMirror?.node, core.goalMirror?.node, core.managerNode, core.mirror?.node, core.phoneNode, core.devicesNode, core.machineRecorder]) await n?.stop();
}

/** 관찰 흐름(src/observe/pipeline.ts)을 연다: 판단·실행 기록은 emit으로, 물체 모양·World State는 대시보드로, 변화는 실행 추적·판단 호출로. 실행 추적을 만든 뒤 부른다. */
export async function startPipeline(core: HomeCore, emit: (event: BrainLog) => void): Promise<void> {
  const { ctx } = core;
  const { env, log, runtimeDir, history } = ctx;
  const perception = core.perception!;
  const { engineHeaders } = core;
  core.pipeline = await createPipeline({
    needsHouseholdPhoto:()=>{
      const map=core.scene?.stations;
      if(core.tvWatch?.armed() || core.checkingVisit || core.roomWatch?.needsPhoto(map?.kitchen_entry ?? null)) return true;
      const dining=map?.stations.find(s=>s.id===map.meal_watch);
      return !!dining && !!core.view()?.objects.some(o=>o.cls==="cup" && o.status==="present" && o.surface && dining.surfaces.includes(o.surface));
    },
    localize:core.localizer ? (f,h)=>core.localizer!.request(f,h) : undefined,
    env, log, world: perception.port, inject: ctx.brain, emit, trace: core.trace,
    // 물체 모양은 /perception/detections로(폰 노드가 대시보드로만 보낸다)
    onSeen: (e) => perception.seen(e),
    // 주기 판단(기본 5초)은 엔진 프레임이 오는 동안만 부른다
    onFrame: () => {
      void perception.node.publish("/perception/frame_seen", { at_ms: core.nowMs() }).catch((e: Error) => { if (!core.closed) log(e.message); });
    },
    onView: (f) => { void perception.node.publish("/perception/view", f).catch((e: Error) => { if (!core.closed) log(e.message); }); },
    // VLM 사진 간격을 1초로 줄이는 때: 실행 추적이 가까이 보거나 목표가 선 동안, TV 규칙이 시청 구역을 지켜보는 동안
    vlmFast: () => (core.tracker?.fastVlm() ?? false) || (core.tvWatch?.watching() ?? false),
    // 분석한 프레임은 디스크에 쓰지 않는다. DATASET_COLLECT=1일 때만 시험 자료로 RUNTIME_DIR/dataset에 쓴다
    dataset: env.DATASET_COLLECT?.trim() === "1"
      ? (frame) => { history.write.dataset(join(runtimeDir, "dataset"), frame).catch((e: Error) => log(`[경고] 시험 자료를 쓰지 못했어요: ${e.message}`)); }
      : undefined,
    onDetected: (jpeg, r) => {
      const h = engineHeaders.get(jpeg);
      if (h && r.landmarks?.length) core.phone?.landmarks(h, r.landmarks);
    },
  });
}
