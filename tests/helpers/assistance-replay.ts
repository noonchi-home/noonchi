import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { inProcessModel } from "./in-process-model.js";
import { BusNode, MemoryBus, VirtualClock, type Body, type Deliver, type Envelope, type NodeName, type ReadMode, type TopicName } from "../../src/bus/index.js";
import { settle } from "../../src/record/replay.js";
import { startServer } from "../../src/server/start.js";

class TraceBus extends MemoryBus {
  readonly sent: Envelope<TopicName>[] = [];
  private delivering = 0;
  omitAssistanceRecords = false;

  override async publish<N extends TopicName>(message: Envelope<N>): Promise<void> {
    await super.publish(message);
    this.sent.push(message as Envelope<TopicName>);
  }

  override async subscribe<N extends TopicName>(topic: N, node: NodeName, deliver: Deliver<N>, options?: { mode?: ReadMode }) {
    if (this.omitAssistanceRecords && topic === "/act/assistance_outcome" && node === "recorder") {
      return { start() {}, async stop() {}, lost: () => 0 };
    }
    return super.subscribe(topic, node, async message => {
      this.delivering++;
      try { return await deliver(message); }
      finally { this.delivering--; }
    }, options);
  }

  override quiet(): boolean { return super.quiet() && this.delivering === 0; }
}

async function drive<T>(clock: VirtualClock, operation: Promise<T>): Promise<T> {
  let working = true;
  const done = operation.finally(() => { working = false; });
  void done.catch(() => {});
  for (let i = 0; working && i < 1000; i++) {
    await clock.advanceTo(clock.now() + 10);
    await new Promise<void>(resume => setTimeout(resume, 1));
  }
  return done;
}

/** Runs production household nodes over an isolated in-memory bus and a temporary database. */
export async function assistanceReplay(options: {
  start?: number;
  home?: string;
  studioDir?: string;
  runtimeDir?: string;
  reflectAt?: string;
  askFirst?: boolean;
  model?: Parameters<typeof inProcessModel>[0];
  omitAssistanceRecords?: boolean;
}) {
  const clock = new VirtualClock(options.start ?? Date.now());
  const bus = new TraceBus({ clock });
  bus.omitAssistanceRecords = options.omitAssistanceRecords ?? false;
  const model = inProcessModel(options.model);
  const runtimeDir = options.runtimeDir ?? mkdtempSync(join(tmpdir(), "adaptive-replay-"));
  let boot = "";
  const fetcher = globalThis.fetch;
  const startupDiagnostics: string[] = [];
  globalThis.fetch = model.fetch;
  const server = await drive(clock, startServer({
    env: { RUNTIME_DIR: runtimeDir, TWIN_STUDIO_DIR: options.studioDir ?? resolve("twin"), HOME_ID: options.home, HOST: "127.0.0.1", PORT: "0",
      HUB: "memory", PHONE_HOST: "127.0.0.1", PHONE_PORT: "0", BRAIN: "1", REFLECT_AT: options.reflectAt ?? "off",
      PAM_TRIGGER: "periodic", PAM_PERIOD_MS: "1000", STALE_MS: "10000",
      OPENAI_API_KEY: "replay-fixture", OPENAI_BASE_URL: model.base, VLM_BASE_URL: model.base,
      PAM_LLM_BASE_URL: model.base, VLM_API_KEY: "replay-fixture" },
    brain: { clock, detector: null }, clock, askFirst: options.askFirst,
    servedPhoneUrls: async port => ["http://127.0.0.1:" + port],
    openBus: async (_env, state) => { boot = state.boot; return bus; },
    log: line => { if (/^\[(?:world|act|brain|recorder)\]/.test(line)) startupDiagnostics.push(line); },
  }).catch(error => {
    globalThis.fetch = fetcher;
    if (startupDiagnostics.length) throw new Error(startupDiagnostics.join("\n"), { cause: error });
    throw error;
  }));
  const actors = new Map<NodeName, BusNode>();
  let answers = 0;
  // 기록 노드의 배달은 기록 작업 스레드가 커밋한 뒤에 끝나므로 장벽은 차례마다 쓰기를 기다린다
  const barrier = () => settle(bus, [...actors.values()], undefined, () => server.historyWriter.flush());
  const publish = async <T extends TopicName>(actor: NodeName, name: T, body: Body<T>) => {
    let node = actors.get(actor);
    if (!node) {
      node = new BusNode({ name: actor, bus, clock, epoch: { boot, home: server.twin.home.id + "#1" } });
      actors.set(actor, node);
      await node.prepare();
      node.start();
    }
    await node.publish(name, body);
    await barrier();
  };
  const output = <T extends TopicName>(name: T) => bus.sent.filter(e => e.topic === name) as Envelope<T>[];
  const phoneCommands = () => output("/act/phone_changes").flatMap(e => "cmd" in e.body ? [e.body.cmd] : []);
  return {
    server, runtimeDir, clock, publish, barrier,
    async answer(choice: string) {
      const c = phoneCommands().at(-1);
      if (c?.type !== "command" || !c.choices.some(a => a.id === choice)) throw new Error("No issued command accepts this answer");
      await publish("phone", "/phone/progress", {
        req: "replay-answer-" + ++answers, expires_ms: clock.now() + 2500, kind: "button", plan_id: c.id, step: c.step, choice,
      });
    },
    advance: (ms: number) => clock.advanceTo(ms, barrier),
    output, phoneCommands,
    requests: model.requests,
    network: model.network,
    async close() {
      try { await Promise.all([...actors.values()].map(n => n.stop())); await drive(clock, server.close()); }
      finally { globalThis.fetch = fetcher; }
    },
  };
}
