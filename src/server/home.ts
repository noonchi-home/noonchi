// 집 하나의 실행 묶음: twin 데이터 → 허브(신호 출처로 감쌈) → 정책·에이전트 → 배치·기준점 → 관찰 흐름·World State·판단·실행 추적·보기 담당(관찰 모드)·계획 → 앱 → 폰 서버.
// 승인 기억(runtime/homes/<집>/approvals.json, src/agent/approval.ts)은 집마다 하나이고 정책(가전 명령)과 실행 추적(PAM 계획)이 같이 쓴다.
// 집을 바꾸면 이 묶음을 통째로 닫고 새로 만든다(src/server/start.ts). 앱은 직접 듣지 않고, 껍데기 서버가 요청을 넘긴다(shell.ts).

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { checkDecision, checkPlan, loadActConfig } from "../act/index.js";
import { Looker } from "../act/index.js";
import { SAY_DONE_MS, sayLine } from "../act/index.js";
import { LessonStore, lessonsPath } from "../act/index.js";
import { lookTargets, matchChoice, taskOf, tasksFor } from "../act/tasks.js";
import { APPROVE } from "../act/prompts.js";
import { EXEC_TEXT } from "../act/labels.js";
import { deviceRunner } from "../act/index.js";
import { ExecutionTracker } from "../act/index.js";
import { Agent } from "../agent/index.js";
import { ApprovalStore, approvalsPath } from "../agent/index.js";
import { Observer } from "../agent/index.js";
import { Planner } from "../agent/index.js";
import { placesOf, type PlaceInfo } from "../agent/index.js";
import type { PlaceNames, LayoutEditor } from "../layout/index.js";
import { Policy } from "../agent/index.js";
import { createProvider } from "../agent/index.js";
import { deviceViews } from "../agent/index.js";
import { PamClient, ThoughtWriter, lastStoredThought, storeThought, thoughtFeed, type ThoughtFeed } from "../brain/index.js";
import type { ThoughtEvent } from "../contract/events.js";
import type { BrainLog, ReadyView, SeenEvent } from "../contract/events.js";
import type { ApprovalAnswer, PlannedCommand } from "../contract/phone.js";
import type { PlanView } from "../contract/plan.js";
import type { AssistMode, ControlMode } from "../contract/setup.js";
import type { HistoryDb, DeviceNote } from "../brain/index.js";
import { memoryForDay, type ReflectResult } from "../brain/index.js";
import { FEEDBACK_TEXT, PHOTO_TEXT } from "../brain/index.js";
import { datasetWriter } from "../brain/index.js";
import { SignalHub, type SignalSource } from "../devices/index.js";
import { loadEndpoints } from "../infer/endpoints.js";
import { createInference } from "../infer/inference.js";
import { createPipeline, type ObservationPipeline, type PipelineInject } from "../observe/index.js";
import type { DeviceHub, DeviceState } from "../contract/devices.js";
import { FOCUS_TTL_MS, focusFromActions, type Focus } from "../layout/index.js";
import { loadLayout } from "../layout/index.js";
import { loadTwin, type TwinData } from "../layout/index.js";
import { listHomes } from "../layout/index.js";
import { loadScene } from "../layout/index.js";
import { EyeFeed } from "../phone/index.js";
import { orderPhoneUrls } from "../phone/index.js";
import { createPhoneServer, type PhoneServer } from "../phone/index.js";
import { estimateViewpoint } from "../phone/index.js";
import { eyeHeightOf, floorLookup, homeBounds, readScenePlan } from "../layout/index.js";
import type { FrameHeader } from "../phone/index.js";
import { twinLandmarks } from "../phone/index.js";
import { StartStore, describeStart, readStartPose, startPosePath, type StartPose } from "../phone/index.js";
import { wallSegments } from "../phone/index.js";
import { repoPath } from "../shared/paths.js";
import { PlanHub } from "../act/index.js";
import { HEARD_MARK } from "../world/labels.js";
import { floorPlanFrom, roomNamedAt } from "../layout/index.js";
import { surfacesFromLayout, type PlaneSurface } from "../world/index.js";
import { Decider } from "../brain/index.js";
import { WorldState } from "../world/index.js";
import { Trigger, loadTriggerConfig } from "../world/index.js";
import type { ThinqLink } from "../devices/index.js";
import { createApp, type TwinHomeApp } from "./app.js";
import { startHub, type HubKind, type MatterTransport, type StartHubOptions } from "./hubFactory.js";

type Env = Record<string, string | undefined>;

/** 기록 DB와 기록기(src/brain/history/recorder.ts)에 넘기는 곳. 서버(start.ts)가 만들고 집을 바꿔도 같은 것을 쓴다. */
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

/** 영상 모드 영상 공용 폴더(저장소 runtime/videos). 시연 폴더(RUNTIME_DIR=runtime/demo/day1·week)로 띄워도 여기서 읽는다:
 *  영상은 커서 시연 폴더마다 복사하지 않고, 시연 폴더를 지우는 준비 명령(demo-setup --fresh)이 이은 폴더를 따라 지우지 않게 정션도 쓰지 않는다. */
const SHARED_VIDEO_DIR = repoPath("runtime/videos/");
/** 영상 모드 영상 폴더: PHONE_VIDEO_DIR, 없으면 공용 runtime/videos(RUNTIME_DIR와 상관없다). */
export function phoneVideoDir(env: Record<string, string | undefined>): string {
  return env.PHONE_VIDEO_DIR?.trim() || SHARED_VIDEO_DIR;
}

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
  /** 지금 돕는 방식(눈치·코치). 없으면 눈치 모드. 판단 호출이 그때그때 읽는다. */
  assist?: () => AssistMode;
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
  /** 폰 위치 맞추기 시작 위치 저장소(집 scene.json이 있을 때). */
  start?: StartStore;
  app: TwinHomeApp;
  twinDir: string;
  phoneUrls: string[];
  /** 폰 서버가 실제로 잡은 포트(PHONE_PORT가 없으면 undefined). */
  phonePort?: number;
  /** ThinQ 연결을 바꾼다(실제 모드). 이전 연결은 멈추고, 새 연결은 붙인 뒤 읽기를 시작한다. null이면 뗀다. */
  setLink(link: ThinqLink | null): void;
  /** 반성 사건(src/server/start.ts가 넘긴다): 말풍선 카드가 20초 동안 배운 습관을 말한다. */
  onReflection(event: Extract<BrainLog, { type: "reflection" }>): void;
  close(): Promise<void>;
}

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

/** 명령 대상·가까이 볼 자리(이름과 트윈 자리 [x, 높이, y]): 면(식탁·싱크대처럼 윗면이 있는 배치)이면 윗면 가운데(싱크볼이 있으면 윗면 높이의 싱크볼 가운데),
 *  그 밖은 배치 가운데. 배치 가운데는 싱크대면 높이 약 0.45m라, 대상을 겨눈 폰 사진에서 윗면(컵이 놓이는 곳)보다 한참 아래다.
 *  컵은 싱크볼에 넣으므로 폰 고리·가까이 보기·영상 모드 폰이 보는 곳은 조리대 가운데가 아니라 싱크볼이다. */
function placeLocator(editor: LayoutEditor | undefined, surfaces: () => PlaneSurface[]) {
  return (id: string): { label: string; position: [number, number, number] } | undefined => {
    const c = editor?.center(id);
    if (!c) return undefined;
    const top = surfaces().find((s) => s.id === id);
    const at = top?.basin?.center ?? top?.center;
    return { label: c.label, position: top && at ? [at[0], top.top, at[1]] : c.position };
  };
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
  let looker: Looker | null = null;
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
    // 들은 말(실제 폰이 들은 말 가운데 명령의 답이 아닌 말)을 기록·방송에 그대로 남길지(KEEP_HEARD_TEXT=1, 기본 꺼짐: 「들은 말 있음」만)
    const keepHeard = /^(1|true|on)$/i.test(env.KEEP_HEARD_TEXT?.trim() ?? "");
    const agent = new Agent({ hub: signals, policy, rooms: twin.rooms, provider, layout, keepHeard });
    // 에이전트 계획 모드(src/agent/planner.ts): PAM이 고른 행동 하나를 단계 계획으로. 말 요청 에이전트와 같은 공급자
    const planner = new Planner({ provider });
    // 에이전트 관찰 모드(src/agent/observer.ts): 잘 못 볼 때 가까이 보기·사람 부탁·기다리기 중 하나를 고른다. 말 요청·계획 모드와 같은 공급자
    const observer = new Observer({ provider });
    const twinDir = home.outDir;
    const hubKind = started.kind;
    const phoneOn = Boolean(env.PHONE_PORT?.trim());
    // 사진 이벤트는 본 서버 /events로 나간다. 앱보다 먼저 만들어 /api/eye/*를 앱에 넘기므로 broadcast는 나중에 잇는다
    const appRef: { current?: TwinHomeApp } = {};
    const feed = phoneOn
      ? new EyeFeed({
        photoDir: env.PHONE_PHOTO_DIR?.trim() || join(runtimeDir, "photos"), broadcast: (m) => appRef.current?.broadcast(m),
        // 사진 찍기 사진은 보관 기간이 지나면 지운다(src/brain/history/retention.ts)
        onSaved: (p) => {
          history.db.addPhoto({ ...p, origin: "photo" });
          history.db.add("photo", p.atMs, PHOTO_TEXT.saved, { subject: p.id });
        },
      })
      : undefined;
    // 폰 위치 맞추기(src/phone/sync): 시작 위치(설정 4단계에서 자리·방향) + 물건 기준점(엔진 프레임 YOLO) + 벽 모양(hit 벽 점)
    const eyeHeightM = eyeHeightOf(env.PHONE_EYE_HEIGHT_M);
    const phoneRef: { current?: PhoneServer } = {};
    // 방·벽(시작 위치 범위·방 검사, 방 바닥 높이, 벽 모양 짝). scene.json이 없거나 깨졌으면 빈 목록
    const plan = readScenePlan(home.scenePath);
    const bounds = homeBounds(plan.rooms);
    const startPath = startPosePath(runtimeDir, home.id);
    let savedStart: StartPose | null = null;
    try {
      savedStart = readStartPose(startPath);
    } catch (e) {
      log(`[경고] ${(e as Error).message}. 시작 위치 없이 시작합니다.`);
    }
    const twinObjects = () => layout?.editor.objects() ?? [];
    const startStore = existsSync(home.scenePath)
      ? new StartStore(startPath, bounds, (p, yaw) => describeStart(twinObjects(), plan.rooms, p, yaw), (s) => phoneRef.current?.setStart(s), savedStart, plan.rooms)
      : undefined;
    const landmarksNow = () => (layout ? twinLandmarks(layout.editor.objects(), layout.catalog) : []);
    // 「냉장고 여기로」처럼 배치를 고치면 기준점 자리도 바꾼다
    layout?.editor.subscribe(() => phoneRef.current?.setLandmarks(landmarksNow()));
    // 엔진 프레임 헤더(찍은 순간 AR 자세·투영): 감지가 끝나면 기준점 상자와 함께 폰 위치 맞추기로 넘긴다
    const engineHeaders = new WeakMap<Buffer, FrameHeader>();
    // 클로이드 계획(src/act/hub.ts): 에이전트 기기 행동·맞춘 눈 → 계획을 /events로. 경로는 서버 장면(scene.json + 도면 설비)으로 찾는다
    const scene = loadScene(home);
    const floorPlan = floorPlanFrom(scene ?? {});
    // 계획 입력의 평면도 물건(벽·바닥·문·창은 뺀다): 배치 이름과 부를 짧은 이름(종류 짧은 이름 → 카탈로그 종류 이름 → 배치 이름)
    // 부르는 이름 자료(src/layout/names.ts): 카탈로그 종류 이름과 배치 이름. 계획 단계·실행 추적·비전 상태 줄이 같은 것을 쓴다
    const placeNames: PlaceNames = { typeLabel: (t) => layout?.editor.typeLabel(t), layoutName: (id) => layout?.editor.center(id)?.label };
    const places = (): PlaceInfo[] => placesOf(floorPlan, placeNames);
    // 대시보드 말풍선 카드(src/act/say.ts): 계획 방송·실제 폰 명령·World State 바뀜·판단 타이머 뒤에 다시 보고, 글이 바뀔 때만 보낸다
    let speak = () => {};
    const plans = new PlanHub(floorPlan, (m) => {
      appRef.current?.broadcast(m);
      if (m.type === "plan" && m.plan) history.plan(m.plan);
      speak();
    });
    // 관찰 흐름(BRAIN=1): 폰 엔진 프레임마다 YOLO·VLM이 분석하고 World State가 합친다(src/observe/pipeline.ts)
    const brainWanted = /^(1|true|on)$/i.test(env.BRAIN?.trim() ?? "");
    // 트윈 윗면(식탁·싱크대): World State가 물건을 놓고, 명령 대상·가까이 보기는 자리의 윗면 가운데를 본다
    const surfaces = surfaceSource(layout?.editor);
    const placeAt = placeLocator(layout?.editor, surfaces);
    if (brainWanted && !phoneOn) log("[경고] BRAIN=1은 PHONE_PORT가 있어야 합니다(폰 카메라가 입력). 관찰 흐름을 끕니다.");
    // 카메라로 본 가전 상태는 허브로 넘긴다(src/devices/hub/signals.ts observe): 실제 출처가 없으면 기기 상태가 되고, 실제 상태와 다르면 처음 한 번 로그에 남긴다
    const world = brainWanted && phoneOn
      ? new WorldState({
        surfaces, floorAt: floorLookup(plan.rooms), roomAt: roomNamedAt(floorPlan, twin.rooms), devices: () => signals.list(),
        locate: (id) => { const c = layout?.editor.center(id); return c ? [c.position[0], c.position[2]] : null; },
        place: (id) => layout?.editor.center(id)?.position ?? null,
        see: (id, seen, at, evidence) => {
          const r = signals.observe(id, seen, at, evidence);
          if (r.kind === "mismatch") log(`카메라로 본 값이 기기 값과 달라 기기 값을 둡니다: ${specOf.get(id)?.label ?? id} 카메라 ${JSON.stringify(seen)} · 기기 ${JSON.stringify(r.real)}`);
          return r;
        },
      })
      : null;
    // 실행 설정(STALE_MS). 틀린 값이면 시작을 막는다
    const act = loadActConfig(env);
    const nowMs = () => ctx.brain?.clock?.now() ?? Date.now();
    // 실제 폰에 낸 지금 명령(실행 추적이 보낸 것), 마지막 판단, 마지막 물체 모양(seen): 새로 붙은 대시보드에도 보낸다
    let command: PlannedCommand | null = null;
    let lastDecision: BrainLog | null = null;
    // 생각 말풍선 두 줄(src/brain/thought.ts): 판단 기록 뒤에 따로 만들어 대시보드로 보내고 기록 DB(thought)에 남긴다(관찰 흐름이 있을 때)
    let thoughts: ThoughtFeed | null = null;
    // 새로 붙은 대시보드에 다시 보낼 두 줄: 보낸 것이 없으면 기록 DB의 마지막 두 줄이 마지막 판단과 행동이 같을 때 그 판단 id로
    const thoughtNow = (): ThoughtEvent | null => {
      const sent = thoughts?.last();
      if (sent) return sent;
      const d = lastDecision?.type === "decision" && lastDecision.status === "valid" ? lastDecision : null;
      const kept = d?.action ? lastStoredThought(history.db, Date.now()) : null;
      return d && kept && kept.action === d.action ? { type: "thought", id: d.id, ...kept } : null;
    };
    let lastSeen: SeenEvent | null = null;
    let said: string | null = null;
    // 마지막으로 가까이 보기를 시작한 자리와 시각(말풍선 카드 6초)
    let lookSay: { place: string; atMs: number } | null = null;
    // 마지막 반성 시각과 새로 배운 규칙 수·쓰고 있는 습관 수(말풍선 카드 20초)
    let reflected: { atMs: number; learned: number; active: number } | null = null;
    // 새로 붙은 대시보드에 다시 보낼 오늘(기록 시간대) 마지막 반성 사건: 기록 DB reflection 줄에서 읽는다(합성 판본도 같다)
    const todayReflection = (): BrainLog[] => {
      const db = history.db;
      const row = db.list({ day: db.dayOf(Date.now()), kinds: ["reflection"], latest: true, limit: 1 })[0];
      if (!row) return [];
      const data = (row.data ?? {}) as Partial<Extract<BrainLog, { type: "reflection" }>>;
      return [{
        type: "reflection", at_ms: row.at_ms, day: data.day ?? row.day, ok: data.ok === true, version: data.version ?? null, applies_day: data.applies_day ?? null, text: row.text,
        ...(data.learned ? { learned: data.learned } : {}), ...(data.active ? { active: data.active } : {}), ...(data.dropped ? { dropped: data.dropped } : {}),
      }];
    };
    // 끝난 지 20초·가까이 보기 6초는 계획 updatedAt(PlanHub, Date.now)과 같은 시계로 잰다
    speak = () => {
      const leftAt = tracker?.leftAt() ?? null;
      const toldAt = tracker?.toldAt() ?? null;
      const text = sayLine({ plan: plans.current(), command, world: world?.view(nowMs()) ?? null, nowMs: Date.now(), look: lookSay, left: leftAt === null ? null : { atMs: leftAt },
        told: toldAt === null ? null : { atMs: toldAt }, quiet: tracker?.quietStep() ?? null, reflected, offWait: tracker?.offWaiting() ?? null,
        offTold: tracker?.offTold() ?? null });
      if (text === said) return;
      said = text;
      appRef.current?.broadcast({ type: "say", text });
    };
    // 수업 기록(코치 계획의 잘한 단계 말 줄이기, runtime/homes/<집>/lessons.json)
    const lessons = new LessonStore(lessonsPath(runtimeDir, home.id));
    // 돕는 방식(눈치·코치): 판단 호출이 그때그때 읽는다(집을 다시 띄우지 않고 바뀐다)
    const assist = () => ctx.assist?.() ?? "noonchi";
    if (world) {
      const now = () => ctx.brain?.clock?.now() ?? Date.now();
      // 판단·계획은 두 줄을 기다리지 않는다: 판단 기록을 보낸 뒤 부르고, 두 줄이 오면 그 판단 id로 보낸다
      // 같은 행동이 이어지는 동안은 처음 두 줄을 다시 보낸다. 다시 띄우면 기록의 마지막 두 줄(10분 안)을 이어 쓴다
      const feed = thoughtFeed({
        writer: new ThoughtWriter({ chat: createInference(env).thought }), send: (m) => appRef.current?.broadcast(m),
        record: (m) => storeThought(history.db, m, Date.now()), seed: lastStoredThought(history.db, Date.now()),
      });
      thoughts = feed;
      const emit = (event: BrainLog) => {
        if (event.type === "decision") lastDecision = event;
        appRef.current?.broadcast({ type: "brain", event });
        history.brain(event);
        if (event.type === "decision") feed.decision(event);
      };
      // 판단 호출(src/brain/decide.ts): World State 관찰 텍스트 + 기억 + 행동 목록으로 PAM 서비스를 부른다.
      // 기억은 그날 처음 정한 판본(src/brain/history/reflect.ts). 관찰 텍스트 시각은 기록 DB와 같은 시간대
      const pamTimeout = Number(env.PAM_TIMEOUT_MS);
      const decide = new Decider({
        pam: new PamClient({ url: loadEndpoints(env).pamUrl, timeoutMs: Number.isFinite(pamTimeout) && pamTimeout > 0 ? pamTimeout : undefined }),
        world, trigger: new Trigger(loadTriggerConfig(env), now()), tasks: () => tasksFor(assist()),
        memory: () => memoryForDay(history.db, history.db.dayOf(now())), emit, offsetMinutes: history.db.offsetMinutes, clock: ctx.brain?.clock,
        // 행동 중 기다리기·기기 단계 동안은 PAM을 부르지 않는다(실행 추적이 조건을 본다)
        hold: () => (tracker?.waiting() ?? false) || (tracker?.coaching() ?? false),
        keepHeard: () => keepHeard,
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
        // 실행 추적이 놓기 단계를 끝낸 물건(placed)도 이미 치운 것으로 본다
        precheck: (d) => checkDecision({ decision: d, tasks: d.tasks ?? tasksFor(assist()), world: world.view(now()), nowMs: now(), placed: tracker?.placed() }),
        // 계획 입력·제출 검사도 이미 치운 물건(placed, 이 계획을 만들 때 것)을 안다: 입력 줄에 「이미 치움」, 그 물건을 대상으로 한 계획은 버린다
        planner: (d, signal) => {
          const task = taskOf(d.action);
          if (!task) return { ok: false, error: "행동 목록에 없는 행동" };
          return planner.plan({
            decision: d, task, world: world.view(now()), floor: plans.floor(), places: places(), names: placeNames, rooms: twin.rooms, devices: deviceViews(signals), nowIso: new Date(now()).toISOString(),
            placed: new Map(tracker?.placed() ?? []), ...(task.coach ? { lesson: lessons.get(task.name) } : {}),
          }, signal);
        },
        // 실제 폰 명령(src/contract/phone.ts). 폰 서버가 지금 명령을 기억해 새로 붙은 폰에도 보낸다. 명령 대상 자리는 배치(면이면 윗면 가운데)에서
        toPhone: (m) => {
          if (m.type === "command") command = m;
          else if (!m.id || command?.id === m.id) command = null;
          // 안전 명령(끄기 안내·부탁)은 실제 폰에서 승인 대기 카드보다 먼저 보인다: 가린 동안 승인 시간 제한을 멈춘다
          policy.pause(command?.grade === "safety");
          phoneRef.current?.command(m);
          if (m.type === "command") speak();
        },
        locate: placeAt, names: placeNames,
        check: (d, p) => checkPlan({
          decision: d, tasks: d.tasks ?? tasksFor(assist()), plan: p, world: world.view(now()), nowMs: now(), staleMs: act.staleMs, mode: ctx.mode?.() ?? "test", deviceSteps: deviceSteps(p),
          placed: tracker?.placed(),
        }),
        lessons,
        // 손으로 켜는 단계가 위험 목록 가전인지(켜기 전에 묻는다)와 묻는 글의 가전 이름
        handDevices: () => deviceViews(signals),
        // 판본이 맞는 실제 폰이 붙어 있는가: 폰이 필요한 계획만 그때 시작한다(폰 서버를 켜지 않았으면 늘 붙어 있다고 본다)
        phoneReady: () => phoneRef.current?.ready() ?? true,
        // 다른 계획이 도는 동안 줄에서 기다리는 끄기 안내: 명령 줄을 바꾸지 않고 붙은 폰에 소리로만 알린다
        sayAloud: (text) => phoneRef.current?.reply(text, "safety"),
        // 멈춘 집기·놓기 단계는 보기 담당(관찰 모드 A)에 알린다
        stalled: (s) => looker?.stalled(s) ?? false,
        // 코치 계획 중 다른 행동을 본 것 같으면 보기 담당(관찰 모드 계기 off_track)에 알린다
        strayed: (s) => looker?.strayed(s) ?? false,
      });
      const tracking = tracker;
      pipeline = await createPipeline({
        env, log, world, inject: ctx.brain, emit,
        // 물체 모양은 대시보드로만 보낸다(초당 10번이라 기록 DB·실행 기록에 넣지 않는다)
        onSeen: (e) => {
          lastSeen = e;
          appRef.current?.broadcast(e);
        },
        broadcastWorld: (w) => {
          appRef.current?.broadcast({ type: "world", world: w });
          speak();
        },
        onChanges: (c) => {
          tracking.onWorld(c);
          decide.onChanges(c);
        },
        // 주기 판단(기본 5초)은 엔진 프레임이 오는 동안만 부른다
        onFrame: () => decide.onFrame(),
        // 분석한 프레임은 디스크에 쓰지 않는다. DATASET_COLLECT=1일 때만 시험 자료로 RUNTIME_DIR/dataset에 쓴다
        dataset: env.DATASET_COLLECT?.trim() === "1" ? datasetWriter(join(runtimeDir, "dataset"), history.db) : undefined,
        onDetected: (jpeg, r) => {
          const h = engineHeaders.get(jpeg);
          if (h && r.landmarks?.length) phoneRef.current?.landmarks(h, r.landmarks);
        },
      });
      const observed = pipeline;
      // 보기 담당(src/act/look.ts): 멈춘 단계(A)와 판단 전 보기(B)에 관찰 모드를 한 번에 하나 부르고 고른 도구를 실행한다
      looker = new Looker({
        observer, closer: (spot, signal) => observed.closer(spot, signal), frame: () => observed.latest(), world: () => world.view(now()),
        askPerson: (planId, stepId, spot) => tracking.askCloser(planId, stepId, spot), tell: (planId, stepId, mode) => tracking.tell(planId, stepId, mode), emit, targets: lookTargets, placed: () => tracking.placed(), clock: ctx.brain?.clock,
        onLook: (spot) => {
          lookSay = { place: spot.label, atMs: Date.now() };
          speak();
        },
      });
      const looking = looker;
      decideTimer = setInterval(() => {
        observed.tick(); // 오래 이어진 가전 상태(냉장고 문 1분)
        decide.tick();
        tracking.tick();
        looking.tick();
        speak();
      }, 250);
      decideTimer.unref?.();
      for (const s of signals.states()) world.applyDevice(s, now()); // 시작 상태는 변화로 내지 않는다
      const observing = pipeline;
      unsubWorld = signals.subscribe((s) => observing.onDevice(s));
    }
    // 실제 폰이 들은 말 가운데 지금 명령의 답이 아닌 말: 관찰 텍스트 한 줄로 판단 호출에 넘긴다(눈치 모드에서도).
    // 그 말 자체는 기록하지 않는다: 기록·대시보드에는 내용 없는 표시(HEARD_MARK)만 남긴다. KEEP_HEARD_TEXT=1이면 그대로 남긴다(기본 꺼짐)
    /** 실제 폰 세션의 지금 승인 대기 목록(폰에 보내는 모양). */
    const phonePending = () => agent.pending(PHONE_SESSION).map((p) => ({ token: p.token, deviceLabel: p.deviceLabel, reason: p.reason, choices: p.choices }));
    const heardSpeech = (text: string) => {
      if (!world || !decider) return;
      const changes = world.heard(text, nowMs());
      if (!changes.length) return;
      decider.onChanges(changes);
      const event: BrainLog = { type: "world_change", at_ms: nowMs(), kind: "heard", text: keepHeard ? changes[0]!.text : HEARD_MARK };
      appRef.current?.broadcast({ type: "brain", event });
      history.brain(event);
    };
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
      brain: observe ? { status: () => ({ ...observe.status(), look: looker?.status() ?? null }) } : undefined, world: worldNow ?? undefined,
      home: { id: home.id, name: home.name }, homes: listHomes(twin.dir), layout: layout?.editor, phoneUrls: () => phoneUrls, mode: ctx.mode, webDir: ctx.webDir, allowOrigin: ctx.allowOrigin, planToken: ctx.planToken, ready: ctx.ready,
      start: startStore && { get: () => startStore.get(), save: (raw) => startStore.save(raw), preview: (raw) => startStore.preview(raw), clear: () => startStore.clear() },
      phoneSync: () => phoneRef.current?.syncState() ?? null,
      plan: plans, offTrack: () => tracker?.offTrack() ?? null, history: history.db, reflect: history.reflect, scene: () => scene,
      brainLast: () => [...todayReflection(), ...(lastDecision ? [lastDecision] : [])], thoughtLast: thoughtNow, seenLast: () => lastSeen, say: () => said,
    });
    const appNow = app;
    appRef.current = app;
    speak();
    let phonePort: number | undefined;
    if (phoneOn) {
      // 맞추기 전에도 원뿔이 보이게: 창가 고정 위치 + 폰 방향(추정, 사진에는 쓰지 않음)
      const fallback = estimateViewpoint(JSON.parse(readFileSync(home.scenePath, "utf8").replace(/^﻿/, "")));
      phone = createPhoneServer({
        eyeHeightM, feed, log, fallback, floorAt: floorLookup(plan.rooms), videoDir: phoneVideoDir(env),
        sync: { landmarks: landmarksNow(), walls: wallSegments(plan), start: startStore?.get() ?? null },
        onEye: (eye) => {
          appNow.broadcast({ type: "eye", eye });
          plans.onEye([eye.position[0], eye.position[1]], eye.estimated === true);
          tracker?.onEye([eye.position[0], eye.position[1]], eye.estimated === true);
        },
        // 실제 폰은 늘 듣는다: 주변 말로 가전 승인을 확정하지 않게 말 전체가 승인·거절 답일 때만 받는다(src/act/prompts.ts APPROVE)
        onSay: async (text) => {
          // 코치 계획의 사람 단계 중 들은 말(명령의 답이 아님): 관찰 모드가 지금 할 일을 다시 알리거나(told) 답하지 않으면(waited) 말 요청 에이전트를 부르지 않는다.
          // 이 일과 상관없는 말(passed)이거나 관찰 모드가 바쁘면 지금처럼 말 요청 에이전트로 넘긴다
          const at = tracker?.coachStep() ?? null;
          if (at && looker && (await looker.heard(at.planId, at.stepId, text, at)) !== "passed") return { reply: "", pending: [] };
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
        // 들은 말을 에이전트보다 먼저 본다(at: 말할 때 폰에 떠 있던 명령·보인 승인 대기). 「그만」은 실제 폰 명령이 없는 단계(기다리기·기기)에도 계획을 그만둔다.
        // 지금 명령의 답이고 at이 그 명령이면 그 답으로 받는다. 말할 때와 다른 명령에 온 답(늦은 답·옛 탭)이면 버린다: 들은 말로만 남기고 에이전트로 보내지 않는다.
        // 말 전체가 승인·거절 답이면 말할 때 보인 승인 대기 token이 하나이고 지금도 대기일 때만 그 하나에 답한다(agent.answerToken). 그 밖에는 버린다(answerAll 없음)
        onAnswer: async (text, at) => {
          const open = tracker?.openCommand();
          const stale = () => {
            heardSpeech(text);
            history.db.add("execution", nowMs(), EXEC_TEXT.staleAnswer, { subject: open?.planId ?? (at?.kind === "command" ? at.id : PHONE_SESSION) });
            return { handled: true, reply: "" };
          };
          // 말로 한 승인·거절: 말할 때 보인 승인 대기 token이 하나이고 지금도 대기일 때 그 하나에만 답한다.
          // at에 승인 token이 있으면 명령(실행 추적)의 답으로 보내지 않는다(뒤에 숨은 명령 승인으로 가지 않게)
          const approval = matchChoice(text, APPROVE);
          // 답한 뒤(버린 때도) 지금 승인 대기 목록을 같이 보낸다: 단추 답처럼 끝난 질문이 폰에 남지 않게
          const byToken = async () => {
            const live = new Set(agent.pending(PHONE_SESSION).map((p) => p.token));
            const token = at?.pending.length === 1 && live.has(at.pending[0]!) ? at.pending[0]! : null;
            const reply = token ? (await agent.answerToken(token, approval!.id as ApprovalAnswer)).reply : stale().reply;
            return { handled: true, reply, pending: phonePending() };
          };
          if (approval && at && at.pending.length > 0) return byToken();
          const heard = tracker?.onHeard(text, at) ?? null;
          if (heard?.kind === "answer") {
            if (open) history.db.add("feedback", nowMs(), FEEDBACK_TEXT.answer(text, open.kind, open.text), { subject: open.planId, data: { choice: heard.choice.id, via: "voice" } });
            return { handled: true, reply: heard.choice.reply };
          }
          if (heard?.kind === "stale") return stale();
          if (approval) return byToken();
          heardSpeech(text);
          return { handled: false };
        },
        // 폰이 판본 hello로 정상이 되면 지금 승인 대기 목록을 다시 받는다
        pending: () => phonePending(),
        ...(observe ? {
          engineMs: observe.config.engineMs,
          onEngine: (jpeg, h, eye, view, at) => {
            engineHeaders.set(jpeg, h);
            observe.onEngine(jpeg, h, eye, view, at);
          },
        } : {}),
      });
      const phoneServer = phone;
      phoneRef.current = phone;
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
      start: startStore, app: appNow, twinDir, phoneUrls, phonePort,
      onReflection(event) {
        if (!event.ok) return;
        reflected = { atMs: event.at_ms, learned: event.learned?.length ?? 0, active: event.active?.length ?? 0 };
        speak();
        setTimeout(() => speak(), SAY_DONE_MS + 50).unref?.();
      },
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
          ["초점", unsubFocus], ["관찰 흐름", () => { clearInterval(decideTimer); decider?.stop(); tracker?.stop(); looker?.stop(); planner.abort(); unsubWorld(); return pipeline?.close(); }], ["눈 화면", () => feed?.close()],
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
    looker?.stop();
    unsubWorld();
    await pipeline?.close().catch(() => {});
    unsubHistory();
    await signals.stop().catch(() => {});
    throw e;
  }
}
