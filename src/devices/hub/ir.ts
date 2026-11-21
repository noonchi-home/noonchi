import type { CommandResult, SightEvidence } from "../../contract/devices.js";

type Power = "on" | "off";
export interface IrConfig {
  device: string;
  port: string;
  codes: Partial<Record<Power | "toggle", string>>;
  offBelow: number;
  onAbove: number;
  holdMs: number;
  confirmMs: number;
}
/** Starting values for a 10-bit light sensor. Each home can supply its measured thresholds. */
export const IR_DEFAULTS = {
  offBelow: 180,
  onAbove: 420,
  holdMs: 600,
  confirmMs: 4000,
} as const satisfies Pick<IrConfig, "offBelow" | "onAbove" | "holdMs" | "confirmMs">;

interface Connection { send(line: string): void; close(): void }
export type IrPort = (port: string, received: (line: string) => void, lost: () => void) => Connection;

interface Pending {
  target: Power;
  code: string;
  id: string | null;
  sentAt: number | null;
  timer: ReturnType<typeof setTimeout>;
  finish(result: CommandResult): void;
}
const SAMPLE_GAP_MS = 350;
const SENSOR_SILENCE_MS = 1500;
const PHOTO_MAX_MS = 5000;
const refused = (error: string): CommandResult => ({ ok: false, outcome: "not_sent", error });

/** A transmission only starts the readback window. Neither an echo nor a remote key proves power. */
export class IrTv {
  power: Power | null = null;
  online = false;
  updatedAt = Date.now();
  private confirmedAt = -Infinity;
  private evidenceAfter = -Infinity;
  private lastPhoto = -Infinity;
  private photoAfterReset: { power: Power; first: number } | null = null;
  private lastLight = -Infinity;
  private band: { power: Power; since: number } | null = null;
  private pending: Pending | null = null;
  private connection?: Connection;
  private closed = false;

  constructor(readonly config: IrConfig,
    private readonly change: (commandId: string | null) => void,
    private readonly intent: (power: Power, commandId: string | null) => void) {}

  start(open: IrPort) {
    this.connection = open(this.config.port, line => this.receive(line), () => this.stop());
    if (this.closed) this.connection.close();
  }

  stop() {
    if (this.closed) return;
    this.closed = true;
    this.online = false;
    this.invalidate("TV 연결이 끊겨 전원을 확인하지 못했어요.");
    this.connection?.close();
  }

  private invalidate(reason: string) {
    this.finish({ ok: false, outcome: "failed", error: reason });
    this.power = null;
    this.confirmedAt = -Infinity;
    this.evidenceAfter = Date.now();
    this.photoAfterReset = null;
    this.band = null;
    this.updatedAt = Date.now();
    this.change(null);
  }

  private finish(result: CommandResult) {
    const p = this.pending;
    if (!p) return;
    this.pending = null;
    clearTimeout(p.timer);
    p.finish(result);
  }

  command(target: Power, id: string | null): Promise<CommandResult> {
    if (!this.online || !this.connection) return Promise.resolve(refused("TV 송신기가 연결되지 않았어요."));
    if (this.pending) return Promise.resolve(refused("앞선 TV 명령의 결과를 확인하고 있어요."));
    const known = Date.now() - this.confirmedAt <= PHOTO_MAX_MS ? this.power : null;
    if (known === target) {
      if (!id) this.change(null);
      return Promise.resolve({ ok: true, outcome: "done" });
    }
    const lightKnown = known !== null && this.band?.power === known &&
      Date.now() - this.lastLight <= SAMPLE_GAP_MS && Date.now() - this.band.since >= this.config.holdMs;
    const code = this.config.codes[target] ?? (lightKnown ? this.config.codes.toggle : undefined);
    if (!code) return Promise.resolve(refused("지금 전원이나 전용 리모컨 코드를 확인할 수 없어요."));
    return new Promise(resolve => {
      // An unknown starting state cannot establish ownership of a transition.
      this.pending = { target, code, id: known === null ? null : id, sentAt: null, finish: resolve,
        timer: setTimeout(() => this.invalidate("보낸 뒤 TV 전원을 확인하지 못했어요."), this.config.confirmMs) };
      this.band = null;
      if (!id) this.change(null);
      this.intent(target, id);
      try {
        this.connection!.send("send " + code);
      } catch {
        this.stop();
      }
    });
  }

  private receive(line: string) {
    if (this.closed) return;
    if (line === "boot") {
      this.online = false;
      this.invalidate("TV 송신기가 다시 시작했어요.");
      return;
    }
    if (line === "ready") {
      if (!this.online) {
        this.online = true;
        this.change(null);
      }
      return;
    }
    if (!this.online) return;
    // 아두이노 시리얼 한 줄: <머리> <값> (머리는 remote·sent·light, 가전 종류가 아니다)
    const [head, value, extra] = line.split(" ");
    if (!value || extra !== undefined) return;
    if (head === "remote" && Object.values(this.config.codes).includes(value)) {
      this.invalidate("리모컨을 직접 눌러 앞선 명령 확인을 멈췄어요.");
    } else if (head === "sent" && this.pending?.code === value && this.pending.sentAt === null) {
      this.pending.sentAt = Date.now();
      this.photoAfterReset = null;
      this.band = null;
    } else if (head === "light") {
      if (value === "none") {
        this.lastLight = -Infinity;
        this.band = null;
      } else if (/^\d{1,4}$/.test(value) && Number(value) <= 1023) this.light(Number(value));
    }
  }

  private light(value: number) {
    const now = Date.now();
    const elapsed = now - this.lastLight;
    this.lastLight = now;
    const power = value >= this.config.onAbove ? "on" : value <= this.config.offBelow ? "off" : null;
    if (!power) { this.band = null; return; }
    if (this.band?.power !== power || elapsed > SAMPLE_GAP_MS) this.band = { power, since: now };
    if (now - this.band.since >= this.config.holdMs) this.confirm(power, this.band.since, now);
  }

  see(power: unknown, capturedAt: number, evidence?: SightEvidence) {
    const now = Date.now();
    if (!this.online || (power !== "on" && power !== "off") || !evidence?.explicit ||
        now - this.lastLight <= SENSOR_SILENCE_MS || capturedAt <= this.lastPhoto ||
        capturedAt > now || now - capturedAt > PHOTO_MAX_MS) return;
    this.lastPhoto = capturedAt;
    const cutoff = Math.max(this.evidenceAfter, this.pending?.sentAt ?? -Infinity);
    if ((this.pending && this.pending.sentAt === null) || capturedAt < cutoff) return;
    if (evidence.seenAt < cutoff) {
      // The world supplies the first frame of its whole stable run. Count two new
      // captures from that run when it straddles a remote press or transmission.
      const previous = this.photoAfterReset;
      this.photoAfterReset = {power, first:evidence.seenAt};
      if (!previous || previous.power !== power || previous.first !== evidence.seenAt) return;
      this.confirm(power, cutoff, capturedAt);
    } else {
      this.photoAfterReset = null;
      this.confirm(power, evidence.seenAt, capturedAt);
    }
  }

  private confirm(power: Power, from: number, at: number) {
    if (at < this.confirmedAt || from < this.evidenceAfter) return;
    const p = this.pending;
    if (p && (p.sentAt === null || from < p.sentAt)) return;
    this.confirmedAt = at;
    const matched = p?.target === power;
    const changed = this.power !== power;
    this.power = power;
    if (!matched && !changed) return;
    this.updatedAt = at;
    this.change(matched ? p.id : null);
    if (matched) this.finish({ ok: true, outcome: "done" });
  }
}
