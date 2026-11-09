// 집 하나의 실행 묶음: twin 데이터 → 허브(신호 출처로 감쌈) → 정책·에이전트 → 배치·기준점 → 관찰 흐름·World State·판단·실행 추적·계획 → 앱 → 폰 서버.
// 승인 기억(runtime/homes/<집>/approvals.json, src/agent/approval.ts)은 집마다 하나이고 정책(가전 명령)과 실행 추적(PAM 계획)이 같이 쓴다.
// 집을 바꾸면 이 묶음을 통째로 닫고 새로 만든다(src/server/start.ts). 앱은 직접 듣지 않고, 껍데기 서버가 요청을 넘긴다(shell.ts).

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { checkDecision, checkPlan, loadActConfig } from "../act/check.js";
import { sayLine } from "../act/say.js";
import { TASK_NAMES, taskOf } from "../act/tasks.js";
import { deviceRunner } from "../act/devices.js";
import { ExecutionTracker } from "../act/track.js";
import { Agent } from "../agent/agent.js";
import { ApprovalStore, approvalsPath } from "../agent/approval.js";
import { Planner } from "../agent/planner.js";
import type { PlaceInfo } from "../agent/planTools.js";
import { Policy } from "../agent/policy.js";
import { createProvider } from "../agent/providers/index.js";
import { deviceViews } from "../agent/tools.js";
import { PamClient } from "../brain/pam.js";
import type { BrainLog, ReadyView } from "../contract/events.js";
import type { PlannedCommand } from "../contract/phone.js";
import type { PlanView } from "../contract/plan.js";
import type { ControlMode } from "../contract/setup.js";
import type { HistoryDb } from "../history/db.js";
import type { DeviceNote } from "../history/recorder.js";
import { memoryForDay, type ReflectResult } from "../history/reflect.js";
import { FEEDBACK_TEXT, PHOTO_TEXT } from "../history/labels.js";
import { datasetWriter } from "../history/retention.js";
import { SignalHub, type SignalSource } from "../hub/signals.js";
import { loadEndpoints } from "../infer/endpoints.js";
import { createPipeline, type ObservationPipeline, type PipelineInject } from "../observe/pipeline.js";
import type { DeviceHub, DeviceState } from "../hub/types.js";
import type { LayoutEditor } from "../layout/editor.js";
import { FOCUS_TTL_MS, focusFromActions, type Focus } from "../layout/focus.js";
import { loadLayout } from "../layout/load.js";
import { loadTwin, type TwinData } from "../model/devices.js";
import { listHomes } from "../model/homes.js";
import { loadScene } from "../model/scene.js";
import { loadAnchorTargets, type AnchorTarget } from "../phone/anchors.js";
import { autoCorners, parseWallPick, pickedRoom, readScenePlan } from "../phone/corners.js";
import { EyeFeed } from "../phone/feed.js";
import { orderPhoneUrls } from "../phone/links.js";
import { createPhoneServer, type PhoneServer } from "../phone/server.js";
import { estimateViewpoint } from "../phone/session.js";
import { TouchStore, eyeHeightOf, floorLookup, homeBounds, readTouchPoints, touchPointsPath, touchTargets, type TouchPoint } from "../phone/touch.js";
import { PlanHub } from "../plan/hub.js";
import { placeShort } from "../plan/labels.js";
import { floorPlanFrom, roomNamedAt } from "../plan/route.js";
import { surfacesFromLayout, type PlaneSurface } from "../world/place.js";
import { Decider } from "../world/decide.js";
import { WorldState } from "../world/state.js";
import { Trigger, loadTriggerConfig } from "../world/trigger.js";
import type { ThinqLink } from "../thinq/link.js";
import { createApp, type TwinHomeApp } from "./app.js";
import { startHub, type HubKind, type MatterTransport, type StartHubOptions } from "./hubFactory.js";

type Env = Record<string, string | undefined>;

/** 기록 DB와 기록기(src/history/recorder.ts)에 넘기는 곳. 서버(start.ts)가 만들고 집을 바꿔도 같은 것을 쓴다. */
export interface HomeHistory {
  db: HistoryDb;
  device(s: DeviceState, note?: DeviceNote): void;
  brain(l: BrainLog): void;
  plan(p: PlanView): void;
  /** 그날을 반성한다(POST /api/reflection/run). 이미 반성 중이면 409. */
  reflect(day: string): Promise<ReflectResult>;
}

/** 폰에서 말한 것은 "phone" 세션 하나로 이어진다(대시보드 대화와 따로 기억). */
const PHONE_SESSION = "phone";

export interface HomeContext {
  env: Env;
  log: (line: string) => void;
  runtimeDir: string;
  /** 폰 서버 포트. 집을 바꿔도 처음 잡은 포트를 다시 쓴다. */
  phonePort?: number;
  /** 집 id·기기 id → 저장해 둔 신호 출처. */
  sources: (homeId: string, deviceIds: string[]) => Record<string, SignalSource>;
  importer?: StartHubOptions["importer"];
  matter?: Record<string, unknown>;
  /** 시험용: 관찰 흐름의 감지기·VLM·시계. */
  brain?: PipelineInject;
  /** 폰 포트로 이어진 https 주소 찾기(tailscale serve). */
  servedPhoneUrls?: (phonePort: number) => Promise<string[]>;
  /** 지금 운영 모드(/api/health). 없으면 시험 모드. */
  mode?: () => ControlMode;
  /** 대시보드·설정 화면 폴더. 없으면 React 빌드(ui/dist). */
  webDir?: string;
  /** 허용할 브라우저 출처(ALLOWED_ORIGINS). 없으면 이 PC만. */
  allowOrigin?: (origin: string) => boolean;
  /** 계획 보내기 토큰(PLAN_TOKEN). */
  planToken?: string;
  /** 준비 상태(/api/health ready). 집을 바꿔도 같은 것을 쓴다. */
  ready?: () => Promise<ReadyView>;
  /** 기록 DB·기록기·반성. */
  history: HomeHistory;
}

export interface HomeRuntime {
  twin: TwinData;
  /** 숨은 세계(실제 시뮬레이터). 엔진·화면은 signals로 읽는다. */
  hub: DeviceHub;
  signals: SignalHub;
  hubKind: HubKind;
  transport?: MatterTransport;
  warnings: string[];
  policy: Policy;
  agent: Agent;
  layout?: LayoutEditor;
  /** 기준점 A·B 저장소(집 scene.json이 있을 때). */
  touch?: TouchStore;
  app: TwinHomeApp;
  twinDir: string;
  phoneUrls: string[];
  /** 폰 서버가 실제로 잡은 포트(PHONE_PORT가 없으면 undefined). */
  phonePort?: number;
  /** ThinQ 연결을 바꾼다(실제 모드). 이전 연결은 멈추고, 새 연결은 붙인 뒤 읽기를 시작한다. null이면 뗀다. */
  setLink(link: ThinqLink | null): void;
  close(): Promise<void>;
}

/** 트윈의 식탁·책상·조리대·싱크대 윗면(물건의 트윈 위치). 배치가 바뀌면 다시 만든다. */
function surfaceSource(editor: LayoutEditor | undefined): () => PlaneSurface[] {
  if (!editor) return () => [];
  let cache: PlaneSurface[] | null = null;
  editor.subscribe(() => { cache = null; });
  return () => (cache ??= surfacesFromLayout(editor.objects().map((o) => {
    const c = editor.center(o.id);
    return {
      id: o.id, name: o.name, type: o.type, plan: o.plan.position, base: o.position[1],
      height: c ? Math.max(0, 2 * (c.position[1] - o.position[1])) : o.height ?? 0, footprint: o.footprint,
    };
  })));
}

/** homeId가 없으면 기본 집. 실패하면 만든 것을 닫고 던진다. */
export async function startHome(homeId: string | undefined, ctx: HomeContext): Promise<HomeRuntime> {
  const { env, log, runtimeDir } = ctx;
  const twin = loadTwin(env.TWIN_STUDIO_DIR, { home: homeId });
  log(`twin 데이터: 집 ${twin.home.id}(${twin.home.name}) · ${twin.source} (${twin.dir}) · 기기 ${twin.devices.length}개 · 방 ${twin.rooms.length}개`);
  for (const w of twin.warnings) log(`[경고] ${w}`);

  const started = await startHub(twin, { env, log, importer: ctx.importer, matter: { log, ...ctx.matter } });
  const signals = new SignalHub(started.hub, ctx.sources(twin.home.id, twin.devices.map((d) => d.id)));
  const none = Object.keys(signals.sources()).length;
  if (none > 0) log(`신호 출처: 신호 없음 ${none}개(상태를 모름으로 보임)`);
  // 가전 변화 기록: 시작 상태는 기억만 하고, 그 뒤 바뀐 값을 적는다
  const specOf = new Map(twin.devices.map((d) => [d.id, d]));
  const { history } = ctx;
  for (const s of signals.states()) history.device(s, { initial: true, label: specOf.get(s.id)?.label, kind: specOf.get(s.id)?.kind });
  const unsubHistory = signals.subscribe((s) => history.device(s, { label: specOf.get(s.id)?.label, kind: specOf.get(s.id)?.kind }));
  let pipeline: ObservationPipeline | null = null;
  let unsubWorld = () => {};
  let decider: Decider | null = null;
  let tracker: ExecutionTracker | null = null;
  let decideTimer: NodeJS.Timeout | undefined;
  let app: TwinHomeApp | undefined;
  let phone: PhoneServer | undefined;
  try {
    const { home } = twin;
    const approvals = new ApprovalStore(approvalsPath(runtimeDir, home.id));
    const policy = new Policy({ approvals });
    const { provider, warning } = createProvider(env);
    if (warning) log(`[경고] ${warning}`);
    const layout = loadLayout(home, { runtimeDir, log });
    if (!layout) log(`[경고] ${home.scenePath}이 없어 배치 보정을 끕니다(twin-studio에서 집을 먼저 빌드하세요).`);
    const agent = new Agent({ hub: signals, policy, rooms: twin.rooms, provider, layout });
    // 에이전트 계획 모드(src/agent/planner.ts): PAM이 고른 행동 하나를 단계 계획으로. 말 요청 에이전트와 같은 공급자
    const planner = new Planner({ provider, hub: signals, policy, rooms: twin.rooms });
    const twinDir = home.outDir;
    const hubKind = started.kind;
    const phoneOn = Boolean(env.PHONE_PORT?.trim());
    // 사진 이벤트는 본 서버 /events로 나간다. 앱보다 먼저 만들어 /api/eye/*를 앱에 넘기므로 broadcast는 나중에 잇는다
    const appRef: { current?: TwinHomeApp } = {};
    const feed = phoneOn
      ? new EyeFeed({
        photoDir: env.PHONE_PHOTO_DIR?.trim() || join(runtimeDir, "photos"), broadcast: (m) => appRef.current?.broadcast(m),
        // 사진 찍기 사진은 보관 기간이 지나면 지운다(src/history/retention.ts)
        onSaved: (p) => {
          history.db.addPhoto({ ...p, origin: "photo" });
          history.db.add("photo", p.atMs, PHOTO_TEXT.saved, { subject: p.id });
        },
      })
      : undefined;
    // 벽 대기 맞춤 기준점 A·B(설정 4단계에서 고름). 저장·지우면 실행 중인 폰 세션의 기준점이 바로 바뀐다
    const eyeHeightM = eyeHeightOf(env.PHONE_EYE_HEIGHT_M);
    const touchPath = touchPointsPath(runtimeDir, home.id);
    let savedTouch: TouchPoint[] | null = null;
    try {
      savedTouch = readTouchPoints(touchPath);
    } catch (e) {
      log(`[경고] ${(e as Error).message}. 평면도 바닥 기준점으로 맞춥니다.`);
    }
    const phoneRef: { current?: PhoneServer; floor?: AnchorTarget[] } = {};
    // 방·벽(기준점 범위 검사·방 바닥 높이·벽 하나로 구석 찾기). scene.json이 없거나 깨졌으면 빈 목록
    const plan = readScenePlan(home.scenePath);
    const bounds = homeBounds(plan.rooms);
    const touchStore = existsSync(home.scenePath)
      ? new TouchStore(touchPath, bounds, (points) => {
        if (!phoneRef.current || !phoneRef.floor) return;
        if (points) phoneRef.current.setTargets(touchTargets(points), "touch");
        else phoneRef.current.setTargets(phoneRef.floor, "floor");
      }, savedTouch)
      : undefined;
    // 클로이드 계획(src/plan/hub.ts): 에이전트 기기 행동·맞춘 눈 → 계획을 /events로. 경로는 서버 장면(scene.json + 도면 설비)으로 찾는다
    const scene = loadScene(home);
    const floorPlan = floorPlanFrom(scene ?? {});
    // 계획 입력의 평면도 물건(벽·바닥·문·창은 뺀다): 배치 이름과 비전 상태 줄의 짧은 이름
    const places = (): PlaceInfo[] => {
      const names = new Map((layout?.editor.objects() ?? []).map((o) => [o.id, o.name]));
      return [...floorPlan.objects.values()].filter((o) => !/^(walls|floors)$|door|win/.test(o.type)).map((o) => {
        const name = names.get(o.id) ?? o.id;
        return { id: o.id, type: o.type, room: o.room, position: o.position, name, short: placeShort(o.type) ?? name };
      });
    };
    // 대시보드 말풍선 카드(src/act/say.ts): 계획 방송·실제 폰 명령·World State 바뀜·판단 타이머 뒤에 다시 보고, 글이 바뀔 때만 보낸다
    let speak = () => {};
    const plans = new PlanHub(floorPlan, (m) => {
      appRef.current?.broadcast(m);
      if (m.type === "plan" && m.plan) history.plan(m.plan);
      speak();
    });
    // 관찰 흐름(BRAIN=1): 폰 엔진 프레임마다 YOLO·VLM이 분석하고 World State가 합친다(src/observe/pipeline.ts)
    const brainWanted = /^(1|true|on)$/i.test(env.BRAIN?.trim() ?? "");
    if (brainWanted && !phoneOn) log("[경고] BRAIN=1은 PHONE_PORT가 있어야 합니다(폰 카메라가 입력). 관찰 흐름을 끕니다.");
    const world = brainWanted && phoneOn
      ? new WorldState({
        surfaces: surfaceSource(layout?.editor), floorAt: floorLookup(plan.rooms), roomAt: roomNamedAt(floorPlan, twin.rooms), devices: () => signals.list(),
        locate: (id) => { const c = layout?.editor.center(id); return c ? [c.position[0], c.position[2]] : null; },
      })
      : null;
    // 실행 설정(STALE_MS). 틀린 값이면 시작을 막는다
    const act = loadActConfig(env);
    const nowMs = () => ctx.brain?.clock?.now() ?? Date.now();
    // 실제 폰에 낸 지금 명령(실행 추적이 보낸 것), 마지막 판단, 상자 있는 마지막 observe: 새로 붙은 대시보드에도 보낸다
    let command: PlannedCommand | null = null;
    let lastDecision: BrainLog | null = null;
    let lastBoxes: BrainLog | null = null;
    let said: string | null = null;
    // 끝난 지 20초는 계획 updatedAt(PlanHub, Date.now)과 같은 시계로 잰다
    speak = () => {
      const text = sayLine({ plan: plans.current(), command, world: world?.view(nowMs()) ?? null, nowMs: Date.now() });
      if (text === said) return;
      said = text;
      appRef.current?.broadcast({ type: "say", text });
    };
    if (world) {
      const now = () => ctx.brain?.clock?.now() ?? Date.now();
      const emit = (event: BrainLog) => {
        if (event.type === "decision") lastDecision = event;
        else if (event.type === "observe" && event.boxes) lastBoxes = event;
        appRef.current?.broadcast({ type: "brain", event });
        history.brain(event);
      };
      // 판단 호출(src/world/decide.ts): World State 관찰 텍스트 + 기억 + 행동 목록으로 PAM 서비스를 부른다.
      // 기억은 그날 처음 정한 판본(src/history/reflect.ts). 관찰 텍스트 시각은 기록 DB와 같은 시간대
      const pamTimeout = Number(env.PAM_TIMEOUT_MS);
      const decide = new Decider({
        pam: new PamClient({ url: loadEndpoints(env).pamUrl, timeoutMs: Number.isFinite(pamTimeout) && pamTimeout > 0 ? pamTimeout : undefined }),
        world, trigger: new Trigger(loadTriggerConfig(env), now()), tasks: () => [...TASK_NAMES],
        memory: () => memoryForDay(history.db, history.db.dayOf(now())), emit, offsetMinutes: history.db.offsetMinutes, clock: ctx.brain?.clock,
        // 행동 중 기다리기·기기 단계 동안은 PAM을 부르지 않는다(실행 추적이 조건을 본다)
        hold: () => tracker?.waiting() ?? false,
        // 판단 → 계획 → 실행 전 검사 → 실행 추적(src/act/)
        onDecision: (d) => tracker?.onDecision(d),
      });
      decider = decide;
      // 실행 전 검사(src/act/check.ts): 시험 모드에서는 짝지은 실제 가전 단계를 막는다
      const deviceSteps = (p: PlanView) => p.steps.flatMap((s) => (s.target?.deviceId
        ? [{ deviceId: s.target.deviceId, paired: signals.sources()[s.target.deviceId]?.kind === "thinq" }] : []));
      // 기기 단계(src/act/devices.ts): 말 요청과 같은 기기 도구·정책(위험 목록은 승인 토큰). 보내기 바로 앞에서 그 계획 단계가 아직인지 본다
      const devices = deviceRunner(signals, policy, twin.rooms);
      tracker = new ExecutionTracker({
        plans, floor: () => plans.floor(), world: () => world.view(now()), emit, clock: ctx.brain?.clock, approvals, devices, offsetMinutes: history.db.offsetMinutes,
        // 계획 전 검사(LLM 없음) → 에이전트 계획 모드 한 번. 손 자리는 맞춘 눈(PlanHub 평면도의 로봇 자리)
        precheck: (d) => checkDecision({ decision: d, tasks: [...TASK_NAMES], world: world.view(now()), nowMs: now() }),
        planner: (d, signal) => {
          const task = taskOf(d.action);
          if (!task) return { ok: false, error: "행동 목록에 없는 행동" };
          return planner.plan({
            decision: d, task, world: world.view(now()), floor: plans.floor(), places: places(), rooms: twin.rooms, devices: deviceViews(signals), nowIso: new Date(now()).toISOString(),
          }, signal);
        },
        // 실제 폰 명령(src/contract/phone.ts). 폰 서버가 지금 명령을 기억해 새로 붙은 폰에도 보낸다. 명령 대상 자리는 배치(물건 가운데)에서
        toPhone: (m) => {
          if (m.type === "command") command = m;
          else if (!m.id || command?.id === m.id) command = null;
          phoneRef.current?.command(m);
          if (m.type === "command") speak();
        },
        locate: (id) => layout?.editor.center(id),
        check: (d, p) => checkPlan({
          decision: d, tasks: [...TASK_NAMES], plan: p, world: world.view(now()), nowMs: now(), staleMs: act.staleMs, mode: ctx.mode?.() ?? "test", deviceSteps: deviceSteps(p),
        }),
      });
      const tracking = tracker;
      pipeline = await createPipeline({
        env, log, world, inject: ctx.brain, emit,
        broadcastWorld: (w) => {
          appRef.current?.broadcast({ type: "world", world: w });
          speak();
        },
        onChanges: (c) => {
          tracking.onWorld();
          decide.onChanges(c);
        },
        // 주기 판단(기본 5초)은 엔진 프레임이 오는 동안만 부른다
        onFrame: () => decide.onFrame(),
        // 분석한 프레임은 디스크에 쓰지 않는다. DATASET_COLLECT=1일 때만 시험 자료로 RUNTIME_DIR/dataset에 쓴다
        dataset: env.DATASET_COLLECT?.trim() === "1" ? datasetWriter(join(runtimeDir, "dataset"), history.db) : undefined,
      });
      const observed = pipeline;
      decideTimer = setInterval(() => {
        observed.tick(); // 오래 이어진 가전 상태(냉장고 문 1분)
        decide.tick();
        tracking.tick();
        speak();
      }, 250);
      decideTimer.unref?.();
      for (const s of signals.states()) world.applyDevice(s, now()); // 시작 상태는 변화로 내지 않는다
      const observing = pipeline;
      unsubWorld = signals.subscribe((s) => observing.onDevice(s));
    }
    if (!decideTimer) {
      // 관찰 흐름이 꺼져 판단 타이머가 없으면 말풍선 글만 본다(끝난 지 20초가 지나면 지켜보기로)
      decideTimer = setInterval(speak, 1000);
      decideTimer.unref?.();
    }
    const observe = pipeline;
    const worldNow = world && (() => world.view(ctx.brain?.clock?.now() ?? Date.now()));
    let phoneUrls: string[] = [];
    app = createApp({
      hub: signals, policy, agent, rooms: twin.rooms, twinDir, viewerDir: home.viewerDir, libraryDir: home.libraryDir, hubKind, log, eye: feed,
      brain: observe ?? undefined, world: worldNow ?? undefined,
      home: { id: home.id, name: home.name }, homes: listHomes(twin.dir), layout: layout?.editor, phoneUrls: () => phoneUrls, mode: ctx.mode, webDir: ctx.webDir, allowOrigin: ctx.allowOrigin, planToken: ctx.planToken, ready: ctx.ready,
      touch: touchStore && {
        get: () => touchStore.get(), save: (raw) => touchStore.save(raw), clear: () => touchStore.clear(), eyeHeightM,
        auto: (raw) => autoCorners(plan, parseWallPick(raw), bounds),
        room: (raw) => pickedRoom(plan, parseWallPick(raw)),
      },
      plan: plans, history: history.db, reflect: history.reflect, scene: () => scene,
      brainLast: () => [lastDecision, lastBoxes].filter((e): e is BrainLog => e !== null), say: () => said,
    });
    const appNow = app;
    appRef.current = app;
    speak();
    let phonePort: number | undefined;
    if (phoneOn) {
      const floor = loadAnchorTargets(home.scenePath, join(home.dataDir, "floorplan.json"));
      const touch = touchStore?.get() ?? null;
      // 맞추기 전에도 원뿔이 보이게: 창가 고정 위치 + 폰 방향(추정, 사진에는 쓰지 않음)
      const fallback = estimateViewpoint(JSON.parse(readFileSync(home.scenePath, "utf8").replace(/^﻿/, "")));
      const maxMismatch = Number(env.PHONE_MAX_MISMATCH_M);
      phone = createPhoneServer({
        targets: touch ? touchTargets(touch) : floor, mode: touch ? "touch" : "floor", eyeHeightM, feed, log, fallback,
        floorAt: floorLookup(plan.rooms),
        maxMismatchM: Number.isFinite(maxMismatch) && maxMismatch > 0 ? maxMismatch : undefined,
        onEye: (eye) => {
          appNow.broadcast({ type: "eye", eye });
          plans.onEye([eye.position[0], eye.position[1]], eye.estimated === true);
          tracker?.onEye([eye.position[0], eye.position[1]], eye.estimated === true);
        },
        // 실제 폰은 늘 듣는다: 주변 말로 가전 승인을 확정하지 않게 말 전체가 승인·거절 답일 때만 받는다(src/act/prompts.ts APPROVE)
        onSay: async (text) => {
          const r = await agent.chat(PHONE_SESSION, text, { heard: true });
          return { reply: r.reply, pending: r.pendingConfirmations.map((p) => ({ token: p.token, deviceLabel: p.deviceLabel, reason: p.reason, choices: p.choices })) };
        },
        // 승인 답(승인·거절): 위험 목록이라 둘 다 이번만이고 기억하지 않는다
        onConfirm: async (token, choice) => ({ reply: (await agent.confirm(token, choice)).reply }),
        onCancel: async (token) => ({ reply: agent.cancel(token).reply }),
        // 실제 폰 명령·질문의 답(「완료」·질문 답 단추, 말 「완료」「다 했어」「그만」). 답으로 맞은 것만 반성 피드백으로 남긴다(늘 듣기의 주변 말은 남기지 않는다)
        onChoice: (id, step, choice) => {
          const open = tracker?.openCommand();
          const picked = open?.choices.find((c) => c.id === choice);
          if (open && picked && tracker?.onAnswer(id, step, choice)) {
            history.db.add("feedback", nowMs(), FEEDBACK_TEXT.answer(picked.label, open.kind, open.text), { subject: id, data: { choice, via: "button" } });
          }
        },
        // 「그만」은 실제 폰 명령이 없는 단계(기다리기·기기)에도 진행 중인 계획을 그만둔다
        onAnswer: (text) => {
          const open = tracker?.openCommand();
          const picked = tracker?.onHeard(text) ?? null;
          if (!picked) return { handled: false };
          if (open) history.db.add("feedback", nowMs(), FEEDBACK_TEXT.answer(text, open.kind, open.text), { subject: open.planId, data: { choice: picked.id, via: "voice" } });
          return { handled: true, reply: picked.reply };
        },
        ...(observe ? {
          engineMs: observe.config.engineMs,
          onEngine: (jpeg, h, eye, view, at) => observe.onEngine(jpeg, h, eye, view, at),
        } : {}),
      });
      const phoneServer = phone;
      phoneRef.current = phone;
      phoneRef.floor = floor;
      layout?.editor.setHere(() => phoneServer.here());
      const wantedPhone = ctx.phonePort ?? Number(env.PHONE_PORT);
      const listened = await phone.listen(Number.isInteger(wantedPhone) && wantedPhone >= 0 ? wantedPhone : 8210, env.PHONE_HOST?.trim() || "0.0.0.0");
      // 폰 주소: PHONE_URL → tailscale serve https → 와이파이(대시보드 QR은 맨 앞 주소).
      // PHONE_LAN_URLS=0(compose)이면 이 기계 네트워크 주소를 넣지 않는다: 컨테이너 안 주소는 밖에서 열 수 없다
      const served = await (ctx.servedPhoneUrls?.(listened.port) ?? Promise.resolve([])).catch(() => []);
      const lanOff = /^(0|false|off)$/i.test(env.PHONE_LAN_URLS?.trim() ?? "");
      phoneUrls = orderPhoneUrls(lanOff ? [] : listened.urls, served, env.PHONE_URL);
      phonePort = (phone.server.address() as { port: number } | null)?.port;
    }
    // 초점: 에이전트가 다룬 물건을 대시보드와 폰에 알린다(표시 전용)
    const sendFocus = (targets: Focus["targets"]) => {
      if (targets.length === 0) return;
      const focus: Focus = { targets, at: new Date().toISOString(), ttl_ms: FOCUS_TTL_MS };
      appNow.broadcast({ type: "focus", focus });
      phone?.sendFocus(targets, FOCUS_TTL_MS);
    };
    const locate = (id: string) => layout?.editor.center(id);
    // 초점 표시는 기본으로 끈다(사용자 요청). FOCUS=1일 때만 대시보드·폰·3D에 보낸다
    const focusOn = /^(1|true|on)$/i.test(env.FOCUS?.trim() ?? "");
    const unsubFocus = !focusOn ? () => {} : agent.subscribe((e) => {
      if (e.event === "reply") sendFocus(focusFromActions(e.actions, locate));
      else if (e.event === "confirmed" && e.ok && e.deviceId) sendFocus(focusFromActions([{ tool: "confirm", args: {}, ok: true, deviceId: e.deviceId, at: "" }], locate));
    });
    let closed = false;
    const phoneNow = phone;
    let link: ThinqLink | null = null;
    return {
      twin, hub: started.hub, signals, hubKind, transport: started.transport, warnings: started.warnings, policy, agent, layout: layout?.editor,
      touch: touchStore, app: appNow, twinDir, phoneUrls, phonePort,
      setLink(next) {
        link?.stop();
        link = closed ? null : next;
        signals.setLink(link);
        link?.start().catch((e) => log(`[경고] ThinQ 읽기를 시작하지 못했어요: ${(e as Error).message}`));
      },
      async close() {
        if (closed) return;
        closed = true;
        // 한 단계가 실패해도 나머지(특히 폰 포트·허브)는 닫는다. 새 집이 같은 포트를 다시 잡아야 한다
        const steps: [string, () => unknown][] = [
          ["초점", unsubFocus], ["관찰 흐름", () => { clearInterval(decideTimer); decider?.stop(); tracker?.stop(); planner.abort(); unsubWorld(); return pipeline?.close(); }], ["눈 화면", () => feed?.close()],
          ["폰 서버", () => phoneNow?.close()], ["앱", () => appNow.close()], ["배치", () => layout?.editor.close()], ["ThinQ", () => link?.stop()],
          ["기록", unsubHistory], ["허브", () => signals.stop()],
        ];
        for (const [name, step] of steps) {
          try {
            await step();
          } catch (e) {
            log(`[경고] 집 ${twin.home.id} 닫기: ${name}을(를) 닫지 못했습니다(${(e as Error).message})`);
          }
        }
      },
    };
  } catch (e) {
    await phone?.close().catch(() => {});
    await app?.close().catch(() => {});
    clearInterval(decideTimer);
    decider?.stop();
    tracker?.stop();
    unsubWorld();
    await pipeline?.close().catch(() => {});
    unsubHistory();
    await signals.stop().catch(() => {});
    throw e;
  }
}
