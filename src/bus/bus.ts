// bus.ts — 통로 인터페이스(ROS 2 rmw처럼). MemoryBus(시험·개발)와 RedisBus(실제)가 같은 계약(tests/helpers/bus-contract.ts)을 따른다.
// subscribe는 그룹·커서를 만들기만 하고 start() 뒤에 배달한다. publish는 받는 쪽 콜백을 그 호출 안에서 부르지 않는다.
// RELIABLE은 deliver가 "ack"일 때만 ack한다. "retry"면 RETRY_MS 뒤 같은 메시지를 다시 주고, 그동안 같은 토픽·그룹의 뒤 메시지는 주지 않는다.
// 한 구독 안에서 MAX_DELIVERIES번 실패하면 /bus/dead에 남기고 ack한 뒤 다음으로 간다. /bus/dead 자체의 실패는 다시 보내지 않고 log만 남긴다.
import type { Envelope } from "./header.js";
import type { NodeName, TopicName } from "./topics.js";

export const MAX_DELIVERIES = 3;
export const RETRY_MS = 100;
export type Outcome = "ack" | "retry";
export type Deliver<N extends TopicName> = (e: Envelope<N>) => Promise<Outcome>;
export interface Subscription {
  start(): void;
  /** 끊는다. 처리 중이던 RELIABLE은 ack하지 않는다(다시 붙은 같은 그룹이 차례대로 다시 받는다). */
  stop(): Promise<void>;
  /** mode "all"에서 잘려 놓친 수(보낸 노드 seq의 건너뜀, 준비 때 기준부터). */
  lost(): number;
}
export interface Bus {
  publish<N extends TopicName>(e: Envelope<N>): Promise<void>;
  subscribe<N extends TopicName>(topic: N, node: NodeName, deliver: Deliver<N>, o?: { mode?: "latest" | "all" }): Promise<Subscription>;
  close(): Promise<void>;
}

/** 놓친 수 세기(SENSOR all): 보낸 노드 인스턴스마다 마지막 seq. base는 준비 때 가장 새 메시지다(그 인스턴스는 그 seq부터).
 *  처음 보는 인스턴스는 seq 0부터 센다: 인스턴스는 seq 1부터 보내고, 준비 뒤에 생긴 인스턴스다(SENSOR 토픽은 보내는 노드가 하나다). */
export function gapCounter(base?: Envelope<TopicName>) {
  const id = (e: Envelope<TopicName>) => `${e.header.node}|${e.header.inst}`;
  const last = new Map<string, number>(base ? [[id(base), base.header.seq]] : []);
  let lost = 0;
  return {
    see(e: Envelope<TopicName>): void {
      const p = last.get(id(e)) ?? 0;
      if (e.header.seq > p + 1) lost += e.header.seq - p - 1;
      last.set(id(e), Math.max(p, e.header.seq));
    },
    lost: () => lost,
  };
}

/** /bus/dead 몸: 처리하지 못한 메시지와 그룹, 전달 횟수. */
export const deadBody = (topic: TopicName, group: NodeName, raw: string, deliveries: number) => ({ topic, group, raw, deliveries });
