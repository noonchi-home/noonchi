// 대시보드 화면 시험 자료: 지켜보기(0)와 컵 치우기 4단계 계획(1~4, 계획 계약 PlanView), 세로 그림 칸(가짜 단계용 image), 물체 모양 하나(seenOf),
// 눈 그림 넷(405×720)과 그림마다 YOLO 상자(EYE_FRAMES). 상자는 시안 scenario.ts BOX를 EYE_CROP_X0만큼 옮겨 그림 끝에서 자른 값이다.
import { createElement } from "react";
import type { HealthView, ServerMessage } from "../../../src/contract/events.ts";
import type { PlanStep, PlanView } from "../../../src/contract/plan.ts";
import type { ScreenProps } from "../../src/dashboard/DashboardScreen";
import type { Detection } from "../../src/dashboard/detections";
import { hubOf } from "../../src/lib/hub";
import { createSeenStore, type SeenStore } from "../../src/dashboard/masks";
import type { PhoneSlot } from "../../src/dashboard/PhonePane";
import type { Talk } from "../../src/dashboard/data";
import { taskOf } from "../../../src/act/tasks.ts";
import { BOX_NAME } from "../../src/dashboard/words";
import type { SeenEvent } from "../../../src/contract/events.ts";

export const PHONE_URL = "http://192.168.0.7:8210/phone/";

export const HEALTH: HealthView = {
  ok: true, devices: 2, hub: "memory", transport: null, provider: "openai", model: "gpt-5-mini", twin: true, eye: true,
  home: { id: "mokryeon_180b", name: "한양목련 180B" }, phone_urls: [PHONE_URL], brain: true, mode: "test", assist: "noonchi",
  ready: {
    ok: false, inference_mode: "mock", vlm: { base_url: "", model: "", key: false, reachable: false }, pam: { url: "", reachable: false, llm: null },
    agent: { provider: "openai", base_url: "", model: "", key: false, reachable: false }, db: false,
  },
};
export const HUB = hubOf(HEALTH, true);

export type EyeFrameId = "table-far" | "table-near" | "sink" | "sink-cup";
export interface EyeFrame { id: EyeFrameId; width: number; height: number; boxes: Detection[] }

/** 눈 그림 넷과 그 위 YOLO 상자(그림 픽셀 [왼쪽, 위, 오른쪽, 아래]). */
export const EYE_FRAMES: EyeFrame[] = [
  { id: "table-far", width: 405, height: 720, boxes: [
    { label: "식탁", score: 0.91, box: [106, 338, 298, 528] },
    { label: "컵", score: 0.84, box: [168, 332, 192, 357] },
  ] },
  { id: "table-near", width: 405, height: 720, boxes: [
    { label: "컵", score: 0.95, box: [160, 238, 245, 346] },
    { label: "식탁", score: 0.89, box: [0, 162, 405, 720] },
  ] },
  { id: "sink", width: 405, height: 720, boxes: [
    { label: "싱크대", score: 0.87, box: [0, 262, 405, 325] },
  ] },
  { id: "sink-cup", width: 405, height: 720, boxes: [
    { label: "싱크대", score: 0.93, box: [0, 100, 405, 370] },
    { label: "컵", score: 0.92, box: [155, 243, 250, 358] },
  ] },
];

export const FRAME = { width: 405, height: 720 };
/** 세로 그림 칸(가짜 단계용). */
export const imageSlot = (id: EyeFrameId = "table-far"): PhoneSlot => ({ kind: "image", src: `/debug-eye/eye-${id}.webp`, ...FRAME });
/** YOLO 상자 하나(먼 식탁 위 컵). */
export const BOX: Detection = { label: "컵", score: 0.84, box: [168, 332, 192, 357] };

const KIND = Object.fromEntries(Object.entries(BOX_NAME).map(([kind, name]) => [name, kind]));
/** 상자들(화면 이름·[왼쪽, 위, 오른쪽, 아래])을 상자를 꽉 채운 모양으로 담은 seen 사건. */
export function seenEvent(boxes: Detection[], frame = FRAME): SeenEvent {
  return {
    type: "seen", at_ms: 1, frame_id: "e1", captured_at_ms: 1, frame,
    shapes: boxes.map((d) => ({
      label: (KIND[d.label] ?? d.label) as SeenEvent["shapes"][number]["label"], score: d.score,
      mask: { at: [d.box[0], d.box[1], d.box[2] - d.box[0], d.box[3] - d.box[1]], cols: 1, rows: 1, bits: "gA==" },
    })),
  };
}
/** 그 seen을 든 저장소(지우지 않음). null이면 빈 저장소. */
export function seenOf(boxes: Detection[] | null, frame = FRAME): SeenStore {
  const store = createSeenStore({ hold: true });
  if (boxes) store.set(seenEvent(boxes, frame));
  return store;
}

const STEPS: PlanStep[] = [
  { id: "cup:1", kind: "move", label: "식탁으로 가기", target: { objectId: "dining_table", room: "living" }, status: "pending" },
  { id: "cup:2", kind: "act", label: "컵 집기", target: { objectId: "cup" }, status: "pending" },
  { id: "cup:3", kind: "move", label: "싱크대로 가기", target: { objectId: "sink", room: "kitchen" }, status: "pending" },
  { id: "cup:4", kind: "act", label: "컵 내려놓기", target: { objectId: "sink" }, status: "pending" },
];

/** 컵 치우기 4단계 계획: n번째 단계가 지금(앞은 끝남, 뒤는 남음). */
export function planAt(n: number): PlanView {
  return {
    id: "cup", revision: n, origin: "mock", source: "planner", goal: "컵 치우기", judgment: "식탁 컵을 치우기로 했어요", dryRun: false,
    robot: { position: [10.6, 8.6], room: "living" }, path: [], legs: [],
    steps: STEPS.map((s, i) => ({ ...s, status: i + 1 < n ? "done" : i + 1 === n ? "active" : "pending" })),
    status: "running", updatedAt: "2026-11-09T00:00:00.000Z",
  };
}
export const PLAN = planAt(1);

/** 단계마다 말풍선 카드 말(0 지켜보기, 1~4 실제 폰 명령). */
export const SAY = ["식탁을 보고 있어요.", "식탁으로 가 주세요.", "컵을 들어 주세요.", "싱크대로 가 주세요.", "컵을 싱크대에 넣어 주세요."];
export const CLEAR_CUP = "컵 치우기";
export const REASON = "사람이 자리를 비운 뒤에도 컵이 식탁에 남아 있어요.";
export const LEFT_CUP_STATE = "컵을 두고 자리를 뜸";
/** 작은 모델이 쓴 생각 메시지(src/brain/thought.ts): 컵 치우기 판단의 흐름(본 것 → 결정적인 근거와 할 일). */
export const MESSAGES = [
  { id: "pam-1@1794214809000:0", text: "사람이 컵을 두고 자리를 떠났어요" },
  { id: "pam-1@1794214809000:1", text: "치우는 습관이라 컵을 치울게요" },
];
/** 컵 치우기 규칙대로 고른 판단의 알약 셋(상태 이름·트리거·액션). */
export const PILLS = { state: "컵을 두고 자리를 뜸", trigger: "사용자가 컵을 식탁 등에 두고 자리를 비웠고, 아무도 컵을 들거나 만지지 않는다.", action: "컵 치우기" };
/** 대기 판단의 알약 셋(처음 상태, 트리거·액션은 대기). */
export const WAIT_PILLS = { state: "먹거나 마시는 중", trigger: "대기", action: "대기" };
/** 계획 단계의 메시지 상자(다듬은 생각 두 줄과 알약 셋). */
export const TALK: Talk = { lines: MESSAGES, fsm: PILLS };
/** 지켜보기의 메시지 상자(말풍선 카드 말 한 줄과 대기 알약). */
export const WATCH_TALK: Talk = { lines: [{ id: "say@0:0", text: "지켜보고 있어요." }], fsm: WAIT_PILLS };

/** 컵 갈래 판단 고정 자료: 행동, 그 규칙이 있는 FSM 상태 id·트리거(src/brain/decision.ts CUP_FSM_MEMORY와 같다, data.test.ts가 견준다), PAM의 생각 한 문장. */
export interface Branch { action: string; state: string; trigger: string; reasoning: string }
export const BRANCHES = {
  clear: { action: CLEAR_CUP, state: "left_cup", trigger: "사용자가 컵을 식탁 등에 두고 자리를 비웠고, 아무도 컵을 들거나 만지지 않는다.", reasoning: REASON },
  leave: { action: "컵 그대로 두기", state: "left_cup", trigger: "사용자가 자리를 비웠지만 컵에 음료가 남아 있다.", reasoning: "컵에 음료가 남아 있어 돌아와서 마실 수 있어요." },
  water: { action: "컵에 물 채워 주기", state: "drinking", trigger: "사용자가 식탁에서 먹는 중이고 식탁 위 컵이 비어 있으며 컵을 들거나 만지지 않는다.", reasoning: "식사 중인데 컵이 비어 있어요." },
  cola: { action: "컵에 콜라 따라 주기", state: "watching_tv", trigger: "사용자가 TV를 보는 중이고 곁의 컵이 비어 있으며 컵을 들거나 만지지 않는다.", reasoning: "TV를 보는 중인데 컵이 비어 있어요." },
} as const satisfies Record<string, Branch>;
/** 코치 판단 고정 자료(라면 끓이기 알려 주기, FSM 상태 cooking)와 13단계 계획(사람 단계·알림·기다리기). */
export const COACH: Branch = {
  action: "라면 끓이기 알려 주기", state: "cooking", trigger: "사용자가 라면 끓이는 법을 알려 달라고 말했거나, 주방에서 라면을 끓이려다 무엇을 해야 할지 모르겠다고 말한다.",
  reasoning: "라면 끓이는 법을 물어봤어요.",
};
const COACH_STEPS: [PlanStep["kind"], string][] = [
  ["move", "수납장으로 가기"], ["act", "냄비 꺼내기"], ["move", "싱크대로 가기"], ["act", "물 받기"], ["move", "인덕션으로 가기"], ["act", "냄비 올리기"], ["act", "인덕션 켜기"],
  ["ask", "물 끓기 알림"], ["wait", "물 끓기 기다리기"], ["act", "면과 스프 넣기"], ["wait", "익기 기다리기"], ["act", "인덕션 끄기"], ["ask", "끝 알림"],
];
/** 코치 13단계 계획: n번째 단계가 지금. */
export function coachPlanAt(n: number): PlanView {
  return {
    ...planAt(1), id: "coach", revision: n, goal: COACH.action, judgment: COACH.reasoning, dryRun: true,
    steps: COACH_STEPS.map(([kind, label], i) => ({ id: `coach:${i + 1}`, kind, label, status: i + 1 < n ? "done" : i + 1 === n ? "active" : "pending" })),
  };
}
/** 코치 계획의 말풍선 카드 말(src/act/labels.ts SAY_TEXT): 다시 알린 뒤, 조용한 단계, 끄기 안내. */
export const COACH_SAY = { retold: "다시 알려 줬어요.", quiet: "냄비 꺼내기를 지켜보고 있어요.", offAsked: "불을 꺼 달라고 했어요." };

/** 「그대로 두기」를 고른 뒤 말풍선 카드 말(src/act/labels.ts SAY_TEXT.left). */
export const LEFT_SAY = "컵을 그대로 두기로 했어요.";
const BRANCH_TASKS = ["컵 치우기", "사용자에게 물어보기", "세탁물 건조기로 옮기기", "에어컨 켜기", "컵 그대로 두기", "컵에 물 채워 주기", "컵에 콜라 따라 주기", "라면 끓이기 알려 주기"];

/** 판단 방송 한 줄. b가 null이면 대기(-1). */
export function branchDecision(b: Branch | null, seq: number): ServerMessage {
  return {
    type: "brain",
    event: {
      type: "decision", at_ms: 1_794_214_804_000 + seq * 5000, id: `pam-${seq}`, seq, text_sent: "관찰", status: "valid",
      prediction: { observation: "관찰", reasoning: b?.reasoning ?? "할 일이 없어요.", task_index: b ? BRANCH_TASKS.indexOf(b.action) : -1 },
      action: b?.action ?? null, fsm: b ? { state: b.state, trigger: b.trigger, learned: false, matched: true } : { state: "drinking", trigger: null, learned: false, matched: false },
      assist: b ? (taskOf(b.action)?.coach ? "coach" : "noonchi") : null, memory_version: 1,
      world: { objects: [], person_visible: false, vlm_missing: 0, yolo_missing: 0 },
    },
  };
}

/** 트윈 칸 지도 자리에 넣는 그림(캔버스). */
export const MAP = createElement("canvas", { "data-fixture-map": "" });

/** n번째 순간의 화면 자료(0 지켜보기, 1~4 계획 단계). */
export function screenAt(n: number, over: Partial<ScreenProps> = {}): ScreenProps {
  const plan = n > 0 ? planAt(n) : null;
  return {
    index: n, plan, step: plan ? plan.steps[n - 1]! : null, robotKnown: true, connected: true, map: MAP, mapReady: true,
    phone: imageSlot(), seen: seenOf([BOX]),
    talk: n > 0 ? TALK : WATCH_TALK, facing: n > 0 ? "twin" : "video", hub: HUB,
    ...over,
  };
}
