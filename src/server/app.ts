// HTTP + WebSocket 서버(docs/plan.md "서버"). DeviceHub 하나를 받아 REST·WS·웹 화면을 제공한다.
// 정책(승인)은 Policy, 자연어는 Agent가 맡는다. 외부 라이브러리는 ws만 쓴다. API 경로는 도메인별 파일(routes/*)이 등록한다.

import type { PendingGoal } from "../contract/goal.js";
import type { HabitFsm } from "../contract/habit.js";
import { existsSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { join, resolve } from "node:path";
import { WebSocket, WebSocketServer } from "ws";
import type { Agent } from "../agent/index.js";
import { Policy } from "../agent/index.js";
import type { BrainLog, HealthView, PersonMessage, ReadyView, SeenEvent, ThoughtEvent } from "../contract/events.js";
import type { WorldView } from "../contract/world.js";
import type { OffTrack } from "../contract/plan.js";
import type { ControlMode } from "../contract/setup.js";
import type { DeviceHub, RoomSpec } from "../contract/devices.js";
import type { HistoryDb } from "../brain/index.js";
import type { ReflectResult } from "../brain/index.js";
import type { LayoutEditor } from "../layout/index.js";
import type { SyncState } from "../phone/index.js";
import type { StartPose } from "../phone/index.js";
import { repoPath } from "../shared/paths.js";
import type { PlanHub } from "../act/index.js";
import { listenRetry } from "../shared/net.js";
import { serveFile } from "../shared/static.js";
import { HttpError, type Handler, type RouteKit } from "./routes/kit.js";
import { agentRoutes } from "./routes/agent.js";
import { brainRoutes } from "./routes/brain.js";
import { devicesRoutes, type MatterControl, type MatterInfoView } from "./routes/devices.js";
import { homeRoutes, layoutRoutes } from "./routes/layout.js";
import { observeRoutes } from "./routes/observe.js";
import { phoneRoutes } from "./routes/phone.js";
import { planRoutes } from "./routes/plan.js";

export { HttpError, readJson } from "./routes/kit.js";
export { canSendPlan, isLoopback } from "./routes/plan.js";

export interface AppOptions {
  hub: DeviceHub;
  policy?: Policy;
  agent?: Agent;
  rooms?: RoomSpec[];
  /** 대시보드·설정 화면 폴더(기본: React 빌드 ui/dist/). */
  webDir?: string;
  /** 고른 집의 twin-studio 산출물 폴더(scene.json·assets/). 있으면 /twin/에 붙인다(요청 때마다 확인). */
  twinDir?: string;
  /** 모든 집이 함께 쓰는 뷰어 폴더(/twin/viewer/). 없으면 twinDir/viewer. */
  viewerDir?: string;
  /** 모든 종류의 개별 GLB 폴더(/twin/lib/). 실행 중 더한 종류가 쓴다. */
  libraryDir?: string;
  /** 지금 불러온 집과 고를 수 있는 집(/api/health, /api/homes). */
  home?: { id: string; name: string };
  homes?: { id: string; name: string }[];
  /** 폰에서 열 주소(폰 AR 서버가 뜬 뒤 정해진다). 대시보드 눈 칸 안내에 쓴다. */
  phoneUrls?: () => string[];
  /** 배치 보정(docs/plan.md 계약 B·C). 있으면 /api/layout*, /events layout 메시지. */
  layout?: LayoutEditor;
  /** 서버 장면(scene.json + 도면 설비, src/layout/scene.ts). GET /api/scene. 없거나 null이면 404. */
  scene?: () => unknown;
  /** 허용할 브라우저 출처(기본: localhost·127.0.0.1·[::1]의 모든 포트). */
  allowOrigin?: (origin: string) => boolean;
  /** 계획 보내기 토큰(PLAN_TOKEN). 있으면 Authorization: Bearer <토큰>을 붙인 요청은 어느 주소에서나 받는다. */
  planToken?: string;
  log?: (msg: string) => void;
  /** /api/health에 보일 허브 종류. */
  hubKind?: string;
  /** 폰 AR 클로이드의 눈 화면(src/phone/feed.ts). 있으면 GET /api/eye/*를 넘긴다. */
  eye?: { handle(req: IncomingMessage, res: ServerResponse, path: string): boolean };
  /** 폰 위치 맞추기 시작 위치(src/phone/sync/start.ts StartStore). 있으면 /api/phone/start-pose*. */
  start?: { get(): StartPose | null; save(raw: unknown): StartPose; preview(raw: unknown): StartPose; clear(): void };
  /** 폰 위치 맞춤 모듈 상태(GET /api/phone/sync). 폰 서버가 없으면 null. */
  phoneSync?: () => SyncState | null;
  /** 관찰 흐름(BRAIN=1, src/observe/pipeline.ts). 있으면 GET /api/brain에 상태를 보인다. */
  brain?: { status(): object };
  /** 지금 World State(BRAIN=1). 있으면 GET /api/world, /events 접속 때 {type:"world"}. */
  world?: () => WorldView;
  /** 마지막 판단(BRAIN=1). /events 접속 때 world 다음에 {type:"brain", replay:true}로 보낸다. */
  brainLast?: () => BrainLog[];
  /** 최근 생각 말풍선 메시지(BRAIN=1, src/brain/thought.ts). /events 접속 때 마지막 판단 다음에 replay:true를 붙여 보낸다. */
  thoughtLast?: () => ThoughtEvent | null;
  /** 마지막 물체 모양(BRAIN=1). /events 접속 때 그대로 replay:true를 붙여 보낸다. */
  seenLast?: () => SeenEvent | null;
  /** 지금 대시보드 말풍선 말과 안전 알림 표시(src/act/say.ts). /events 접속 때 {type:"say"}. */
  say?: () => { text: string | null; safety?: true };
  /** 지금 행동 모드(눈치·코치, src/act/mode.ts). /events 접속 때 {type:"mode"}. 없으면 보내지 않는다. */
  actMode?: () => "noonchi" | "coach";
  /** 마지막 미리 세운 목표(src/goal/watch.ts). /events 접속 때 {type:"goal"}. 없거나 null이면 보내지 않는다. */
  goalLast?: () => PendingGoal | null;
  /** 마지막 습관 FSM 그림 자료(src/brain/habit.ts). /events 접속 때 {type:"habit"}. 없거나 null이면 보내지 않는다. */
  habitLast?: () => HabitFsm | null;
  /** 시간 줄 사람 줄의 마지막 사람 상태(src/brain/person.ts). 접속한 대시보드에 다시 보낸다. */
  personLast?: () => PersonMessage | null;
  robotLast?: () => import("../contract/machines.js").RobotMessage | null;
  /** 지금 실제 폰에 낸 명령 한 줄. /events 접속 때 있으면 {type:"phone_command"}로 보낸다. */
  phoneCommand?: () => string | null;
  /** 지금 운영 모드(/api/health). 없으면 시험 모드. */
  mode?: () => ControlMode;
  /** 준비 상태(/api/health ready, src/server/ready.ts). 없으면 준비 안 됨. */
  ready?: () => Promise<ReadyView>;
  /** 클로이드 계획 보관(src/act/hub.ts). 있으면 에이전트 행동을 넘기고 POST /api/plan*을 받는다. 접속 때 지금 계획을 보낸다. */
  plan?: Pick<PlanHub, "current" | "onAgent" | "put" | "setStep">;
  /** 끄기 추적 요약(실행 추적 offTrack). GET /api/plan이 계획과 같은 답에 싣는다(영상 판정이 같은 순간 값으로 끝낼지 본다). 없으면 null. */
  offTrack?: () => OffTrack | null;
  /** 기록 DB(src/brain/history/db.ts). 있으면 GET /api/history·/api/history/day/{날짜}·/api/decisions. */
  history?: HistoryDb;
  /** 그날 반성(src/brain/history/reflect.ts). 있으면 POST /api/reflection/run. */
  reflect?: (day: string) => Promise<ReflectResult>;
}

export interface TwinHomeApp {
  readonly server: Server;
  readonly wss: WebSocketServer;
  readonly policy: Policy;
  listen(port?: number, host?: string): Promise<{ port: number; url: string }>;
  close(): Promise<void>;
  broadcast(msg: unknown): void;
}

/** 대시보드·설정 화면 폴더: React 빌드(ui/dist). npm start·npm run dev가 먼저 빌드한다. */
export const DEFAULT_WEB_DIR = repoPath("ui/dist/");
/** 화면 폴더에 index.html이 없을 때(빌드 전) 화면 요청에 주는 오류. */
export const NOT_BUILT = "화면이 아직 빌드되지 않았어요. npm run ui:build";

/** /events 연결 하나에 보낼 것이 이만큼(바이트) 넘게 쌓여 있으면 물체 모양(seen)은 그 연결에 보내지 않는다. */
export const EVENTS_SEEN_MAX_BUFFERED = 256 * 1024;
/** 느린 연결에 초당 10번 오는 seen이 쌓이지 않게: seen은 다음 것이 앞 것을 대신하므로 밀린 연결에는 건너뛴다. 다른 메시지는 건너뛰지 않는다. */
export function skipsWhenBehind(msg: unknown, bufferedAmount: number): boolean {
  return bufferedAmount > EVENTS_SEEN_MAX_BUFFERED && typeof msg === "object" && msg !== null && (msg as { type?: unknown }).type === "seen";
}
const LOCAL_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i;
/** 준비 상태를 모를 때(앱만 따로 띄운 시험). */
const NOT_READY: ReadyView = {
  ok: false, inference_mode: "openai", vlm: { base_url: "", model: "", key: false, reachable: false },
  pam: { base_url: "", model: "", key: false, reachable: false }, agent: { provider: "openai", base_url: "", model: "", key: false, reachable: false }, db: false,
};

/** 기본 허용 출처: 이 PC(localhost·127.0.0.1·[::1])의 모든 포트. */
export const isLocalOrigin = (origin: string): boolean => LOCAL_ORIGIN.test(origin);

/** 허용 출처: 이 PC(localhost·127.0.0.1·[::1]) + ALLOWED_ORIGINS(쉼표로 나눈 https://호스트[:포트], tailscale serve 주소). */
export function originChecker(raw: string | undefined): (origin: string) => boolean {
  const listed = new Set((raw ?? "").split(",").map((s) => s.trim()).filter(Boolean).map((s) => {
    try {
      return new URL(s).origin;
    } catch {
      throw new Error(`ALLOWED_ORIGINS에 주소가 아닌 값이 있어요: ${s} (예: https://<서버>.<tailnet>.ts.net)`);
    }
  }));
  return (origin) => isLocalOrigin(origin) || listed.has(origin);
}

// ── 앱 ────────────────────────────────────────────────────

export function createApp(opts: AppOptions): TwinHomeApp {
  const { hub, agent } = opts;
  const policy = opts.policy ?? new Policy();
  const webDir = resolve(opts.webDir ?? DEFAULT_WEB_DIR);
  const twinDir = opts.twinDir ? resolve(opts.twinDir) : undefined;
  const viewerDir = opts.viewerDir ? resolve(opts.viewerDir) : undefined;
  const libraryDir = opts.libraryDir ? resolve(opts.libraryDir) : undefined;
  const allowOrigin = opts.allowOrigin ?? isLocalOrigin;
  const log = opts.log ?? ((m: string) => console.log(m));

  const matterInfo = (): MatterInfoView | undefined => {
    const info = (hub as Partial<MatterControl>).info;
    return info && typeof info === "object" && "transport" in info ? info : undefined;
  };

  const routes: { method: string; pattern: RegExp; handler: Handler; status?: (body: unknown) => number }[] = [];
  const route = (method: string, pattern: RegExp, handler: Handler, status?: (body: unknown) => number) => routes.push({ method, pattern, handler, status });

  route("GET", /^\/api\/health$/, async (): Promise<HealthView> => ({
    ok: true, devices: hub.list().length, hub: opts.hubKind ?? "memory", transport: matterInfo()?.transport ?? null,
    provider: agent?.provider.name ?? null, model: agent?.provider.model ?? null, twin: !!twinDir && existsSync(twinDir),
    eye: !!opts.eye, home: opts.home ?? null, phone_urls: opts.phoneUrls?.() ?? [], ...(opts.history ? { tz_minutes: opts.history.offsetMinutes } : {}),
    brain: !!opts.brain, mode: opts.mode?.() ?? "test",
    ready: opts.ready ? await opts.ready() : NOT_READY,
  }));

  // 설정 화면은 자기가 본 집(home)을 같이 보낸다. 다른 탭에서 집을 바꿨으면 새 집을 고치지 않는다.
  // 본문을 기다리는 사이 이 앱이 닫혔으면(집을 바꿈) 쓰지 않는다
  const sameHome = (body: Record<string, unknown>) => {
    if (closed) throw new HttpError(503, "집을 바꾸는 중이에요. 잠시 뒤 다시 해 주세요.");
    if (typeof body.home === "string" && opts.home && body.home !== opts.home.id) throw new HttpError(409, `집이 바뀌었어요(지금 ${opts.home.name}). 화면을 새로 고치세요.`);
  };
  // API 경로는 도메인별 파일(routes/*)이 등록한다. 등록 차례는 나누기 전과 같다(같은 경로·메서드면 먼저 등록한 것이 이긴다).
  const kit: RouteKit = { route, opts, hub, agent, policy, closed: () => closed, sameHome, matterInfo };
  observeRoutes(kit);
  brainRoutes(kit);
  layoutRoutes(kit);
  phoneRoutes(kit);
  planRoutes(kit);
  homeRoutes(kit);
  devicesRoutes(kit);
  agentRoutes(kit);

  // ── HTTP ──

  function cors(req: IncomingMessage, res: ServerResponse): boolean {
    const origin = req.headers.origin;
    if (!origin) return true;
    if (!allowOrigin(origin)) return false;
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "content-type");
    return true;
  }

  function sendJson(res: ServerResponse, status: number, body: unknown): void {
    const text = JSON.stringify(body);
    res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
    res.end(text);
  }

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? "/", "http://localhost");
    const allowed = cors(req, res);
    if (req.method === "OPTIONS") {
      res.writeHead(allowed ? 204 : 403);
      res.end();
      return;
    }
    // 다른 사이트에서 보낸 쓰기 요청(CSRF)은 막는다
    if (!allowed && req.method !== "GET" && req.method !== "HEAD") {
      sendJson(res, 403, { ok: false, error: "허용되지 않은 출처의 요청입니다." });
      return;
    }
    const path = url.pathname;
    // 눈 화면은 JSON이 아니라 JPEG·MJPEG 스트림이라 일반 API 라우팅 앞에서 넘긴다
    if (opts.eye && path.startsWith("/api/eye/") && opts.eye.handle(req, res, path)) return;
    if (path.startsWith("/api/")) {
      const candidates = routes.filter((r) => r.pattern.test(path));
      const r = candidates.find((x) => x.method === req.method);
      if (!r) {
        sendJson(res, candidates.length > 0 ? 405 : 404, { ok: false, error: candidates.length > 0 ? "허용되지 않은 메서드입니다." : `없는 API입니다: ${path}` });
        return;
      }
      try {
        let params: string[];
        try {
          params = (path.match(r.pattern) ?? []).slice(1).map((p) => decodeURIComponent(p));
        } catch {
          throw new HttpError(400, "경로를 읽지 못했습니다(잘못된 % 인코딩).");
        }
        const body = await r.handler(req, url, params);
        sendJson(res, r.status ? r.status(body) : 200, body);
      } catch (e) {
        if (e instanceof HttpError) sendJson(res, e.status, { ok: false, error: e.message, ...e.extra });
        else {
          log(`[server] ${req.method} ${path} 오류: ${(e as Error).stack ?? e}`);
          sendJson(res, 500, { ok: false, error: `서버 오류: ${(e as Error).message}` });
        }
      }
      return;
    }
    if (req.method !== "GET" && req.method !== "HEAD") {
      sendJson(res, 405, { ok: false, error: "허용되지 않은 메서드입니다." });
      return;
    }
    const head = req.method === "HEAD";
    if (path === "/twin") {
      res.writeHead(301, { location: "/twin/" });
      res.end();
      return;
    }
    if (path.startsWith("/twin/")) {
      const rel = path.slice("/twin/".length);
      // 뷰어·라이브러리는 모든 집이 함께 쓰는 폴더라 집 폴더보다 먼저 본다
      const [root, sub] = rel.startsWith("viewer/") && viewerDir ? [viewerDir, rel.slice("viewer/".length)]
        : rel.startsWith("lib/") && libraryDir ? [libraryDir, rel.slice("lib/".length)]
        : [twinDir, rel];
      if (root && existsSync(root) && serveFile(res, root, sub, head)) return;
      sendJson(res, 404, { ok: false, error: twinDir && existsSync(twinDir) ? `파일이 없습니다: ${path}` : "3D 트윈(twin-studio 집 산출물)이 아직 없습니다. twin-studio에서 먼저 빌드하세요." });
      return;
    }
    if (serveFile(res, webDir, path === "/" ? "index.html" : path, head)) return;
    if (!existsSync(join(webDir, "index.html"))) sendJson(res, 503, { ok: false, error: NOT_BUILT });
    else sendJson(res, 404, { ok: false, error: `파일이 없습니다: ${path}` });
  }

  const server = createServer((req, res) => {
    handle(req, res).catch((e) => {
      log(`[server] 처리 실패: ${(e as Error).stack ?? e}`);
      if (!res.headersSent) sendJson(res, 500, { ok: false, error: "서버 오류" });
      else res.end();
    });
  });

  // ── WebSocket /events ──

  const wss = new WebSocketServer({
    server,
    path: "/events",
    verifyClient: ({ origin }: { origin?: string }) => !origin || allowOrigin(origin),
  });
  // ws는 HTTP 서버의 'error'(listen 실패 등)를 wss로 다시 내보낸다. 듣는 쪽이 없으면 처리 안 된 예외가 되어
  // listen()이 거부되지 않고 프로세스가 죽는다. 그 오류는 listen()의 reject로 전달되므로 여기서는 받기만 한다.
  wss.on("error", () => {});

  function send(ws: WebSocket, msg: unknown): void {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
  }

  function broadcast(msg: unknown): void {
    const text = JSON.stringify(msg);
    for (const ws of wss.clients) if (ws.readyState === WebSocket.OPEN && !skipsWhenBehind(msg, ws.bufferedAmount)) ws.send(text);
  }

  wss.on("connection", (ws) => {
    send(ws, { type: "hello", devices: hub.list().length, provider: agent?.provider.name ?? null, hub: opts.hubKind ?? "memory", home: opts.home?.id ?? null });
    for (const state of hub.states()) send(ws, { type: "state", state });
    for (const m of opts.layout?.syncMessages() ?? []) send(ws, m);
    send(ws, { type: "plan", plan: opts.plan?.current() ?? null });
    if (opts.world) send(ws, { type: "world", world: opts.world() });
    for (const event of opts.brainLast?.() ?? []) send(ws, { type: "brain", event, replay: true });
    const thought = opts.thoughtLast?.();
    if (thought) send(ws, { ...thought, replay: true });
    const seen = opts.seenLast?.();
    if (seen) send(ws, { ...seen, replay: true });
    send(ws, { type: "say", ...(opts.say?.() ?? { text: null }) });
    if (opts.actMode) send(ws, { type: "mode", mode: opts.actMode() });
    const goal = opts.goalLast?.();
    if (goal) send(ws, { type: "goal", goal });
    const habit = opts.habitLast?.();
    if (habit) send(ws, { type: "habit", habit });
    const person = opts.personLast?.();
    if (person) send(ws, person);
    const robot = opts.robotLast?.();
    if (robot) send(ws, robot);
    const command = opts.phoneCommand?.();
    if (command) send(ws, { type: "phone_command", text: command });
    ws.on("error", () => {});
  });

  const unsubHub = hub.subscribe((state) => broadcast({ type: "state", state }));
  const unsubAgent = agent?.subscribe((e) => {
    broadcast({ type: "agent", ...e });
    opts.plan?.onAgent(e);
  });
  const unsubLayout = opts.layout?.subscribe((m) => broadcast(m));

  let closed = false;
  return {
    server,
    wss,
    policy,
    broadcast,
    async listen(port = 8200, host = "127.0.0.1") {
      const addr = await listenRetry(server, port, host, { log });
      const shown = host === "0.0.0.0" || host === "::" ? "127.0.0.1" : host.includes(":") ? `[${host}]` : host;
      return { port: addr.port, url: `http://${shown}:${addr.port}` };
    },
    async close() {
      if (closed) return;
      closed = true;
      unsubHub();
      unsubAgent?.();
      unsubLayout?.();
      for (const ws of wss.clients) ws.terminate();
      await new Promise<void>((r) => wss.close(() => r()));
      server.closeAllConnections();
      await new Promise<void>((r) => server.close(() => r()));
    },
  };
}
