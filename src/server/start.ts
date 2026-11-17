// 서버 시작(npm start·데모·e2e 테스트 공용): 껍데기 서버(포트·설정 API) + 집 실행 묶음(src/server/home/).
// 설정 흐름(집 → 가전 → 운영 모드 → 위치 동기화 → 대시보드): 집을 고르면 묶음을 닫고 새 집으로 다시 만든다. 포트는 그대로다.
// 운영 모드: 시험(기본, ThinQ를 부르지 않음) · 실제(짝지은 에어컨·냉장고는 ThinQ). ThinQ 클라이언트는 실제 모드에서만 만든다.

import { randomUUID } from "node:crypto";
import { join } from "node:path";
import type { Agent, Policy } from "../agent/index.js";
import { openBus, type Bus } from "../bus/index.js";
import { agentEndpoint } from "../agent/index.js";
import type { BrainLog } from "../contract/events.js";
import type { PlanView } from "../contract/plan.js";
import type { AssistMode, ControlMode, SetupView, ThinqDeviceView } from "../contract/setup.js";
import type { SignalHub } from "../devices/index.js";
import { HistoryDb, historyTzMinutes } from "../brain/index.js";
import { REFLECT_TEXT } from "../brain/index.js";
import { attachRecorder, topic, type DeviceNote } from "../brain/index.js";
import { loadReflectAt, runReflection, scheduleReflection, type ReflectResult } from "../brain/index.js";
import { loadRetention, sweep } from "../brain/index.js";
import { PamClient, pamSettings } from "../brain/index.js";
import type { DeviceHub, DeviceState } from "../contract/devices.js";
import { loadEndpoints } from "../infer/endpoints.js";
import type { LayoutEditor } from "../layout/index.js";
import { KIND_LABELS } from "../devices/index.js";
import type { PipelineInject } from "../observe/index.js";
import { resolveTwinStudioDir, type TwinData } from "../layout/index.js";
import { listHomes } from "../layout/index.js";
import { acquireServerLock, restoreNeeded } from "./lock.js";
import { KINDS } from "../devices/kinds.js";
import { checkKinds } from "../devices/index.js";
import { SetupError, SetupStore, effectiveSources, parsePairs, parseSources } from "./setup/store.js";
import { repoPath } from "../shared/paths.js";
import { PAIRABLE_KINDS, fitsKind } from "../devices/index.js";
import { ThinqClient, ThinqError, thinqConfig } from "../devices/index.js";
import { DEFAULT_POLL_MS, DEFAULT_READBACK_MS, ThinqLink } from "../devices/index.js";
import { HttpError, originChecker, type TwinHomeApp } from "./app.js";
import type { HubKind, MatterTransport, StartHubOptions } from "./hubFactory.js";
import { startHome, type HomeContext, type HomeRuntime } from "./home/index.js";
import { makeReady } from "./ready.js";
import { createShell } from "./shell.js";

type Env = Record<string, string | undefined>;

/** 실행 중 만든 파일(사진·배치 수정본·설정) 폴더(커밋하지 않음). RUNTIME_DIR로 바꾼다. */
const DEFAULT_RUNTIME_DIR = repoPath("runtime/");

const msOf = (raw: string | undefined, fallback: number) => {
  const n = Number(raw);
  return raw?.trim() && Number.isFinite(n) && n >= 0 ? n : fallback;
};
const msListOf = (raw: string | undefined, fallback: number[]) => {
  const list = (raw ?? "").split(",").map((x) => Number(x.trim())).filter((n) => Number.isFinite(n) && n >= 0);
  return raw?.trim() && list.length > 0 ? list : fallback;
};

export interface StartServerOptions {
  /** 기본 process.env. HUB, MATTER_*, AGENT_PROVIDER, TWIN_STUDIO_DIR, HOME_ID(저장한 집이 없을 때 띄울 집, 기본 집), PORT(0이면 빈 포트), HOST,
   *  ALLOWED_ORIGINS(이 PC 말고 대시보드를 여는 출처, 쉼표로 여러 개), PLAN_TOKEN(다른 주소에서 POST /api/plan을 받을 토큰),
   *  추론 모드(openai 기본·vllm)·VLM_BASE_URL·VLM_MODEL·VLM_CLOSER_MODEL·VLM_API_KEY·VLM_EXTRA_BODY·PAM_LLM_*(src/infer/endpoints.ts),
   *  기록 DB는 RUNTIME_DIR/noonchi.db, HISTORY_TZ_MINUTES(기록 날짜의 시간대 분, 기본 540), REFLECT_AT(매일 반성 시각 HH:MM, 기본 23:30, off면 끔),
   *  PHOTO_RETENTION_DAYS·DATASET_RETENTION_DAYS(사진 찍기 사진·시험 자료 보관 일, 기본 7), DATASET_COLLECT(1이면 엔진 프레임을 시험 자료로 저장),
   *  PHONE_PORT(있으면 폰 AR 서버), PHONE_HOST(기본 0.0.0.0),
   *  PHONE_EYE_HEIGHT_M(바닥 hit이 없을 때 폰 높이에서 빼는 눈높이, 기본 1.5), PHONE_URL(폰 주소 맨 앞), PHONE_LAN_URLS(0이면 폰 주소에 이 기계 네트워크 주소를 넣지 않음, compose),
   *  FOCUS(1이면 초점 표시를 보낸다, 기본 끔), PHONE_PHOTO_DIR(사진 폴더, 기본 runtime/photos), PHONE_VIDEO_DIR(영상 모드 영상 폴더, 기본 공용 runtime/videos, RUNTIME_DIR와 상관없음), RUNTIME_DIR(배치 수정본·설정의 바탕, 기본 runtime),
   *  BRAIN(1이면 폰 엔진 프레임으로 관찰 흐름을 돌린다. PHONE_PORT 필요, VLM은 추론 모드가 고른 주소),
   *  ENGINE_FRAME_MS·VLM_FRAME_MS·VLM_WINDOW_FRAMES·VLM_MAX_INFLIGHT·DETECT_QUEUE_MAX·BRAIN_YOLO_PATH·BRAIN_POSE_PATH·BRAIN_YOLO_THREADS·BRAIN_YOLO_PROVIDER·BRAIN_POSE_EVERY(src/observe/pipeline.ts),
   *  FALL_DROP_MS·FALL_HOLD_MS·FALL_GAP_MS·FALL_TORSO_DEG·FALL_THIGH_DEG·FALL_VIEW_DEG(쓰러짐 의심 시간·각도, src/world/fall.ts),
   *  THINQ_TOKEN(실제 모드), THINQ_REGION·THINQ_COUNTRY·THINQ_CLIENT_ID·THINQ_API_KEY·THINQ_BASE_URL·THINQ_TIMEOUT_MS(src/devices/thinq/client.ts),
   *  THINQ_POLL_MS(짝지은 기기 읽기 간격, 기본 15000, 0이면 처음 한 번), THINQ_READBACK_MS(명령 뒤 다시 읽기 전 기다림, 기본 1000,2000,4000)을 읽는다. */
  env?: Env;
  log?: (line: string) => void;
  /** true면 설정(고른 집·끝냄·신호 출처)을 RUNTIME_DIR에 저장하고 다음 시작 때 읽는다(npm start). 기본은 메모리에만 두고 「끝냄」으로 시작. */
  persistSetup?: boolean;
  /** 테스트용: matter 모듈 불러오기. */
  importer?: StartHubOptions["importer"];
  /** MatterHub 추가 옵션. */
  matter?: Record<string, unknown>;
  /** 테스트용: 관찰 흐름의 감지기·VLM·시계. */
  brain?: PipelineInject;
  /** 폰 포트로 이어진 https 주소 찾기(main.ts는 tailscale serve 설정을 읽는다). 없으면 찾지 않는다. */
  servedPhoneUrls?: (phonePort: number) => Promise<string[]>;
  /** 대시보드·설정 화면 폴더. 기본은 React 빌드(ui/dist). */
  webDir?: string;
  /** 시험용: 노드 통로 열기(기본 openBus: REDIS_URL이면 RedisBus, 아니면 MemoryBus). */
  openBus?: (env: Env, o: { boot: string; log?: (s: string) => void; onLost: (err: Error) => void }) => Promise<Bus>;
  /** 통로를 잃었을 때(Redis가 다시 켜짐) 서버를 닫은 뒤 부르는 끝내기(기본 process.exit). */
  exit?: (code: number) => void;
}

/** 집 실행 묶음에서 오는 값은 집을 바꾸면 새 집 것으로 바뀐다(getter). */
export interface RunningServer {
  url: string;
  port: number;
  readonly app: TwinHomeApp;
  /** 숨은 세계(실제 시뮬레이터 허브). 엔진·화면이 보는 것은 signals다. */
  readonly hub: DeviceHub;
  readonly signals: SignalHub;
  readonly hubKind: HubKind;
  /** hubKind가 matter일 때 실제 전송(network가 실패하면 local). */
  readonly transport?: MatterTransport;
  /** 허브 대체 경로를 탄 이유(network→local, matter→memory). 없으면 빈 배열. */
  readonly warnings: string[];
  readonly agent: Agent;
  readonly policy: Policy;
  readonly twin: TwinData;
  /** 집 scene.json이 있으면 배치 편집기. */
  readonly layout?: LayoutEditor;
  /** 고른 집의 twin-studio 산출물 폴더(/twin/에 붙는다). */
  readonly twinDir: string;
  /** PHONE_PORT를 줬을 때 폰에서 열 주소. 없으면 빈 배열. */
  readonly phoneUrls: string[];
  readonly setup: SetupStore;
  /** 지금 운영 모드. */
  readonly mode: ControlMode;
  /** 지금 돕는 방식(눈치·코치). */
  readonly assist: AssistMode;
  /** 기록 DB(RUNTIME_DIR/noonchi.db). 집을 바꿔도 같다. */
  readonly history: HistoryDb;
  /** 다른 집으로 바꾼다(POST /api/setup/home과 같음). */
  switchHome(id: string): Promise<void>;
  close(): Promise<void>;
}

export async function startServer(opts: StartServerOptions = {}): Promise<RunningServer> {
  const env = opts.env ?? process.env;
  const log = opts.log ?? ((line: string) => console.log(line));
  // 가전 종류 등록부가 틀린 조합이면(승인·ThinQ 어댑터·손 조작) 까닭과 함께 시작을 막는다
  const kindProblems = checkKinds(KINDS);
  if (kindProblems.length) throw new Error(`가전 종류 등록부가 틀렸어요(src/devices/kinds.ts): ${kindProblems.join(" / ")}`);
  const runtimeDir = env.RUNTIME_DIR?.trim() || DEFAULT_RUNTIME_DIR;
  const store = new SetupStore({ runtimeDir, persist: opts.persistSetup ?? false, log });
  let mode: ControlMode = store.mode();
  if (mode === "live" && !thinqConfig(env).ok) {
    log("[경고] ThinQ 토큰이 없어 시험 모드로 띄웁니다. 실제 모드는 THINQ_TOKEN을 넣고 설정에서 다시 고르세요.");
    mode = "test";
  }
  // 대시보드를 여는 출처: 이 PC + ALLOWED_ORIGINS(tailscale serve 주소). 쓰기 요청과 /events에 쓴다
  const allowOrigin = originChecker(env.ALLOWED_ORIGINS);
  // 추론 모드(openai|vllm)와 모델 주소, PAM LLM 전송 값. 틀린 설정이면 잠금·DB를 열기 전에 시작을 막는다
  const endpoints = loadEndpoints(env);
  const pamConfig = pamSettings(env);
  const reflectAt = loadReflectAt(env);
  const retention = loadRetention(env);
  // 이 런타임 폴더를 쓰는 서버라는 표시(RUNTIME_DIR/server.lock.db의 SQLite 배타 잠금, src/server/lock.ts). DB를 열기 전에 잡는다:
  // 같은 폴더를 쓰는 서버·시연 준비가 이미 있으면 여기서 멈춘다. 끌 때·시작이 실패할 때 놓고, 프로세스가 죽으면 OS가 푼다
  const lock = acquireServerLock(runtimeDir);
  // 시연 준비 --fresh가 옛 항목을 다 되돌리지 못한 폴더면 DB를 열기 전에 멈춘다(파일이 두 폴더에 나뉘어 있다)
  const unfinished = restoreNeeded(runtimeDir);
  if (unfinished) {
    lock.release();
    throw new Error(unfinished);
  }
  // 기록 DB(RUNTIME_DIR/noonchi.db)와 기록기. 집 묶음이 가전·관찰·판단·계획을 넘기고, 운영 모드는 여기서 넘긴다. 시작이 실패하면 닫는다
  let db: HistoryDb;
  try {
    db = HistoryDb.open(join(runtimeDir, "noonchi.db"), historyTzMinutes(env));
  } catch (e) {
    lock.release();
    throw e;
  }
  const feed = { device: topic<[DeviceState, DeviceNote?]>(), brain: topic<[BrainLog]>(), plan: topic<[PlanView]>(), mode: topic<[ControlMode]>() };
  const stopRecorder = attachRecorder(db, { onDevice: feed.device.on, onBrain: feed.brain.on, onPlan: feed.plan.on, onMode: feed.mode.on });
  const closeDb = () => {
    stopRecorder();
    db.close();
  };
  // 노드 통로(src/bus): 기동마다 새 boot로 하나 열고 집을 바꿔도 같은 통로를 쓴다. 집을 열 때마다 집 세대(<집 id>#<연 횟수>)가 새로 붙는다.
  // Redis가 다시 켜져 이번 기동을 잃으면 그 까닭을 남기고 서버를 닫은 뒤 끝 코드 1로 끝낸다(compose restart가 새 기동으로 띄운다)
  const boot = randomUUID();
  let closeServer: (() => Promise<void>) | null = null;
  const exit = opts.exit ?? ((code: number) => process.exit(code));
  let bus: Bus;
  try {
    bus = await (opts.openBus ?? openBus)(env, {
      boot, log,
      onLost: (e) => {
        log(`[오류] ${e.message}`);
        void (closeServer?.() ?? Promise.resolve()).catch(() => {}).finally(() => exit(1));
      },
    });
  } catch (e) {
    closeDb();
    lock.release();
    throw e;
  }
  let opened = 0;
  // 반성: 한 번에 하나. 결과는 지금 집의 대시보드 판단 기록으로 보낸다(기록 DB에는 runReflection이 적는다).
  // 서버를 끌 때는 진행 중인 반성의 PAM 요청을 끊고 끝날 때까지 기다린 뒤 DB를 닫는다
  const pam = new PamClient({ settings: pamConfig });
  const closing = new AbortController();
  let reflecting: Promise<ReflectResult> | null = null;
  const reflect = async (day: string): Promise<ReflectResult> => {
    if (reflecting) throw new HttpError(409, REFLECT_TEXT.running);
    // 반성 사건은 지금 집의 대시보드로 보내고 집 묶음에도 넘긴다(말풍선 카드가 배운 습관을 말한다)
    const job = runReflection(db, pam, day, {
      signal: closing.signal,
      emit: (event) => {
        current?.app.broadcast({ type: "brain", event });
        if (event.type === "reflection") current?.onReflection(event);
      },
    });
    reflecting = job;
    try {
      return await job;
    } finally {
      reflecting = null;
    }
  };
  const ctx: HomeContext = {
    env, log, runtimeDir, importer: opts.importer, matter: opts.matter, brain: opts.brain, servedPhoneUrls: opts.servedPhoneUrls, webDir: opts.webDir,
    sources: (homeId, ids) => store.sources(homeId, ids), mode: () => mode, assist: () => store.assist(), allowOrigin, planToken: env.PLAN_TOKEN?.trim() || undefined, ready: makeReady({ endpoints, agent: agentEndpoint(env), db }),
    history: { db, device: feed.device.emit, brain: feed.brain.emit, plan: feed.plan.emit, reflect },
    bus, epochOf: (homeId) => ({ boot, home: `${homeId}#${++opened}` }),
  };
  const studioDir = resolveTwinStudioDir(env.TWIN_STUDIO_DIR);
  const pollMs = msOf(env.THINQ_POLL_MS, DEFAULT_POLL_MS);
  const readbackMs = msListOf(env.THINQ_READBACK_MS, DEFAULT_READBACK_MS);

  // ThinQ 클라이언트는 실제 모드에서 처음 필요할 때 만든다(시험 모드는 만들지 않는다)
  let client: ThinqClient | null = null;
  let thinqList: ThinqDeviceView[] | null = null;
  const thinqClient = (): ThinqClient => {
    if (client) return client;
    const c = thinqConfig(env);
    if (!c.ok) throw new HttpError(400, `${c.error} 실제 모드로 바꿀 수 없어요.`);
    client = new ThinqClient(c.config);
    return client;
  };

  /** 지금 모드·짝·저장한 출처를 집 묶음에 적용한다. 실제 모드에서 짝이 있을 때만 ThinQ 연결을 만든다. */
  const applyControl = (h: HomeRuntime, quiet = true) => {
    const homeId = h.twin.home.id;
    const ids = h.twin.devices.map((d) => d.id);
    const pairs = store.pairs(homeId, ids, { quiet });
    h.signals.setSources(effectiveSources(store.sources(homeId, ids, { quiet: true }), pairs, mode));
    h.setLink(mode === "live" && Object.keys(pairs).length > 0
      ? new ThinqLink({ client: thinqClient(), world: h.hub, pairs, log, pollMs, readbackMs })
      : null);
  };
  const openHome = async (id: string | undefined): Promise<HomeRuntime> => {
    const h = await startHome(id, ctx);
    try {
      applyControl(h, false);
    } catch (e) {
      await h.close();
      throw e;
    }
    return h;
  };

  // 저장한 집이 없거나 사라졌으면 HOME_ID(없으면 기본 집)
  const saved = store.state().home;
  const fallbackHome = env.HOME_ID?.trim() || undefined;
  let rt: HomeRuntime;
  try {
    try {
      rt = await openHome(saved ?? fallbackHome);
    } catch (e) {
      if (!saved) throw e;
      log(`[경고] 저장한 집 ${saved}를 띄우지 못했습니다(${(e as Error).message}). ${fallbackHome ?? "기본 집"}으로 띄웁니다.`);
      rt = await openHome(fallbackHome);
    }
  } catch (e) {
    await bus.close().catch(() => {});
    closeDb();
    lock.release();
    throw e;
  }
  if (mode === "live") log("운영 모드: 실제(짝지은 가전은 ThinQ)");
  ctx.phonePort = rt.phonePort;
  let current: HomeRuntime | null = rt;
  let last: HomeRuntime = rt;
  let switching = false;
  let switchError: string | null = null;
  let job: Promise<void> | null = null; // 진행 중인 집 바꾸기(close가 끝나길 기다린다)
  let closed = false;

  const homes = () => listHomes(studioDir);
  /** 설정 화면이 본 집(body.home)이 지금 집과 같아야 쓴다(다른 탭에서 집을 바꿨으면 409). */
  const requireHome = (body: Record<string, unknown>) => {
    if (!current) throw new HttpError(503, switching ? "집을 바꾸는 중이에요. 잠시 뒤 다시 해 주세요." : `집을 띄우지 못했어요: ${switchError ?? "알 수 없음"}`);
    if (typeof body.home !== "string" || !body.home) throw new HttpError(400, "home(지금 설정 중인 집 id)이 필요합니다.");
    if (body.home !== current.twin.home.id) throw new HttpError(409, `집이 바뀌었어요(지금 ${current.twin.home.name}). 설정 화면을 새로 고치세요.`);
    return current;
  };

  function switchHome(id: string): Promise<void> {
    if (closed) return Promise.reject(new HttpError(503, "서버를 끄는 중이에요."));
    if (switching) return Promise.reject(new HttpError(409, "이미 집을 바꾸는 중이에요."));
    const run = doSwitch(id);
    job = run.catch(() => {});
    return run;
  }

  async function doSwitch(id: string): Promise<void> {
    if (!homes().some((h) => h.id === id)) throw new HttpError(400, `없는 집입니다: ${id} (있는 집: ${homes().map((h) => h.id).join(", ")})`);
    if (current && current.twin.home.id === id) return;
    switching = true;
    switchError = null;
    const previous = last.twin.home.id;
    try {
      const old = current;
      current = null;
      await old?.close();
      try {
        const next = await openHome(id);
        // 바꾸는 동안 서버를 껐으면 새 묶음도 바로 닫는다
        if (closed) {
          await next.close();
          return;
        }
        current = next;
      } catch (e) {
        switchError = (e as Error).message;
        log(`[경고] 집 ${id}를 띄우지 못했습니다(${switchError}). ${previous}로 되돌립니다.`);
        try {
          const back = await openHome(previous);
          if (closed) await back.close();
          else current = back;
        } catch (e2) {
          log(`[경고] ${previous}로도 되돌리지 못했습니다: ${(e2 as Error).message}`);
        }
        throw new HttpError(400, `집 ${id}를 띄우지 못했어요: ${switchError}`);
      }
      last = current;
      log(`집을 바꿨어요: ${previous} → ${id}`);
    } finally {
      switching = false;
    }
  }

  const deviceIds = (h: HomeRuntime) => h.twin.devices.map((d) => d.id);
  const deviceViews = (h: HomeRuntime): SetupView["devices"] => {
    const stored = store.sources(h.twin.home.id, deviceIds(h), { quiet: true });
    return h.twin.devices.map((d) => ({
      id: d.id, label: d.label, room: d.room, roomLabel: d.roomLabel, kind: d.kind, kindLabel: KIND_LABELS[d.kind],
      source: stored[d.id] ?? { kind: "virtual" }, pairable: PAIRABLE_KINDS.includes(d.kind),
    }));
  };
  const view = (): SetupView => {
    const st = store.state();
    const h = current;
    return {
      ok: true, persist: store.persist, done: st.done, switching, error: switchError,
      home: h ? { id: h.twin.home.id, name: h.twin.home.name } : null, homes: homes(),
      rooms: h?.twin.rooms ?? [], devices: h ? deviceViews(h) : [], devices_saved: h ? store.hasSources(h.twin.home.id) : false,
      position: { start: !!h?.start, layout: !!h?.layout, phone_urls: h?.phoneUrls ?? [] },
      mode, assist: store.assist(), thinq: { ready: thinqConfig(env).ok }, pairs: h ? store.pairs(h.twin.home.id, deviceIds(h), { quiet: true }) : {},
    };
  };

  const shell = createShell({
    current: () => current?.app ?? null,
    webDir: opts.webDir,
    allowOrigin,
    log,
    setup: {
      view,
      done: () => store.state().done,
      async chooseHome(body) {
        const id = typeof body.home === "string" ? body.home.trim() : "";
        if (!id) throw new HttpError(400, "home(집 id)이 필요합니다.");
        await switchHome(id);
        store.setHome(id);
        return view();
      },
      setSources(body) {
        const h = requireHome(body);
        try {
          const ids = deviceIds(h);
          store.saveSources(h.twin.home.id, { ...store.sources(h.twin.home.id, ids, { quiet: true }), ...parseSources(body.sources, ids) });
        } catch (e) {
          if (e instanceof SetupError) throw new HttpError(400, e.message);
          throw e;
        }
        applyControl(h);
        return view();
      },
      setMode(body) {
        const want = body.mode;
        if (want !== "test" && want !== "live") throw new HttpError(400, "mode는 test(시험) 또는 live(실제)여야 합니다.");
        if (want === "live") {
          if (body.confirm !== true) throw new HttpError(400, "실제 모드는 화면에서 한 번 더 확인한 뒤에 바꿀 수 있어요.");
          thinqClient();
        } else {
          client = null;
          thinqList = null;
        }
        const changed = mode !== want;
        mode = want;
        store.setMode(want);
        if (changed) feed.mode.emit(want);
        if (current) applyControl(current);
        log(`운영 모드: ${want === "live" ? "실제(짝지은 가전은 ThinQ)" : "시험"}`);
        return view();
      },
      setAssist(body) {
        const want = body.assist;
        if (want !== "auto" && want !== "noonchi" && want !== "coach") throw new HttpError(400, "assist는 auto(자동)·noonchi(눈치)·coach(코치) 가운데 하나여야 합니다.");
        store.setAssist(want);
        log(`돕는 방식: ${want === "auto" ? "자동" : want === "coach" ? "코치" : "눈치"}`);
        return view();
      },
      async thinqDevices() {
        if (mode !== "live") throw new HttpError(409, "실제 모드에서만 ThinQ 기기를 불러와요.");
        try {
          thinqList = (await thinqClient().devices()).map((d) => ({ ...d, kind: PAIRABLE_KINDS.find((k) => fitsKind(k, d.type)) ?? null }));
        } catch (e) {
          if (e instanceof ThinqError) throw new HttpError(502, `ThinQ 기기 목록을 받지 못했어요. ${e.message}`);
          throw e;
        }
        return { ok: true, devices: thinqList };
      },
      setPairs(body) {
        const h = requireHome(body);
        let parsed: Record<string, string | null>;
        try {
          parsed = parsePairs(body.pairs, h.twin.devices);
        } catch (e) {
          if (e instanceof SetupError) throw new HttpError(400, e.message);
          throw e;
        }
        // ThinQ 목록을 받았으면 그 목록에 있고 종류가 맞는 기기만
        for (const [id, target] of Object.entries(parsed)) {
          if (target === null || !thinqList) continue;
          const t = thinqList.find((d) => d.id === target);
          if (!t) throw new HttpError(400, `ThinQ 기기 목록에 없는 기기예요: ${target}`);
          const d = h.twin.devices.find((x) => x.id === id)!;
          if (!fitsKind(d.kind, t.type)) throw new HttpError(400, `${d.label}와 ThinQ ${t.name}는 종류가 달라요.`);
        }
        const next = { ...store.pairs(h.twin.home.id, deviceIds(h), { quiet: true }) };
        for (const [id, target] of Object.entries(parsed)) {
          if (target === null) delete next[id];
          else next[id] = target;
        }
        store.savePairs(h.twin.home.id, next);
        applyControl(h);
        return view();
      },
      finish(body) {
        const h = requireHome(body);
        store.setHome(h.twin.home.id);
        store.markDone();
        return view();
      },
    },
  });

  const wanted = Number(env.PORT ?? 8200);
  const host = env.HOST?.trim() || "127.0.0.1";
  let listened: { port: number; url: string };
  try {
    listened = await shell.listen(Number.isInteger(wanted) && wanted >= 0 ? wanted : 8200, host);
  } catch (e) {
    await rt.close().catch(() => {});
    await bus.close().catch(() => {});
    closeDb();
    lock.release();
    throw e;
  }

  // 보관 기간: 시작 때와 1시간마다 지난 사진 찍기 사진·시험 자료를 지운다
  const clean = () => {
    try {
      const n = sweep(db, { ...retention, nowMs: Date.now() });
      if (n.photos || n.dataset) log(`보관 기간이 지난 사진을 지웠어요: 사진 찍기 ${n.photos}장, 시험 자료 ${n.dataset}장`);
    } catch (e) {
      log(`[경고] 지난 사진을 지우지 못했어요: ${(e as Error).message}`);
    }
  };
  clean();
  const cleaner = setInterval(clean, 3_600_000);
  cleaner.unref?.();
  const schedule = reflectAt ? scheduleReflection({ at: reflectAt, offsetMinutes: db.offsetMinutes, run: reflect }) : null;
  if (reflectAt) log(`반성: 매일 ${reflectAt}`);
  const live = () => current ?? last;
  const server: RunningServer = {
    url: listened.url, port: listened.port,
    get app() { return live().app; },
    get hub() { return live().hub; },
    get signals() { return live().signals; },
    get hubKind() { return live().hubKind; },
    get transport() { return live().transport; },
    get warnings() { return live().warnings; },
    get agent() { return live().agent; },
    get policy() { return live().policy; },
    get twin() { return live().twin; },
    get layout() { return live().layout; },
    get twinDir() { return live().twinDir; },
    get phoneUrls() { return live().phoneUrls; },
    setup: store,
    get mode() { return mode; },
    get assist() { return store.assist(); },
    history: db,
    switchHome: async (id) => {
      await switchHome(id);
      store.setHome(id);
    },
    async close() {
      if (closed) return;
      closed = true;
      schedule?.stop();
      clearInterval(cleaner);
      await job;
      // 집의 새 일(판단·실행 추적·가전 정책)을 먼저 막는다: 집 닫기의 첫 단계(새 일 막기)는 부르는 순간 돈다.
      // 그다음 진행 중인 반성 요청을 끊고, 집 닫기와 반성이 끝나기를 기다린다. 앱이 /events 소켓을 먼저 끊어야 껍데기 서버 close가 기다리지 않는다
      const homeClosing = current?.close();
      closing.abort(new Error("서버를 끔"));
      await homeClosing;
      await reflecting?.catch(() => {});
      await shell.close();
      await bus.close().catch(() => {});
      closeDb();
      lock.release();
    },
  };
  closeServer = () => server.close();
  return server;
}
