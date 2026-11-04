// 폰 AR 페이지와 자세 WebSocket만 여는 작은 서버(SSOT 9.6). 같은 와이파이의 폰이 붙도록 0.0.0.0에 열 수 있다.
// 기기 제어 REST는 여기 없다. 본 서버(127.0.0.1)는 그대로 두고 눈 자세는 onEye로, 폰의 말(say)과 승인은 onSay·onConfirm·onCancel로
// 넘긴다(그 뒤는 에이전트·승인 정책이 맡는다). 내부 테스트용이라 같은 와이파이의 누구나 말을 보낼 수 있다.

import { createServer, type IncomingMessage, type Server } from "node:http";
import { networkInterfaces } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocket, WebSocketServer } from "ws";
import { listenRetry } from "../server/net.js";
import { serveFile } from "../server/static.js";
import type { AnchorTarget } from "./anchors.js";
import type { EyeFeed } from "./feed.js";
import { MAX_PACKET_BYTES, parseFramePacket } from "./packet.js";
import type { Plan2, Vec3 } from "./align.js";
import { PhoneSession, type AlignMode, type EyeEvent, type FallbackViewpoint, type HerePoint } from "./session.js";

const DEFAULT_WEB_DIR = fileURLToPath(new URL("../../web/phone/", import.meta.url));

export interface PhoneServerOptions {
  targets: AnchorTarget[];
  onEye: (eye: EyeEvent) => void;
  /** 카메라 프레임·사진을 받을 곳. 없으면 바이너리 메시지를 무시한다. */
  feed?: EyeFeed;
  /** 기준점 거리 차이 허용값(m). 기본 0.3. */
  maxMismatchM?: number;
  /** 있으면 맞추기 전에도 창가 고정 위치 + 폰 방향으로 추정 눈을 보낸다(session.ts estimateFor). */
  fallback?: FallbackViewpoint;
  /** 기준점 방식(기본 floor). touch면 targets는 대시보드에서 고른 벽 지점 A·B다(touch.ts). */
  mode?: AlignMode;
  /** touch 모드의 눈 높이(방 바닥 위 m, 기본 1.5). */
  eyeHeightM?: number;
  /** 평면 점이 있는 방의 바닥 높이(touch 모드 눈 높이에 더한다). */
  floorAt?: (p: Plan2) => number;
  webDir?: string;
  log?: (msg: string) => void;
  /** 폰에서 말하거나 쓴 문장(음성 인식 결과). 에이전트 답과 승인 대기를 돌려준다. */
  onSay?: (text: string) => Promise<PhoneReply>;
  onConfirm?: (token: string) => Promise<{ reply: string }>;
  onCancel?: (token: string) => Promise<{ reply: string }>;
}

export interface PhoneReply {
  reply: string;
  pending: { token: string; deviceLabel: string; reason: string }[];
}

/** 초점 대상(트윈 좌표). */
export interface FocusTarget {
  id: string;
  label: string;
  position: Vec3;
}

const MAX_SAY = 500;

export interface PhoneServer {
  readonly server: Server;
  /** '여기': 마지막 자세의 조준점(평면도). */
  here(): HerePoint;
  /** 클로이드가 지금 다루는 물건을 폰 화면에 표시하게 보낸다(맞추기 전이면 보내지 않는다). */
  sendFocus(targets: FocusTarget[], ttlMs: number): void;
  /** 기준점·방식을 바꾸고(기록·맞춤은 지움) 연결된 폰에 새 상태를 보낸다. */
  setTargets(targets: AnchorTarget[], mode: AlignMode): void;
  listen(port: number, host: string): Promise<{ port: number; urls: string[] }>;
  close(): Promise<void>;
}

/** 페이지를 준 호스트와 같은 출처만 받는다(다른 사이트가 가짜 자세를 보내지 못하게). */
export function sameHost(origin: string | undefined, host: string | undefined): boolean {
  if (!origin) return true;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

/** 폰에서 열 주소. 0.0.0.0이면 이 PC의 사설 IPv4마다 하나씩. */
export function lanUrls(port: number, host: string): string[] {
  if (host !== "0.0.0.0" && host !== "::") return [`http://${host}:${port}/phone/`];
  return Object.values(networkInterfaces())
    .flat()
    .filter((a) => a && a.family === "IPv4" && !a.internal)
    .map((a) => `http://${a!.address}:${port}/phone/`);
}

export function createPhoneServer(opts: PhoneServerOptions): PhoneServer {
  const webDir = resolve(opts.webDir ?? DEFAULT_WEB_DIR);
  const log = opts.log ?? ((m: string) => console.log(m));
  const session = new PhoneSession(opts.targets, {
    maxMismatchM: opts.maxMismatchM, fallback: opts.fallback, mode: opts.mode, eyeHeightM: opts.eyeHeightM, floorAt: opts.floorAt,
  });

  const server = createServer((req, res) => {
    const path = new URL(req.url ?? "/", "http://localhost").pathname;
    if (req.method !== "GET" && req.method !== "HEAD") {
      res.writeHead(405);
      res.end();
      return;
    }
    if (path === "/" || path === "/phone") {
      res.writeHead(302, { location: "/phone/" });
      res.end();
      return;
    }
    if (path.startsWith("/phone/") && serveFile(res, webDir, path.slice("/phone/".length), req.method === "HEAD")) return;
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end("없는 경로입니다");
  });

  const wss = new WebSocketServer({
    server,
    path: "/phone/events",
    maxPayload: MAX_PACKET_BYTES,
    verifyClient: ({ origin, req }: { origin?: string; req: IncomingMessage }) => sameHost(origin, req.headers.host),
  });
  wss.on("error", () => {}); // listen 실패는 listen()의 reject로 전달된다(app.ts와 같은 이유)

  const reply = (ws: WebSocket, msg: unknown) => {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
  };
  // 바이너리 메시지 = 카메라 프레임·사진 패킷(packet.ts)
  const onPacket = (ws: WebSocket, data: Buffer) => {
    const packet = parseFramePacket(data);
    if ("error" in packet) {
      reply(ws, session.status(packet.error));
      return;
    }
    const { header, jpeg } = packet;
    if (!opts.feed) return;
    if (header.kind === "frame") {
      opts.feed.pushFrame(jpeg, header.width, header.height);
      return;
    }
    const eye = header.position && header.orientation
      ? session.eyeAt(header.position, header.orientation, header.tracking ?? "ok", header.epoch)
      : null;
    const photo = opts.feed.savePhoto(jpeg, header.width, header.height, eye);
    reply(ws, { type: "photo_saved", id: photo.id, aligned: eye !== null });
  };

  const talk = async (ws: WebSocket, msg: Record<string, unknown>) => {
    try {
      if (msg.type === "say") {
        const text = typeof msg.text === "string" ? msg.text.trim().slice(0, MAX_SAY) : "";
        if (!text) return reply(ws, { type: "reply", text: "말이 비어 있어요. 다시 말해 주세요.", pending: [] });
        if (!opts.onSay) return reply(ws, { type: "reply", text: "에이전트가 연결되지 않았어요.", pending: [] });
        const r = await opts.onSay(text);
        return reply(ws, { type: "reply", text: r.reply, pending: r.pending });
      }
      const token = typeof msg.token === "string" ? msg.token : "";
      const fn = msg.type === "confirm" ? opts.onConfirm : opts.onCancel;
      if (!token || !fn) return reply(ws, { type: "reply", text: "승인할 작업을 찾지 못했어요.", pending: [] });
      const r = await fn(token);
      return reply(ws, { type: "reply", text: r.reply, pending: [] });
    } catch (e) {
      log(`[phone] 대화 처리 실패: ${(e as Error).message}`);
      return reply(ws, { type: "reply", text: `처리하지 못했어요: ${(e as Error).message}`, pending: [] });
    }
  };

  wss.on("connection", (ws) => {
    reply(ws, session.status());
    ws.on("message", (data, isBinary) => {
      if (isBinary) {
        onPacket(ws, Array.isArray(data) ? Buffer.concat(data) : Buffer.from(data as Buffer));
        return;
      }
      let raw: unknown;
      try {
        raw = JSON.parse(String(data));
      } catch {
        reply(ws, session.status("JSON이 아닙니다"));
        return;
      }
      const type = (raw as { type?: unknown } | null)?.type;
      if (type === "say" || type === "confirm" || type === "cancel") {
        void talk(ws, raw as Record<string, unknown>);
        return;
      }
      const out = session.handle(raw);
      if (out.reply) reply(ws, out.reply);
      if (out.eye) opts.onEye(out.eye);
    });
    ws.on("error", () => {});
  });

  return {
    server,
    here: () => session.here(),
    sendFocus(targets, ttlMs) {
      if (!session.aligned) return;
      const msg = JSON.stringify({
        type: "focus", ttl_ms: ttlMs,
        targets: targets.map((t) => ({ id: t.id, label: t.label, ar: session.toAr(t.position)! })),
      });
      for (const ws of wss.clients) if (ws.readyState === WebSocket.OPEN) ws.send(msg);
    },
    setTargets(targets, mode) {
      session.setTargets(targets, mode);
      for (const ws of wss.clients) reply(ws, session.status());
    },
    async listen(port, host) {
      const addr = await listenRetry(server, port, host, { log });
      return { port: addr.port, urls: lanUrls(addr.port, host) };
    },
    async close() {
      for (const ws of wss.clients) ws.terminate();
      await new Promise<void>((r) => wss.close(() => r()));
      server.closeAllConnections();
      await new Promise<void>((r) => server.close(() => r()));
    },
  };
}
