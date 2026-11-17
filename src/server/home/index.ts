// 집 하나의 실행 묶음: twin 데이터 → 허브(신호 출처로 감쌈) → 정책·에이전트 → 배치·기준점 → 관찰 흐름·World State·판단·실행 추적·보기 담당(관찰 모드)·계획 → 앱 → 폰 서버.
// 승인 기억(runtime/homes/<집>/approvals.json, src/agent/approval.ts)은 집마다 하나이고 정책(가전 명령)과 실행 추적(PAM 계획)이 같이 쓴다.
// 집을 바꾸면 이 묶음을 통째로 닫고 새로 만든다(src/server/start.ts). 앱은 직접 듣지 않고, 껍데기 서버가 요청을 넘긴다(shell.ts).
// 파일 나눔(src/server/home/): index.ts 조립(도메인별 잇기를 차례대로 부름)·앱·닫기 차례, core.ts 안쪽 공유 객체 HomeCore, devices.ts 가전·허브·ThinQ,
// agent.ts 정책·에이전트·외부 연락·계획 모드·관찰 모드·초점, phone.ts 실제 폰, act.ts 계획·판단·실행 추적·보기 담당, observe.ts World State·관찰 흐름·주기 타이머, say.ts 말풍선 카드.

import type { DeviceNote, HistoryDb, ReflectResult } from "../../brain/index.js";
import type { BrainLog, ReadyView } from "../../contract/events.js";
import type { PlanView } from "../../contract/plan.js";
import type { AssistMode, ControlMode } from "../../contract/setup.js";
import type { DeviceHub, DeviceState } from "../../contract/devices.js";
import type { SignalHub, SignalSource, ThinqLink } from "../../devices/index.js";
import type { LayoutEditor, TwinData } from "../../layout/index.js";
import type { PipelineInject } from "../../observe/index.js";
import type { StartStore } from "../../phone/index.js";
import type { Agent, Policy } from "../../agent/index.js";
import type { HubKind, MatterTransport, StartHubOptions } from "../hubFactory.js";
import { prepareAct, startAct, startLooker, startPlans } from "./act.js";
import { startAgent, watchFocus } from "./agent.js";
import { preparePhone, startPhone } from "./phone.js";
import { startLoop, startPipeline, startWorld } from "./observe.js";
import { onReflection, sayTimer, startSay } from "./say.js";
import { setLink, startDevices } from "./devices.js";
import { HomeCore } from "./core.js";
import { listHomes } from "../../layout/index.js";
import { createApp, type TwinHomeApp } from "../app.js";

export { phoneVideoDir } from "./phone.js";
export { restSource } from "./observe.js";

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

/** homeId가 없으면 기본 집. 실패하면 만든 것을 닫고 던진다. 도메인별 잇기는 서로의 결과를 쓰므로 이 차례를 지킨다. */
export async function startHome(homeId: string | undefined, ctx: HomeContext): Promise<HomeRuntime> {
  const core = new HomeCore(ctx);
  await startDevices(core, homeId);
  try {
    startAgent(core);
    preparePhone(core);
    startPlans(core);
    startWorld(core);
    prepareAct(core);
    startSay(core);
    if (core.world) {
      const emit = startAct(core);
      await startPipeline(core, emit);
      startLooker(core, emit);
      startLoop(core);
    }
    sayTimer(core);
    startApp(core);
    if (core.phoneOn) await startPhone(core);
    watchFocus(core);
    return runtime(core);
  } catch (e) {
    await core.phone?.close().catch(() => {});
    await core.app?.close().catch(() => {});
    clearInterval(core.decideTimer);
    core.decider?.stop();
    core.thoughts?.close();
    core.tracker?.stop();
    core.looker?.stop();
    core.unsubWorld();
    await core.pipeline?.close().catch(() => {});
    core.unsubHistory();
    await core.signals.stop().catch(() => {});
    throw e;
  }
}

/** 새로 붙은 대시보드에 다시 보낼 오늘(기록 시간대) 마지막 반성 사건: 기록 DB reflection 줄에서 읽는다(합성 판본도 같다). */
function todayReflection(db: HistoryDb): BrainLog[] {
  const row = db.list({ day: db.dayOf(Date.now()), kinds: ["reflection"], latest: true, limit: 1 })[0];
  if (!row) return [];
  const data = (row.data ?? {}) as Partial<Extract<BrainLog, { type: "reflection" }>>;
  return [{
    type: "reflection", at_ms: row.at_ms, day: data.day ?? row.day, ok: data.ok === true, version: data.version ?? null, applies_day: data.applies_day ?? null, text: row.text,
    ...(data.learned ? { learned: data.learned } : {}), ...(data.active ? { active: data.active } : {}), ...(data.dropped ? { dropped: data.dropped } : {}),
  }];
}

/** 앱(HTTP·WebSocket 경로)을 만든다. 실제 폰에 낸 지금 명령, 마지막 판단, 마지막 물체 모양(seen)은 새로 붙은 대시보드에도 보낸다. */
function startApp(core: HomeCore): void {
  const { ctx, twin, signals, policy, agent, layout, feed, startStore, plans } = core;
  const { log, history } = ctx;
  const { home } = twin;
  const observe = core.pipeline;
  const world = core.world;
  const worldNow = world && (() => world.view(core.nowMs()));
  core.app = createApp({
    hub: signals, policy, agent, rooms: twin.rooms, twinDir: home.outDir, viewerDir: home.viewerDir, libraryDir: home.libraryDir, hubKind: core.started.kind, log, eye: feed,
    brain: observe ? { status: () => ({ ...observe.status(), look: core.looker?.status() ?? null }) } : undefined, world: worldNow ?? undefined,
    home: { id: home.id, name: home.name }, homes: listHomes(twin.dir), layout: layout?.editor, phoneUrls: () => core.phoneUrls, mode: ctx.mode, webDir: ctx.webDir, allowOrigin: ctx.allowOrigin, planToken: ctx.planToken, ready: ctx.ready,
    start: startStore && { get: () => startStore.get(), save: (raw) => startStore.save(raw), preview: (raw) => startStore.preview(raw), clear: () => startStore.clear() },
    phoneSync: () => core.phone?.syncState() ?? null,
    plan: plans, offTrack: () => core.tracker?.offTrack() ?? null, history: history.db, reflect: history.reflect, scene: () => core.scene,
    brainLast: () => [...todayReflection(history.db), ...(core.lastDecision ? [core.lastDecision] : [])], thoughtLast: () => core.thoughts?.last() ?? null, seenLast: () => core.lastSeen, say: () => ({ text: core.said, ...(core.saidSafety ? { safety: true as const } : {}) }),
    actMode: () => core.mode(),
  });
  core.speak();
}

/** 띄운 집: 반성 사건·ThinQ 연결 바꾸기·닫기. */
function runtime(core: HomeCore): HomeRuntime {
  const { twin, started, signals, policy, agent, planner, layout, feed, ctx } = core;
  const { log } = ctx;
  const appNow = core.app!;
  const phoneNow = core.phone;
  return {
    twin, hub: started.hub, signals, hubKind: started.kind, transport: started.transport, warnings: started.warnings, policy, agent, layout: layout?.editor,
    start: core.startStore, app: appNow, twinDir: twin.home.outDir, phoneUrls: core.phoneUrls, phonePort: core.phonePort,
    onReflection(event) {
      onReflection(core, event);
    },
    setLink(next) {
      setLink(core, next);
    },
    async close() {
      if (core.closed) return;
      core.closed = true;
      // 한 단계가 실패해도 나머지(특히 폰 포트·허브)는 닫는다. 새 집이 같은 포트를 다시 잡아야 한다.
      // 먼저 새 일을 막는다: 판단·계획 진행(판단 타이머·실행 추적·관찰 모드·계획 모드)을 멈추고 정책을 닫아 가전 명령을 막는다.
      // 그다음 외부 연락: 차례를 기다리던 연락은 취소로 기록하고, 보내는 중인 연락은 끝난 뒤 닫는다(기록 DB·말풍선·폰·앱 답 길은 아직 열려 있다)
      const steps: [string, () => unknown][] = [
        ["새 일 막기", () => { policy.close(); clearInterval(core.decideTimer); core.decider?.stop(); core.tracker?.stop(); core.looker?.stop(); planner.abort(); }],
        ["외부 연락", () => agent.close()], ["초점", core.unsubFocus], ["관찰 흐름", () => { core.thoughts?.close(); core.unsubWorld(); return core.pipeline?.close(); }], ["눈 화면", () => feed?.close()],
        ["폰 서버", () => phoneNow?.close()], ["앱", () => appNow.close()], ["배치", () => layout?.editor.close()], ["ThinQ", () => core.link?.stop()],
        ["기록", core.unsubHistory], ["허브", () => signals.stop()],
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
}
