// fresh.ts — 낡은 메시지 보기(받는 쪽 한곳): 지금 기동·집이 아니면 버린다. 순서 기준(토픽 표 order)이 있으면 (토픽, 열쇠)마다
// 확정한 마지막 값보다 옛것(근거 시각·판본이 작음, 같으면 같은 노드 인스턴스의 이미 본 seq)을 버린다. 확정(commit)은 처리가 성공한 뒤에만 한다.
import type { Envelope } from "./header.js";
import { TOPICS, type TopicName } from "./topics.js";

type Mark = { at: number; node: string; inst: string; seq: number };
const SEP = "|";

export class Freshness {
  readonly #last = new Map<string, Mark>();
  constructor(private readonly epoch: () => { boot: string; home: string }) {}

  #mark(e: Envelope<TopicName>): Mark | null {
    const order = TOPICS[e.topic].order;
    if (order === null) return null;
    const b = e.body as Record<string, unknown>;
    const at = order === "stamp" ? e.header.stamp : Number(b[order]);
    return { at, node: e.header.node, inst: e.header.inst, seq: e.header.seq };
  }

  check(e: Envelope<TopicName>): boolean {
    const now = this.epoch();
    if (e.header.boot !== now.boot || e.header.home !== now.home) return false;
    const m = this.#mark(e);
    const p = m && this.#last.get(e.topic + SEP + e.key);
    if (!m || !p) return true;
    return m.at > p.at || (m.at === p.at && !(m.node === p.node && m.inst === p.inst && m.seq <= p.seq));
  }

  commit(e: Envelope<TopicName>): void {
    const m = this.#mark(e);
    if (m) this.#last.set(e.topic + SEP + e.key, m);
  }
}
