// HTTP + WebSocket 서버(docs/plan.md "서버"). DeviceHub 하나를 받아 REST·WS·웹 화면을 제공한다.
// 정책(승인)은 Policy, 자연어는 Agent가 맡는다. 외부 라이브러리는 ws만 쓴다.

import { createHash, timingSafeEqual } from "node:crypto";
import { existsSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocket, WebSocketServer } from "ws";
import { z } from "zod";
import type { Agent } from "../agent/agent.js";
import { newSessionId } from "../agent/agent.js";
import { Policy } from "../agent/policy.js";
import type { BrainLog, HealthView, ReadyView, SeenEvent } from "../contract/events.js";
import type { HistoryKind } from "../contract/history.js";
import type { WorldView } from "../contract/world.js";
import type { OffTrack, PlanView } from "../contract/plan.js";
import type { ControlMode } from "../contract/setup.js";
import { deviceViews, roomViews } from "../agent/tools.js";
import type { Command, CommandResult, DeviceHub, RoomSpec } from "../hub/types.js";
import { HISTORY_KINDS, type HistoryDb } from "../history/db.js";
import type { ReflectResult } from "../history/reflect.js";
import { daySummary, isDay } from "../history/summary.js";
import type { LayoutEditor } from "../layout/editor.js";
import type { SyncState } from "../sync/aligner.js";
import { StartPoseError, type StartPose } from "../sync/start.js";
import type { PlanHub } from "../plan/hub.js";
import { twinChange } from "../model/mapping.js";
import { listenRetry } from "./net.js";
import { serveFile } from "./static.js";

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
  /** 서버 장면(scene.json + 도면 설비, src/model/scene.ts). GET /api/scene. 없거나 null이면 404. */
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
  /** 폰 위치 맞추기 시작 위치(src/sync/start.ts StartStore). 있으면 /api/phone/start-pose*. */
  start?: { get(): StartPose | null; save(raw: unknown): StartPose; preview(raw: unknown): StartPose; clear(): void };
  /** 폰 위치 맞춤 모듈 상태(GET /api/phone/sync). 폰 서버가 없으면 null. */
  phoneSync?: () => SyncState | null;
  /** 관찰 흐름(BRAIN=1, src/observe/pipeline.ts). 있으면 GET /api/brain에 상태를 보인다. */
  brain?: { status(): object };
  /** 지금 World State(BRAIN=1). 있으면 GET /api/world, /events 접속 때 {type:"world"}. */
  world?: () => WorldView;
  /** 마지막 판단(BRAIN=1). /events 접속 때 world 다음에 {type:"brain", replay:true}로 보낸다. */
  brainLast?: () => BrainLog[];
  /** 마지막 물체 모양(BRAIN=1). /events 접속 때 그대로 replay:true를 붙여 보낸다. */
  seenLast?: () => SeenEvent | null;
  /** 지금 대시보드 말풍선 카드 글(src/act/say.ts). /events 접속 때 {type:"say"}. 없으면 null. */
  say?: () => string | null;
  /** 지금 운영 모드(/api/health). 없으면 시험 모드. */
  mode?: () => ControlMode;
  /** 준비 상태(/api/health ready, src/server/ready.ts). 없으면 준비 안 됨. */
  ready?: () => Promise<ReadyView>;
  /** 클로이드 계획 보관(src/plan/hub.ts). 있으면 에이전트 행동을 넘기고 POST /api/plan*을 받는다. 접속 때 지금 계획을 보낸다. */
  plan?: Pick<PlanHub, "current" | "onAgent" | "put" | "setStep">;
  /** 끄기 추적 요약(실행 추적 offTrack). GET /api/plan이 계획과 같은 답에 싣는다(영상 판정이 같은 순간 값으로 끝낼지 본다). 없으면 null. */
  offTrack?: () => OffTrack | null;
  /** 기록 DB(src/history/db.ts). 있으면 GET /api/history·/api/history/day/{날짜}·/api/decisions. */
  history?: HistoryDb;
  /** 그날 반성(src/history/reflect.ts). 있으면 POST /api/reflection/run. */
  reflect?: (day: string) => Promise<ReflectResult>;
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

/** 대시보드·설정 화면 폴더: React 빌드(ui/dist). npm start·npm run dev가 먼저 빌드한다. */
export const DEFAULT_WEB_DIR = fileURLToPath(new URL("../../ui/dist/", import.meta.url));
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
  ok: false, inference_mode: "mock", vlm: { base_url: "", model: "", key: false, reachable: false },
  pam: { url: "", reachable: false, llm: null }, agent: { provider: "openai", base_url: "", model: "", key: false, reachable: false }, db: false,
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
const MAX_BODY = 1 << 20;

export class HttpError extends Error {
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

// 클로이드 계획(docs/plan-contract.md). 글은 화면에 그대로 나가므로 화면 글 규칙(60자 아래, 화살표·괄호 없음)을 여기서도 본다
const PlanCopy = z.string().max(60).refine((t) => !/→|⇒|->|=>|[()]/.test(t), { error: "화살표·괄호 없이 지금 상태나 할 일만 써 주세요" });
const XZSchema = z.tuple([z.number(), z.number()]);
const PlanSchema = z.object({
  id: z.string().min(1).max(200),
  revision: z.number().int().min(1),
  supersedes: z.string().min(1).max(200).optional(),
  origin: z.enum(["live", "mock"]).optional(),
  source: z.enum(["brain", "agent", "planner"]),
  goal: PlanCopy.min(1),
  judgment: PlanCopy,
  dryRun: z.boolean(),
  robot: z.object({ position: XZSchema.nullable(), room: z.string().nullable() }),
  path: z.array(XZSchema).max(1000),
  legs: z.array(z.object({ stepId: z.string(), end: z.number().int().min(0) })),
  steps: z.array(z.object({
    id: z.string().min(1).max(200),
    kind: z.enum(["move", "act", "ask", "device", "wait"]),
    label: PlanCopy.min(1),
    target: z.object({ objectId: z.string().optional(), deviceId: z.string().optional(), room: z.string().optional(), position: XZSchema.optional() }).optional(),
    status: z.enum(["pending", "active", "done", "failed", "skipped"]),
  })).min(1).max(50),
  status: z.enum(["planned", "running", "done", "cancelled", "failed"]),
  updatedAt: z.string().max(64),
}).superRefine((p, ctx) => {
  if (p.robot.position === null && p.path.length > 0) ctx.addIssue({ code: "custom", path: ["path"], message: "로봇 위치를 모르면 path는 []" });
  const moves = new Set(p.steps.filter((s) => s.kind === "move").map((s) => s.id));
  p.legs.forEach((l, i) => {
    if (!moves.has(l.stepId)) ctx.addIssue({ code: "custom", path: ["legs", i, "stepId"], message: "move 단계 id가 아님" });
    if (l.end >= p.path.length) ctx.addIssue({ code: "custom", path: ["legs", i, "end"], message: "path 밖 점 번호" });
  });
});
const StepStatusSchema = PlanSchema.shape.steps.element.shape.status;

function parsePlan(raw: unknown): PlanView {
  const r = PlanSchema.safeParse(raw, { error: KO_ERRORS });
  if (!r.success) {
    const issues = r.error.issues.map((i) => `${i.path.join(".") || "plan"}: ${i.message}`).join("; ");
    throw new HttpError(400, `계획 형식이 올바르지 않습니다: ${issues}`);
  }
  return r.data as PlanView;
}

/** 같은 PC에서 온 요청인가(127.0.0.1·::1). */
export const isLoopback = (address: string | undefined): boolean => !!address && /^(127\.\d+\.\d+\.\d+|::1|::ffff:127\.\d+\.\d+\.\d+)$/.test(address);

const digest = (s: string) => createHash("sha256").update(s).digest();

/** 계획을 보낼 수 있는가: 같은 PC 주소이거나, PLAN_TOKEN이 있고 Authorization: Bearer <토큰>이 맞다.
 *  compose로 띄우면 호스트·tailscale serve에서 온 요청도 컨테이너에는 Docker 브리지 주소로 보이므로 토큰을 쓴다. */
export function canSendPlan(address: string | undefined, authorization: string | undefined, token: string | undefined): boolean {
  if (isLoopback(address)) return true;
  const got = /^Bearer\s+(.+)$/i.exec(authorization?.trim() ?? "")?.[1];
  return !!token && !!got && timingSafeEqual(digest(got), digest(token));
}

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

export async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
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

/** ThinQ가 받았지만 적용을 확인하지 못한 명령은 202(받음). */
function commandStatus(r: CommandResult): number {
  if (r.ok) return r.outcome === "unverified" ? 202 : 200;
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
  const allowOrigin = opts.allowOrigin ?? isLocalOrigin;
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

  route("GET", /^\/api\/health$/, async (): Promise<HealthView> => ({
    ok: true, devices: hub.list().length, hub: opts.hubKind ?? "memory", transport: matterInfo()?.transport ?? null,
    provider: agent?.provider.name ?? null, model: agent?.provider.model ?? null, twin: !!twinDir && existsSync(twinDir),
    eye: !!opts.eye, home: opts.home ?? null, phone_urls: opts.phoneUrls?.() ?? [], brain: !!opts.brain, mode: opts.mode?.() ?? "test",
    ready: opts.ready ? await opts.ready() : NOT_READY,
  }));

  route("GET", /^\/api\/brain$/, async () => {
    if (!opts.brain) throw new HttpError(404, "관찰 흐름이 꺼져 있습니다(BRAIN=1, PHONE_PORT 필요)");
    return { ok: true, ...opts.brain.status() };
  });

  route("GET", /^\/api\/world$/, async () => {
    if (!opts.world) throw new HttpError(404, "관찰 흐름이 꺼져 있습니다(BRAIN=1, PHONE_PORT 필요)");
    return { ok: true, world: opts.world() };
  });

  // ── 기록 ──

  const requireHistory = () => {
    if (!opts.history) throw new HttpError(404, "기록 DB가 없습니다.");
    return opts.history;
  };
  const msParam = (url: URL, key: string) => {
    const raw = url.searchParams.get(key)?.trim();
    if (!raw) return undefined;
    const v = Number(raw);
    if (!Number.isFinite(v) || v < 0) throw new HttpError(400, `${key}는 0 이상의 시각(ms)이어야 합니다.`);
    return v;
  };
  const limitParam = (url: URL, fallback: number, max: number) => {
    const raw = url.searchParams.get("limit")?.trim();
    if (!raw) return fallback;
    const v = Number(raw);
    if (!Number.isInteger(v) || v < 1 || v > max) throw new HttpError(400, `limit는 1~${max} 사이 정수여야 합니다.`);
    return v;
  };
  // since가 없으면 최근 limit줄, 있으면 since부터 limit줄(둘 다 시각 순)
  route("GET", /^\/api\/history$/, async (_req, url) => {
    const db = requireHistory();
    const kinds = (url.searchParams.get("kinds") ?? "").split(",").map((k) => k.trim()).filter(Boolean);
    const unknown = kinds.filter((k) => !HISTORY_KINDS.includes(k as HistoryKind));
    if (unknown.length) throw new HttpError(400, `모르는 기록 종류입니다: ${unknown.join(", ")} (있는 종류: ${HISTORY_KINDS.join(", ")})`);
    const since = msParam(url, "since");
    return { ok: true, rows: db.list({ since, until: msParam(url, "until"), kinds: kinds as HistoryKind[], limit: limitParam(url, 500, 5000), latest: since === undefined }) };
  });
  route("GET", /^\/api\/history\/day\/(\d{4}-\d{2}-\d{2})$/, async (_req, _url, [day]) => {
    const db = requireHistory();
    if (!isDay(day!)) throw new HttpError(400, `없는 날짜입니다: ${day}`);
    return { ok: true, ...daySummary(db, day!) };
  });
  // 반성 바로 하기: day(기본 오늘). 그날 기록이 없거나 이미 반성 중이면 409, PAM 실패는 502
  route("POST", /^\/api\/reflection\/run$/, async (req) => {
    const db = requireHistory();
    if (!opts.reflect) throw new HttpError(404, "반성을 쓸 수 없습니다.");
    const body = await readJson(req);
    const day = body.day ?? db.dayOf(Date.now());
    if (typeof day !== "string" || !isDay(day)) throw new HttpError(400, "day는 YYYY-MM-DD 날짜여야 합니다.");
    const r = await opts.reflect(day);
    if (!r.ok) throw new HttpError(r.empty ? 409 : 502, r.error);
    return { ok: true, day, version: r.version, appliesDay: r.appliesDay };
  });
  // 그날 기억 고정 상태(읽기만, 고정하지 않는다): 그날 판단이 고정한 판본, 지금 판단이 부르면 쓸 판본(고정 판본, 없으면 그날 쓸 수 있는 가장 새 판본), 가장 새 판본
  route("GET", /^\/api\/memory\/day\/(\d{4}-\d{2}-\d{2})$/, async (_req, _url, [day]) => {
    const db = requireHistory();
    if (!isDay(day!)) throw new HttpError(400, `없는 날짜입니다: ${day}`);
    const pinned = db.pinnedMemory(day!);
    const v = pinned !== null ? db.memoryVersion(pinned) : db.memoryFor(day!);
    return { ok: true, day, pinned, uses: v ? { version: v.version, source: v.source, appliesDay: v.appliesDay, day: v.day } : null, latest: db.latestMemoryVersion() };
  });
  route("GET", /^\/api\/decisions$/, async (_req, url) => ({ ok: true, decisions: requireHistory().decisions(limitParam(url, 20, 500)) }));

  // ── 집 장면·배치 보정 ──

  route("GET", /^\/api\/scene$/, async () => {
    const scene = opts.scene?.();
    if (!scene) throw new HttpError(404, "집 장면이 없어요.");
    return { ok: true, scene };
  });

  const requireLayout = () => {
    if (!opts.layout) throw new HttpError(404, "배치 보정을 쓸 수 없습니다(집 scene.json이 없음).");
    return opts.layout;
  };
  route("GET", /^\/api\/layout$/, async () => {
    const editor = requireLayout();
    return { ok: true, ...editor.status(), items: editor.edits() };
  });
  // 설정 화면은 자기가 본 집(home)을 같이 보낸다. 다른 탭에서 집을 바꿨으면 새 집을 고치지 않는다.
  // 본문을 기다리는 사이 이 앱이 닫혔으면(집을 바꿈) 쓰지 않는다
  const sameHome = (body: Record<string, unknown>) => {
    if (closed) throw new HttpError(503, "집을 바꾸는 중이에요. 잠시 뒤 다시 해 주세요.");
    if (typeof body.home === "string" && opts.home && body.home !== opts.home.id) throw new HttpError(409, `집이 바뀌었어요(지금 ${opts.home.name}). 화면을 새로 고치세요.`);
  };
  route("POST", /^\/api\/layout\/save$/, async (req) => {
    sameHome(await readJson(req));
    return { ok: true, ...requireLayout().save() };
  });
  route("POST", /^\/api\/layout\/reset$/, async (req) => {
    sameHome(await readJson(req));
    return { ok: true, reverted: requireLayout().reset().length };
  });

  // ── 폰 위치 맞추기: 시작 위치(자리·방향)와 맞춤 상태 ──

  const requireStart = () => {
    if (!opts.start) throw new HttpError(404, "시작 위치를 쓸 수 없습니다(집 scene.json이 없음).");
    return opts.start;
  };
  const startView = (s: StartPose | null) => ({
    ok: true, start: s ? { position: s.position, yaw_deg: s.yawDeg, label: s.label, facing_label: s.facingLabel } : null,
  });
  route("GET", /^\/api\/phone\/start-pose$/, async () => startView(requireStart().get()));
  route("POST", /^\/api\/phone\/start-pose$/, async (req) => {
    const store = requireStart();
    const body = await readJson(req);
    sameHome(body);
    try {
      return startView(store.save(body));
    } catch (e) {
      if (e instanceof StartPoseError) throw new HttpError(400, e.message);
      throw e;
    }
  });
  // 저장하지 않고 검사·이름 채우기만(설정 화면이 자리·방향을 바꿀 때)
  route("POST", /^\/api\/phone\/start-pose\/preview$/, async (req) => {
    const store = requireStart();
    const body = await readJson(req);
    sameHome(body);
    try {
      return startView(store.preview(body));
    } catch (e) {
      if (e instanceof StartPoseError) throw new HttpError(400, e.message);
      throw e;
    }
  });
  route("POST", /^\/api\/phone\/start-pose\/clear$/, async (req) => {
    sameHome(await readJson(req));
    requireStart().clear();
    return startView(null);
  });
  route("GET", /^\/api\/phone\/sync$/, async () => ({ ok: true, sync: opts.phoneSync?.() ?? null }));

  // ── 클로이드 계획 ──

  route("GET", /^\/api\/plan$/, async () => ({ ok: true, plan: opts.plan?.current() ?? null, off: opts.offTrack?.() ?? null }));
  const requirePlan = (req: IncomingMessage) => {
    if (!opts.plan) throw new HttpError(404, "계획을 받을 수 없습니다(집이 아직 없음).");
    if (!canSendPlan(req.socket.remoteAddress, req.headers.authorization, opts.planToken)) throw new HttpError(403, "계획은 서버와 같은 PC에서 보내거나 PLAN_TOKEN을 붙여 보내야 합니다.");
    if (closed) throw new HttpError(503, "집을 바꾸는 중이에요. 잠시 뒤 다시 해 주세요.");
    return opts.plan;
  };
  route("POST", /^\/api\/plan$/, async (req) => {
    const plans = requirePlan(req);
    plans.put(parsePlan((await readJson(req)).plan));
    return { ok: true, plan: plans.current() };
  });
  route("POST", /^\/api\/plan\/([^/]+)\/steps\/([^/]+)$/, async (req, _url, [id, stepId]) => {
    const plans = requirePlan(req);
    const r = StepStatusSchema.safeParse((await readJson(req)).status);
    if (!r.success) throw new HttpError(400, "status는 pending·active·done·failed·skipped 중 하나여야 합니다.");
    if (!plans.setStep(id!, stepId!, r.data)) throw new HttpError(404, `지금 계획에 없는 단계입니다: ${id} ${stepId}`);
    return { ok: true, plan: plans.current() };
  });

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
    const seen = opts.seenLast?.();
    if (seen) send(ws, { ...seen, replay: true });
    send(ws, { type: "say", text: opts.say?.() ?? null });
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
