// history.ts — 기록 노드가 기록 DB(noonchi.db)에 쓰는 토픽과 줄(+ 녹화). 반성(DAY_KINDS·HABIT_KINDS)이 읽는 종류는 모두 RELIABLE에서 온다.
// 메시지 하나의 기록 줄과 처리표(bus_seen, msgId)는 한 트랜잭션이다(db.once): 다시 온 메시지는 쓰지 않는다. 가전 지난 값(device_last)도 같은 트랜잭션이다.
// 녹화는 같은 메시지를 다시 남기지 않는다. 다 쓰면 콜백이 끝나 실행기가 ack한다(실패하면 던져 다시 받는다).
// 녹화하는 SENSOR(record: true)는 커서(mode "all")로 다 읽는다. 사진 토픽과 /bus/dead는 녹화하지 않는다.
import type { BrainLog, DecisionRecord, FeedbackLog } from "../contract/events.js";
import type { PlanView } from "../contract/plan.js";
import type { WorldChange } from "../contract/world.js";
import { decisionLog, deviceRecorder, recordPlan, recordBrainLog, recordFeedback, storeThought, type HistoryDb } from "../brain/index.js";
import { TOPICS, msgId, type BusNode, type Envelope, type TopicName } from "../bus/index.js";
import { HEARD_MARK, redactHeard } from "../world/labels.js";
import { machineWrites } from "./machines.js";
import type { Bag } from "./bag.js";

type Write = (b: Record<string, unknown>, stamp: number, header: Envelope<TopicName>["header"]) => void;
/** 프레임마다 생기는 분석 없음은 관찰 기록(observe)으로 남으므로 world_change로 다시 쓰지 않는다(관찰 흐름과 같다). */
const PER_FRAME = new Set(["vlm_missing", "yolo_missing"]);
/** 들은 말 글: KEEP_HEARD_TEXT가 아니면 내용 없이 표시만 남긴다(기록 DB·녹화가 같은 정책). */
const heardText = (text: string, keep: boolean) => (keep ? text : HEARD_MARK);
/** World State 변화 하나의 기록 줄: 기록 시각은 처리 시각(지금처럼 그날 기록에 들어간다), 근거(촬영) 시각은 observed_ms로 따로. */
const changeLog = (c: WorldChange, at: number, keep: boolean): BrainLog =>
  ({ type: "world_change", at_ms: at, kind: c.kind, text: c.kind === "heard" ? heardText(c.text, keep) : c.text, observed_ms: c.at_ms });
/** 녹화에 남길 봉투: 들은 말(/phone/heard 글, /world/changes의 heard 변화 글)은 기록 DB와 같은 정책으로 가린다. */
function forBag(e: Envelope<TopicName>, keep: boolean): Envelope<TopicName> {
  if (keep) return e;
  const b = e.body as Record<string, unknown>;
  if (e.topic === "/manager/order" || (e.topic === "/manager/request" && b.kind === "speech")) {
    const input = b.input as import("../bus/index.js").Body<"/brain/decision">;
    return { ...e, body: { ...b, input: { ...input, decision: { ...input.decision, textSent: redactHeard(input.decision.textSent) } } } } as Envelope<TopicName>;
  }
  if (e.topic === "/brain/decision" || e.topic === "/brain/plan_request") {
    const d = b.decision as DecisionRecord;
    return { ...e, body: { ...b, decision: { ...d, textSent: redactHeard(d.textSent) } } } as Envelope<TopicName>;
  }
  if (e.topic === "/phone/progress" && b.kind === "voice") {
    return { ...e, body: { ...b, text: HEARD_MARK } } as Envelope<TopicName>;
  }
  if (e.topic === "/phone/heard") return { ...e, body: { ...b, text: HEARD_MARK } } as Envelope<TopicName>;
  if (e.topic === "/world/changes") return { ...e, body: { ...b, changes: (b.changes as WorldChange[]).map((c) => (c.kind === "heard" ? { ...c, text: HEARD_MARK } : c)) } } as Envelope<TopicName>;
  return e;
}

export function historyRoutes(node: BusNode, db: HistoryDb, o: { bag?: Bag; now: () => number; keepHeard?: boolean; machinesOnly?: boolean }): void {
  const keep = o.keepHeard ?? false;
  const device = deviceRecorder(db, o.now);
  const logs = (list: unknown) => { for (const l of (list ?? []) as BrainLog[]) recordBrainLog(db, l); };
  const machines = machineWrites(db);
  const history: Partial<Record<TopicName, Write>> = o.machinesOnly ? { ...machines } : {
    ...machines,
    "/perception/analysis": (b) => logs(b.logs),
    "/world/changes": (b) => { for (const c of b.changes as WorldChange[]) if (!PER_FRAME.has(c.kind)) recordBrainLog(db, changeLog(c, o.now(), keep)); },
    "/device/changes": (b) => device(b.state as never, b.note as never),
    "/bus/dead": (b) => { db.add("bus_gap", o.now(), `처리하지 못한 메시지: ${String(b.topic)}`, { data: b }); },
  };
  history["/brain/link_changes"] = (b) => recordBrainLog(db, b as unknown as BrainLog);
  history["/brain/thought"] = (b) => {
    const { home, messages } = b as import("../bus/index.js").Body<"/brain/thought">;
    for (const m of messages) storeThought(db, home, m);
  };
  history["/brain/decision"] = (b) => recordBrainLog(db, decisionLog(b.decision as DecisionRecord, Number(b.at_ms), b.assist as "noonchi" | "coach", keep));
  history["/act/log"] = (b) => {
    if (b.type === "plan") { if (b.plan) recordPlan(db, b.plan as PlanView, o.now()); }
    else if (b.type === "feedback") recordFeedback(db, b as unknown as FeedbackLog);
    else recordBrainLog(db, b as unknown as BrainLog);
  };
  const recorded = (t: TopicName) => {
    const s = TOPICS[t] as { qos: { kind: string; record?: boolean }; photo?: string };
    return t !== "/bus/dead" && !s.photo && (s.qos.kind !== "sensor" || !!s.qos.record);
  };
  const topics = new Set<TopicName>([...(Object.keys(history) as TopicName[]), ...(o.bag ? (Object.keys(TOPICS) as TopicName[]).filter(recorded) : [])]);
  for (const topic of topics) {
    const write = history[topic];
    node.on(topic, (b, { e }) => {
      if (write) db.once({ topic, group: "recorder", key: e.key, msg: msgId(e.header), boot: e.header.boot }, () => write(b as Record<string, unknown>, e.header.stamp, e.header));
      if (o.bag && recorded(topic)) o.bag.write(forBag(e, keep), o.now());
    }, TOPICS[topic].qos.kind === "sensor" ? { mode: "all" } : {});
  }
}
