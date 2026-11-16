// API 경로: Matter 브리지, 방·기기 목록, 기기 명령·트윈 상태·센서(정책을 거친다).
import { z } from "zod";
import type { Command, CommandResult } from "../../contract/devices.js";
import { deviceViews, roomViews } from "../../agent/index.js";
import { twinChange } from "../../devices/index.js";
import { HttpError, KO_ERRORS, readJson, type RouteKit } from "./kit.js";

/** MatterHub에서 서버가 쓰는 부분(src/devices/matter/matterHub.ts를 직접 불러오지 않으려고 모양만 적는다). */
export interface MatterInfoView {
  transport: string;
  commissioning?: string;
  storageDir?: string;
  [key: string]: unknown;
}
export interface MatterControl {
  readonly info: MatterInfoView;
  openCommissioningWindow(timeoutSeconds?: number): Promise<unknown>;
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

function parseCommand(raw: unknown): Command {
  const value = typeof raw === "string" ? { type: raw } : raw;
  const r = CommandSchema.safeParse(value, { error: KO_ERRORS });
  if (!r.success) {
    const issues = r.error.issues.map((i) => `${i.path.join(".") || "command"}: ${i.message}`).join("; ");
    throw new HttpError(400, `명령 형식이 올바르지 않습니다: ${issues}`);
  }
  return r.data as Command;
}

/** ThinQ가 받았지만 적용을 확인하지 못한 명령은 202(받음). */
function commandStatus(r: CommandResult): number {
  if (r.ok) return r.outcome === "unverified" ? 202 : 200;
  if (r.needsConfirmation) return 409;
  return 400;
}

export function devicesRoutes({ route, hub, policy, opts, matterInfo }: RouteKit): void {
  const spec = (id: string) => hub.list().find((d) => d.id === id);
  const requireSpec = (id: string) => {
    const s = spec(id);
    if (!s) throw new HttpError(404, `기기를 찾을 수 없습니다: ${id}`);
    return s;
  };

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
}
