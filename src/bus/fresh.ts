// fresh.ts — 낡은 메시지 보기(받는 쪽 한곳): 지금 기동·집이 아니면 버린다. 순서 기준(토픽 표 order)이 있으면 (토픽, 열쇠)마다
// 확정한 가장 큰 근거 값(근거 시각·판본·발행 시각)보다 옛것을 버린다. 같은 근거 값이면 보낸 노드 인스턴스마다 확정한 seq를 기억해
// 그 인스턴스의 이미 처리한 seq를 버린다(다른 인스턴스를 처리한 뒤에도). 더 큰 근거 값을 확정하면 인스턴스 기억은 새로 시작한다.
// 확정(commit)은 처리가 성공한 뒤에만 한다.
import type { Envelope } from "./header.js";
import { TOPICS, type TopicName } from "./topics.js";

/** (토픽, 열쇠)마다: 확정한 가장 큰 근거 값과, 그 값에서 인스턴스마다 확정한 가장 큰 seq. */
type Mark = { at: number; seqs: Map<string, number> };
const SEP = "|";

export class Freshness {
  readonly #last = new Map<string, Mark>();
  constructor(private readonly epoch: () => { boot: string; home: string }) {}

  #at(e: Envelope<TopicName>): number | null {
    const order = TOPICS[e.topic].order;
    if (order === null) return null;
    return order === "stamp" ? e.header.stamp : Number((e.body as Record<string, unknown>)[order]);
  }

  check(e: Envelope<TopicName>): boolean {
    const now = this.epoch();
    if (e.header.boot !== now.boot || e.header.home !== now.home) return false;
    const at = this.#at(e);
    const p = at === null ? undefined : this.#last.get(e.topic + SEP + e.key);
    if (at === null || !p) return true;
    if (at !== p.at) return at > p.at;
    const seen = p.seqs.get(e.header.node + SEP + e.header.inst);
    return seen === undefined || e.header.seq > seen;
  }

  commit(e: Envelope<TopicName>): void {
    const at = this.#at(e);
    if (at === null) return;
    const k = e.topic + SEP + e.key;
    const p = this.#last.get(k);
    if (p && at < p.at) return;
    const mark = p && at === p.at ? p : { at, seqs: new Map<string, number>() };
    const who = e.header.node + SEP + e.header.inst;
    mark.seqs.set(who, Math.max(mark.seqs.get(who) ?? 0, e.header.seq));
    this.#last.set(k, mark);
  }
}
