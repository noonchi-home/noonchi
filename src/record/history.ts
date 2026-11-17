// history.ts — 기록 노드가 기록 DB(noonchi.db)에 쓰는 토픽과 줄(+ 녹화). 반성(DAY_KINDS·HABIT_KINDS)이 읽는 종류는 모두 RELIABLE에서 온다.
// 메시지 하나의 기록 줄과 처리표(bus_seen, msgId)는 한 트랜잭션이다(db.once): 다시 온 메시지는 쓰지 않는다. 가전 지난 값(device_last)도 같은 트랜잭션이다.
// 녹화는 같은 메시지를 다시 남기지 않는다. 다 쓰면 콜백이 끝나 실행기가 ack한다(실패하면 던져 다시 받는다).
// 녹화하는 SENSOR(record: true)는 커서(mode "all")로 다 읽는다. 사진 토픽과 /bus/dead는 녹화하지 않는다.
import type { BrainLog, FeedbackLog } from "../contract/events.js";
import type { WorldChange } from "../contract/world.js";
import { deviceRecorder, recordBrainLog, recordFeedback, type HistoryDb } from "../brain/index.js";
import { TOPICS, msgId, type BusNode, type TopicName } from "../bus/index.js";
import { HEARD_MARK } from "../world/labels.js";
import type { Bag } from "./bag.js";

type Write = (b: Record<string, unknown>) => void;
/** 프레임마다 생기는 분석 없음은 관찰 기록(observe)으로 남으므로 world_change로 다시 쓰지 않는다(관찰 흐름과 같다). */
const PER_FRAME = new Set(["vlm_missing", "yolo_missing"]);
/** World State 변화 하나의 기록 줄. 들은 말은 내용 없이 표시만 남긴다. */
const changeLog = (c: WorldChange): BrainLog => ({ type: "world_change", at_ms: c.at_ms, kind: c.kind, text: c.kind === "heard" ? HEARD_MARK : c.text });

export function historyRoutes(node: BusNode, db: HistoryDb, o: { bag?: Bag; now: () => number }): void {
  const device = deviceRecorder(db, o.now);
  const logs = (list: unknown) => { for (const l of (list ?? []) as BrainLog[]) recordBrainLog(db, l); };
  const history: Partial<Record<TopicName, Write>> = {
    "/perception/analysis": (b) => logs(b.logs),
    "/world/changes": (b) => { for (const c of b.changes as WorldChange[]) if (!PER_FRAME.has(c.kind)) recordBrainLog(db, changeLog(c)); },
    "/brain/decision": (b) => recordBrainLog(db, b as unknown as BrainLog),
    "/brain/link": (b) => recordBrainLog(db, b as unknown as BrainLog),
    "/act/log": (b) => (b.type === "feedback" ? recordFeedback(db, b as unknown as FeedbackLog) : recordBrainLog(db, b as unknown as BrainLog)),
    "/device/changes": (b) => device(b.state as never, b.note as never),
    "/bus/dead": (b) => { db.add("bus_gap", o.now(), `처리하지 못한 메시지: ${String(b.topic)}`, { data: b }); },
  };
  const recorded = (t: TopicName) => {
    const s = TOPICS[t] as { qos: { kind: string; record?: boolean }; photo?: string };
    return t !== "/bus/dead" && !s.photo && (s.qos.kind !== "sensor" || !!s.qos.record);
  };
  const topics = new Set<TopicName>([...(Object.keys(history) as TopicName[]), ...(o.bag ? (Object.keys(TOPICS) as TopicName[]).filter(recorded) : [])]);
  for (const topic of topics) {
    const write = history[topic];
    node.on(topic, (b, { e }) => {
      if (write) db.once({ topic, group: "recorder", key: e.key, msg: msgId(e.header), boot: e.header.boot }, () => write(b as Record<string, unknown>));
      if (o.bag && recorded(topic)) o.bag.write(e, o.now());
    }, TOPICS[topic].qos.kind === "sensor" ? { mode: "all" } : {});
  }
}
