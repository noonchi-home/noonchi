// 허브 고르기·시작(startHub): 기본은 HUB=matter, network 커미셔닝이 실패하면 local로, 그것도 안 되면 MemoryHub로.
// 실제 matter.js는 tests/e2e.test.ts에서 쓴다. 여기서는 가짜 matter 모듈로 분기만 본다.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { importsOf, parseCode, resolveSpec } from "../scripts/domain-ast.js";
import { MemoryHub } from "../src/devices/hub/memory.js";
import type { DeviceSpec } from "../src/contract/devices.js";
import { startHub } from "../src/server/hubFactory.js";
import { ROOMS, homeDevices } from "./helpers/home.js";

const data = { devices: homeDevices(), initial: {}, rooms: ROOMS };

/** start()가 transport에 따라 실패할 수 있는 가짜 Matter 허브. */
class FakeMatterHub extends MemoryHub {
  started = false;
  stopped = false;
  constructor(devices: DeviceSpec[], readonly opts: Record<string, unknown>, private readonly failOn: string[]) {
    super(devices);
  }
  override async start(): Promise<void> {
    if (this.failOn.includes(String(this.opts.transport))) {
      const e = new Error("브리지 커미셔닝에 실패했습니다: 시간 초과");
      e.name = "MatterNetworkError";
      throw e;
    }
    this.started = true;
  }
  override async stop(): Promise<void> {
    this.stopped = true;
  }
}

function fakeMatter(failOn: string[] = []) {
  const made: FakeMatterHub[] = [];
  const importer = async () => ({
    createMatterHub: (twin: { devices: DeviceSpec[] }, opts: Record<string, unknown>) => {
      const hub = new FakeMatterHub(twin.devices, opts, failOn);
      made.push(hub);
      return hub;
    },
  });
  return { made, importer };
}

describe("startHub", () => {
  it("HUB가 없으면 matter, MATTER_TRANSPORT가 없으면 network로 시작한다", async () => {
    const { made, importer } = fakeMatter();
    const r = await startHub(data, { env: { MATTER_STORAGE_DIR: "store" }, importer, log: () => {} });
    expect(r.kind).toBe("matter");
    expect(r.transport).toBe("network");
    expect(r.warnings).toEqual([]);
    expect(made).toHaveLength(1);
    expect(made[0]!.started).toBe(true);
    expect(made[0]!.opts).toMatchObject({ transport: "network", storageDir: "store", commissionTimeoutMs: 30_000 });
  });

  it("MATTER_COMMISSION_TIMEOUT_MS로 커미셔닝 제한 시간을 바꾼다", async () => {
    const { made, importer } = fakeMatter();
    await startHub(data, { env: { MATTER_COMMISSION_TIMEOUT_MS: "5000" }, importer, log: () => {} });
    expect(made[0]!.opts.commissionTimeoutMs).toBe(5000);
  });

  it("network 시작이 실패하면 그 허브를 정리하고 local 전송으로 다시 시작한다(로그 한 줄)", async () => {
    const { made, importer } = fakeMatter(["network"]);
    const lines: string[] = [];
    const r = await startHub(data, { env: {}, importer, log: (m) => lines.push(m) });
    expect(made.map((h) => h.opts.transport)).toEqual(["network", "local"]);
    expect(made[0]!.stopped).toBe(true);
    expect(made[1]!.started).toBe(true);
    expect(r.hub).toBe(made[1]);
    expect(r).toMatchObject({ kind: "matter", transport: "local" });
    expect(r.warnings).toHaveLength(1);
    expect(r.warnings[0]).toMatch(/network.*local/);
    expect(r.warnings[0]).toContain("시간 초과");
    expect(lines.join("\n")).toMatch(/local 전송으로/);
  });

  it("local까지 실패하면 MemoryHub로 대신한다", async () => {
    const { importer } = fakeMatter(["network", "local"]);
    const r = await startHub(data, { env: {}, importer, log: () => {} });
    expect(r.hub).toBeInstanceOf(MemoryHub);
    expect(r.hub).not.toBeInstanceOf(FakeMatterHub);
    expect(r.kind).toBe("memory");
    expect(r.transport).toBeUndefined();
    expect(r.warnings.at(-1)).toMatch(/MemoryHub/);
  });

  it("MATTER_TRANSPORT=local이면 local로 한 번만 시도한다", async () => {
    const { made, importer } = fakeMatter();
    const r = await startHub(data, { env: { MATTER_TRANSPORT: "local" }, importer, log: () => {} });
    expect(made.map((h) => h.opts.transport)).toEqual(["local"]);
    expect(r.transport).toBe("local");
  });

  it("서버를 띄우는 정적 import 길에 matter.js가 없다: Matter 허브는 고를 때만 devices 입구의 지연 로더(loadMatterHub)로 읽는다", () => {
    const root = join(import.meta.dirname, "..");
    const seen = new Set<string>(["src/server/main.ts"]);
    const queue = ["src/server/main.ts"];
    const exists = (p: string) => existsSync(join(root, p));
    while (queue.length) {
      const f = queue.shift()!;
      for (const ref of importsOf(parseCode(f, readFileSync(join(root, f), "utf8")))) {
        if (ref.typeOnly || ref.kind === "dynamic" || ref.kind === "type-query") continue;
        const r = resolveSpec(f, ref.spec, exists);
        const key = "path" in r ? r.path : "external" in r ? `pkg:${r.external}` : "";
        if (!key || seen.has(key)) continue;
        seen.add(key);
        if ("path" in r) queue.push(r.path);
      }
    }
    expect([...seen].filter((k) => k.startsWith("pkg:@matter/") || (k.startsWith("src/devices/matter/") && k !== "src/devices/matter/load.ts"))).toEqual([]);
    expect(seen.has("src/server/hubFactory.ts")).toBe(true);
  });

  it("HUB=memory면 matter 모듈을 부르지 않는다", async () => {
    let called = false;
    const r = await startHub(data, { env: { HUB: "memory" }, importer: async () => { called = true; return {}; }, log: () => {} });
    expect(called).toBe(false);
    expect(r.hub).toBeInstanceOf(MemoryHub);
    expect(r.kind).toBe("memory");
  });

  it("추가 Matter 옵션(matter)을 넘긴다", async () => {
    const { made, importer } = fakeMatter();
    await startHub(data, { env: {}, importer, log: () => {}, matter: { port: 6123 } });
    expect(made[0]!.opts.port).toBe(6123);
  });
});
