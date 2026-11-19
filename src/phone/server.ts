// 폰 AR 페이지와 자세 WebSocket만 여는 작은 서버(SSOT 9.6). 같은 와이파이의 폰이 붙도록 0.0.0.0에 열 수 있다.
// 기기 제어 REST는 여기 없다. 본 서버(127.0.0.1)는 그대로 두고 눈 자세는 onEye로, 폰의 말(say)과 승인 답(승인·거절)은 onSay·onConfirm·onCancel로
// 넘긴다(그 뒤는 에이전트·승인 정책이 맡는다). 실제 폰에 명령·질문이 떠 있으면 말을 먼저 그 답으로 맞춰 보고(onAnswer),
// 답 단추(answer)는 onChoice로 넘긴다(src/contract/phone.ts). 명령 대상의 트윈 자리는 맞춘 변환으로 AR 자리로 바꿔 보내고(맞추기 전 null),
// 맞춤이 바뀌면 지금 명령을 다시 보낸다(speak false). 위치 맞춤 모듈(src/phone/sync)의 상태가 바뀌면 붙은 폰 모두에 상태를 보낸다.
// 명령의 소리 등급(grade)은 실행 추적이 붙여 온 그대로 보낸다(src/act/talk-grade.ts). 실제 폰은 안전·질문 말을 자르지 않고 끝까지 읽는다.
// 내부 테스트용이라 같은 와이파이의 누구나 말을 보낼 수 있다.
// 폰 화면은 React 빌드 ui/dist/phone/이고 빌드 파일은 /assets/다(대시보드와 같은 빌드). 영상 모드 영상은 /phone/videos/다(videoDir, Range).
// 폰 판본(src/contract/phone-version.ts): 연결마다 hello를 기다린다. 판본이 맞는 hello를 받기 전에는 그 연결에 계획 명령을 보내지 않고 답(answer·say·confirm·cancel)을
// 받지 않는다(관찰 사진·자세는 받는다). 열린 뒤 2초 안에 hello가 없거나 판본이 다르면 옛 탭으로 두고 새로 고침 안내(명령 id refresh)를 보낸다.
// 그 뒤라도 맞는 hello가 오면 정상으로 바꿔 새로 고침 안내를 지우고 지금 명령 전체와 승인 대기 목록을 다시 보낸다. ready(): 맞는 폰이 하나라도 붙어 있다.
// 말(say)의 at(말할 때 떠 있던 명령·보인 승인 대기)은 모양을 본 뒤 onAnswer에 넘긴다(틀리면 칸 없음).

import { existsSync, statSync } from "node:fs";
import { createServer, type IncomingMessage, type Server } from "node:http";
import { networkInterfaces } from "node:os";
import { join, resolve } from "node:path";
import { WebSocket, WebSocketServer } from "ws";
import type { FocusTarget } from "../contract/events.js";
import type { ApprovalAnswer, HeardAt, PhoneCommand, PhonePending, PhoneTalkReply, PlannedCommand, PlannedCommandMessage } from "../contract/phone.js";
import { PHONE_PROTOCOL } from "./protocol.js";
import { REFRESH_TEXT } from "../act/labels.js";
import { listenRetry } from "../shared/net.js";
import { headWithin } from "../shared/cut.js";
import { serveFile, serveRange } from "../shared/static.js";
import { captureTime } from "../shared/capture-time.js";
import { repoPath } from "../shared/paths.js";
import type { EyeFeed } from "./feed.js";
import { MAX_PACKET_BYTES, parsePacket, type FrameHeader } from "./packet.js";
import type { Plan2 } from "../shared/geometry.js";
import { PhoneSession, type EyeEvent, type FallbackViewpoint, type HerePoint, type LandmarkBoxIn, type PhoneSessionOptions, type PhoneStatus } from "./session.js";
import type { CameraView } from "../contract/observe.js";
import type { SyncState } from "./sync/aligner.js";
import type { TwinLandmark } from "./sync/landmarks.js";
import type { StartPose } from "./sync/start.js";

export type { FocusTarget } from "../contract/events.js";

/** 폰 화면 빌드 폴더: ui/dist(대시보드와 같은 빌드). npm start·npm run dev가 먼저 빌드한다. */
export const DEFAULT_UI_DIR = repoPath("ui/dist/");
/** 빌드 전이면 /phone/ 요청에 주는 글. */
export const PHONE_NOT_BUILT = "폰 화면이 아직 빌드되지 않았어요. npm run ui:build";
/** /phone/ 밖에서 내주는 ui/dist 파일: 빌드 파일·브랜드 그림·글꼴 라이선스 폴더와 파비콘. 대시보드·설정 화면은 내주지 않는다. */
const PHONE_FILES = /^\/(assets|brand|fonts)\/(.+)$|^\/(favicon\.ico|favicon-32\.png|apple-touch-icon\.png|icon-192\.png|icon-512\.png)$/;
/** 영상 모드가 트는 영상(videoDir 바로 아래 파일 하나). */
const VIDEO_PATH = /^\/phone\/videos\/([A-Za-z0-9_-]{1,64}\.(?:mp4|webm))$/;
const VIDEO_NAME = /^[A-Za-z0-9_-]{1,64}\.(?:mp4|webm)$/;

/** 영상 모드 연결인가: 소켓 주소의 video=<영상 이름>이 이 서버가 내주는 영상(videoDir 바로 아래 파일)일 때만. 실제 폰 페이지는 붙이지 않는다. */
// 영상 모드: 카메라 입력
export function videoSession(url: string | undefined, videoDir: string | null): boolean {
  if (!videoDir || !url) return false;
  const name = new URL(url, "http://phone").searchParams.get("video");
  if (!name || !VIDEO_NAME.test(name)) return false;
  try {
    return statSync(join(videoDir, name)).isFile();
  } catch {
    return false;
  }
}

/** 붙잡은 장면 표시(held)는 영상 모드 연결의 엔진 프레임에만 둔다. 실제 폰은 같은 사진을 새 관찰로 쌓지 않는다(관찰 흐름이 중복으로 버린다). */
// 영상 모드: held
export function engineHeader(header: FrameHeader, video: boolean): FrameHeader {
  if (video || header.held === undefined) return header;
  const { held: _held, ...rest } = header;
  return rest;
}

export interface PhoneServerOptions {
  onReady?: (ready: boolean) => void;
  onEye: (eye: EyeEvent) => void;
  /** 카메라 프레임·사진을 받을 곳. 없으면 바이너리 메시지를 무시한다. */
  feed?: EyeFeed;
  /** 있으면 맞추기 전에도 창가 고정 위치 + 폰 방향으로 추정 눈을 보낸다(session.ts estimateFor). */
  fallback?: FallbackViewpoint;
  /** 바닥 hit이 없을 때 폰 높이에서 빼는 눈높이(m, 기본 1.5). */
  eyeHeightM?: number;
  /** 평면 점이 있는 방의 바닥 높이(floor_z). */
  floorAt?: (p: Plan2) => number;
  /** 위치 맞춤(시작 위치·물건·벽 모양, session.ts): 트윈 물건 기준점, 방 쪽 벽 면, 이 집의 시작 위치. */
  sync: PhoneSessionOptions["sync"];
  /** 화면 빌드 폴더(기본 ui/dist). 폰 화면은 그 안 phone/index.html. */
  uiDir?: string;
  /** 영상 모드 영상 폴더(runtime/videos). 있으면 GET /phone/videos/<이름>.mp4·.webm을 Range로 나눠 준다. */
  videoDir?: string;
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
  /** 폰의 말(say)을 에이전트보다 먼저 받는다. 명령·질문의 답(「완료」「그만」 등)이거나 버린 답이면 handled이고, 그때는 에이전트로 보내지 않고 reply를 돌려준다.
   *  at: 말할 때 폰에 떠 있던 명령·보인 승인 대기(없으면 옛 탭이거나 모양이 틀림). */
  onAnswer?: (text: string, at?: HeardAt) => Handled | Promise<Handled>;
  /** 지금 승인 대기 목록. 연결이 판본 hello로 정상이 되면 이 목록을 보낸다(reply의 pending). */
  pending?: () => PhonePending[];
}

/** 들은 말을 먼저 받은 결과: handled면 에이전트로 보내지 않고 reply를 돌려준다. pending이 있으면(말로 한 승인·거절 뒤) 지금 승인 대기 목록을 같이 보낸다. */
export interface Handled { handled: boolean; reply?: string; pending?: PhonePending[] }

export interface PhoneReply {
  reply: string;
  pending: PhonePending[];
}

const MAX_SAY = 500;
const ANSWERS: readonly ApprovalAnswer[] = ["approve", "reject"];
/** 열린 뒤 이만큼(ms) 안에 판본 hello가 없으면 옛 탭으로 둔다. */
export const HELLO_MS = 2000;
/** 옛 탭에 보내는 새로 고침 안내(옛 탭도 그리는 보통 명령). */
export const REFRESH_COMMAND: PhoneCommand = { type: "command", id: "refresh", step: "refresh", text: REFRESH_TEXT, choices: [], vision: null, target: null, speak: true };

/** 말(say)의 at 모양을 본다. 틀리면 undefined(칸 없음과 같다). */
export function heardAt(raw: unknown): HeardAt | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const a = raw as Record<string, unknown>;
  const pending = Array.isArray(a.pending) && a.pending.length <= 20 && a.pending.every((x) => typeof x === "string" && x.length <= 80) ? (a.pending as string[]) : null;
  if (!pending) return undefined;
  if (a.kind === "none") return { kind: "none", pending: [...pending] };
  if (a.kind === "command" && typeof a.id === "string" && typeof a.step === "string" && a.id.length <= 64 && a.step.length <= 80) {
    return { kind: "command", id: a.id, step: a.step, pending: [...pending] };
  }
  return undefined;
}

export interface PhoneServer {
  readonly server: Server;
  /** '여기': 마지막 자세의 조준점(평면도). */
  here(): HerePoint;
  /** 클로이드가 지금 다루는 물건을 폰 화면에 표시하게 보낸다(맞추기 전이면 보내지 않는다). */
  sendFocus(targets: FocusTarget[], ttlMs: number): void;
  /** 이 집의 시작 위치를 바꾸고(설정 저장·지우기) 연결된 폰에 새 상태를 보낸다. */
  setStart(start: StartPose | null): void;
  /** 트윈 물건 기준점을 바꾼다(배치 보정). */
  setLandmarks(list: readonly TwinLandmark[]): void;
  /** 엔진 프레임 YOLO 기준점 상자(관찰 흐름이 넘긴다). 맞춤이 바뀌면 폰에 상태를 보낸다. */
  landmarks(header: FrameHeader, boxes: readonly LandmarkBoxIn[]): void;
  /** 위치 맞춤 모듈 상태. */
  syncState(): SyncState;
  /** 판본이 맞는 실제 폰(맞는 hello를 받은 연결)이 하나라도 붙어 있는가. */
  ready(): boolean;
  /** 말의 답 메시지(pending 없음)를 판본이 맞는 붙은 폰 모두에 보낸다. 폰은 명령 줄을 건드리지 않고 소리로 읽고 잠깐 알림 줄에 남긴다.
   *  grade safety(다시 켜짐 경고)면 폰이 자르지 않고 끝까지 읽는다. */
  reply(text: string, grade?: "safety"): void;
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
  const videoDir = opts.videoDir ? resolve(opts.videoDir) : null;
  const log = opts.log ?? ((m: string) => console.log(m));
  const session = new PhoneSession({ fallback: opts.fallback, eyeHeightM: opts.eyeHeightM, floorAt: opts.floorAt, sync: opts.sync });

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
    // 영상은 같은 출처로 준다(폰 페이지가 영상을 canvas에 그려 보낸다). 이름이 틀리거나 없으면 404
    if (path.startsWith("/phone/videos/")) {
      const video = VIDEO_PATH.exec(path);
      if (videoDir && video && serveRange(req, res, videoDir, video[1]!, head)) return;
    } else if (path.startsWith("/phone/")) {
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
  /** 상태 메시지에 엔진 프레임 간격과 폰 계약 판본을 싣는다. */
  const withEngine = (s: PhoneStatus): PhoneStatus => ({ ...(opts.engineMs ? { ...s, engine_ms: opts.engineMs } : s), protocol: PHONE_PROTOCOL });
  const status = (error?: string) => withEngine(session.status(error));
  // 바이너리 메시지 = 엔진 프레임(분석용)·화면 프레임(표시용)·사진·표시 영상 패킷(packet.ts). 영상은 연결 번호로 구분해 판단 없이 중계한다(video.ts)
  const onPacket = (ws: WebSocket, source: number, video: boolean, data: Buffer) => {
    const receivedAtMs = Date.now();
    const packet = parsePacket(data);
    if ("error" in packet) {
      reply(ws, status(packet.error));
      return;
    }
    if ("video" in packet) {
      const { video, data: body } = packet;
      if (video.kind === "video_config") opts.feed?.video.config(source, { codec: video.codec, width: video.width, height: video.height, description: body });
      else {
        // 촬영 시각: 엔진 프레임과 같은 규칙(같은 폰 프레임이면 같은 값). 대시보드가 그 시각의 마스크를 이 장면에 얹는다
        const at = captureTime({ receivedAtMs, capturedAt: video.captured_at, timeErrMs: video.time_err_ms }).atMs;
        opts.feed?.video.chunk(source, { key: video.key, ts: video.ts, width: video.width, height: video.height, data: body, at });
      }
      return;
    }
    const { header, jpeg } = packet;
    const eyeOf = () => (header.position && header.orientation
      ? session.eyeAt(header.position, header.orientation, header.tracking ?? "ok", header.epoch)
      : null);
    if (header.kind === "engine") {
      const view = header.position && header.orientation ? session.viewAt(header.position, header.orientation, header.projection, header.epoch) : null;
      // 영상 모드: held
      opts.onEngine?.(jpeg, engineHeader(header, video), eyeOf(), view, receivedAtMs);
      return;
    }
    // 화면 프레임은 표시만, 사진은 저장만 한다(관찰 흐름에는 엔진 프레임만 들어간다)
    if (header.kind === "frame") {
      opts.feed?.pushFrame(jpeg, header.width, header.height, captureTime({ receivedAtMs, capturedAt: header.captured_at, timeErrMs: header.time_err_ms }).atMs);
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
        const text = typeof msg.text === "string" ? headWithin(msg.text.trim(), MAX_SAY) : "";
        if (!text) return say("말이 비어 있어요. 다시 말해 주세요.");
        const answer = await opts.onAnswer?.(text, heardAt(msg.at));
        if (answer?.handled) return say(answer.reply ?? "", answer.pending);
        if (!opts.onSay) return say("에이전트가 연결되지 않았어요.");
        const r = await opts.onSay(text);
        return say(r.reply, r.pending);
      }
      const token = typeof msg.token === "string" ? msg.token : "";
      if (msg.type === "confirm") {
        const choice = msg.choice === undefined ? "approve" : ANSWERS.find((a) => a === msg.choice);
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

  /** 처리 중인 승인 답(confirm·cancel). 닫을 때 그 답을 보낸 뒤 연결을 끊는다. */
  const answering = new Set<Promise<void>>();
  let connections = 0;
  let current: PlannedCommand | null = null;
  /** 연결마다 판본: wait hello 기다리는 중, ok 판본이 맞음, old 옛 탭(hello 없음·판본 다름). */
  const phase = new WeakMap<WebSocket, "wait" | "ok" | "old">();
  const ok = (ws: WebSocket) => phase.get(ws) === "ok";
  const ready = () => [...wss.clients].some((ws) => ok(ws) && ws.readyState === WebSocket.OPEN);
  let lastReady = false;
  const notifyReady = () => {
    const current = ready();
    if (lastReady === current) return;
    lastReady = current;
    opts.onReady?.(current);
  };
  /** 실제 폰에 보낼 명령: 대상 트윈 자리 → AR 자리(맞추기 전이면 대상 null). */
  const wire = (c: PlannedCommand, speak = c.speak): PhoneCommand => {
    const ar = c.target ? session.toAr(c.target.position) : null;
    return { ...c, target: c.target && ar ? { id: c.target.id, label: c.target.label, ar } : null, speak };
  };
  /** 맞춤이 바뀌었으면(moved: 맞춘 변환이 움직였어도) 지금 명령을 새 대상 자리로 다시 보낸다. */
  const resendIf = (wasAligned: boolean, moved = false) => {
    if (!current || (session.aligned === wasAligned && !(moved && session.aligned))) return;
    const msg = wire(current, false);
    for (const ws of wss.clients) if (ok(ws)) reply(ws, msg);
  };
  /** 위치 맞춤 상태가 바뀌면 붙은 폰 모두에 상태를 보낸다. */
  const broadcastStatus = () => {
    for (const ws of wss.clients) reply(ws, status());
  };
  wss.on("connection", (ws, req) => {
    const source = ++connections;
    // 이 서버가 내주는 영상으로 연 연결(영상 시험·영상 폰 페이지)만 영상 모드다
    // 영상 모드: 카메라 입력
    const video = videoSession(req.url, videoDir);
    log(`[phone] 폰 연결(지금 ${wss.clients.size}대)`);
    ws.on("close", () => {
      notifyReady();
      opts.feed?.video.endSource(source);
      log(`[phone] 폰 끊김(지금 ${wss.clients.size}대)`);
    });
    reply(ws, status());
    phase.set(ws, "wait");
    // 옛 탭: 새로 고침 안내만 보낸다
    const old = () => {
      phase.set(ws, "old");
      notifyReady();
      reply(ws, REFRESH_COMMAND);
    };
    const helloTimer = setTimeout(() => { if (phase.get(ws) === "wait") old(); }, HELLO_MS);
    helloTimer.unref?.();
    // 판본이 맞는 hello: 정상으로 바꾸고 지금 명령 전체(대상은 지금 맞춘 AR 자리, 읽지 않음)와 지금 승인 대기 목록을 보낸다
    const hello = (protocol: unknown) => {
      const was = phase.get(ws);
      if (protocol !== PHONE_PROTOCOL) {
        if (was !== "old") old();
        return;
      }
      if (was === "ok") return;
      phase.set(ws, "ok");
      notifyReady();
      if (was === "old") reply(ws, { type: "command_clear", id: REFRESH_COMMAND.id });
      reply(ws, current ? wire(current, false) : { type: "command_clear" });
      // 지금 승인 대기 목록도 보낸다(새로 연 폰도 이미 대기 중인 질문을 보고 답한다)
      if (opts.pending) reply(ws, { type: "reply", text: "", pending: opts.pending() } satisfies PhoneTalkReply);
    };
    ws.on("close", () => clearTimeout(helloTimer));
    ws.on("message", (data, isBinary) => {
      if (isBinary) {
        onPacket(ws, source, video, Array.isArray(data) ? Buffer.concat(data) : Buffer.from(data as Buffer));
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
      if (type === "hello") {
        hello((raw as { protocol?: unknown }).protocol);
        return;
      }
      // 판본이 맞는 연결의 답만 받는다(옛 탭의 답은 다른 명령에 갈 수 있다)
      if (type === "say" || type === "confirm" || type === "cancel") {
        if (!ok(ws)) return;
        const t = talk(ws, raw as Record<string, unknown>);
        // 승인 답(confirm·cancel)은 닫을 때 그 답을 보낸 뒤 연결을 닫는다
        if (type !== "say") {
          answering.add(t);
          void t.finally(() => answering.delete(t));
        }
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
        if (ok(ws) && typeof id === "string" && typeof step === "string" && typeof choice === "string" && id.length <= 64 && step.length <= 80 && choice.length <= 32) {
          opts.onChoice?.(id, step, choice);
        }
        return;
      }
      const wasAligned = session.aligned;
      const out = session.handle(raw);
      if (out.changed) broadcastStatus();
      if (out.reply && !(out.changed && !out.reply.error)) reply(ws, withEngine(out.reply));
      if (out.eye) opts.onEye(out.eye);
      resendIf(wasAligned, out.changed === true);
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
    setStart(start) {
      session.setStart(start);
      broadcastStatus();
    },
    setLandmarks: (list) => session.setLandmarks(list),
    landmarks(header, boxes) {
      const wasAligned = session.aligned;
      if (!session.landmarks(header, boxes)) return;
      broadcastStatus();
      resendIf(wasAligned, true);
    },
    syncState: () => session.syncState(),
    ready,
    reply(text, grade) {
      for (const ws of wss.clients) if (ok(ws)) reply(ws, { type: "reply", text, ...(grade ? { grade } : {}) } satisfies PhoneTalkReply);
    },
    command(msg) {
      if (msg.type === "command") current = msg;
      else if (msg.id === undefined || msg.id === current?.id) current = null;
      const out = msg.type === "command" ? wire(msg) : msg;
      for (const ws of wss.clients) if (ok(ws)) reply(ws, out);
    },
    async listen(port, host) {
      const addr = await listenRetry(server, port, host, { log });
      return { port: addr.port, urls: lanUrls(addr.port, host) };
    },
    async close() {
      // 처리 중인 승인 답(confirm·cancel)의 답을 보내고, 보낸 글이 소켓에 다 넘어갈 때까지(최대 1초) 기다린 뒤 연결을 끊는다.
      // 집을 닫을 때 에이전트가 취소로 끝낸 외부 연락의 답이 실제 폰에 닿게 한다(src/server/home/index.ts는 에이전트를 먼저 닫는다)
      await Promise.allSettled([...answering]);
      for (const end = Date.now() + 1000; [...wss.clients].some((ws) => ws.bufferedAmount > 0) && Date.now() < end; ) await new Promise((r) => setTimeout(r, 10));
      for (const ws of wss.clients) ws.terminate();
      await new Promise<void>((r) => wss.close(() => r()));
      server.closeAllConnections();
      await new Promise<void>((r) => server.close(() => r()));
    },
  };
}
