// header.ts — 메시지 머리(ROS 2 std_msgs/Header처럼): stamp(발행 시각 ms), node(보낸 노드), inst(보낸 노드 인스턴스: 노드 객체마다 새 값),
// seq(인스턴스·토픽마다 1부터), boot(기동), home(집). 메시지 식별자 msgId는 이 다섯으로 만든다.
// 근거 시각은 몸의 observed_ms다(머리 stamp는 발행 시각). 사진은 jpeg_b64로 싣고 frameBytes로 되살린다.
import { z } from "zod";
import { NODES, TOPICS, type Body, type TopicName } from "./topics.js";

export const Header = z.strictObject({
  stamp: z.number().finite(), node: z.enum(NODES), inst: z.string().min(1), seq: z.number().int().nonnegative(), boot: z.string().min(1), home: z.string().min(1),
});
export type Header = z.infer<typeof Header>;
export interface Envelope<N extends TopicName> { topic: N; key: string; header: Header; body: Body<N> }

/** 메시지 식별자: 기동/집/노드/인스턴스/seq. 중복 판정(처리표·녹화)이 쓴다. */
export const msgId = (h: Header): string => `${h.boot}/${h.home}/${h.node}/${h.inst}/${h.seq}`;

export function encode<N extends TopicName>(e: Envelope<N>): string {
  return JSON.stringify({ key: e.key, header: e.header, body: e.body });
}

const envelopes = new Map(Object.entries(TOPICS).map(([topic, spec]) =>
  [topic, z.strictObject({ key: z.string(), header: Header, body: spec.body })] as const));

export function decode<N extends TopicName>(topic: N, raw: string): Envelope<N> {
  const v = envelopes.get(topic)!.parse(JSON.parse(raw));
  return { topic, key: v.key, header: v.header, body: v.body as Body<N> };
}

/** /perception/frame 몸의 사진 바이트. */
export const frameBytes = (body: { jpeg_b64: string }): Buffer => Buffer.from(body.jpeg_b64, "base64");
