// TV 중계 연결: 짝지은 트윈 TV를 중계(지훈 님 tvrelay)로 읽어 안쪽 허브(트윈)에 비추고, 켜기·끄기를 중계로 보낸다.
// 원본: noonchi-home/experiment jihoon/2026-11-24_lg-tv-infrared-relay(code/noonchi-relay/feat-tv-relay.diff)의 RelayLink.
// ThinQ 연결(src/devices/thinq/link.ts)과 같은 모양이라 신호 출처 허브(src/devices/hub/signals.ts)가 relay 출처로 같은 방식으로 쓴다.
// 명령은 중계가 적외선을 쏘고 TV 와이파이 응답으로 확인한 결과(done·unverified·failed·not_sent)를 그대로 돌려주고, 다시 읽어 트윈에 비춘다.
//   중계에 닿지 않으면 보냈는지 모르므로 실패(failed)로 돌려준다. 기기마다 한 번에 한 명령만 보낸다.
// 읽기: 처음 한 번, 그 뒤 pollMs마다. 사람이 리모컨으로 켠 것(시나리오 6단계)도 이 읽기로 들어온다.
//   중계가 「모름」(TV 응답을 아직 확인 못 함)이면 읽은 값을 지워 기기를 「모름」으로 보인다.

import type { Command, CommandResult, DeviceHub, DeviceSpec, Readback } from "../../contract/devices.js";
import { RelayError, type RelayClient, type RelayState } from "./client.js";

export interface RelayLinkOptions {
  client: Pick<RelayClient, "state" | "command">;
  /** 안쪽 허브(트윈). 읽은 값을 여기에 비춘다. */
  world: DeviceHub;
  /** 트윈 기기 id → 중계 쪽 기기 이름(경로의 {기기}). */
  pairs: Record<string, string>;
  log?: (line: string) => void;
  /** 주기 읽기 간격(ms). 0이면 처음 한 번만. 기본 2초(리모컨으로 켠 것을 빨리 알도록). */
  pollMs?: number;
  now?: () => Date;
}

export const DEFAULT_RELAY_POLL_MS = 2000;

export class RelayLink {
  private readonly client: RelayLinkOptions["client"];
  private readonly world: DeviceHub;
  private readonly pairs: Map<string, string>;
  private readonly log: (line: string) => void;
  private readonly pollMs: number;
  private readonly now: () => Date;
  private readonly backs = new Map<string, Readback>();
  private readonly busy = new Set<string>();
  private readonly failing = new Set<string>();
  private listener: ((id: string) => void) | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private polling = false;
  private stopped = false;
  private seq = 0;

  constructor(opts: RelayLinkOptions) {
    this.client = opts.client;
    this.world = opts.world;
    this.pairs = new Map(Object.entries(opts.pairs));
    this.log = opts.log ?? (() => {});
    this.pollMs = opts.pollMs ?? DEFAULT_RELAY_POLL_MS;
    this.now = opts.now ?? (() => new Date());
  }

  handles(id: string): boolean {
    return this.pairs.has(id);
  }

  /** 마지막으로 읽은 출처·시각. 아직 못 읽었거나 중계가 모른다고 하면 undefined(상태 모름). */
  readback(id: string): Readback | undefined {
    const r = this.backs.get(id);
    return r ? { ...r } : undefined;
  }

  /** 읽은 값을 트윈에 비춘 뒤(처음 읽었거나 값·앎이 바뀌었을 때) 부른다. */
  onUpdate(cb: ((id: string) => void) | null): void {
    this.listener = cb;
  }

  async start(): Promise<void> {
    await this.poll();
    if (this.pollMs > 0 && !this.stopped) {
      this.timer = setInterval(() => void this.poll(), this.pollMs);
      this.timer.unref?.();
    }
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** 한 기기를 읽어 트윈에 비춘다. 못 읽으면 null. */
  async refresh(id: string): Promise<RelayState | null> {
    const target = this.pairs.get(id);
    return target ? this.read(id, target) : null;
  }

  async command(id: string, cmd: Command): Promise<CommandResult> {
    const target = this.pairs.get(id);
    const spec = this.spec(id);
    if (!target || !spec) return { ok: false, error: `중계와 짝지은 기기가 아니에요: ${id}` };
    const label = spec.label;
    if (cmd.type !== "on" && cmd.type !== "off") return { ok: false, outcome: "not_sent", error: `${label}: 중계는 켜기·끄기만 보낼 수 있어요.`, state: this.world.get(id) };
    if (this.busy.has(id)) return { ok: false, outcome: "not_sent", error: `${label}: 앞 명령을 처리하는 중이에요. 끝난 뒤 다시 보내 주세요.`, state: this.world.get(id) };
    this.busy.add(id);
    const execution = { id: `relay-${++this.seq}`, route: "relay" as const, target };
    const end = (r: Omit<CommandResult, "execution" | "state">): CommandResult => ({ ...r, state: this.world.get(id), execution });
    const name = cmd.type === "on" ? "켜기" : "끄기";
    try {
      this.log(`중계 ${execution.id}: ${label} ${name} 보냄`);
      let r;
      try {
        r = await this.client.command(cmd.type, target);
      } catch (e) {
        const why = e instanceof RelayError && e.status === 0 ? "중계 응답이 없어 보냈는지 몰라요" : "중계가 명령을 받지 않았어요";
        this.log(`중계 ${execution.id}: ${label} ${name} 실패: ${(e as Error).message}`);
        await this.read(id, target);
        return end({ ok: false, outcome: "failed", error: `${label}: ${why}. ${(e as Error).message}` });
      }
      await this.read(id, target);
      this.log(`중계 ${execution.id}: ${label} ${name} ${r.outcome}${r.error ? ` (${r.error})` : ""}`);
      if (r.outcome === "done" || r.outcome === "unverified") return end({ ok: true, outcome: r.outcome });
      return end({ ok: false, outcome: r.outcome, error: `${label}: ${r.error ?? (r.outcome === "not_sent" ? "중계가 보내지 않았어요." : "중계가 쏘지 못했어요.")}` });
    } finally {
      this.busy.delete(id);
    }
  }

  private spec(id: string): DeviceSpec | undefined {
    return this.world.list().find((d) => d.id === id);
  }

  private async poll(): Promise<void> {
    if (this.polling || this.stopped) return;
    this.polling = true;
    try {
      for (const [id, target] of this.pairs) if (!this.busy.has(id) && !this.stopped) await this.read(id, target);
    } finally {
      this.polling = false;
    }
  }

  private async read(id: string, target: string): Promise<RelayState | null> {
    const spec = this.spec(id);
    if (!spec) return null;
    let state: RelayState;
    try {
      state = await this.client.state(target);
    } catch (e) {
      if (!this.failing.has(id)) this.log(`[경고] 중계: ${spec.label} 상태를 읽지 못했어요: ${(e as Error).message}`);
      this.failing.add(id);
      return null;
    }
    if (this.failing.delete(id)) this.log(`중계: ${spec.label} 상태를 다시 읽었어요.`);
    if (this.stopped) return state;
    if (state.power === "unknown") {
      // 중계도 모른다: 읽은 값을 지워 「모름」으로 보인다
      if (this.backs.delete(id)) this.listener?.(id);
      return state;
    }
    const first = !this.backs.has(id);
    this.backs.set(id, { source: "relay", deviceId: target, at: this.now().toISOString() });
    const changed = await this.mirror(spec, state.power === "on");
    if ((first || changed) && !this.stopped) this.listener?.(id);
    return state;
  }

  /** 켜짐·꺼짐을 트윈에 비춘다. 바뀌었으면 true. */
  private async mirror(spec: DeviceSpec, on: boolean): Promise<boolean> {
    const now = this.world.get(spec.id);
    if (!now || now.matter.onOff === on) return false;
    const r = await this.world.command(spec.id, { type: on ? "on" : "off" });
    if (!r.ok) this.log(`[경고] 중계: ${spec.label} 트윈에 비추지 못했어요: ${r.error ?? (on ? "on" : "off")}`);
    return r.ok;
  }
}
