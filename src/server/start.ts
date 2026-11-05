// 서버 시작(npm start·데모·e2e 테스트 공용): 껍데기 서버(포트·설정 API) + 집 실행 묶음(src/server/home.ts).
// 설정 흐름(집 → 가전 → 위치 동기화 → 대시보드): 집을 고르면 묶음을 닫고 새 집으로 다시 만든다. 포트는 그대로다.

import { fileURLToPath } from "node:url";
import type { Agent } from "../agent/agent.js";
import type { Policy } from "../agent/policy.js";
import type { CreateLiveBrainOptions } from "../brain/live.js";
import type { SignalHub } from "../hub/signals.js";
import type { DeviceHub } from "../hub/types.js";
import type { LayoutEditor } from "../layout/editor.js";
import { KIND_LABELS } from "../model/mapping.js";
import { resolveTwinStudioDir, type TwinData } from "../model/devices.js";
import { listHomes } from "../model/homes.js";
import { SetupError, SetupStore, parseSources } from "../setup/store.js";
import { HttpError, type TwinHomeApp } from "./app.js";
import type { HubKind, MatterTransport, StartHubOptions } from "./hubFactory.js";
import { startHome, type HomeContext, type HomeRuntime } from "./home.js";
import { createShell } from "./shell.js";

type Env = Record<string, string | undefined>;

/** 실행 중 만든 파일(사진·배치 수정본·설정) 폴더(커밋하지 않음). RUNTIME_DIR로 바꾼다. */
const DEFAULT_RUNTIME_DIR = fileURLToPath(new URL("../../runtime/", import.meta.url));

export interface StartServerOptions {
  /** 기본 process.env. HUB, MATTER_*, AGENT_PROVIDER, TWIN_STUDIO_DIR, HOME_ID(저장한 집이 없을 때 띄울 집, 기본 집), PORT(0이면 빈 포트), HOST,
   *  PHONE_PORT(있으면 폰 AR 서버), PHONE_HOST(기본 0.0.0.0), PHONE_MAX_MISMATCH_M(기준점 거리 차이 허용값, 기본 0.3),
   *  PHONE_EYE_HEIGHT_M(벽 대기 맞춤의 눈 높이, 기본 1.5),
   *  FOCUS(1이면 초점 표시를 보낸다, 기본 끔), PHONE_PHOTO_DIR(사진 폴더, 기본 runtime/photos), RUNTIME_DIR(배치 수정본·설정의 바탕, 기본 runtime),
   *  BRAIN(1이면 폰 카메라로 상위 판단을 돌린다. PHONE_PORT·OPENAI_API_KEY 필요, BRAIN_* 는 docs/reference.md)을 읽는다. */
  env?: Env;
  log?: (line: string) => void;
  /** true면 설정(고른 집·끝냄·신호 출처)을 RUNTIME_DIR에 저장하고 다음 시작 때 읽는다(npm start). 기본은 메모리에만 두고 「끝냄」으로 시작. */
  persistSetup?: boolean;
  /** 테스트용: matter 모듈 불러오기. */
  importer?: StartHubOptions["importer"];
  /** MatterHub 추가 옵션. */
  matter?: Record<string, unknown>;
  /** 테스트용: 두뇌의 판정기·감지기·판단 모델·시계. */
  brain?: CreateLiveBrainOptions["inject"];
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
  /** 다른 집으로 바꾼다(POST /api/setup/home과 같음). */
  switchHome(id: string): Promise<void>;
  close(): Promise<void>;
}

export async function startServer(opts: StartServerOptions = {}): Promise<RunningServer> {
  const env = opts.env ?? process.env;
  const log = opts.log ?? ((line: string) => console.log(line));
  const runtimeDir = env.RUNTIME_DIR?.trim() || DEFAULT_RUNTIME_DIR;
  const store = new SetupStore({ runtimeDir, persist: opts.persistSetup ?? false, log });
  const ctx: HomeContext = {
    env, log, runtimeDir, importer: opts.importer, matter: opts.matter, brain: opts.brain,
    sources: (homeId, ids) => store.sources(homeId, ids),
  };
  const studioDir = resolveTwinStudioDir(env.TWIN_STUDIO_DIR);

  // 저장한 집이 없거나 사라졌으면 HOME_ID(없으면 기본 집)
  const saved = store.state().home;
  const fallbackHome = env.HOME_ID?.trim() || undefined;
  let rt: HomeRuntime;
  try {
    rt = await startHome(saved ?? fallbackHome, ctx);
  } catch (e) {
    if (!saved) throw e;
    log(`[경고] 저장한 집 ${saved}를 띄우지 못했습니다(${(e as Error).message}). ${fallbackHome ?? "기본 집"}으로 띄웁니다.`);
    rt = await startHome(fallbackHome, ctx);
  }
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
        const next = await startHome(id, ctx);
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
          const back = await startHome(previous, ctx);
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

  const deviceViews = (h: HomeRuntime) => h.twin.devices.map((d) => ({
    id: d.id, label: d.label, room: d.room, roomLabel: d.roomLabel, kind: d.kind, kindLabel: KIND_LABELS[d.kind], source: h.signals.source(d.id),
  }));
  const view = () => {
    const st = store.state();
    const h = current;
    return {
      ok: true, persist: store.persist, done: st.done, switching, error: switchError,
      home: h ? { id: h.twin.home.id, name: h.twin.home.name } : null, homes: homes(),
      rooms: h?.twin.rooms ?? [], devices: h ? deviceViews(h) : [], devices_saved: h ? store.hasSources(h.twin.home.id) : false,
      position: { touch: !!h?.touch, layout: !!h?.layout, phone_urls: h?.phoneUrls ?? [] },
    };
  };

  const shell = createShell({
    current: () => current?.app ?? null,
    log,
    setup: {
      view,
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
          const next = { ...h.signals.sources(), ...parseSources(body.sources, h.twin.devices.map((d) => d.id)) };
          h.signals.setSources(next);
          store.saveSources(h.twin.home.id, h.signals.sources());
        } catch (e) {
          if (e instanceof SetupError) throw new HttpError(400, e.message);
          throw e;
        }
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
    throw e;
  }

  const live = () => current ?? last;
  return {
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
    switchHome: async (id) => {
      await switchHome(id);
      store.setHome(id);
    },
    async close() {
      if (closed) return;
      closed = true;
      await job;
      // 앱이 /events 소켓을 먼저 끊어야 껍데기 서버 close가 기다리지 않는다
      await current?.close();
      await shell.close();
    },
  };
}
