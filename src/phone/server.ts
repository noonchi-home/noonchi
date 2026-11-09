// 폰 AR 페이지와 자세 WebSocket만 여는 작은 서버(SSOT 9.6). 같은 와이파이의 폰이 붙도록 0.0.0.0에 열 수 있다.
// 기기 제어 REST는 여기 없다. 본 서버(127.0.0.1)는 그대로 두고 눈 자세는 onEye로, 폰의 말(say)과 승인 답(이번만·앞으로도·하지 마)은 onSay·onConfirm·onCancel로
// 넘긴다(그 뒤는 에이전트·승인 정책이 맡는다). 실제 폰에 명령·질문이 떠 있으면 말을 먼저 그 답으로 맞춰 보고(onAnswer),
// 답 단추(answer)는 onChoice로 넘긴다(src/contract/phone.ts). 명령 대상의 트윈 자리는 맞춘 기준점으로 AR 자리로 바꿔 보내고(맞추기 전 null),
// 맞춤이 바뀌면 지금 명령을 다시 보낸다(speak false).
// 내부 테스트용이라 같은 와이파이의 누구나 말을 보낼 수 있다.
// 폰 화면은 React 빌드 ui/dist/phone/이고 빌드 파일은 /assets/다(대시보드와 같은 빌드).

import { existsSync } from "node:fs";
import { createServer, type IncomingMessage, type Server } from "node:http";
import { networkInterfaces } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocket, WebSocketServer } from "ws";
import type { FocusTarget } from "../contract/events.js";
import type { ApprovalAnswer, PhoneCommand, PhonePending, PhoneTalkReply, PlannedCommand, PlannedCommandMessage } from "../contract/phone.js";
import { listenRetry } from "../server/net.js";
import { serveFile } from "../server/static.js";
import type { AnchorTarget } from "./anchors.js";
import type { EyeFeed } from "./feed.js";
import { MAX_PACKET_BYTES, parsePacket, type FrameHeader } from "./packet.js";
import type { Plan2 } from "./align.js";
import { PhoneSession, type AlignMode, type CameraView, type EyeEvent, type FallbackViewpoint, type HerePoint, type PhoneStatus } from "./session.js";

export type { FocusTarget } from "../contract/events.js";

/** 폰 화면 빌드 폴더: ui/dist(대시보드와 같은 빌드). npm start·npm run dev가 먼저 빌드한다. */
export const DEFAULT_UI_DIR = fileURLToPath(new URL("../../ui/dist/", import.meta.url));
/** 빌드 전이면 /phone/ 요청에 주는 글. */
export const PHONE_NOT_BUILT = "폰 화면이 아직 빌드되지 않았어요. npm run ui:build";
/** /phone/ 밖에서 내주는 ui/dist 파일: 빌드 파일·브랜드 그림·글꼴 라이선스 폴더와 파비콘. 대시보드·설정 화면은 내주지 않는다. */
const PHONE_FILES = /^\/(assets|brand|fonts)\/(.+)$|^\/(favicon\.ico|favicon-32\.png|apple-touch-icon\.png|icon-192\.png|icon-512\.png)$/;

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
  /** 화면 빌드 폴더(기본 ui/dist). 폰 화면은 그 안 phone/index.html. */
  uiDir?: string;
  log?: (msg: string) => void;
  /** 폰에서 말하거나 쓴 문장(음성 인식 결과). 에이전트 답과 승인 대기를 돌려준다. */
  onSay?: (text: string) => Promise<PhoneReply>;
  /** 승인 답(confirm). choice가 없으면 once. */
  onConfirm?: (token: string, choice: ApprovalAnswer) => Promise<{ reply: string }>;
  onCancel?: (token: string) => Promise<{ reply: string }>;
  /** 관찰 흐름(BRAIN=1): 엔진 프레임을 그 순간의 눈 자세·카메라(맞추기 전 null)와 함께 넘긴다. */
  onEngine?: (jpeg: Buffer, header: FrameHeader, eye: EyeEvent | null, view: CameraView | null, receivedAtMs: number) => void;
  /** 엔진 프레임 간격(ms). 있으면 상태 메시지에 engine_ms로 실어 폰이 그 간격으로 보낸다. */
  engineMs?: number;
  /** 실제 폰 답 단추({type:"answer", id, step, choice}: 「완료」·질문 답). */
  onChoice?: (id: string, step: string, choice: string) => void;
  /** 폰의 말(say)을 에이전트보다 먼저 받는다. 명령·질문의 답(「완료」「그만」 등)이면 handled이고, 그때는 에이전트로 보내지 않고 reply를 돌려준다. */
  onAnswer?: (text: string) => { handled: boolean; reply?: string };
}

export interface PhoneReply {
  reply: string;
  pending: PhonePending[];
}

const MAX_SAY = 500;
const ANSWERS: readonly ApprovalAnswer[] = ["once", "always", "never"];

export interface PhoneServer {
  readonly server: Server;
  /** '여기': 마지막 자세의 조준점(평면도). */
  here(): HerePoint;
  /** 클로이드가 지금 다루는 물건을 폰 화면에 표시하게 보낸다(맞추기 전이면 보내지 않는다). */
  sendFocus(targets: FocusTarget[], ttlMs: number): void;
  /** 기준점·방식을 바꾸고(기록·맞춤은 지움) 연결된 폰에 새 상태를 보낸다. */
  setTargets(targets: AnchorTarget[], mode: AlignMode): void;
  /** 실제 폰 명령(command)·지우기(command_clear)를 연결된 폰 모두에 보내고 지금 명령으로 둔다. 새로 붙은 폰은 상태 다음에
   *  지금 명령을 speak false로, 명령이 없으면 id 없는 command_clear를 받는다(다시 켠 서버에 다시 붙은 폰의 이전 명령이 지워진다). */
  command(msg: PlannedCommandMessage): void;
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
  const uiDir = resolve(opts.uiDir ?? DEFAULT_UI_DIR);
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
    const head = req.method === "HEAD";
    // 폴더마다 그 폴더를 뿌리로 내준다(..%2F로 ui/dist의 대시보드·설정 화면에 닿지 않게)
    const file = PHONE_FILES.exec(path);
    if (path.startsWith("/phone/")) {
      if (serveFile(res, join(uiDir, "phone"), path.slice("/phone/".length), head)) return;
      if (!existsSync(join(uiDir, "phone", "index.html"))) {
        res.writeHead(503, { "content-type": "text/plain; charset=utf-8" });
        res.end(PHONE_NOT_BUILT);
        return;
      }
    } else if (file && serveFile(res, file[1] ? join(uiDir, file[1]) : uiDir, file[2] ?? file[3]!, head)) return;
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
  /** 상태 메시지에 엔진 프레임 간격을 싣는다. */
  const withEngine = (s: PhoneStatus): PhoneStatus => (opts.engineMs ? { ...s, engine_ms: opts.engineMs } : s);
  const status = (error?: string) => withEngine(session.status(error));
  // 바이너리 메시지 = 엔진 프레임(분석용)·화면 프레임(표시용)·사진·표시 영상 패킷(packet.ts). 영상은 연결 번호로 구분해 판단 없이 중계한다(video.ts)
  const onPacket = (ws: WebSocket, source: number, data: Buffer) => {
    const receivedAtMs = Date.now();
    const packet = parsePacket(data);
    if ("error" in packet) {
      reply(ws, status(packet.error));
      return;
    }
    if ("video" in packet) {
      const { video, data: body } = packet;
      if (video.kind === "video_config") opts.feed?.video.config(source, { codec: video.codec, width: video.width, height: video.height, description: body });
      else opts.feed?.video.chunk(source, { key: video.key, ts: video.ts, width: video.width, height: video.height, data: body });
      return;
    }
    const { header, jpeg } = packet;
    const eyeOf = () => (header.position && header.orientation
      ? session.eyeAt(header.position, header.orientation, header.tracking ?? "ok", header.epoch)
      : null);
    if (header.kind === "engine") {
      const view = header.position && header.orientation ? session.viewAt(header.position, header.orientation, header.projection, header.epoch) : null;
      opts.onEngine?.(jpeg, header, eyeOf(), view, receivedAtMs);
      return;
    }
    // 화면 프레임은 표시만, 사진은 저장만 한다(관찰 흐름에는 엔진 프레임만 들어간다)
    if (header.kind === "frame") {
      opts.feed?.pushFrame(jpeg, header.width, header.height);
      return;
    }
    if (!opts.feed) return;
    const eye = eyeOf();
    const photo = opts.feed.savePhoto(jpeg, header.width, header.height, eye);
    reply(ws, { type: "photo_saved", id: photo.id, aligned: eye !== null });
  };

  // 답(PhoneTalkReply): 에이전트 답만 승인 대기 목록(pending)을 싣는다. 명령의 답·승인·취소·오류는 그 칸을 빼서 실제 폰이 목록을 그대로 둔다
  const talk = async (ws: WebSocket, msg: Record<string, unknown>) => {
    const say = (text: string, pending?: PhoneReply["pending"]): void => reply(ws, { type: "reply", text, ...(pending ? { pending } : {}) } satisfies PhoneTalkReply);
    try {
      if (msg.type === "say") {
        const text = typeof msg.text === "string" ? msg.text.trim().slice(0, MAX_SAY) : "";
        if (!text) return say("말이 비어 있어요. 다시 말해 주세요.");
        const answer = opts.onAnswer?.(text);
        if (answer?.handled) return say(answer.reply ?? "");
        if (!opts.onSay) return say("에이전트가 연결되지 않았어요.");
        const r = await opts.onSay(text);
        return say(r.reply, r.pending);
      }
      const token = typeof msg.token === "string" ? msg.token : "";
      if (msg.type === "confirm") {
        const choice = msg.choice === undefined ? "once" : ANSWERS.find((a) => a === msg.choice);
        if (!token || !choice || !opts.onConfirm) return say("승인할 작업을 찾지 못했어요.");
        return say((await opts.onConfirm(token, choice)).reply);
      }
      if (!token || !opts.onCancel) return say("승인할 작업을 찾지 못했어요.");
      return say((await opts.onCancel(token)).reply);
    } catch (e) {
      log(`[phone] 대화 처리 실패: ${(e as Error).message}`);
      return say(`처리하지 못했어요: ${(e as Error).message}`);
    }
  };

  let connections = 0;
  let current: PlannedCommand | null = null;
  /** 실제 폰에 보낼 명령: 대상 트윈 자리 → AR 자리(맞추기 전이면 대상 null). */
  const wire = (c: PlannedCommand, speak = c.speak): PhoneCommand => {
    const ar = c.target ? session.toAr(c.target.position) : null;
    return { ...c, target: c.target && ar ? { id: c.target.id, label: c.target.label, ar } : null, speak };
  };
  /** 맞춤이 바뀌었으면 지금 명령을 새 대상 자리로 다시 보낸다. */
  const resendIf = (wasAligned: boolean) => {
    if (!current || session.aligned === wasAligned) return;
    const msg = wire(current, false);
    for (const ws of wss.clients) reply(ws, msg);
  };
  wss.on("connection", (ws) => {
    const source = ++connections;
    log(`[phone] 폰 연결(지금 ${wss.clients.size}대)`);
    ws.on("close", () => {
      opts.feed?.video.endSource(source);
      log(`[phone] 폰 끊김(지금 ${wss.clients.size}대)`);
    });
    reply(ws, status());
    reply(ws, current ? wire(current, false) : { type: "command_clear" });
    ws.on("message", (data, isBinary) => {
      if (isBinary) {
        onPacket(ws, source, Array.isArray(data) ? Buffer.concat(data) : Buffer.from(data as Buffer));
        return;
      }
      let raw: unknown;
      try {
        raw = JSON.parse(String(data));
      } catch {
        reply(ws, status("JSON이 아닙니다"));
        return;
      }
      const type = (raw as { type?: unknown } | null)?.type;
      if (type === "say" || type === "confirm" || type === "cancel") {
        void talk(ws, raw as Record<string, unknown>);
        return;
      }
      // 시계 맞춤(NTP식): 폰이 보낸 t0를 그대로, 서버 시각을 붙여 바로 돌려준다
      if (type === "clock") {
        const t0 = (raw as { t0?: unknown }).t0;
        if (typeof t0 === "number" && Number.isFinite(t0)) reply(ws, { type: "clock", t0, server: Date.now() });
        return;
      }
      if (type === "answer") {
        const { id, step, choice } = raw as { id?: unknown; step?: unknown; choice?: unknown };
        if (typeof id === "string" && typeof step === "string" && typeof choice === "string" && id.length <= 64 && step.length <= 80 && choice.length <= 32) {
          opts.onChoice?.(id, step, choice);
        }
        return;
      }
      const wasAligned = session.aligned;
      const out = session.handle(raw);
      if (out.reply) reply(ws, withEngine(out.reply));
      if (out.eye) opts.onEye(out.eye);
      resendIf(wasAligned);
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
      const wasAligned = session.aligned;
      session.setTargets(targets, mode);
      for (const ws of wss.clients) reply(ws, status());
      resendIf(wasAligned);
    },
    command(msg) {
      if (msg.type === "command") current = msg;
      else if (msg.id === undefined || msg.id === current?.id) current = null;
      const out = msg.type === "command" ? wire(msg) : msg;
      for (const ws of wss.clients) reply(ws, out);
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
