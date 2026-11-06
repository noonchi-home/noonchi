// 집 하나의 실행 묶음: twin 데이터 → 허브(신호 출처로 감쌈) → 정책·에이전트 → 배치·기준점 → 두뇌 → 앱 → 폰 서버.
// 집을 바꾸면 이 묶음을 통째로 닫고 새로 만든다(src/server/start.ts). 앱은 직접 듣지 않고, 껍데기 서버가 요청을 넘긴다(shell.ts).

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Agent } from "../agent/agent.js";
import { Policy } from "../agent/policy.js";
import { createProvider } from "../agent/providers/index.js";
import { createLiveBrain, type CreateLiveBrainOptions, type LiveBrain } from "../brain/live.js";
import type { ControlMode } from "../contract/setup.js";
import { surfacesFrom, type Surface } from "../brain/presence.js";
import { SignalHub, type SignalSource } from "../hub/signals.js";
import type { DeviceHub } from "../hub/types.js";
import type { LayoutEditor } from "../layout/editor.js";
import { FOCUS_TTL_MS, focusFromActions, type Focus } from "../layout/focus.js";
import { loadLayout } from "../layout/load.js";
import { loadTwin, type TwinData } from "../model/devices.js";
import { listHomes } from "../model/homes.js";
import { loadAnchorTargets, type AnchorTarget } from "../phone/anchors.js";
import { autoCorners, parseWallPick, pickedRoom, readScenePlan } from "../phone/corners.js";
import { EyeFeed } from "../phone/feed.js";
import { orderPhoneUrls } from "../phone/links.js";
import { createPhoneServer, type PhoneServer } from "../phone/server.js";
import { estimateViewpoint } from "../phone/session.js";
import { TouchStore, eyeHeightOf, floorLookup, homeBounds, readTouchPoints, touchPointsPath, touchTargets, type TouchPoint } from "../phone/touch.js";
import type { ThinqLink } from "../thinq/link.js";
import { createApp, type TwinHomeApp } from "./app.js";
import { startHub, type HubKind, type MatterTransport, type StartHubOptions } from "./hubFactory.js";

type Env = Record<string, string | undefined>;

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
  brain?: CreateLiveBrainOptions["inject"];
  /** 폰 포트로 이어진 https 주소 찾기(tailscale serve). */
  servedPhoneUrls?: (phonePort: number) => Promise<string[]>;
  /** 지금 운영 모드(/api/health). 없으면 시험 모드. */
  mode?: () => ControlMode;
  /** 대시보드·설정 화면 폴더. 없으면 React 빌드(ui/dist). */
  webDir?: string;
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

/** 트윈의 식탁·책상 윗면(두뇌의 "식탁을 비추는가"). 배치가 바뀌면 다시 만든다. */
function surfaceSource(editor: LayoutEditor | undefined): () => Surface[] {
  if (!editor) return () => [];
  let cache: Surface[] | null = null;
  editor.subscribe(() => { cache = null; });
  return () => (cache ??= surfacesFrom(editor.objects().map((o) => {
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
  let live: LiveBrain | null = null;
  let app: TwinHomeApp | undefined;
  let phone: PhoneServer | undefined;
  try {
    const policy = new Policy();
    const { provider, warning } = createProvider(env);
    if (warning) log(`[경고] ${warning}`);
    const { home } = twin;
    const layout = loadLayout(home, { runtimeDir, log });
    if (!layout) log(`[경고] ${home.scenePath}이 없어 배치 보정을 끕니다(twin-studio에서 집을 먼저 빌드하세요).`);
    const agent = new Agent({ hub: signals, policy, rooms: twin.rooms, provider, layout });
    const twinDir = home.outDir;
    const hubKind = started.kind;
    const phoneOn = Boolean(env.PHONE_PORT?.trim());
    // 사진 이벤트는 본 서버 /events로 나간다. 앱보다 먼저 만들어 /api/eye/*를 앱에 넘기므로 broadcast는 나중에 잇는다
    const appRef: { current?: TwinHomeApp } = {};
    const feed = phoneOn
      ? new EyeFeed({ photoDir: env.PHONE_PHOTO_DIR?.trim() || join(runtimeDir, "photos"), broadcast: (m) => appRef.current?.broadcast(m) })
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
    // 상위 판단(BRAIN=1): 폰 카메라 프레임으로 컵 시나리오를 돈다(src/brain/live.ts). 행동은 모의라 기기 명령이 없다
    const brainWanted = /^(1|true|on)$/i.test(env.BRAIN?.trim() ?? "");
    if (brainWanted && !phoneOn) log("[경고] BRAIN=1은 PHONE_PORT가 있어야 합니다(폰 카메라가 입력). 두뇌를 끕니다.");
    live = brainWanted && phoneOn
      ? await createLiveBrain({
        env, runtimeDir, log, surfaces: surfaceSource(layout?.editor), inject: ctx.brain,
        toDashboard: (m) => appRef.current?.broadcast(m), toPhone: (m) => phoneRef.current?.send(m),
      })
      : null;
    const brain = live;
    let phoneUrls: string[] = [];
    app = createApp({
      hub: signals, policy, agent, rooms: twin.rooms, twinDir, viewerDir: home.viewerDir, libraryDir: home.libraryDir, hubKind, log, eye: feed, brain: brain ?? undefined,
      home: { id: home.id, name: home.name }, homes: listHomes(twin.dir), layout: layout?.editor, phoneUrls: () => phoneUrls, mode: ctx.mode, webDir: ctx.webDir,
      touch: touchStore && {
        get: () => touchStore.get(), save: (raw) => touchStore.save(raw), clear: () => touchStore.clear(), eyeHeightM,
        auto: (raw) => autoCorners(plan, parseWallPick(raw), bounds),
        room: (raw) => pickedRoom(plan, parseWallPick(raw)),
      },
    });
    const appNow = app;
    appRef.current = app;
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
        onEye: (eye) => appNow.broadcast({ type: "eye", eye }),
        onSay: async (text) => {
          const r = await agent.chat(PHONE_SESSION, text);
          return { reply: r.reply, pending: r.pendingConfirmations.map((p) => ({ token: p.token, deviceLabel: p.deviceLabel, reason: p.reason })) };
        },
        onConfirm: async (token) => ({ reply: (await agent.confirm(token)).reply }),
        onCancel: async (token) => ({ reply: agent.cancel(token).reply }),
        ...(brain ? {
          onFrame: (jpeg, h, eye, at) => brain.onFrame(jpeg, { receivedAtMs: at, capturedAt: h.captured_at, timeErrMs: h.time_err_ms, eye }),
          onPhoto: (jpeg, h, eye, at) => brain.onPhoto(jpeg, { receivedAtMs: at, capturedAt: h.captured_at, timeErrMs: h.time_err_ms, eye }),
          onBrainReply: (id, choice) => brain.onReply(id, choice),
        } : {}),
      });
      const phoneServer = phone;
      phoneRef.current = phone;
      phoneRef.floor = floor;
      layout?.editor.setHere(() => phoneServer.here());
      const wantedPhone = ctx.phonePort ?? Number(env.PHONE_PORT);
      const listened = await phone.listen(Number.isInteger(wantedPhone) && wantedPhone >= 0 ? wantedPhone : 8210, env.PHONE_HOST?.trim() || "0.0.0.0");
      // 폰 주소: PHONE_URL → tailscale serve https → 와이파이(대시보드 QR은 맨 앞 주소)
      const served = await (ctx.servedPhoneUrls?.(listened.port) ?? Promise.resolve([])).catch(() => []);
      phoneUrls = orderPhoneUrls(listened.urls, served, env.PHONE_URL);
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
          ["초점", unsubFocus], ["두뇌", () => live?.close()], ["눈 화면", () => feed?.close()],
          ["폰 서버", () => phoneNow?.close()], ["앱", () => appNow.close()], ["배치", () => layout?.editor.close()], ["ThinQ", () => link?.stop()],
          ["허브", () => signals.stop()],
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
    await live?.close().catch(() => {});
    await signals.stop().catch(() => {});
    throw e;
  }
}
