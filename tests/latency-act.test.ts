// 컵을 집었다는 World State 발행 직전부터 실제 폰 WebSocket의 다음 명령까지 잰다. 프레임·모델·시험의 pump 대기는 측정 밖이다.
import { readFileSync, writeFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { expect, it } from "vitest";
import { MemoryBus, type Envelope, type TopicName } from "../src/bus/index.js";
import type { WorldStateMsg } from "../src/contract/world.js";
import { cupSession } from "./helpers/cup-session.js";
import { cupPos } from "./helpers/top-look.js";
import { det } from "./helpers/detectors.js";

const fixture = new URL("./fixtures/latency/act.json", import.meta.url);
const baselineRun = process.env.LATENCY_ACT_BASELINE === "write";
const SAMPLES = baselineRun ? 3 : 1;

it("집 상태에 컵 집기가 들어오면 실제 폰에 다음 명령이 기준 시간 안에 온다", async () => {
  const samples: number[] = [];
  for (let i = 0; i < SAMPLES; i++) {
    let start = 0, end = 0;
    class TimedBus extends MemoryBus {
      override publish<N extends TopicName>(e: Envelope<N>) {
        if (!start && e.topic === "/world/state" && (e.body as WorldStateMsg).view.objects.some((o) => o.cls === "cup" && o.facts.place?.value === "in_hand")) start = performance.now();
        return super.publish(e);
      }
    }
    const session = await cupSession({ openBus: async () => new TimedBus(), phone: (m) => {
      if (!end && m.type === "command" && m.speak && m.text === "싱크대로 가 주세요") end = performance.now();
    } });
    try {
      const { scene, people, dash, pump, said, ws } = session;
      people.push(det("person", 0.9, [40, 40, 120, 280]));
      await pump(() => dash.some((m) => m.type === "brain" && m.event.type === "decision" && m.event.fsm?.state === "drinking"));
      people.splice(0);
      await pump(() => !!said("식탁으로 가 주세요"));
      const first = said("식탁으로 가 주세요")!;
      ws.send(JSON.stringify({ type: "answer", id: first.id, step: first.step, choice: "done" }));
      await pump(() => !!said("컵 안이 보이게 위에서 비춰 주세요"));
      scene.above = cupPos(dash, "cup_1");
      await pump(() => !!said("컵을 들어 주세요"));
      scene.above = null;
      scene.cupPlace = "in_hand";
      await pump(() => end > 0);
      expect(start).toBeGreaterThan(0);
      expect(end).toBeGreaterThan(start);
      samples.push(Math.round((end - start) * 10) / 10);
    } finally { await session.close(); }
  }
  if (baselineRun) writeFileSync(fixture, JSON.stringify({ base: "3bc11928", samples_ms: samples }, null, 2) + "\n");
  else {
    const baseline = JSON.parse(readFileSync(fixture, "utf8")) as { samples_ms: number[] };
    // 통로 한 번의 예산 10ms(집 상태 지연 시험과 같음). 두 번 더 지난다.
    expect(samples[0]).toBeLessThanOrEqual(Math.max(...baseline.samples_ms) + 2 * 10);
  }
}, SAMPLES * 90_000);
