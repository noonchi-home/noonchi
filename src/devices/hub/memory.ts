// MemoryHub: Matter 없이 메모리에서 DeviceHub를 흉내 낸다(테스트·데모·Matter 대체).
// 명령은 mapping의 Matter 요약에 적용하고, twin 상태는 그 요약에서 다시 계산한다(진실의 원천 = Matter 요약).

import type { TwinDevices } from "../devices.js";
import {
  applyCommandToMatter,
  applySensorToMatter,
  checkCommand,
  defaultTwinValue,
  matterFromTwin,
  normalizeCommand,
  twinFromMatter,
  type MatterSummary,
} from "../mapping.js";
import type { Command, CommandResult, DeviceHub, DeviceSpec, DeviceState } from "../../contract/devices.js";

export interface MemoryHubOptions {
  now?: () => Date;
}

type Listener = (s: DeviceState) => void;

export class MemoryHub implements DeviceHub {
  private readonly specs = new Map<string, DeviceSpec>();
  private readonly data = new Map<string, DeviceState>();
  private readonly listeners = new Set<Listener>();
  private readonly now: () => Date;

  constructor(devices: DeviceSpec[], initial: Record<string, Record<string, unknown>> = {}, opts: MemoryHubOptions = {}) {
    this.now = opts.now ?? (() => new Date());
    for (const spec of devices) {
      this.specs.set(spec.id, structuredClone(spec));
      const twin: Record<string, unknown> = {};
      for (const [attr, values] of Object.entries(spec.twinAttrs)) {
        twin[attr] = initial[spec.id]?.[attr] ?? defaultTwinValue(attr, values);
      }
      const matter = matterFromTwin(spec, twin);
      this.data.set(spec.id, this.make(spec.id, { ...twin, ...twinFromMatter(spec, matter) }, matter));
    }
  }

  static fromTwin(twin: Pick<TwinDevices, "devices" | "initial">, opts?: MemoryHubOptions): MemoryHub {
    return new MemoryHub(twin.devices, twin.initial, opts);
  }

  async start(): Promise<void> {}
  async stop(): Promise<void> {}

  list(): DeviceSpec[] {
    return [...this.specs.values()].map((s) => structuredClone(s));
  }

  get(id: string): DeviceState | undefined {
    const s = this.data.get(id);
    return s ? structuredClone(s) : undefined;
  }

  states(): DeviceState[] {
    return [...this.data.values()].map((s) => structuredClone(s));
  }

  async command(id: string, cmd: Command): Promise<CommandResult> {
    const spec = this.specs.get(id);
    const state = this.data.get(id);
    if (!spec || !state) return { ok: false, error: `기기를 찾을 수 없습니다: ${id}` };
    const c = normalizeCommand(spec, cmd);
    const error = checkCommand(spec, c, state);
    if (error) return { ok: false, error, state: structuredClone(state) };
    const matter = applyCommandToMatter(spec, state.matter, c);
    return this.commit(id, { ...state.twin, ...twinFromMatter(spec, matter) }, matter);
  }

  async setSensor(id: string, attr: string, value: unknown): Promise<CommandResult> {
    const spec = this.specs.get(id);
    const state = this.data.get(id);
    if (!spec || !state) return { ok: false, error: `기기를 찾을 수 없습니다: ${id}` };
    if (!spec.sensors.includes(attr)) {
      const list = spec.sensors.length > 0 ? spec.sensors.join(", ") : "없음";
      return { ok: false, error: `${spec.label}: '${attr}'은(는) 센서 값이 아닙니다(센서: ${list}).`, state: structuredClone(state) };
    }
    const allowed = spec.twinAttrs[attr] ?? [];
    if (allowed.length > 0 && !allowed.includes(value)) {
      return { ok: false, error: `${spec.label}: ${attr} 값은 ${allowed.map(String).join("/")} 중 하나여야 합니다(받은 값: ${JSON.stringify(value)}).`, state: structuredClone(state) };
    }
    const matter = applySensorToMatter(spec, state.matter, attr, value);
    return this.commit(id, { ...state.twin, [attr]: value, ...twinFromMatter(spec, matter) }, matter);
  }

  subscribe(cb: Listener): () => void {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  }

  private make(id: string, twin: Record<string, unknown>, matter: MatterSummary): DeviceState {
    return { id, online: true, twin, matter, updatedAt: this.now().toISOString() };
  }

  private commit(id: string, twin: Record<string, unknown>, matter: MatterSummary): CommandResult {
    const state = this.make(id, twin, matter);
    this.data.set(id, state);
    for (const cb of [...this.listeners]) {
      try {
        cb(structuredClone(state));
      } catch {
        // 구독자 오류는 허브 동작에 영향을 주지 않는다
      }
    }
    return { ok: true, state: structuredClone(state) };
  }
}
