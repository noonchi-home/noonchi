// HTTP + WebSocket 서버(docs/plan.md "서버"). DeviceHub 하나를 받아 REST·WS·웹 화면을 제공한다.
// 정책(승인)은 Policy, 자연어는 Agent가 맡는다. 외부 라이브러리는 ws만 쓴다.

import { existsSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocket, WebSocketServer } from "ws";
import { z } from "zod";
import type { Agent } from "../agent/agent.js";
import { newSessionId } from "../agent/agent.js";
import { Policy } from "../agent/policy.js";
import { deviceViews, roomViews } from "../agent/tools.js";
import type { Command, CommandResult, DeviceHub, RoomSpec } from "../hub/types.js";
import type { LayoutEditor } from "../layout/editor.js";
import { twinChange } from "../model/mapping.js";
import { listenRetry } from "./net.js";
import { serveFile } from "./static.js";

export interface AppOptions {
  hub: DeviceHub;
  policy?: Policy;
  agent?: Agent;
  rooms?: RoomSpec[];
  /** 웹 화면 폴더(기본: 레포의 web/). */
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
  /** 허용할 브라우저 출처(기본: localhost·127.0.0.1·[::1]의 모든 포트). */
  allowOrigin?: (origin: string) => boolean;
  log?: (msg: string) => void;
  /** /api/health에 보일 허브 종류. */
  hubKind?: string;
  /** 폰 AR 클로이드의 눈 화면(src/phone/feed.ts). 있으면 GET /api/eye/*를 넘긴다. */
  eye?: { handle(req: IncomingMessage, res: ServerResponse, path: string): boolean };
}

/** MatterHub에서 서버가 쓰는 부분(src/matter/matterHub.ts를 직접 불러오지 않으려고 모양만 적는다). */
interface MatterInfoView {
  transport: string;
  commissioning?: string;
  storageDir?: string;
  [key: string]: unknown;
}
interface MatterControl {
  readonly info: MatterInfoView;
  openCommissioningWindow(timeoutSeconds?: number): Promise<unknown>;
}

export interface TwinHomeApp {
  readonly server: Server;
  readonly wss: WebSocketServer;
  readonly policy: Policy;
  listen(port?: number, host?: string): Promise<{ port: number; url: string }>;
  close(): Promise<void>;
  broadcast(msg: unknown): void;
}

const DEFAULT_WEB_DIR = fileURLToPath(new URL("../../web/", import.meta.url));
const LOCAL_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i;
const MAX_BODY = 1 << 20;

class HttpError extends Error {
  constructor(readonly status: number, message: string, readonly extra?: Record<string, unknown>) {
    super(message);
  }
}

// ── 요청 본문 검사 ─────────────────────────────────────────

const CommandSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("on") }),
  z.object({ type: z.literal("off") }),
  z.object({ type: z.literal("level"), percent: z.number() }),
  z.object({
    type: z.literal("climate"),
    mode: z.enum(["cool", "heat", "auto", "dry", "fan"]).optional(),
    setpointC: z.number().optional(),
    fan: z.enum(["low", "medium", "high", "auto"]).optional(),
  }),
  z.object({ type: z.literal("covering"), openPercent: z.number() }),
  z.object({ type: z.literal("lock") }),
  z.object({ type: z.literal("unlock") }),
  z.object({ type: z.literal("start") }),
  z.object({ type: z.literal("stop") }),
  z.object({ type: z.literal("pause") }),
  z.object({ type: z.literal("valve"), open: z.boolean() }),
]);

const KO_ERRORS = z.locales.ko().localeError;

function parseCommand(raw: unknown): Command {
  const value = typeof raw === "string" ? { type: raw } : raw;
  const r = CommandSchema.safeParse(value, { error: KO_ERRORS });
  if (!r.success) {
    const issues = r.error.issues.map((i) => `${i.path.join(".") || "command"}: ${i.message}`).join("; ");
    throw new HttpError(400, `명령 형식이 올바르지 않습니다: ${issues}`);
  }
  return r.data as Command;
}

function record(v: unknown): Record<string, unknown> {
  if (!v || typeof v !== "object" || Array.isArray(v)) throw new HttpError(400, "요청 본문은 JSON 객체여야 합니다.");
  return v as Record<string, unknown>;
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY) throw new HttpError(413, "요청 본문이 너무 큽니다(최대 1MB).");
    chunks.push(chunk as Buffer);
  }
  const text = Buffer.concat(chunks).toString("utf8").trim();
  if (!text) return {};
  try {
    return record(JSON.parse(text));
  } catch (e) {
    if (e instanceof HttpError) throw e;
    throw new HttpError(400, "요청 본문 JSON을 읽지 못했습니다.");
  }
}

function commandStatus(r: CommandResult): number {
  if (r.ok) return 200;
  if (r.needsConfirmation) return 409;
  return 400;
}

// ── 앱 ────────────────────────────────────────────────────

export function createApp(opts: AppOptions): TwinHomeApp {
  const { hub, agent } = opts;
  const policy = opts.policy ?? new Policy();
  const webDir = resolve(opts.webDir ?? DEFAULT_WEB_DIR);
  const twinDir = opts.twinDir ? resolve(opts.twinDir) : undefined;
  const viewerDir = opts.viewerDir ? resolve(opts.viewerDir) : undefined;
  const libraryDir = opts.libraryDir ? resolve(opts.libraryDir) : undefined;
  const allowOrigin = opts.allowOrigin ?? ((o: string) => LOCAL_ORIGIN.test(o));
  const log = opts.log ?? ((m: string) => console.log(m));

  const spec = (id: string) => hub.list().find((d) => d.id === id);
  const matterInfo = (): MatterInfoView | undefined => {
    const info = (hub as Partial<MatterControl>).info;
    return info && typeof info === "object" && "transport" in info ? info : undefined;
  };
  const requireSpec = (id: string) => {
    const s = spec(id);
    if (!s) throw new HttpError(404, `기기를 찾을 수 없습니다: ${id}`);
    return s;
  };

  type Handler = (req: IncomingMessage, url: URL, params: string[]) => Promise<unknown>;
  const routes: { method: string; pattern: RegExp; handler: Handler; status?: (body: unknown) => number }[] = [];
  const route = (method: string, pattern: RegExp, handler: Handler, status?: (body: unknown) => number) => routes.push({ method, pattern, handler, status });

  route("GET", /^\/api\/health$/, async () => ({
    ok: true, devices: hub.list().length, hub: opts.hubKind ?? "memory", transport: matterInfo()?.transport ?? null,
    provider: agent?.provider.name ?? null, model: agent?.provider.model ?? null, twin: !!twinDir && existsSync(twinDir),
    eye: !!opts.eye, home: opts.home ?? null, phone_urls: opts.phoneUrls?.() ?? [],
  }));

  // ── 배치 보정 ──

  const requireLayout = () => {
    if (!opts.layout) throw new HttpError(404, "배치 보정을 쓸 수 없습니다(집 scene.json이 없음).");
    return opts.layout;
  };
  route("GET", /^\/api\/layout$/, async () => {
    const editor = requireLayout();
    return { ok: true, ...editor.status(), items: editor.edits() };
  });
  route("POST", /^\/api\/layout\/save$/, async () => ({ ok: true, ...requireLayout().save() }));
  route("POST", /^\/api\/layout\/reset$/, async () => ({ ok: true, reverted: requireLayout().reset().length }));

  route("GET", /^\/api\/homes$/, async () => ({ current: opts.home?.id ?? null, homes: opts.homes ?? (opts.home ? [opts.home] : []) }));

  // ── Matter(허브가 MatterHub일 때) ──

  route("GET", /^\/api\/matter$/, async () => {
    const info = matterInfo();
    if (!info) throw new HttpError(404, "Matter 허브가 아닙니다(HUB=memory로 떠 있음).");
    const { storageDir: _dir, ...rest } = info;
    return { ok: true, ...rest };
  });

  route("POST", /^\/api\/matter\/commissioning-window$/, async (req) => {
    const control = hub as Partial<MatterControl>;
    if (!matterInfo() || typeof control.openCommissioningWindow !== "function") throw new HttpError(404, "Matter 허브가 아닙니다(HUB=memory로 떠 있음).");
    const body = await readJson(req);
    const raw = body.timeoutSeconds ?? 900;
    // Matter 규격: 커미셔닝 창은 180초~900초
    if (typeof raw !== "number" || !Number.isInteger(raw) || raw < 180 || raw > 900) throw new HttpError(400, "timeoutSeconds는 180~900 사이 정수여야 합니다.");
    let pairing: unknown;
    try {
      pairing = await control.openCommissioningWindow(raw);
    } catch (e) {
      throw new HttpError(400, `페어링 창을 열지 못했습니다: ${(e as Error).message}`);
    }
    return { ok: true, timeoutSeconds: raw, pairing, reply: `${Math.round(raw / 60)}분 동안 다른 Matter 컨트롤러(Home Assistant 등)가 이 페어링 코드로 브리지를 추가할 수 있어요.` };
  });

  route("GET", /^\/api\/rooms$/, async () => roomViews(hub.list(), opts.rooms));

  route("GET", /^\/api\/devices$/, async (_req, url) => {
    const room = url.searchParams.get("room");
    const kind = url.searchParams.get("kind");
    return deviceViews(hub).filter((d) => (!room || d.room === room) && (!kind || d.kind === kind));
  });

  route("GET", /^\/api\/devices\/([^/]+)$/, async (_req, _url, [id]) => {
    const s = requireSpec(id!);
    return { ...s, state: hub.get(s.id) };
  });

  route("POST", /^\/api\/devices\/([^/]+)\/command$/, async (req, _url, [id]) => {
    const body = await readJson(req);
    requireSpec(id!);
    const cmd = parseCommand(body.command);
    const token = typeof body.confirmToken === "string" && body.confirmToken ? body.confirmToken : undefined;
    return policy.guard(hub, id!, cmd, token);
  }, (b) => commandStatus(b as CommandResult));

  // 3D 트윈 화면에서 바꾼 twin 상태(docs/plan.md "3D 트윈 연결"). 제어 attr은 명령으로 바꿔 정책을 거치고, 센서 attr은 센서 값을 바꾼다.
  route("POST", /^\/api\/devices\/([^/]+)\/twin$/, async (req, _url, [id]) => {
    const body = await readJson(req);
    const s = requireSpec(id!);
    if (typeof body.attr !== "string" || !body.attr) throw new HttpError(400, "attr(twin 상태 이름)가 필요합니다.");
    if (!("value" in body)) throw new HttpError(400, "value가 필요합니다.");
    const change = twinChange(s, body.attr, body.value);
    if (change.type === "invalid") throw new HttpError(400, change.error);
    if (change.type === "sensor") return { ...(await hub.setSensor(s.id, body.attr, change.value)), via: "sensor" };
    const token = typeof body.confirmToken === "string" && body.confirmToken ? body.confirmToken : undefined;
    return { ...(await policy.guard(hub, s.id, change.command, token)), via: "command", command: change.command };
  }, (b) => commandStatus(b as CommandResult));

  route("POST", /^\/api\/sensors\/([^/]+)$/, async (req, _url, [id]) => {
    const body = await readJson(req);
    requireSpec(id!);
    if (typeof body.attr !== "string" || !body.attr) throw new HttpError(400, "attr(센서 이름)가 필요합니다.");
    if (!("value" in body)) throw new HttpError(400, "value가 필요합니다.");
    return hub.setSensor(id!, body.attr, body.value);
  }, (b) => ((b as CommandResult).ok ? 200 : 400));

  route("POST", /^\/api\/agent\/chat$/, async (req) => {
    if (!agent) throw new HttpError(503, "에이전트가 설정되지 않았습니다.");
    const body = await readJson(req);
    const message = typeof body.message === "string" ? body.message.trim() : "";
    if (!message) throw new HttpError(400, "message(보낼 말)가 필요합니다.");
    if (message.length > 2000) throw new HttpError(400, "message가 너무 깁니다(최대 2000자).");
    const sessionId = typeof body.sessionId === "string" && body.sessionId.trim() ? body.sessionId.trim().slice(0, 100) : newSessionId();
    return agent.chat(sessionId, message);
  });

  route("POST", /^\/api\/agent\/confirm$/, async (req) => {
    const body = await readJson(req);
    if (typeof body.token !== "string" || !body.token) throw new HttpError(400, "token이 필요합니다.");
    if (agent) return agent.confirm(body.token);
    const p = policy.pending().find((x) => x.token === body.token);
    const r = await policy.confirm(hub, body.token);
    return { ...r, deviceId: p?.deviceId, reply: r.ok ? "승인한 명령을 실행했어요." : r.error };
  }, (b) => ((b as { ok: boolean }).ok ? 200 : 400));

  route("POST", /^\/api\/agent\/cancel$/, async (req) => {
    const body = await readJson(req);
    if (typeof body.token !== "string" || !body.token) throw new HttpError(400, "token이 필요합니다.");
    if (agent) return agent.cancel(body.token);
    const p = policy.consume(body.token);
    return { ok: !!p, reply: p ? "취소했어요." : "취소할 승인 대기가 없어요." };
  });

  route("GET", /^\/api\/agent\/pending$/, async (_req, url) => {
    const sessionId = url.searchParams.get("sessionId") ?? undefined;
    if (agent) return agent.pending(sessionId);
    return policy.pending().map((p) => ({ ...p, expiresAt: new Date(p.expiresAt).toISOString() }));
  });

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
    sendJson(res, 404, { ok: false, error: `파일이 없습니다: ${path}` });
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
    for (const ws of wss.clients) if (ws.readyState === WebSocket.OPEN) ws.send(text);
  }

  wss.on("connection", (ws) => {
    send(ws, { type: "hello", devices: hub.list().length, provider: agent?.provider.name ?? null, hub: opts.hubKind ?? "memory" });
    for (const state of hub.states()) send(ws, { type: "state", state });
    for (const m of opts.layout?.syncMessages() ?? []) send(ws, m);
    ws.on("error", () => {});
  });

  const unsubHub = hub.subscribe((state) => broadcast({ type: "state", state }));
  const unsubAgent = agent?.subscribe((e) => broadcast({ type: "agent", ...e }));
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
