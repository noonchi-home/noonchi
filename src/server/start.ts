// 서버 시작(npm start·데모·e2e 테스트 공용): twin 데이터 → 허브(기본 matter, 대체 경로 포함) → 정책·에이전트 → HTTP/WS.

import { join } from "node:path";
import { Agent } from "../agent/agent.js";
import { Policy } from "../agent/policy.js";
import { createProvider } from "../agent/providers/index.js";
import type { DeviceHub } from "../hub/types.js";
import { loadTwin, type TwinData } from "../model/devices.js";
import { createApp, type TwinHomeApp } from "./app.js";
import { startHub, type HubKind, type MatterTransport, type StartHubOptions } from "./hubFactory.js";

type Env = Record<string, string | undefined>;

export interface StartServerOptions {
  /** 기본 process.env. HUB, MATTER_*, AGENT_PROVIDER, TWIN_STUDIO_DIR, PORT(0이면 빈 포트), HOST를 읽는다. */
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
  /** twin-studio apartment/ 폴더(/twin/에 붙는다). */
  twinDir: string;
  close(): Promise<void>;
}

export async function startServer(opts: StartServerOptions = {}): Promise<RunningServer> {
  const env = opts.env ?? process.env;
  const log = opts.log ?? ((line: string) => console.log(line));

  const twin = loadTwin(env.TWIN_STUDIO_DIR);
  log(`twin 데이터: ${twin.source} (${twin.dir}) · 기기 ${twin.devices.length}개 · 방 ${twin.rooms.length}개`);
  for (const w of twin.warnings) log(`[경고] ${w}`);

  const started = await startHub(twin, { env, log, importer: opts.importer, matter: { log, ...opts.matter } });
  const { hub } = started;
  try {
    const policy = new Policy();
    const { provider, warning } = createProvider(env);
    if (warning) log(`[경고] ${warning}`);
    const agent = new Agent({ hub, policy, rooms: twin.rooms, provider });
    const twinDir = join(twin.dir, "apartment");
    const hubKind = started.kind;
    const app = createApp({ hub, policy, agent, rooms: twin.rooms, twinDir, hubKind, log });
    const wanted = Number(env.PORT ?? 8200);
    const host = env.HOST?.trim() || "127.0.0.1";
    const { port, url } = await app.listen(Number.isInteger(wanted) && wanted >= 0 ? wanted : 8200, host);
    let closed = false;
    return {
      url, port, app, hub, hubKind, transport: started.transport, warnings: started.warnings, agent, policy, twin, twinDir,
      async close() {
        if (closed) return;
        closed = true;
        await app.close();
        await hub.stop();
      },
    };
  } catch (e) {
    await hub.stop().catch(() => {});
    throw e;
  }
}
