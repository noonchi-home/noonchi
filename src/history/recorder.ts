// 기록기: 가전 변화, 관찰(VLM 답·VLM 분석 없음, YOLOX 분석 없음), World State 변화, PAM에 보낸 관찰 텍스트, 판단, 계획, 실행, 운영 모드,
// PAM 연결 끊김·연결됨, 주기 판단 멈춤·다시 시작을 한 시간축에 적는다. 사진은 적지 않는다. 반성은 runReflection이 적는다.
// YOLOX 결과는 등장·사라짐(detection)으로 남는다. 프레임마다 YOLOX 분석 없음이면 yolo, VLM 답이나 VLM 분석 없음이면 vlm 줄이 남는다.
import type { BrainLog } from "../contract/events.js";
import type { PlanView } from "../contract/plan.js";
import type { ControlMode } from "../contract/setup.js";
import type { DeviceState } from "../hub/types.js";
import { CHANGE_TEXT } from "../world/labels.js";
import type { HistoryDb } from "./db.js";
import { DECISION_TEXT, MODE_TEXT, PLAN_STATUS_TEXT } from "./labels.js";

/** 가전 상태와 함께 오는 것: initial이면 처음 알린 상태(적지 않고 기억만), label은 기록 글에 쓸 가전 이름. */
export interface DeviceNote { initial?: boolean; label?: string }

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

export function attachRecorder(db: HistoryDb, o: RecorderSources): () => void {
  const now = o.now ?? (() => Date.now());
  const last = new Map<string, Record<string, unknown>>();
  const offs = [
    o.onDevice((s, note) => {
      const prev = last.get(s.id);
      last.set(s.id, { ...s.twin });
      if (note?.initial) return;
      const at = Date.parse(s.updatedAt) || now();
      for (const [attr, to] of Object.entries(s.twin)) {
        const from = prev?.[attr] ?? null;
        if (prev && Object.is(prev[attr], to)) continue;
        db.add("device", at, CHANGE_TEXT.deviceAttr(note?.label ?? s.id, attr, to), { subject: s.id, data: { attr, from, to } });
      }
    }),
    o.onBrain((l) => {
      switch (l.type) {
        case "observe":
          if (l.yolo_missing) {
            db.add("yolo", l.at_ms, CHANGE_TEXT.yoloMissing[l.yolo_missing], {
              subject: l.frame_id, data: { captured_at_ms: l.captured_at_ms, yolo_missing: l.yolo_missing, vlm_missing: l.vlm_missing ?? null },
            });
          } else if (l.vlm !== null || l.vlm_missing) {
            db.add("vlm", l.at_ms, l.vlm ?? CHANGE_TEXT.vlmMissing[l.vlm_missing!], { subject: l.frame_id, data: { captured_at_ms: l.captured_at_ms, missing: l.vlm_missing ?? null } });
          }
          return;
        case "world_change":
          db.add(DETECTION.has(l.kind) ? "detection" : "world", l.at_ms, l.text, { data: { kind: l.kind } });
          return;
        case "decision":
          db.add("pam_text", l.at_ms, l.text_sent, { subject: l.id });
          db.add("decision", l.at_ms, l.action ?? (l.status === "valid" ? DECISION_TEXT.wait : DECISION_TEXT.failed(l.error ?? "")), {
            subject: l.id, data: { seq: l.seq, prediction: l.prediction, status: l.status, memory_version: l.memory_version, world: l.world },
          });
          return;
        case "execution":
          db.add("execution", l.at_ms, l.text, { subject: l.plan_id, data: { state: l.state } });
          return;
        case "link":
          db.add("link", l.at_ms, l.text, { subject: l.target, data: { up: l.up } });
          return;
        case "trigger":
          db.add("trigger", l.at_ms, l.text, { data: { paused: l.paused } });
          return;
        case "reflection":
          return;
      }
    }),
    o.onPlan((p) => db.add("plan", Date.parse(p.updatedAt) || now(), `${p.goal} ${PLAN_STATUS_TEXT[p.status]}`, {
      subject: p.id, data: { revision: p.revision, status: p.status, steps: p.steps.map((s) => ({ id: s.id, label: s.label, status: s.status })) },
    })),
    o.onMode((m) => db.add("mode", now(), MODE_TEXT[m], { data: { mode: m } })),
  ];
  return () => offs.forEach((off) => off());
}
