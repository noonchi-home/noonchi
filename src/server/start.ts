// 서버 시작(npm start·데모·e2e 테스트 공용): twin 데이터 → 허브(기본 matter, 대체 경로 포함) → 정책·에이전트 → HTTP/WS.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Agent } from "../agent/agent.js";
import { createLiveBrain, type CreateLiveBrainOptions, type LiveBrain } from "../brain/live.js";
import { surfacesFrom, type Surface } from "../brain/presence.js";
import { Policy } from "../agent/policy.js";
import { createProvider } from "../agent/providers/index.js";
import type { DeviceHub } from "../hub/types.js";
import type { LayoutEditor } from "../layout/editor.js";
import { FOCUS_TTL_MS, focusFromActions, type Focus } from "../layout/focus.js";
import { loadLayout } from "../layout/load.js";
import { loadTwin, type TwinData } from "../model/devices.js";
import { listHomes } from "../model/homes.js";
import { loadAnchorTargets } from "../phone/anchors.js";
import { EyeFeed } from "../phone/feed.js";
import { createPhoneServer, type PhoneServer } from "../phone/server.js";
import { estimateViewpoint } from "../phone/session.js";
import { TouchStore, eyeHeightOf, floorLookup, homeBounds, readTouchPoints, touchPointsPath, touchTargets, type TouchPoint } from "../phone/touch.js";
import type { AnchorTarget } from "../phone/anchors.js";
import { createApp, type TwinHomeApp } from "./app.js";
import { startHub, type HubKind, type MatterTransport, type StartHubOptions } from "./hubFactory.js";

type Env = Record<string, string | undefined>;

/** 실행 중 만든 파일(사진·배치 수정본) 폴더(커밋하지 않음). RUNTIME_DIR로 바꾼다. */
const PHONE_SESSION = "phone";
const DEFAULT_RUNTIME_DIR = fileURLToPath(new URL("../../runtime/", import.meta.url));

export interface StartServerOptions {
  /** 기본 process.env. HUB, MATTER_*, AGENT_PROVIDER, TWIN_STUDIO_DIR, HOME_ID(twin-studio homes.json의 집, 기본 집), PORT(0이면 빈 포트), HOST,
   *  PHONE_PORT(있으면 폰 AR 서버), PHONE_HOST(기본 0.0.0.0), PHONE_MAX_MISMATCH_M(기준점 거리 차이 허용값, 기본 0.3),
   *  PHONE_EYE_HEIGHT_M(벽 대기 맞춤의 눈 높이, 기본 1.5),
   *  FOCUS(1이면 초점 표시를 보낸다, 기본 끔), PHONE_PHOTO_DIR(사진 폴더, 기본 runtime/photos), RUNTIME_DIR(배치 수정본 runtime/homes/<id>/edits.json의 바탕, 기본 runtime),
   *  BRAIN(1이면 폰 카메라로 상위 판단을 돌린다. PHONE_PORT·OPENAI_API_KEY 필요, BRAIN_* 는 docs/reference.md)을 읽는다. */
  env?: Env;
  log?: (line: string) => void;
  /** 테스트용: matter 모듈 불러오기. */
  importer?: StartHubOptions["importer"];
  /** MatterHub 추가 옵션. */
  matter?: Record<string, unknown>;
  /** 테스트용: 두뇌의 판정기·감지기·판단 모델·시계. */
  brain?: CreateLiveBrainOptions["inject"];
}

export interface RunningServer {
  url: string;
  port: number;
  app: TwinHomeApp;
  hub: DeviceHub;
  hubKind: HubKind;
  /** hubKind가 matter일 때 실제 전송(network가 실패하면 local). */
  transport?: MatterTransport;
  /** 허브 대체 경로를 탄 이유(network→local, matter→memory). 없으면 빈 배열. */
  warnings: string[];
  agent: Agent;
  policy: Policy;
  twin: TwinData;
  /** 집 scene.json이 있으면 배치 편집기. */
  layout?: LayoutEditor;
  /** 고른 집의 twin-studio 산출물 폴더(/twin/에 붙는다). */
  twinDir: string;
  /** PHONE_PORT를 줬을 때 폰에서 열 주소. 없으면 빈 배열. */
  phoneUrls: string[];
  close(): Promise<void>;
}

/** scene.json plan.rooms(기준점 범위 검사·방 바닥 높이). 읽지 못하면 빈 목록. */
function sceneRooms(scenePath: string): { polygon?: number[][]; floor_z?: number }[] {
  try {
    const scene = JSON.parse(readFileSync(scenePath, "utf8").replace(/^﻿/, "")) as { plan?: { rooms?: { polygon?: number[][]; floor_z?: number }[] } };
    return scene.plan?.rooms ?? [];
  } catch {
    return [];
  }
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

export async function startServer(opts: StartServerOptions = {}): Promise<RunningServer> {
  const env = opts.env ?? process.env;
  const log = opts.log ?? ((line: string) => console.log(line));

  const twin = loadTwin(env.TWIN_STUDIO_DIR, { home: env.HOME_ID?.trim() || undefined });
  log(`twin 데이터: 집 ${twin.home.id}(${twin.home.name}) · ${twin.source} (${twin.dir}) · 기기 ${twin.devices.length}개 · 방 ${twin.rooms.length}개`);
  for (const w of twin.warnings) log(`[경고] ${w}`);

  const started = await startHub(twin, { env, log, importer: opts.importer, matter: { log, ...opts.matter } });
  const { hub } = started;
  let live: LiveBrain | null = null;
  try {
    const policy = new Policy();
    const { provider, warning } = createProvider(env);
    if (warning) log(`[경고] ${warning}`);
    const { home } = twin;
    const runtimeDir = env.RUNTIME_DIR?.trim() || DEFAULT_RUNTIME_DIR;
    const layout = loadLayout(home, { runtimeDir, log });
    if (!layout) log(`[경고] ${home.scenePath}이 없어 배치 보정을 끕니다(twin-studio에서 집을 먼저 빌드하세요).`);
    const agent = new Agent({ hub, policy, rooms: twin.rooms, provider, layout });
    const twinDir = home.outDir;
    const hubKind = started.kind;
    const phoneOn = Boolean(env.PHONE_PORT?.trim());
    // 사진 이벤트는 본 서버 /events로 나간다. 앱보다 먼저 만들어 /api/eye/*를 앱에 넘기므로 broadcast는 나중에 잇는다
    const appRef: { current?: TwinHomeApp } = {};
    const feed = phoneOn
      ? new EyeFeed({ photoDir: env.PHONE_PHOTO_DIR?.trim() || join(runtimeDir, "photos"), broadcast: (m) => appRef.current?.broadcast(m) })
      : undefined;
    // 벽 대기 맞춤 기준점 A·B(대시보드에서 고름). 저장·지우면 실행 중인 폰 세션의 기준점이 바로 바뀐다
    const eyeHeightM = eyeHeightOf(env.PHONE_EYE_HEIGHT_M);
    const touchPath = touchPointsPath(runtimeDir, home.id);
    let savedTouch: TouchPoint[] | null = null;
    try {
      savedTouch = readTouchPoints(touchPath);
    } catch (e) {
      log(`[경고] ${(e as Error).message}. 평면도 바닥 기준점으로 맞춥니다.`);
    }
    const phoneRef: { current?: PhoneServer; floor?: AnchorTarget[] } = {};
    const touchStore = existsSync(home.scenePath)
      ? new TouchStore(touchPath, homeBounds(sceneRooms(home.scenePath)), (points) => {
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
        env, runtimeDir, log, surfaces: surfaceSource(layout?.editor), inject: opts.brain,
        toDashboard: (m) => appRef.current?.broadcast(m), toPhone: (m) => phoneRef.current?.send(m),
      })
      : null;
    const brain = live;
    const app = createApp({
      hub, policy, agent, rooms: twin.rooms, twinDir, viewerDir: home.viewerDir, libraryDir: home.libraryDir, hubKind, log, eye: feed, brain: brain ?? undefined,
      home: { id: home.id, name: home.name }, homes: listHomes(twin.dir), layout: layout?.editor, phoneUrls: () => phoneUrls,
      touch: touchStore && { get: () => touchStore.get(), save: (raw) => touchStore.save(raw), clear: () => touchStore.clear(), eyeHeightM },
    });
    appRef.current = app;
    const wanted = Number(env.PORT ?? 8200);
    const host = env.HOST?.trim() || "127.0.0.1";
    const { port, url } = await app.listen(Number.isInteger(wanted) && wanted >= 0 ? wanted : 8200, host);
    let phone: PhoneServer | undefined;
    let phoneUrls: string[] = [];
    if (phoneOn) {
      try {
        const floor = loadAnchorTargets(home.scenePath, join(home.dataDir, "floorplan.json"));
        const touch = touchStore?.get() ?? null;
        // 맞추기 전에도 원뿔이 보이게: 창가 고정 위치 + 폰 방향(추정, 사진에는 쓰지 않음)
        const fallback = estimateViewpoint(JSON.parse(readFileSync(home.scenePath, "utf8").replace(/^﻿/, "")));
        const maxMismatch = Number(env.PHONE_MAX_MISMATCH_M);
        phone = createPhoneServer({
          targets: touch ? touchTargets(touch) : floor, mode: touch ? "touch" : "floor", eyeHeightM, feed, log, fallback,
          floorAt: floorLookup(sceneRooms(home.scenePath)),
          maxMismatchM: Number.isFinite(maxMismatch) && maxMismatch > 0 ? maxMismatch : undefined,
          onEye: (eye) => app.broadcast({ type: "eye", eye }),
          // 폰에서 말한 것은 "phone" 세션 하나로 이어진다(대시보드 대화와 따로 기억)
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
        const wantedPhone = Number(env.PHONE_PORT);
        const listened = await phone.listen(Number.isInteger(wantedPhone) && wantedPhone >= 0 ? wantedPhone : 8210, env.PHONE_HOST?.trim() || "0.0.0.0");
        phoneUrls = listened.urls;
      } catch (e) {
        await app.close();
        await live?.close();
        throw e;
      }
    }
    // 초점: 에이전트가 다룬 물건을 대시보드와 폰에 알린다(표시 전용)
    const sendFocus = (targets: Focus["targets"]) => {
      if (targets.length === 0) return;
      const focus: Focus = { targets, at: new Date().toISOString(), ttl_ms: FOCUS_TTL_MS };
      app.broadcast({ type: "focus", focus });
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
    return {
      url, port, app, hub, hubKind, transport: started.transport, warnings: started.warnings, agent, policy, twin, twinDir, phoneUrls, layout: layout?.editor,
      async close() {
        if (closed) return;
        closed = true;
        unsubFocus();
        await live?.close();
        feed?.close();
        await phone?.close();
        await app.close();
        await hub.stop();
      },
    };
  } catch (e) {
    await live?.close().catch(() => {});
    await hub.stop().catch(() => {});
    throw e;
  }
}
