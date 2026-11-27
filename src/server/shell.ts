// 껍데기 서버: 포트를 계속 잡고 /api/setup*와 앱 화면 오류(/api/mobile/client-error)만 직접 처리한다. 나머지 HTTP 요청과 /events 업그레이드는 지금 집 앱의
// server로 넘긴다(앱 server는 듣지 않고 'request'·'upgrade' 처리기로만 쓴다). 집을 바꾸는 동안(앱 없음) API는 503이다.

import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { existsSync } from "node:fs";
import type { Duplex } from "node:stream";
import { resolve } from "node:path";
import { DEFAULT_WEB_DIR, HttpError, isLocalOrigin, readJson, type TwinHomeApp } from "./app.js";
import { listenRetry } from "../shared/net.js";
import { serveFile } from "../shared/static.js";
import { CLIENT_ERROR_PATH, clientErrorReceiver } from "./client-error.js";
import type { IrPortsView, IrTestView, IrView } from "../contract/ir.js";
import { IR_PATHS } from "../shared/ir.js";

/** 설정 API(start.ts가 구현). 던지는 HttpError는 그 상태 코드로 나간다. */
export interface SetupApi {
  stations(): object;
  setStations(body: Record<string, unknown>): object;
  view(): object;
  chooseHome(body: Record<string, unknown>): Promise<object>;
  setSources(body: Record<string, unknown>): object;
  finish(body: Record<string, unknown>): object;
  /** 운영 모드(test·live). live는 confirm: true와 ThinQ 토큰이 있어야 한다. */
  setMode(body: Record<string, unknown>): object;
  /** 실제 모드에서만 ThinQ 기기 목록. */
  thinqDevices(home?: string): Promise<object>;
  /** 에어컨·냉장고 ↔ ThinQ 기기 짝. */
  setPairs(body: Record<string, unknown>): object;
  /** 적외선 리모컨 등록(계약 src/contract/ir.ts, 경로 src/shared/ir.ts IR_PATHS). */
  ir: {
    view(home?: string): IrView;
    ports(): Promise<IrPortsView>;
    setPort(body: Record<string, unknown>): Promise<IrView>;
    saveRemote(body: Record<string, unknown>): IrView;
    deleteRemote(body: Record<string, unknown>): IrView;
    learn(body: Record<string, unknown>): Promise<IrView>;
    cancelLearn(body: Record<string, unknown>): IrView;
    deleteButton(body: Record<string, unknown>): IrView;
    test(body: Record<string, unknown>): Promise<IrTestView>;
    preset(body: Record<string, unknown>): IrView;
  };
}

export interface ShellOptions {
  setup: SetupApi;
  /** 지금 집의 앱. 집을 바꾸는 중이면 null. */
  current: () => TwinHomeApp | null;
  webDir?: string;
  allowOrigin?: (origin: string) => boolean;
  mobileUrls?: () => readonly string[];
  log?: (msg: string) => void;
  /** 앱 오류 보고 분당 횟수를 셀 시계(시험용). */
  now?: () => number;
}

export interface Shell {
  readonly server: Server;
  listen(port: number, host: string): Promise<{ port: number; url: string }>;
  close(): Promise<void>;
}

const BUSY = "집을 바꾸는 중이에요. 잠시 뒤 다시 해 주세요.";

export function mobileHubUrls(origins: readonly string[]): string[] {
  const urls = origins.flatMap(value => {
    try {
      const url = new URL(value);
      if (!["https:", "http:"].includes(url.protocol) || url.username || url.password ||
        !["/", "/mobile/"].includes(url.pathname) ||
        /^(?:localhost\.?|127\..*|0\.0\.0\.0|\[::1\]|\[::\])$/i.test(url.hostname)) return [];
      return [new URL("/mobile/", url.origin).href];
    } catch { return []; }
  });
  return [...new Set(urls)];
}

export function createShell(opts: ShellOptions): Shell {
  const webDir = resolve(opts.webDir ?? DEFAULT_WEB_DIR);
  const allowOrigin = opts.allowOrigin ?? isLocalOrigin;
  const log = opts.log ?? ((m: string) => console.log(m));
  const receiveClientError = clientErrorReceiver({ log, now: opts.now });

  function sendJson(res: ServerResponse, status: number, body: unknown): void {
    res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
    res.end(JSON.stringify(body));
  }

  async function shellRoute(req: IncomingMessage, res: ServerResponse, path: string, search: string): Promise<void> {
    const origin = req.headers.origin;
    if (req.method !== "GET" && origin && !allowOrigin(origin)) {
      sendJson(res, 403, { ok: false, error: "허용되지 않은 출처의 요청입니다." });
      return;
    }
    try {
      let body: object;
      if (req.method === "GET" && path === "/api/setup") body = { ...opts.setup.view(), mobile_urls: opts.mobileUrls?.() ?? [] };
      else if (req.method === "GET" && path === "/api/setup/stations") body = opts.setup.stations();
      else if (req.method === "PUT" && path === "/api/setup/stations") body = opts.setup.setStations(await readJson(req));
      else if (req.method === "POST" && path === "/api/setup/home") body = await opts.setup.chooseHome(await readJson(req));
      else if (req.method === "POST" && path === "/api/setup/devices") body = opts.setup.setSources(await readJson(req));
      else if (req.method === "POST" && path === "/api/setup/done") body = opts.setup.finish(await readJson(req));
      else if (req.method === "POST" && path === "/api/setup/mode") body = opts.setup.setMode(await readJson(req));
      else if (req.method === "GET" && path === "/api/setup/thinq") body = await opts.setup.thinqDevices(new URLSearchParams(search).get("home") ?? undefined);
      else if (req.method === "POST" && path === "/api/setup/pairs") body = opts.setup.setPairs(await readJson(req));
      else if (req.method === "GET" && path === IR_PATHS.view) body = opts.setup.ir.view(new URLSearchParams(search).get("home") ?? undefined);
      else if (req.method === "GET" && path === IR_PATHS.ports) body = await opts.setup.ir.ports();
      else if (req.method === "POST" && path === IR_PATHS.port) body = await opts.setup.ir.setPort(await readJson(req));
      else if (req.method === "POST" && path === IR_PATHS.remote) body = opts.setup.ir.saveRemote(await readJson(req));
      else if (req.method === "POST" && path === IR_PATHS.remoteDelete) body = opts.setup.ir.deleteRemote(await readJson(req));
      else if (req.method === "POST" && path === IR_PATHS.learn) body = await opts.setup.ir.learn(await readJson(req));
      else if (req.method === "POST" && path === IR_PATHS.learnCancel) body = opts.setup.ir.cancelLearn(await readJson(req));
      else if (req.method === "POST" && path === IR_PATHS.buttonDelete) body = opts.setup.ir.deleteButton(await readJson(req));
      else if (req.method === "POST" && path === IR_PATHS.test) body = await opts.setup.ir.test(await readJson(req));
      else if (req.method === "POST" && path === IR_PATHS.preset) body = opts.setup.ir.preset(await readJson(req));
      else if (path === CLIENT_ERROR_PATH) {
        if (req.method !== "POST") throw new HttpError(405, "허용되지 않은 메서드입니다.");
        body = await receiveClientError(req);
      }
      else throw new HttpError(404, `없는 API입니다: ${path}`);
      sendJson(res, 200, body);
    } catch (e) {
      if (e instanceof HttpError) sendJson(res, e.status, { ok: false, error: e.message, ...e.extra });
      else {
        log(`[server] ${req.method} ${path} 오류: ${(e as Error).stack ?? e}`);
        sendJson(res, 500, { ok: false, error: `서버 오류: ${(e as Error).message}` });
      }
    }
  }

  const server = createServer((req, res) => {
    const { pathname: path, search } = new URL(req.url ?? "/", "http://localhost");
    if (path === "/api/setup" || path.startsWith("/api/setup/") || path === CLIENT_ERROR_PATH) {
      if (req.method === "OPTIONS") {
        res.writeHead(204);
        res.end();
        return;
      }
      shellRoute(req, res, path, search).catch(() => { if (!res.headersSent) sendJson(res, 500, { ok: false, error: "서버 오류" }); });
      return;
    }
    if (req.method === "GET" || req.method === "HEAD") {
      const target = path === "/setup" || path === "/setup/" || path === "/setup/index.html" ? "/mobile/settings/"
        : path === "/mobile" || path === "/mobile/settings" ? path + "/" : null;
      // A legacy build can still serve its old settings entry until the new bundle is built.
      if (target && existsSync(resolve(webDir, "." + target, "index.html"))) {
        res.writeHead(302, { location: target + search, "cache-control": "no-store" });
        res.end();
        return;
      }
    }
    const app = opts.current();
    if (app) {
      app.server.emit("request", req, res);
      return;
    }
    // 바꾸는 중에도 설정 화면 파일은 내준다(바꾸기가 실패해도 다시 고를 수 있게)
    if ((req.method === "GET" || req.method === "HEAD") && !path.startsWith("/api/") && !path.startsWith("/twin/")
      && serveFile(res, webDir, path === "/" ? "index.html" : path, req.method === "HEAD")) return;
    sendJson(res, 503, { ok: false, error: BUSY });
  });

  server.on("upgrade", (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    const app = opts.current();
    if (app) app.server.emit("upgrade", req, socket, head);
    else socket.destroy();
  });

  let closed = false;
  return {
    server,
    async listen(port, host) {
      const addr = await listenRetry(server, port, host, { log });
      const shown = host === "0.0.0.0" || host === "::" ? "127.0.0.1" : host.includes(":") ? `[${host}]` : host;
      return { port: addr.port, url: `http://${shown}:${addr.port}` };
    },
    async close() {
      if (closed) return;
      closed = true;
      server.closeAllConnections();
      await new Promise<void>((r) => server.close(() => r()));
    },
  };
}
