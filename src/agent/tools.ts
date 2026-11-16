// 에이전트와 MCP가 함께 쓰는 도구(이름·한국어 설명·zod 스키마·실행).
// 도구는 ToolBackend를 통해 집을 다룬다: 서버 안에서는 localBackend(hub, policy), MCP에서는 REST를 부르는 httpBackend.

import { z } from "zod";
import type { Policy } from "./policy.js";
import type { DeviceView } from "../contract/events.js";
import type { Command, CommandResult, DeviceHub, DeviceSpec, RoomSpec } from "../contract/devices.js";
import type { DeviceKind } from "../devices/kinds.js";
import { KIND_LABELS } from "../devices/index.js";
import { doneSentence } from "./phrases.js";
import type { LayoutTools } from "./layoutTools.js";
import { findDevices } from "./search.js";
import { resolveRoom } from "../layout/index.js";
import { compact } from "../shared/korean.js";

export type { DeviceView } from "../contract/events.js";

/** GET /api/rooms 한 항목. */
export interface RoomView extends RoomSpec {
  deviceCount: number;
}

export interface ToolBackend {
  rooms(): Promise<RoomView[]>;
  devices(): Promise<DeviceView[]>;
  /** 정책(승인)을 거쳐 명령한다. */
  command(id: string, cmd: Command, confirmToken?: string): Promise<CommandResult>;
  /** 승인 토큰으로 대기 중인 명령을 실행한다. */
  confirm(token: string): Promise<CommandResult & { deviceId?: string }>;
  /** 배치 보정(서버 안 에이전트만). */
  layout?: LayoutTools;
}

export interface ToolResult {
  ok: boolean;
  error?: string;
  message?: string;
  device?: { id: string; label: string };
  command?: Command;
  state?: Record<string, unknown> | "모름"; // twin 상태(신호 없는 기기는 "모름")
  matter?: Record<string, unknown>;  // Matter 속성 요약
  needsConfirmation?: { token: string; reason: string };
  /** LLM에게 보여 줄 때 needsConfirmation 대신(토큰 없음). */
  pendingApproval?: { reason: string };
  /** ThinQ가 받았지만 다시 읽은 값이 달라 적용을 확인하지 못했다(완료라고 말하지 않는다). */
  unverified?: true;
  data?: unknown;
}

export interface ToolDef {
  name: string;
  title: string;
  description: string;
  schema: z.ZodObject<z.ZodRawShape>;
  readOnly?: boolean;
  /** MCP에만 노출(서버 안 LLM이 스스로 승인하지 못하게). */
  mcpOnly?: boolean;
  /** 서버 안 에이전트에만 노출(MCP 목록에 내지 않는다). */
  agentOnly?: boolean;
  /** 기기 명령 도구면 인자 → 가전 명령(승인 판정·폰이 필요한 계획 판정이 쓴다). */
  command?: (args: Record<string, unknown>) => Command;
  run(backend: ToolBackend, args: Record<string, unknown>): Promise<ToolResult>;
}

// ── 공용 보기 ────────────────────────────────────────────

export function roomViews(devices: Pick<DeviceSpec, "room" | "roomLabel">[], rooms?: RoomSpec[]): RoomView[] {
  const count = new Map<string, number>();
  for (const d of devices) count.set(d.room, (count.get(d.room) ?? 0) + 1);
  const out: RoomView[] = (rooms ?? []).map((r) => ({ id: r.id, label: r.label, deviceCount: count.get(r.id) ?? 0 }));
  for (const d of devices) {
    if (!out.some((r) => r.id === d.room)) out.push({ id: d.room, label: d.roomLabel, deviceCount: count.get(d.room) ?? 0 });
  }
  return out;
}

export function deviceViews(hub: DeviceHub): DeviceView[] {
  const out: DeviceView[] = [];
  for (const spec of hub.list()) {
    const state = hub.get(spec.id);
    if (state) out.push({ ...spec, state });
  }
  return out;
}

export function localBackend(hub: DeviceHub, policy: Policy, rooms?: RoomSpec[], layout?: LayoutTools): ToolBackend {
  return {
    layout,
    rooms: async () => roomViews(hub.list(), rooms),
    devices: async () => deviceViews(hub),
    command: (id, cmd, token) => policy.guard(hub, id, cmd, token),
    confirm: async (token) => {
      const p = policy.pending().find((x) => x.token === token);
      const r = await policy.confirm(hub, token);
      return { ...r, deviceId: p?.deviceId };
    },
  };
}

/** 도구 결과에 넣는 기기 요약. */
function brief(d: DeviceView) {
  return {
    id: d.id, label: d.label, room: d.room, roomLabel: d.roomLabel, kind: d.kind, kindLabel: KIND_LABELS[d.kind],
    capabilities: d.capabilities, sensors: d.sensors,
    // 신호 없는 기기는 상태를 모른다(사진·질문으로만 확인)
    ...(d.state.signal === "none" ? { signal: "none" as const, state: "모름" } : { online: d.state.online, state: d.state.twin }),
  };
}

async function resolveDevice(backend: ToolBackend, idOrLabel: string): Promise<DeviceView | undefined> {
  const devices = await backend.devices();
  return devices.find((d) => d.id === idOrLabel)
    ?? devices.find((d) => d.label === idOrLabel)
    ?? devices.find((d) => compact(d.label) === compact(idOrLabel));
}

/** ThinQ가 받았지만 다시 읽은 값이 다를 때의 답. */
export const unverifiedSentence = (label: string) => `${label}에 명령을 보냈어요. 실제로 바뀌었는지는 확인하지 못했어요.`;

const notFound = (id: string): ToolResult => ({ ok: false, error: `기기를 찾을 수 없습니다: ${id} (find_devices나 list_devices로 id를 확인하세요)` });

// ── 스키마 ───────────────────────────────────────────────

const KINDS = Object.keys(KIND_LABELS) as [DeviceKind, ...DeviceKind[]];
const deviceId = z.string().min(1).describe("기기 id(find_devices·list_devices 결과의 id). 정확한 한국어 이름도 됩니다.");
const percent = (what: string) => z.number().min(0).max(100).describe(`${what} 0~100(%)`);

function commandTool(
  name: string,
  title: string,
  description: string,
  extra: z.ZodRawShape,
  toCommand: (a: Record<string, unknown>) => Command,
): ToolDef {
  return {
    name, title, description, command: toCommand,
    schema: z.object({ device_id: deviceId, ...extra }),
    async run(backend, args) {
      const id = String(args.device_id);
      const d = await resolveDevice(backend, id);
      if (!d) return notFound(id);
      const cmd = toCommand(args);
      const r = await backend.command(d.id, cmd);
      const device = { id: d.id, label: d.label };
      if (r.ok && r.state?.signal === "none") {
        return { ok: true, device, command: cmd, state: "모름", message: `${d.label}에 명령을 보냈어요. 신호가 없어 결과는 확인하지 못했어요.` };
      }
      if (r.ok && r.outcome === "unverified") {
        return { ok: true, device, command: cmd, state: r.state?.twin, matter: r.state?.matter, unverified: true, message: unverifiedSentence(d.label) };
      }
      if (r.ok) {
        return { ok: true, device, command: cmd, state: r.state?.twin, matter: r.state?.matter, message: doneSentence([d.label], d.kind, cmd) };
      }
      if (r.needsConfirmation) {
        return { ok: false, device, command: cmd, needsConfirmation: r.needsConfirmation, message: `${r.needsConfirmation.reason} 사용자가 승인하면 실행됩니다.` };
      }
      return { ok: false, device, command: cmd, error: r.error ?? "명령에 실패했습니다.", state: r.state?.twin };
    },
  };
}

/** 넘기기: 가전 요청이 아닌 말에 말 요청 에이전트가 답하지 않게 하는 도구. */
export const LEAVE_IT = "leave_it";

export const TOOLS: ToolDef[] = [
  {
    name: "list_rooms", title: "방 목록", readOnly: true,
    description: "집의 방 목록(id, 한국어 이름, 기기 수)을 돌려줍니다.",
    schema: z.object({}),
    async run(backend) {
      return { ok: true, data: await backend.rooms() };
    },
  },
  {
    name: "list_devices", title: "기기 목록", readOnly: true,
    description: "기기 목록과 현재 상태를 돌려줍니다. room(방 id 또는 한국어 이름)과 kind(기기 종류)로 거를 수 있습니다.",
    schema: z.object({
      room: z.string().optional().describe("방 id 또는 한국어 이름(예: living_room, 거실)"),
      kind: z.enum(KINDS).optional().describe("기기 종류(light, tv, aircon, covering, lock …)"),
    }),
    async run(backend, args) {
      let devices = await backend.devices();
      if (typeof args.room === "string" && args.room.trim()) {
        const rooms = await backend.rooms();
        const room = resolveRoom(args.room, rooms);
        if (!room) return { ok: false, error: `방을 찾을 수 없습니다: ${args.room} (가능한 방: ${rooms.map((r) => r.label).join(", ")})` };
        devices = devices.filter((d) => d.room === room.id);
      }
      if (typeof args.kind === "string") devices = devices.filter((d) => d.kind === args.kind);
      return { ok: true, data: devices.map(brief) };
    },
  },
  {
    name: "find_devices", title: "기기 찾기", readOnly: true,
    description: "한국어 이름이나 방 이름으로 기기를 찾습니다(부분 일치, 종류 동의어 포함). 예: '거실 불', '안방 에어컨', '현관문', 'TV'.",
    schema: z.object({ query: z.string().min(1).describe("찾을 말(예: 거실 불)") }),
    async run(backend, args) {
      const query = String(args.query);
      const [devices, rooms] = await Promise.all([backend.devices(), backend.rooms()]);
      const r = findDevices(query, devices, rooms);
      const byId = new Map(devices.map((d) => [d.id, d]));
      const found = r.devices.map((d) => brief(byId.get(d.id)!));
      return {
        ok: true,
        data: { query, rooms: rooms.filter((x) => r.rooms.includes(x.id)).map((x) => ({ id: x.id, label: x.label })), devices: found },
        message: found.length === 0 ? `'${query}'에 맞는 기기가 없습니다.` : undefined,
      };
    },
  },
  {
    name: "get_state", title: "기기 상태", readOnly: true,
    description: "기기 하나의 현재 상태(twin 상태와 Matter 속성 요약)를 돌려줍니다.",
    schema: z.object({ device_id: deviceId }),
    async run(backend, args) {
      const id = String(args.device_id);
      const d = await resolveDevice(backend, id);
      if (!d) return notFound(id);
      return { ok: true, device: { id: d.id, label: d.label }, data: { ...brief(d), matter: d.state.matter, updatedAt: d.state.updatedAt } };
    },
  },
  commandTool("turn_on", "켜기", "기기를 켭니다. 동작형 가전(세탁기·전자레인지·로봇청소기)은 시작, 수전은 물 틀기가 됩니다.", {}, () => ({ type: "on" })),
  commandTool("turn_off", "끄기", "기기를 끕니다. 동작형 가전은 정지, 수전은 물 잠그기가 됩니다.", {}, () => ({ type: "off" })),
  commandTool("set_level", "밝기·음량", "조명 밝기나 스피커 음량을 0~100%로 맞춥니다. 조명은 0이면 꺼지고 0보다 크면 켜집니다.",
    { percent: percent("밝기·음량") }, (a) => ({ type: "level", percent: Number(a.percent) })),
  commandTool("set_climate", "냉난방 설정", "에어컨·보일러의 모드, 설정 온도(°C), 바람 세기를 바꿉니다. 꺼져 있으면 켭니다. 공기청정기·팬은 바람 세기만 됩니다.",
    {
      mode: z.enum(["cool", "heat", "auto", "dry", "fan"]).optional().describe("cool 냉방, heat 난방, auto 자동, dry 제습, fan 송풍"),
      setpoint_c: z.number().optional().describe("설정 온도(°C). 에어컨 18~30, 보일러 10~30"),
      fan: z.enum(["low", "medium", "high", "auto"]).optional().describe("바람 세기"),
    },
    (a) => {
      const c: Command = { type: "climate" };
      if (a.mode !== undefined) c.mode = a.mode as NonNullable<typeof c.mode>;
      if (a.setpoint_c !== undefined) c.setpointC = Number(a.setpoint_c);
      if (a.fan !== undefined) c.fan = a.fan as NonNullable<typeof c.fan>;
      return c;
    }),
  commandTool("set_covering", "커튼·블라인드", "커튼·블라인드 열림 정도를 맞춥니다. 100 = 활짝 열림, 0 = 닫힘.",
    { open_percent: percent("열림 정도") }, (a) => ({ type: "covering", openPercent: Number(a.open_percent) })),
  commandTool("lock", "잠그기", "도어록을 잠급니다.", {}, () => ({ type: "lock" })),
  commandTool("unlock", "잠금 해제", "도어록 잠금을 해제합니다(현관문 열기). 사용자 승인이 필요합니다.", {}, () => ({ type: "unlock" })),
  commandTool("start", "시작", "세탁기·건조기·식기세척기·전자레인지·로봇청소기를 시작합니다. 전자레인지는 사용자 승인이 필요합니다.", {}, () => ({ type: "start" })),
  commandTool("stop", "정지", "동작 중인 가전을 멈춥니다(로봇청소기는 충전대로 돌아감).", {}, () => ({ type: "stop" })),
  commandTool("set_valve", "수전", "수전·샤워 물을 틀거나(open=true) 잠급니다(open=false).",
    { open: z.boolean().describe("true = 물 틀기, false = 잠그기") }, (a) => ({ type: "valve", open: Boolean(a.open) })),
  {
    name: LEAVE_IT, title: "넘기기", readOnly: true, agentOnly: true,
    description: "가전 제어·배치 요청이 아닌 말(혼잣말, 하는 법을 묻는 말, 주변 대화)이면 이 도구 하나만 부릅니다. 그런 말은 판단 모델이 듣고 돕습니다. 답 글은 쓰지 않습니다.",
    schema: z.object({}),
    async run() {
      return { ok: true, message: "넘겼습니다. 답 글을 쓰지 마세요." };
    },
  },
  {
    name: "confirm_action", title: "승인 확정", mcpOnly: true,
    description: "승인이 필요한 명령(현관문 잠금 해제, 인덕션 켜기, 전자레인지 시작)을 사용자가 분명히 승인했을 때만, 그 명령이 돌려준 token으로 실행합니다. 사용자에게 먼저 묻지 않고 부르지 마세요.",
    schema: z.object({ token: z.string().min(1).describe("명령 결과의 needsConfirmation.token") }),
    async run(backend, args) {
      const r = await backend.confirm(String(args.token));
      if (!r.ok) return { ok: false, error: r.error ?? "승인한 명령을 실행하지 못했습니다." };
      const d = r.deviceId ? await resolveDevice(backend, r.deviceId) : undefined;
      if (r.state?.signal === "none") {
        return { ok: true, state: "모름", device: d ? { id: d.id, label: d.label } : undefined, message: `${d?.label ?? "기기"}에 승인한 명령을 보냈어요. 신호가 없어 결과는 확인하지 못했어요.` };
      }
      if (r.outcome === "unverified") {
        return { ok: true, state: r.state?.twin, matter: r.state?.matter, unverified: true, device: d ? { id: d.id, label: d.label } : undefined, message: unverifiedSentence(d?.label ?? "기기") };
      }
      return {
        ok: true, state: r.state?.twin, matter: r.state?.matter,
        device: d ? { id: d.id, label: d.label } : undefined,
        message: d ? `승인한 명령을 실행했습니다: ${d.label}` : "승인한 명령을 실행했습니다.",
      };
    },
  },
];

export const AGENT_TOOLS: ToolDef[] = TOOLS.filter((t) => !t.mcpOnly);

/** 기기 도구 이름과 인자 → 가전 명령. 기기 명령 도구가 아니면 null. */
export function toolCommand(tool: string, args: Record<string, unknown>): Command | null {
  return TOOLS.find((t) => t.name === tool)?.command?.(args) ?? null;
}
export const MCP_TOOLS: ToolDef[] = TOOLS.filter((t) => !t.agentOnly);

/** LLM API용 JSON 스키마($schema 키 없음). */
export function toolJsonSchema(tool: ToolDef): Record<string, unknown> & { type: "object" } {
  const s = z.toJSONSchema(tool.schema) as Record<string, unknown>;
  delete s.$schema;
  return { ...s, type: "object", properties: (s.properties as Record<string, unknown> | undefined) ?? {} };
}

const KO_ERRORS = z.locales.ko().localeError;

/** 이름으로 도구를 찾아 인자를 검사하고 실행한다. 예외는 한국어 오류 결과로 바꾼다. */
export async function runTool(name: string, args: unknown, backend: ToolBackend, tools: ToolDef[] = TOOLS): Promise<ToolResult> {
  const tool = tools.find((t) => t.name === name);
  if (!tool) return { ok: false, error: `알 수 없는 도구입니다: ${name}` };
  const parsed = tool.schema.safeParse(args ?? {}, { error: KO_ERRORS });
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".") || "(전체)"}: ${i.message}`).join("; ");
    return { ok: false, error: `도구 인자가 올바르지 않습니다(${name}): ${issues}` };
  }
  try {
    return await tool.run(backend, parsed.data as Record<string, unknown>);
  } catch (e) {
    return { ok: false, error: `도구 실행 중 오류(${name}): ${(e as Error).message}` };
  }
}
