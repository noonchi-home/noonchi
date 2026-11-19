// 기록기: 가전 변화(낱말 표 사건 글, 거실 에어컨 켜짐, 카메라로 본 값이면 「· 카메라로 봄」), 관찰(VLM 답·VLM 분석 없음, YOLO 분석 없음), World State 변화, PAM에 보낸 관찰 텍스트, 판단, 계획, 실행, 운영 모드,
// PAM 연결 끊김·연결됨, 주기 판단 멈춤·다시 시작, 관찰 모드가 고른 것(look)을 한 시간축에 적는다. 사진은 적지 않는다. 반성은 runReflection이 적는다.
// YOLO 결과는 등장·사라짐(detection)으로 남는다. 프레임마다 YOLO 분석 없음이면 yolo, VLM 답이나 VLM 분석 없음이면 vlm 줄이 남는다.
import type { BrainLog, FeedbackLog } from "../../contract/events.js";
import type { PlanView } from "../../contract/plan.js";
import type { ControlMode } from "../../contract/setup.js";
import type { DeviceState } from "../../contract/devices.js";
import { CHANGE_TEXT } from "../../world/labels.js";
import { becameKey, deviceText } from "../../world/index.js";
import type { HistoryDb } from "./db.js";
import { DECISION_TEXT, MODE_TEXT, PLAN_STATUS_TEXT } from "./labels.js";

/** 가전 상태와 함께 오는 것: initial이면 처음 알린 상태(적지 않고 기억만), label은 기록 글에 쓸 가전 이름, kind는 사건 글(세탁 멈춤)을 고를 가전 종류. */
export interface DeviceNote { initial?: boolean; label?: string; kind?: string }

export interface RecorderSources {
  onDevice(cb: (s: DeviceState, note?: DeviceNote) => void): () => void;
  onBrain(cb: (l: BrainLog) => void): () => void;
  onPlan(cb: (p: PlanView) => void): () => void;
  onMode(cb: (m: ControlMode) => void): () => void;
  now?: () => number;
}

/** 구독 목록 하나: on으로 받고 emit으로 보낸다. */
export function topic<T extends unknown[]>(): { on(cb: (...v: T) => void): () => void; emit(...v: T): void } {
  const subs = new Set<(...v: T) => void>();
  return {
    on: (cb) => { subs.add(cb); return () => { subs.delete(cb); }; },
    emit: (...v) => { for (const cb of [...subs]) cb(...v); },
  };
}

const DETECTION = new Set(["appeared", "gone", "person_appeared", "person_gone"]);

/** 가전 기록기: 가전 상태 하나를 지난 값(기록 DB device_last)과 견줘 바뀐 속성마다 device 줄을 쓰고 지난 값을 바꾼다.
 *  initial이면 지난 값만 바꾼다. 메모리에 들지 않아 기록 노드를 다시 만들어도 이어진다(기록 노드는 db.once 트랜잭션 안에서 부른다). */
export function deviceRecorder(db: HistoryDb, now: () => number): (s: DeviceState, note?: DeviceNote) => void {
  return (s, note) => {
    const prev = db.deviceLast(s.id);
    db.setDeviceLast(s.id, { ...s.twin });
    if (note?.initial) return;
    const at = Date.parse(s.updatedAt) || now();
    for (const [attr, to] of Object.entries(s.twin)) {
      const from = prev?.[attr] ?? null;
      if (prev && Object.is(prev[attr], to)) continue;
      const key = becameKey(attr, to);
      const label = note?.label ?? s.id;
      // 카메라로 본 값이 상태가 된 속성은 「카메라로 봄」을 붙인다
      const seen = !!s.vision?.applied && attr in s.vision.twin && Object.is(s.vision.twin[attr], to);
      const text = key ? (seen ? CHANGE_TEXT.deviceSeen : CHANGE_TEXT.device)(label, deviceText(note?.kind ?? "", key).became) : CHANGE_TEXT.deviceAttr(label, attr, to);
      db.add("device", at, text, { subject: s.id, data: { attr, from, to, ...(seen ? { vision: true } : {}) } });
    }
  };
}

/** 판단 쪽 기록 하나(관찰·World State 변화·판단·실행·연결·계기·보기)를 기록 DB 줄로 쓴다. 반성은 runReflection이 쓴다. */
export function recordBrainLog(db: HistoryDb, l: BrainLog): void {
  switch (l.type) {
    case "observe":
      if (l.yolo_missing) {
        db.add("yolo", l.at_ms, CHANGE_TEXT.yoloMissing[l.yolo_missing], {
          subject: l.frame_id, data: { captured_at_ms: l.captured_at_ms, yolo_missing: l.yolo_missing, vlm_missing: l.vlm_missing ?? null },
        });
      } else if (l.vlm !== null || l.vlm_missing) {
        db.add("vlm", l.at_ms, l.vlm ?? CHANGE_TEXT.vlmMissing[l.vlm_missing!], { subject: l.frame_id, data: { captured_at_ms: l.captured_at_ms, missing: l.vlm_missing ?? null, ...(l.scene ? { scene: l.scene } : {}), ...(l.view ? { view: l.view, size: l.size } : {}), ...(l.dets ? { dets: l.dets } : {}) } });
      }
      return;
    case "world_change":
      db.add(DETECTION.has(l.kind) ? "detection" : "world", l.at_ms, l.text, { data: { kind: l.kind, ...(l.observed_ms !== undefined ? { observed_ms: l.observed_ms } : {}) } });
      return;
    case "decision":
      db.add("pam_text", l.at_ms, l.text_sent, { subject: l.id });
      db.add("decision", l.at_ms, l.action ?? (l.status === "valid" ? DECISION_TEXT.wait : DECISION_TEXT.failed(l.error ?? "")), {
        subject: l.id, data: {
          seq: l.seq, prediction: l.prediction, status: l.status, memory_version: l.memory_version, world: l.world, ...(l.usage ? { usage: l.usage } : {}),
          // 사람 상태·화살표(덩어리 기록·반성이 그 판단의 사람 상태를 본다), 말 부탁·늦은 답 표시
          ...(l.fsm ? { fsm: l.fsm } : {}), ...(l.source ? { source: l.source } : {}), ...(l.via ? { via: l.via } : {}), ...(l.late ? { late: l.late } : {}), ...(l.goal ? { goal: l.goal } : {}),
        },
      });
      return;
    case "execution":
      db.add("execution", l.at_ms, l.text, { subject: l.plan_id, data: { state: l.state, ...(l.reason ? { reason: l.reason } : {}) } });
      return;
    case "link":
      db.add("link", l.at_ms, l.text, { subject: l.target, data: { up: l.up } });
      return;
    case "trigger":
      db.add("trigger", l.at_ms, l.text, { data: { paused: l.paused } });
      return;
    case "look":
      db.add("look", l.at_ms, l.text, {
        subject: l.target ?? undefined,
        data: { trigger: l.trigger, target: l.target, tool: l.tool, reason: l.reason, result: l.result, plan_id: l.plan_id ?? null, step_id: l.step_id ?? null },
      });
      return;
    case "reflection":
      return;
  }
}

/** 사용자 답 한 줄을 기록 DB feedback 줄로 쓴다(반성 피드백). 폰 답 처리와 기록 노드가 같은 길을 쓴다. */
export function recordFeedback(db: HistoryDb, f: FeedbackLog): void {
  db.add("feedback", f.at_ms, f.text, { subject: f.subject, data: f.data });
}

export function recordPlan(db: HistoryDb, p: PlanView, now: number): void {
  db.add("plan", Date.parse(p.updatedAt) || now, `${p.goal} ${PLAN_STATUS_TEXT[p.status]}`, {
    subject: p.id, data: { revision: p.revision, status: p.status, steps: p.steps.map((s) => ({ id: s.id, kind: s.kind, label: s.label, status: s.status })) },
  });
}

export function attachRecorder(db: HistoryDb, o: RecorderSources): () => void {
  const now = o.now ?? (() => Date.now());
  const offs = [
    o.onDevice(deviceRecorder(db, now)),
    o.onBrain((l) => recordBrainLog(db, l)),
    o.onPlan((p) => recordPlan(db, p, now())),
    o.onMode((m) => db.add("mode", now(), MODE_TEXT[m], { data: { mode: m } })),
  ];
  return () => offs.forEach((off) => off());
}
