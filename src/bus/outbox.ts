// outbox.ts — 차례대로 보내기: 노드가 낸 메시지를 낸 차례대로 하나씩 보낸다. 발행이 실패하면 같은 봉투(같은 메시지 id)로 RETRY_MS 뒤 다시 보내고,
// 그동안 뒤 메시지를 붙잡아 둔다(받는 쪽이 앞 입력 없이 뒤 입력만 받지 않게, 다시 보낸 것은 받는 쪽이 같은 메시지로 본다).
// 노드를 끝내면 남은 것을 버린다. drain(ms)은 다 보내거나 기한이 지날 때까지 기다린다(집을 닫기 전 비우기, 닫기가 걸리지 않게 기한을 둔다).
import { RETRY_MS } from "./bus.js";
import type { Clock } from "./clock.js";
import type { Envelope } from "./header.js";
import type { BusNode } from "./node.js";
import type { Body, TopicName } from "./topics.js";

export class Outbox {
  readonly #queue: Envelope<TopicName>[] = [];
  readonly #emptied: (() => void)[] = [];
  #pumping = false;

  constructor(private readonly node: BusNode, private readonly o: { clock: Clock; log: (s: string) => void }) {}

  /** 보낼 메시지 수(보내는 중 포함). */
  get size(): number { return this.#queue.length; }

  /** 메시지 하나를 줄에 넣는다. 낼 수 없으면(닫힌 노드·틀린 몸) 남기고 false. */
  push<N extends TopicName>(topic: N, body: Body<N>): boolean {
    try {
      this.#queue.push(this.node.envelope(topic, body) as Envelope<TopicName>);
    } catch (e) {
      this.o.log(`[${this.node.name}] ${topic}를 낼 수 없어요: ${(e as Error).message}`);
      return false;
    }
    void this.#pump();
    return true;
  }

  /** 다 보낼 때까지 기다린다(true). ms가 지나면 기다리지 않는다(false). */
  drain(ms: number): Promise<boolean> {
    if (!this.#queue.length) return Promise.resolve(true);
    return new Promise<boolean>((resolve) => {
      let done = false;
      const finish = (v: boolean) => { if (!done) { done = true; cancel(); resolve(v); } };
      const cancel = this.o.clock.after(ms, () => finish(false));
      this.#emptied.push(() => finish(true));
    });
  }

  async #pump(): Promise<void> {
    if (this.#pumping) return;
    this.#pumping = true;
    try {
      while (this.#queue.length) {
        if (this.node.closed) {
          this.#queue.length = 0;
          break;
        }
        const e = this.#queue[0]!;
        try {
          await this.node.send(e);
          this.#queue.shift();
        } catch (err) {
          if (this.node.closed) continue;
          this.o.log(`[${this.node.name}] ${e.topic} 발행 실패, 같은 봉투로 다시 보내요: ${(err as Error).message}`);
          await new Promise<void>((r) => { this.o.clock.after(RETRY_MS, r); });
        }
      }
    } finally {
      this.#pumping = false;
      if (!this.#queue.length) for (const r of this.#emptied.splice(0)) r();
    }
  }
}
