// 통로 계약(MemoryBus·RedisBus가 같은 시험을 통과한다): 준비·시작 두 단계, QoS 셋, SENSOR 상한·놓친 수,
// 처리 뒤 ack·차례를 지키며 다시 주기·dead(dead의 실패는 다시 보내지 않음), 끊긴 뒤 다시 받기, publish 안에서 동기로 부르지 않음.
import { describe, expect, it } from "vitest";
import { RETRY_MS, type Bus, type Envelope, type Outcome, type TopicName } from "../../src/bus/index.js";

const EPOCH = { boot: "b1", home: "h#1" };
/** SENSOR 시험 몸: 미니맵 물체 모양(빈 모양). */
const seen = (observed_ms: number) => ({ observed_ms, frame_id: `e${observed_ms}`, frame: { width: 4, height: 3 }, shapes: [] });
const env = <N extends TopicName>(topic: N, body: Record<string, unknown>, seq: number, key = "_", node = "world"): Envelope<N> =>
  ({ topic, key, header: { stamp: 1000 + seq, node, inst: "i1", seq, ...EPOCH }, body } as never);
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));
const until = async (f: () => boolean | Promise<boolean>, ms = 3000) => {
  const t0 = Date.now();
  while (!(await f())) {
    if (Date.now() - t0 > ms) throw new Error("기다림 초과");
    await pause(10);
  }
};

export function busContract(name: string, make: () => Promise<Bus>, opts: { length: (b: Bus, topic: string) => Promise<number> }) {
  describe(`${name} 통로 계약`, () => {
    it("처음 값만 복구하는 구독은 준비 뒤 바뀐 명령을 앞질러 주지 않는다", async () => {
      const bus = await make();
      const received: number[] = [];
      try {
        await bus.publish(env("/device/state", { id: "a", on: 1 }, 1, "a", "devices"));
        const sub = await bus.subscribe("/device/state", "phone", async (e) => {
          received.push(e.header.seq);
          return "ack";
        }, { mode: "snapshot" });
        await bus.publish(env("/device/state", { id: "a", on: 0 }, 2, "a", "devices"));
        sub.start();
        await until(() => received.length > 0);
        await sub.stop();
        expect(received).toEqual([1]);
      } finally { await bus.close(); }
    });
    it("준비만 한 구독은 배달하지 않고, 시작한 뒤에 준비 이후 것부터 준다(RELIABLE)", async () => {
      const bus = await make();
      const got: number[] = [];
      const sub = await bus.subscribe("/world/changes", "brain", async (m) => { got.push(m.body.rev as number); return "ack"; });
      await bus.publish(env("/world/changes", { rev: 1, changes: [] }, 1));
      await pause(100);
      expect(got).toEqual([]);
      sub.start();
      await until(() => got.includes(1));
      await bus.close();
    });

    it("SENSOR latest: 늦게 붙으면 옛것을 받지 않고, 밀린 것 가운데 가장 새 것을 받는다", async () => {
      const bus = await make();
      for (let i = 1; i <= 50; i++) await bus.publish(env("/phone/pose", { observed_ms: i }, i, "_", "phone"));
      const got: number[] = [];
      const sub = await bus.subscribe("/phone/pose", "world", async (m) => { got.push(m.body.observed_ms as number); await pause(30); return "ack"; });
      sub.start();
      for (let i = 51; i <= 60; i++) await bus.publish(env("/phone/pose", { observed_ms: i }, i, "_", "phone"));
      await until(() => got.includes(60));
      expect(got.every((x) => x > 50)).toBe(true);
      expect(got.length).toBeLessThan(10);
      await bus.close();
    });

    it("SENSOR all(기록 커서): 준비 이후 것을 차례로 다 주고, 놓친 수는 0이다", async () => {
      const bus = await make();
      const got: number[] = [];
      const sub = await bus.subscribe("/perception/detections", "recorder", async (m) => { got.push(m.header.seq); return "ack"; }, { mode: "all" });
      for (let i = 1; i <= 20; i++) await bus.publish(env("/perception/detections", seen(i), i, "_", "perception"));
      sub.start();
      await until(() => got.length === 20);
      expect(got).toEqual(Array.from({ length: 20 }, (_, k) => k + 1));
      expect(sub.lost()).toBe(0);
      await bus.close();
    });

    it("SENSOR all: 상한(depth 600)을 넘으면 앞을 잃고 그 수를 센다. 준비 때 가장 새 seq가 기준이라 첫 수신 전에 잘린 것도 센다", async () => {
      const bus = await make();
      const det = (seq: number) => env("/perception/detections", seen(seq), seq, "_", "perception");
      for (let i = 1; i <= 5; i++) await bus.publish(det(i));
      const got: number[] = [];
      const sub = await bus.subscribe("/perception/detections", "recorder", async (m) => { got.push(m.header.seq); return "ack"; }, { mode: "all" });
      for (let i = 6; i <= 705; i++) await bus.publish(det(i));
      expect(await opts.length(bus, "/perception/detections")).toBe(600);
      sub.start();
      await until(() => got.at(-1) === 705, 10_000);
      expect(got).toEqual(Array.from({ length: 600 }, (_, k) => k + 106));
      expect(sub.lost()).toBe(100);
      await bus.close();
    });

    it("STATE: 늦게 붙어도 열쇠마다 최신 값을 바로 받고, 그 뒤 값도 받는다", async () => {
      const bus = await make();
      await bus.publish(env("/device/state", { id: "a", on: 1 }, 1, "a", "devices"));
      await bus.publish(env("/device/state", { id: "a", on: 2 }, 2, "a", "devices"));
      await bus.publish(env("/device/state", { id: "b", on: 1 }, 3, "b", "devices"));
      const got: string[] = [];
      const sub = await bus.subscribe("/device/state", "world", async (m) => { got.push(`${m.key}${m.body.on}`); return "ack"; });
      sub.start();
      await until(() => got.length >= 2);
      expect(got.sort()).toEqual(["a2", "b1"]);
      await bus.publish(env("/device/state", { id: "a", on: 3 }, 4, "a", "devices"));
      await until(() => got.includes("a3"));
      await bus.close();
    });

    it("RELIABLE: 그룹마다 모두 차례대로 받고, 모두 ack하면 잘린다", async () => {
      const bus = await make();
      const a: number[] = [];
      const b: number[] = [];
      const sa = await bus.subscribe("/world/changes", "brain", async (m) => { a.push(m.body.rev as number); return "ack"; });
      const sb = await bus.subscribe("/world/changes", "act", async (m) => { await pause(5); b.push(m.body.rev as number); return "ack"; });
      sa.start();
      sb.start();
      for (let i = 1; i <= 30; i++) await bus.publish(env("/world/changes", { rev: i, changes: [] }, i));
      await until(() => a.length === 30 && b.length === 30);
      expect(a).toEqual(Array.from({ length: 30 }, (_, k) => k + 1));
      expect(b).toEqual(a);
      await until(async () => (await opts.length(bus, "/world/changes")) === 0);
      await bus.close();
    });

    it("RELIABLE: 앞 메시지가 성공하거나 dead가 되기 전에는 뒤 메시지를 주지 않는다", async () => {
      const bus = await make();
      const seen: string[] = [];
      let fails = 2;
      const s = await bus.subscribe("/world/changes", "act", async (m) => {
        const rev = m.body.rev as number;
        if (rev === 1 && fails-- > 0) { seen.push("1 실패"); return "retry"; }
        seen.push(`${rev} 성공`);
        return "ack";
      });
      s.start();
      await bus.publish(env("/world/changes", { rev: 1, changes: [] }, 1));
      await bus.publish(env("/world/changes", { rev: 2, changes: [] }, 2));
      await until(() => seen.includes("2 성공"), 5000);
      expect(seen).toEqual(["1 실패", "1 실패", "1 성공", "2 성공"]);
      await bus.close();
    });

    it("RELIABLE: 세 번 실패하면 /bus/dead에 남기고 ack한 뒤 다음으로 간다", async () => {
      const bus = await make();
      const tries: number[] = [];
      const dead: Record<string, unknown>[] = [];
      const sd = await bus.subscribe("/bus/dead", "recorder", async (m) => { dead.push(m.body); return "ack"; });
      const s = await bus.subscribe("/world/changes", "act", async (m) => { tries.push(m.body.rev as number); return m.body.rev === 1 ? "retry" : "ack"; });
      sd.start();
      s.start();
      await bus.publish(env("/world/changes", { rev: 1, changes: [] }, 1));
      await bus.publish(env("/world/changes", { rev: 2, changes: [] }, 2));
      await until(() => dead.length === 1 && tries.includes(2), 10_000);
      expect(tries).toEqual([1, 1, 1, 2]);
      expect(dead[0]).toMatchObject({ topic: "/world/changes", group: "act", deliveries: 3 });
      await bus.close();
    });

    it("/bus/dead 처리가 실패해도 dead를 다시 dead로 보내지 않는다", async () => {
      const bus = await make();
      let tries = 0;
      const sd = await bus.subscribe("/bus/dead", "recorder", async () => { tries++; return "retry"; });
      sd.start();
      await bus.publish(env("/bus/dead", { topic: "/world/changes" }, 1, "/world/changes", "act"));
      await until(() => tries === 3, 5000);
      await pause(500);
      expect(tries).toBe(3);
      expect(await opts.length(bus, "/bus/dead")).toBe(0);
      await bus.close();
    });

    it("RELIABLE: 처리를 끝내지 못하고 끊긴 메시지는 같은 그룹이 다시 붙으면 차례대로 다시 받는다(같은 기동 안)", async () => {
      const bus = await make();
      const s1 = await bus.subscribe("/world/changes", "act", () => new Promise<Outcome>(() => {}));
      s1.start();
      await bus.publish(env("/world/changes", { rev: 1, changes: [] }, 1));
      await bus.publish(env("/world/changes", { rev: 2, changes: [] }, 2));
      await pause(100);
      await s1.stop();
      const got: number[] = [];
      const s2 = await bus.subscribe("/world/changes", "act", async (m) => { got.push(m.body.rev as number); return "ack"; });
      s2.start();
      await until(() => got.length === 2, 5000);
      expect(got).toEqual([1, 2]);
      await bus.close();
    });

    it("publish는 받는 쪽 콜백을 그 호출 안에서(동기로) 부르지 않는다", async () => {
      const bus = await make();
      let inside = false;
      let sawInside = false;
      const s = await bus.subscribe("/world/changes", "act", async () => { sawInside ||= inside; return "ack"; });
      s.start();
      inside = true;
      const sent = bus.publish(env("/world/changes", { rev: 1, changes: [] }, 1));
      inside = false;
      await sent;
      await until(async () => (await opts.length(bus, "/world/changes")) === 0);
      expect(sawInside).toBe(false);
      await bus.close();
    });

    it("RELIABLE: 다시 주기를 기다리는 동안 새 메시지가 와도 RETRY_MS 전에는 다시 주지 않는다", async () => {
      const bus = await make();
      const at: number[] = [];
      const s = await bus.subscribe("/world/changes", "act", async (m) => {
        if (m.body.rev !== 1) return "ack";
        at.push(Date.now());
        return at.length === 1 ? "retry" : "ack";
      });
      s.start();
      await bus.publish(env("/world/changes", { rev: 1, changes: [] }, 1));
      await until(() => at.length === 1);
      await bus.publish(env("/world/changes", { rev: 2, changes: [] }, 2));
      await until(() => at.length === 2, 5000);
      expect(at[1]! - at[0]!).toBeGreaterThanOrEqual(RETRY_MS - 5);
      await bus.close();
    });

    it("닫은 뒤에는 발행·구독을 거절한다", async () => {
      const bus = await make();
      await bus.close();
      await expect(bus.publish(env("/world/changes", { rev: 1, changes: [] }, 1))).rejects.toThrow(/닫힌 통로/);
      await expect(bus.subscribe("/world/changes", "act", async () => "ack")).rejects.toThrow(/닫힌 통로/);
    });
  });
}
