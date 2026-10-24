// 서버 시작(npm start·데모·e2e 테스트 공용): twin 데이터 → 허브(기본 matter, 대체 경로 포함) → 정책·에이전트 → HTTP/WS.

import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Agent } from "../agent/agent.js";
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
import { createApp, type TwinHomeApp } from "./app.js";
import { startHub, type HubKind, type MatterTransport, type StartHubOptions } from "./hubFactory.js";

type Env = Record<string, string | undefined>;

/** 실행 중 만든 파일(사진·배치 수정본) 폴더(커밋하지 않음). RUNTIME_DIR로 바꾼다. */
const PHONE_SESSION = "phone";
const DEFAULT_RUNTIME_DIR = fileURLToPath(new URL("../../runtime/", import.meta.url));

export interface StartServerOptions {
  /** 기본 process.env. HUB, MATTER_*, AGENT_PROVIDER, TWIN_STUDIO_DIR, HOME_ID(twin-studio homes.json의 집, 기본 집), PORT(0이면 빈 포트), HOST,
   *  PHONE_PORT(있으면 폰 AR 서버), PHONE_HOST(기본 0.0.0.0), PHONE_MAX_MISMATCH_M(기준점 거리 차이 허용값, 기본 0.3),
   *  PHONE_PHOTO_DIR(사진 폴더, 기본 runtime/photos), RUNTIME_DIR(배치 수정본 runtime/homes/<id>/edits.json의 바탕, 기본 runtime)를 읽는다. */
  env?: Env;
  log?: (line: string) => void;
  /** 테스트용: matter 모듈 불러오기. */
  importer?: StartHubOptions["importer"];
  /** MatterHub 추가 옵션. */
  matter?: Record<string, unknown>;
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

export async function startServer(opts: StartServerOptions = {}): Promise<RunningServer> {
  const env = opts.env ?? process.env;
  const log = opts.log ?? ((line: string) => console.log(line));

  const twin = loadTwin(env.TWIN_STUDIO_DIR, { home: env.HOME_ID?.trim() || undefined });
  log(`twin 데이터: 집 ${twin.home.id}(${twin.home.name}) · ${twin.source} (${twin.dir}) · 기기 ${twin.devices.length}개 · 방 ${twin.rooms.length}개`);
  for (const w of twin.warnings) log(`[경고] ${w}`);

  const started = await startHub(twin, { env, log, importer: opts.importer, matter: { log, ...opts.matter } });
  const { hub } = started;
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
    const app = createApp({
      hub, policy, agent, rooms: twin.rooms, twinDir, viewerDir: home.viewerDir, libraryDir: home.libraryDir, hubKind, log, eye: feed,
      home: { id: home.id, name: home.name }, homes: listHomes(twin.dir), layout: layout?.editor, phoneUrls: () => phoneUrls,
    });
    appRef.current = app;
    const wanted = Number(env.PORT ?? 8200);
    const host = env.HOST?.trim() || "127.0.0.1";
    const { port, url } = await app.listen(Number.isInteger(wanted) && wanted >= 0 ? wanted : 8200, host);
    let phone: PhoneServer | undefined;
    let phoneUrls: string[] = [];
    if (phoneOn) {
      try {
        const targets = loadAnchorTargets(home.scenePath, join(home.dataDir, "floorplan.json"));
        const maxMismatch = Number(env.PHONE_MAX_MISMATCH_M);
        phone = createPhoneServer({
          targets, feed, log,
          maxMismatchM: Number.isFinite(maxMismatch) && maxMismatch > 0 ? maxMismatch : undefined,
          onEye: (eye) => app.broadcast({ type: "eye", eye }),
          // 폰에서 말한 것은 "phone" 세션 하나로 이어진다(대시보드 대화와 따로 기억)
          onSay: async (text) => {
            const r = await agent.chat(PHONE_SESSION, text);
            return { reply: r.reply, pending: r.pendingConfirmations.map((p) => ({ token: p.token, deviceLabel: p.deviceLabel, reason: p.reason })) };
          },
          onConfirm: async (token) => ({ reply: (await agent.confirm(token)).reply }),
          onCancel: async (token) => ({ reply: agent.cancel(token).reply }),
        });
        const phoneServer = phone;
        layout?.editor.setHere(() => phoneServer.here());
        const wantedPhone = Number(env.PHONE_PORT);
        const listened = await phone.listen(Number.isInteger(wantedPhone) && wantedPhone >= 0 ? wantedPhone : 8210, env.PHONE_HOST?.trim() || "0.0.0.0");
        phoneUrls = listened.urls;
      } catch (e) {
        await app.close();
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
    const unsubFocus = agent.subscribe((e) => {
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
        feed?.close();
        await phone?.close();
        await app.close();
        await hub.stop();
      },
    };
  } catch (e) {
    await hub.stop().catch(() => {});
    throw e;
  }
}
