// ThinQ 연결(실제 모드에서만 만든다): 짝지은 트윈 기기를 ThinQ로 읽어 안쪽 허브(트윈)에 비추고, 명령을 ThinQ로 보낸다.
// 명령(정책을 거친 뒤): 지금 상태 읽기 → 목표와 같은 단계는 건너뜀 → 보냄 → 다시 읽어 같으면 다음 단계(구현명세서 THQ-02·03).
//   다시 읽은 값이 끝내 다르면 「확인 안 됨」(ok: true, outcome: unverified)으로 멈춘다. 거부면 실패, 지금 상태를 못 읽으면 보내지 않는다.
//   응답이 없으면(시간 초과·연결 끊김) 받았는지 모르므로 다시 읽어서 정한다.
// 기기마다 한 번에 한 단계만 보낸다. 앞 명령이 끝나기 전 같은 기기 명령은 거절한다.

import type { Command, CommandResult, DeviceHub, DeviceSpec, Readback } from "../../contract/devices.js";
import { mirrorPlan, readAppliance, thinqAdapterOf, thinqSteps, type Reading } from "./appliance.js";
import { ThinqError, type ThinqClient } from "./client.js";

export interface ThinqLinkOptions {
  client: Pick<ThinqClient, "state" | "control">;
  /** 안쪽 허브(트윈). 읽은 값을 여기에 비춘다. */
  world: DeviceHub;
  /** 트윈 기기 id → ThinQ 기기 id. */
  pairs: Record<string, string>;
  log?: (line: string) => void;
  /** 주기 읽기 간격(ms). 0이면 처음 한 번만. 기본 15초. */
  pollMs?: number;
  /** 명령 뒤 다시 읽기 전에 기다릴 시간들(ms). 기본 1·2·4초. */
  readbackMs?: number[];
  now?: () => Date;
}

export const DEFAULT_POLL_MS = 15_000;
export const DEFAULT_READBACK_MS = [1000, 2000, 4000];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const reason = (e: unknown) => (e as Error).message;

export class ThinqLink {
  private readonly client: ThinqLinkOptions["client"];
  private readonly world: DeviceHub;
  private readonly pairs: Map<string, string>;
  private readonly log: (line: string) => void;
  private readonly pollMs: number;
  private readonly readbackMs: number[];
  private readonly now: () => Date;
  private readonly backs = new Map<string, Readback>();
  private readonly busy = new Set<string>();
  private readonly failing = new Set<string>();
  private listener: ((id: string) => void) | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private polling = false;
  private stopped = false;
  private seq = 0;

  constructor(opts: ThinqLinkOptions) {
    this.client = opts.client;
    this.world = opts.world;
    this.pairs = new Map(Object.entries(opts.pairs));
    this.log = opts.log ?? (() => {});
    this.pollMs = opts.pollMs ?? DEFAULT_POLL_MS;
    this.readbackMs = opts.readbackMs ?? DEFAULT_READBACK_MS;
    this.now = opts.now ?? (() => new Date());
  }

  handles(id: string): boolean {
    return this.pairs.has(id);
  }

  /** 마지막으로 읽은 출처·시각. 아직 못 읽었으면 undefined(상태 모름). */
  readback(id: string): Readback | undefined {
    const r = this.backs.get(id);
    return r ? { ...r } : undefined;
  }

  /** 읽은 값을 트윈에 비춘 뒤(처음 읽었거나 값이 바뀌었을 때) 부른다. */
  onUpdate(cb: ((id: string) => void) | null): void {
    this.listener = cb;
  }

  /** 짝지은 기기를 모두 한 번 읽고, pollMs마다 다시 읽는다. */
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
  async refresh(id: string): Promise<Reading | null> {
    const target = this.pairs.get(id);
    return target ? this.read(id, target) : null;
  }

  async command(id: string, cmd: Command): Promise<CommandResult> {
    const target = this.pairs.get(id);
    const spec = this.spec(id);
    if (!target || !spec) return { ok: false, error: `ThinQ와 짝지은 기기가 아니에요: ${id}` };
    const label = spec.label;
    if (this.busy.has(id)) return { ok: false, outcome: "not_sent", error: `${label}: 앞 명령을 처리하는 중이에요. 끝난 뒤 다시 보내 주세요.`, state: this.world.get(id) };
    this.busy.add(id);
    const execution = { id: `thinq-${++this.seq}`, route: "thinq" as const, target };
    const end = (r: Omit<CommandResult, "execution" | "state">): CommandResult => ({ ...r, state: this.world.get(id), execution });
    try {
      const adapter = thinqAdapterOf(spec.kind);
      const steps = adapter ? thinqSteps(adapter, cmd) : null;
      if (!steps) return end({ ok: false, outcome: "not_sent", error: `${label}: ThinQ로 보낼 수 없는 명령이에요.` });
      let reading = await this.read(id, target);
      if (!reading) return end({ ok: false, outcome: "not_sent", error: `${label}: 지금 상태를 읽지 못해 보내지 않았어요.` });
      for (const step of steps) {
        if (step.done(reading)) continue;
        this.log(`ThinQ ${execution.id}: ${label} ${step.name} 보냄`);
        try {
          await this.client.control(target, step.body);
        } catch (e) {
          // 응답이 없으면 받았는지 모른다. 다시 읽어서 정한다
          if (!(e instanceof ThinqError && e.status === 0)) {
            this.log(`ThinQ ${execution.id}: ${label} ${step.name} 거부: ${reason(e)}`);
            return end({ ok: false, outcome: "failed", error: `${label}: ThinQ가 명령을 거부했어요. ${reason(e)}` });
          }
          this.log(`ThinQ ${execution.id}: ${label} ${step.name} 응답 없음, 다시 읽어 봅니다`);
        }
        let verified = false;
        for (const wait of this.readbackMs) {
          await sleep(wait);
          const r = await this.read(id, target);
          if (!r) continue;
          reading = r;
          if (step.done(r)) {
            verified = true;
            break;
          }
        }
        if (!verified) {
          this.log(`ThinQ ${execution.id}: ${label} ${step.name} 확인 안 됨`);
          return end({ ok: true, outcome: "unverified" });
        }
        this.log(`ThinQ ${execution.id}: ${label} ${step.name} 완료`);
      }
      return end({ ok: true, outcome: "done" });
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
      // 명령 중인 기기는 명령 쪽이 읽는다
      for (const [id, target] of this.pairs) if (!this.busy.has(id) && !this.stopped) await this.read(id, target);
    } finally {
      this.polling = false;
    }
  }

  private async read(id: string, target: string): Promise<Reading | null> {
    const spec = this.spec(id);
    if (!spec) return null;
    let raw: Record<string, unknown>;
    try {
      raw = await this.client.state(target);
    } catch (e) {
      if (!this.failing.has(id)) this.log(`[경고] ThinQ: ${spec.label} 상태를 읽지 못했어요: ${reason(e)}`);
      this.failing.add(id);
      return null;
    }
    if (this.failing.delete(id)) this.log(`ThinQ: ${spec.label} 상태를 다시 읽었어요.`);
    const adapter = thinqAdapterOf(spec.kind);
    const reading = adapter ? readAppliance(adapter, raw) : {};
    const first = !this.backs.has(id);
    this.backs.set(id, { source: "thinq", deviceId: target, at: this.now().toISOString() });
    const changed = await this.mirror(spec, reading);
    if ((first || changed) && !this.stopped) this.listener?.(id);
    return reading;
  }

  /** 읽은 값을 트윈에 비춘다. 바뀐 것이 있으면 true. */
  private async mirror(spec: DeviceSpec, reading: Reading): Promise<boolean> {
    const state = this.world.get(spec.id);
    if (!state) return false;
    const adapter = thinqAdapterOf(spec.kind);
    const plan = adapter ? mirrorPlan(adapter, reading, state) : { commands: [], sensors: [] };
    for (const c of plan.commands) {
      const r = await this.world.command(spec.id, c);
      if (!r.ok) this.log(`[경고] ThinQ: ${spec.label} 트윈에 비추지 못했어요: ${r.error ?? c.type}`);
    }
    for (const [attr, value] of plan.sensors) {
      const r = await this.world.setSensor(spec.id, attr, value);
      if (!r.ok) this.log(`[경고] ThinQ: ${spec.label} 트윈에 비추지 못했어요: ${r.error ?? attr}`);
    }
    return plan.commands.length + plan.sensors.length > 0;
  }
}
