// 집마다 등록한 리모컨(<RUNTIME_DIR>/homes/<집>/remotes.json)과 신호 같음 판정.
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import type { IrSignal, RemoteRole } from "../../contract/ir.js";
import { IR_LABEL_MAX } from "../../contract/ir.js";
import { HOUSEHOLD_KINDS } from "../kinds.js";
import type { BridgePress } from "./ir-bridge.js";
import { IR_DEFAULTS, type IrConfig } from "./ir.js";

const NEC_NAME = /^NEC2?$/;
const decoded = z.strictObject({ protocol: z.string().min(1).max(20), address: z.number().int().min(0), command: z.number().int().min(0) });
const signal = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("nec"), address: z.number().int().min(0).max(0xffff), command: z.number().int().min(0).max(0xff) }),
  z.strictObject({ kind: z.literal("raw"), khz: z.number().int().min(30).max(60), ticks: z.array(z.number().int().min(1).max(255)).min(4).max(750), decoded: decoded.nullable() }),
]);
const label = z.string().trim().min(1).max(IR_LABEL_MAX);
const button = z.strictObject({
  id: z.string().regex(/^b_[0-9a-f]{8}$/), label, role: z.enum(["on", "off", "toggle"]).nullable(), signal, learned_at: z.string().min(1),
});
const remote = z.strictObject({ id: z.string().regex(/^r_[0-9a-f]{8}$/), label, device: z.string().min(1), buttons: z.array(button) })
  .refine((r) => new Set(r.buttons.map((b) => b.label)).size === r.buttons.length, "단추 이름이 겹쳐요.")
  .refine((r) => (["on", "off", "toggle"] as const).every((role) => r.buttons.filter((b) => b.role === role).length <= 1), "전원 단추 뜻이 겹쳐요.")
  .refine((r) => r.buttons.every((b, i) => r.buttons.every((c, j) => j <= i || !equalSignal(b.signal, c.signal))), "같은 신호의 단추가 있어요.");
export const remotesFile = z.strictObject({
  version: z.literal(1),
  port: z.strictObject({ name: z.string().regex(/^(COM[1-9][0-9]*|FAKE)$/), pnp: z.string().min(1).nullable() }).nullable(),
  remotes: z.array(remote),
}).refine((f) => new Set(f.remotes.map((r) => r.device)).size === f.remotes.length, "가전 하나에 리모컨은 하나예요.");

export type RemotesFile = z.infer<typeof remotesFile>;
export type RemoteEntry = RemotesFile["remotes"][number];
export type ButtonEntry = RemoteEntry["buttons"][number];
export const EMPTY_REMOTES: RemotesFile = { version: 1, port: null, remotes: [] };

const pathOf = (runtime: string, home: string) => join(runtime, "homes", home, "remotes.json");

export function loadRemotes(runtime: string, home: string): RemotesFile {
  let text: string;
  try { text = readFileSync(pathOf(runtime, home), "utf8"); }
  catch (e) { if ((e as NodeJS.ErrnoException).code === "ENOENT") return structuredClone(EMPTY_REMOTES); throw e; }
  return remotesFile.parse(JSON.parse(text));
}

export function saveRemotes(runtime: string, home: string, file: RemotesFile): void {
  const checked = remotesFile.parse(file);
  const target = pathOf(runtime, home);
  mkdirSync(join(runtime, "homes", home), { recursive: true });
  const tmp = `${target}.${randomUUID()}.tmp`;
  try {
    writeFileSync(tmp, JSON.stringify(checked, null, 2) + "\n", { flag: "wx" });
    renameSync(tmp, target);
  } finally { rmSync(tmp, { force: true }); }
}

export function sameTicks(a: readonly number[], b: readonly number[]): boolean {
  if (Math.abs(a.length - b.length) > 2) return false;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) if (Math.abs(a[i]! - b[i]!) > Math.max(3, Math.ceil(0.25 * Math.max(a[i]!, b[i]!)))) return false;
  return true;
}

const necOf = (s: IrSignal) => (s.kind === "nec" ? s : s.decoded && NEC_NAME.test(s.decoded.protocol) ? s.decoded : null);
const sameDecoded = (a: { protocol: string; address: number; command: number }, b: typeof a) =>
  a.protocol === b.protocol && a.address === b.address && a.command === b.command;

export function equalSignal(a: IrSignal, b: IrSignal): boolean {
  const na = necOf(a), nb = necOf(b);
  if (na && nb) return na.address === nb.address && na.command === nb.command;
  if (a.kind === "raw" && b.kind === "raw") return a.decoded && b.decoded ? sameDecoded(a.decoded, b.decoded) : sameTicks(a.ticks, b.ticks);
  return false;
}

export function pressMatches(signal: IrSignal, p: BridgePress): boolean {
  if (p.overflow) return false;
  if (p.decoded) {
    if (signal.kind === "nec") return NEC_NAME.test(p.decoded.protocol) && p.decoded.address === signal.address && p.decoded.command === signal.command;
    if (signal.decoded) return sameDecoded(signal.decoded, p.decoded);
  }
  return signal.kind === "raw" && !!p.ticks && sameTicks(signal.ticks, p.ticks);
}

export const codeOf = (buttonId: string) => "BTN:" + buttonId;
export const newId = (prefix: "r" | "b") => `${prefix}_${randomUUID().replace(/-/g, "").slice(0, 8)}`;

/** 트윈 TV에 달린 첫 리모컨의 전원 뜻 단추 → IrTv 설정. 확인 시간은 IR_DEFAULTS(켜기 8초·끄기 4초). */
export function tvConfigOf(file: RemotesFile, devices: readonly { id: string; kind: string }[]): IrConfig | null {
  const tv = file.remotes.find((r) => devices.some((d) => d.id === r.device && d.kind === HOUSEHOLD_KINDS.viewerPower) && r.buttons.some((b) => b.role));
  if (!tv) return null;
  const codes: IrConfig["codes"] = {};
  for (const b of tv.buttons) if (b.role) codes[b.role] = codeOf(b.id);
  return { device: tv.device, port: file.port?.name ?? "", codes, ...IR_DEFAULTS };
}

export interface RemoteBrief { device: string; remote: string; label: string; buttons: { id: string; label: string; role: RemoteRole }[] }
/** SignalHub가 쓰는 리모컨 쪽(IrSetup이 만든다). send는 포트가 연결되지 않았거나 보드가 err면 reject. */
export interface RemoteRuntime {
  list(): RemoteBrief[];
  send(device: string, button: string): Promise<void>;
  onPressed(cb: (e: { device: string; remote: string; button: string; role: RemoteRole }) => void): () => void;
}
