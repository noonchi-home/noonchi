// 토픽 표(ROS 2 토픽·QoS처럼): 이름, QoS(SENSOR·STATE·RELIABLE), 몸 모양(zod), 열쇠, 순서 기준, 보내는 노드, 사진 칸.
// 토픽을 더할 때는 이 표 하나에 더한다. qos가 없으면 satisfies에서 타입 오류다. 사진(jpeg_b64)이 든 토픽은 SENSOR만.
// 몸 모양은 그 토픽을 옮기는 묶음에서 실제 모양으로 바꾼다(그 전에는 객체인지와 순서 칸만 본다).
import { z } from "zod";

export const NODES = ["phone", "perception", "world", "brain", "act", "devices", "recorder"] as const;
export type NodeName = (typeof NODES)[number];
export type Qos = { kind: "sensor"; depth: number; record?: boolean } | { kind: "state" } | { kind: "reliable" };
/** 낡음을 보는 기준: 근거 시각(observed_ms 칸), 상태 판본(rev 칸), 발행 시각(머리 stamp), 없음. */
export type Order = "observed_ms" | "rev" | "stamp" | null;
export interface TopicSpec<B = unknown> {
  qos: Qos;
  body: z.ZodType<B>;
  key: (b: B) => string;
  order: Order;
  from: readonly NodeName[];
  /** 사진 칸 이름(녹화에서 뺀다). SENSOR 토픽만. */
  photo?: string;
}

/** 사진 base64 글 상한(≈ 512KB JPEG). */
export const MAX_FRAME_B64 = 700_000;
const B64 = /^[A-Za-z0-9+/]*={0,2}$/;
const obj = z.looseObject({});
const observed = z.looseObject({ observed_ms: z.number().finite() });
const revved = z.looseObject({ rev: z.number().int().nonnegative() });
const frame = z.looseObject({
  jpeg_b64: z.string().max(MAX_FRAME_B64).regex(B64), width: z.number().int().positive(), height: z.number().int().positive(), observed_ms: z.number().finite(),
});
const one = () => "_";
const by = (k: string) => (b: Record<string, unknown>) => String(b[k] ?? "_");

export const TOPICS = {
  "/perception/frame": { qos: { kind: "sensor", depth: 4 }, body: frame, key: one, order: "observed_ms", from: ["phone"], photo: "jpeg_b64" },
  "/phone/pose": { qos: { kind: "sensor", depth: 600, record: true }, body: observed, key: one, order: "observed_ms", from: ["phone"] },
  "/perception/detections": { qos: { kind: "sensor", depth: 600, record: true }, body: observed, key: one, order: "observed_ms", from: ["perception"] },
  "/perception/analysis": { qos: { kind: "reliable" }, body: observed, key: by("frame_id"), order: "observed_ms", from: ["perception"] },
  "/perception/look_request": { qos: { kind: "reliable" }, body: obj, key: by("req"), order: null, from: ["act"] },
  "/perception/look_result": { qos: { kind: "reliable" }, body: observed, key: by("req"), order: "observed_ms", from: ["perception"] },
  "/world/input": { qos: { kind: "reliable" }, body: obj, key: by("id"), order: null, from: ["act"] },
  "/world/state": { qos: { kind: "state" }, body: revved, key: one, order: "rev", from: ["world"] },
  "/world/changes": { qos: { kind: "reliable" }, body: revved, key: one, order: "rev", from: ["world"] },
  "/brain/decision": { qos: { kind: "reliable" }, body: obj, key: one, order: "stamp", from: ["brain"] },
  "/brain/plan": { qos: { kind: "reliable" }, body: obj, key: by("decision_id"), order: null, from: ["brain", "act"] },
  "/brain/thought": { qos: { kind: "reliable" }, body: obj, key: one, order: "stamp", from: ["brain"] },
  "/brain/link": { qos: { kind: "state" }, body: obj, key: one, order: "stamp", from: ["brain"] },
  "/brain/cancel": { qos: { kind: "reliable" }, body: obj, key: by("decision_id"), order: null, from: ["act"] },
  "/act/plan": { qos: { kind: "state" }, body: obj, key: by("id"), order: "stamp", from: ["act"] },
  "/act/status": { qos: { kind: "state" }, body: obj, key: one, order: "stamp", from: ["act"] },
  "/act/log": { qos: { kind: "reliable" }, body: obj, key: one, order: "stamp", from: ["act"] },
  "/act/phone_command": { qos: { kind: "state" }, body: obj, key: one, order: "stamp", from: ["act"] },
  "/phone/claim": { qos: { kind: "state" }, body: obj, key: by("claim_id"), order: "stamp", from: ["act", "phone"] },
  "/phone/owner": { qos: { kind: "state" }, body: obj, key: one, order: "stamp", from: ["phone"] },
  "/phone/progress": { qos: { kind: "reliable" }, body: obj, key: by("req"), order: null, from: ["phone"] },
  "/phone/heard": { qos: { kind: "reliable" }, body: observed, key: one, order: "observed_ms", from: ["phone"] },
  "/phone/say": { qos: { kind: "reliable" }, body: obj, key: one, order: null, from: ["act", "brain"] },
  "/phone/link": { qos: { kind: "state" }, body: obj, key: one, order: "stamp", from: ["phone"] },
  "/device/command": { qos: { kind: "reliable" }, body: z.looseObject({ command_id: z.string().min(1), deadline_ms: z.number().finite() }), key: by("command_id"), order: null, from: ["act", "phone"] },
  "/device/result": { qos: { kind: "reliable" }, body: z.looseObject({ command_id: z.string().min(1), status: z.enum(["done", "failed", "expired", "unknown"]) }), key: by("command_id"), order: null, from: ["devices"] },
  "/device/state": { qos: { kind: "state" }, body: obj, key: by("id"), order: "stamp", from: ["devices"] },
  "/device/changes": { qos: { kind: "reliable" }, body: obj, key: by("id"), order: "stamp", from: ["devices"] },
  "/bus/dead": { qos: { kind: "reliable" }, body: obj, key: by("topic"), order: null, from: NODES },
} as const satisfies Record<string, TopicSpec<Record<string, unknown>>>;

export type TopicName = keyof typeof TOPICS;
export type Body<N extends TopicName> = z.infer<(typeof TOPICS)[N]["body"]>;
