// 껍데기 서버: 포트를 계속 잡고 /api/setup*만 직접 처리한다. 나머지 HTTP 요청과 /events 업그레이드는 지금 집 앱의
// server로 넘긴다(앱 server는 듣지 않고 'request'·'upgrade' 처리기로만 쓴다). 집을 바꾸는 동안(앱 없음) API는 503이다.

import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { Duplex } from "node:stream";
import { resolve } from "node:path";
import { DEFAULT_WEB_DIR, HttpError, isLocalOrigin, readJson, type TwinHomeApp } from "./app.js";
import { listenRetry } from "../shared/net.js";
import { serveFile } from "../shared/static.js";

/** 설정 API(start.ts가 구현). 던지는 HttpError는 그 상태 코드로 나간다. */
export interface SetupApi {
  stations(): object;
  setStations(body: Record<string, unknown>): object;
  view(): object;
  /** 설정을 끝냈는지. 안 끝냈으면 /는 /setup/으로 보낸다. */
  done(): boolean;
  chooseHome(body: Record<string, unknown>): Promise<object>;
  setSources(body: Record<string, unknown>): object;
  finish(body: Record<string, unknown>): object;
  /** 운영 모드(test·live). live는 confirm: true와 ThinQ 토큰이 있어야 한다. */
  setMode(body: Record<string, unknown>): object;
  /** 실제 모드에서만 ThinQ 기기 목록. */
  thinqDevices(): Promise<object>;
  /** 에어컨·냉장고 ↔ ThinQ 기기 짝. */
  setPairs(body: Record<string, unknown>): object;
}

export interface ShellOptions {
  setup: SetupApi;
  /** 지금 집의 앱. 집을 바꾸는 중이면 null. */
  current: () => TwinHomeApp | null;
  webDir?: string;
  allowOrigin?: (origin: string) => boolean;
  log?: (msg: string) => void;
}

export interface Shell {
  readonly server: Server;
  listen(port: number, host: string): Promise<{ port: number; url: string }>;
  close(): Promise<void>;
}

const BUSY = "집을 바꾸는 중이에요. 잠시 뒤 다시 해 주세요.";

export function createShell(opts: ShellOptions): Shell {
  const webDir = resolve(opts.webDir ?? DEFAULT_WEB_DIR);
  const allowOrigin = opts.allowOrigin ?? isLocalOrigin;
  const log = opts.log ?? ((m: string) => console.log(m));

  function sendJson(res: ServerResponse, status: number, body: unknown): void {
    res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
    res.end(JSON.stringify(body));
  }

  async function setupRoute(req: IncomingMessage, res: ServerResponse, path: string): Promise<void> {
    const origin = req.headers.origin;
    if (req.method !== "GET" && origin && !allowOrigin(origin)) {
      sendJson(res, 403, { ok: false, error: "허용되지 않은 출처의 요청입니다." });
      return;
    }
    try {
      let body: object;
      if (req.method === "GET" && path === "/api/setup") body = opts.setup.view();
      else if (req.method === "GET" && path === "/api/setup/stations") body = opts.setup.stations();
      else if (req.method === "PUT" && path === "/api/setup/stations") body = opts.setup.setStations(await readJson(req));
      else if (req.method === "POST" && path === "/api/setup/home") body = await opts.setup.chooseHome(await readJson(req));
      else if (req.method === "POST" && path === "/api/setup/devices") body = opts.setup.setSources(await readJson(req));
      else if (req.method === "POST" && path === "/api/setup/done") body = opts.setup.finish(await readJson(req));
      else if (req.method === "POST" && path === "/api/setup/mode") body = opts.setup.setMode(await readJson(req));
      else if (req.method === "GET" && path === "/api/setup/thinq") body = await opts.setup.thinqDevices();
      else if (req.method === "POST" && path === "/api/setup/pairs") body = opts.setup.setPairs(await readJson(req));
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
    const path = new URL(req.url ?? "/", "http://localhost").pathname;
    if (path === "/api/setup" || path.startsWith("/api/setup/")) {
      if (req.method === "OPTIONS") {
        res.writeHead(204);
        res.end();
        return;
      }
      setupRoute(req, res, path).catch(() => { if (!res.headersSent) sendJson(res, 500, { ok: false, error: "서버 오류" }); });
      return;
    }
    // 설정을 안 끝냈으면 대시보드 대신 설정 화면부터
    if ((req.method === "GET" || req.method === "HEAD") && path === "/" && !opts.setup.done()) {
      res.writeHead(302, { location: "/setup/", "cache-control": "no-store" });
      res.end();
      return;
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
