// open.ts — REDIS_URL이 있으면 RedisBus(켜질 때 디스크 저장 끔 확인, 다른 기동의 열쇠 지움, 기동 표시 열쇠), 없으면 MemoryBus(같은 계약). 다른 갈래는 없다.
// onLost(꼭 넘김): Redis가 다시 켜져 이번 기동의 메시지를 잃었을 때. 통로는 그 뒤 요청을 거절하고, 띄우는 곳은 서버를 끝낸다(compose restart가 새 기동으로 띄운다).
import type { Bus } from "./bus.js";
import { MemoryBus } from "./memory.js";

export async function openBus(env: Record<string, string | undefined>, o: { boot: string; log?: (s: string) => void; onLost: (err: Error) => void }): Promise<Bus> {
  const url = env.REDIS_URL?.trim();
  if (!url) return new MemoryBus(o.log);
  const { RedisBus } = await import("./redis.js");
  return RedisBus.connect(url, { boot: o.boot, log: o.log, onLost: o.onLost });
}
