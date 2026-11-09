// 실제 폰 화면 상태 예시: 화면 시험(ui/tests/phone-screen.test.tsx)과 화면 사진 페이지(shots.tsx)가 함께 쓴다.
// 명령·비전 상태·질문·승인 글은 서버 글(src/plan/labels.ts STEP_COMMAND·VISION_TEXT·APPROVAL_TEXT, src/act/prompts.ts) 그대로다. marks는 명령 대상(command.target) 고리 하나다.
// 모든 상태를 세로(390×844·412×915·360×780)로 찍고, 가로는 pick-cup(844×390)과 intro(844×390·780×360)를 찍어 본다.
import { APPROVE, ASK_PROMPT, STEP_DONE } from "../../../src/act/prompts.ts";
import { APPROVAL_TEXT, STEP_COMMAND, VISION_TEXT } from "../../../src/plan/labels.ts";
import { initialView, type Anchor, type Command, type FocusMark, type PhoneView } from "./state";

export const SHOT_NAMES = [
  "intro", "go-table", "pick-cup", "low-cup", "go-sink", "put-cup", "idle", "weak", "align", "mic", "offline", "settings", "no-camera", "anchors", "place", "question", "approve",
  "approve-task",
] as const;
export type ShotName = (typeof SHOT_NAMES)[number];
export interface Shot { view: PhoneView; marks: FocusMark[] }

const anchors: Anchor[] = [
  { id: "A", label: "거실 창 오른쪽 벽", recorded: true },
  { id: "B", label: "반대편 벽", recorded: false },
];
const intro: PhoneView = { ...initialView(), support: { kind: "ready" }, mode: "touch", anchors };
const live: PhoneView = {
  ...intro, ar: true, connected: true, listening: "on", aligned: true, mismatchM: 0.06, anchors: anchors.map((a) => ({ ...a, recorded: true })),
};
const notAligned: Partial<PhoneView> = { aligned: false, mismatchM: null, anchors };
const done = [{ id: STEP_DONE.id, label: STEP_DONE.label }];
const step = (k: number, text: string, vision: string, target: string): Command => ({ id: "plan:pam-1", step: `plan:pam-1:${k}`, text, vision, choices: done, target });
const cup = `${VISION_TEXT.cup} · 손에 있음`;
const pickCup = step(2, STEP_COMMAND.pickCup, `${VISION_TEXT.cup} · 식탁 위`, "cup");
const ring = (id: string, label: string, u: number, v: number): FocusMark => ({ id, label, u, v, off: false, angle: 0 });
const answers = (ids: string[]) => APPROVE.filter((c) => ids.includes(c.id)).map(({ id, label }) => ({ id, label }));

export const SHOTS: Record<ShotName, Shot> = {
  intro: { view: intro, marks: [] },
  "go-table": { view: { ...live, command: step(1, STEP_COMMAND.goTable, VISION_TEXT.distance(VISION_TEXT.table, 6.1), "table") }, marks: [ring("table", "식탁", 0.44, 0.6)] },
  "pick-cup": { view: { ...live, command: pickCup }, marks: [ring("cup", "컵", 0.5, 0.56)] },
  // 컵이 엄지 자리 카드 밑에 비침: 고리 대신 카드 위에 아래를 가리키는 세모
  "low-cup": { view: { ...live, command: pickCup }, marks: [ring("cup", "컵", 0.5, 0.92)] },
  // 싱크대가 화면 밖(오른쪽): 가장자리 화살표 하나
  "go-sink": {
    view: { ...live, command: step(3, STEP_COMMAND.goSink, `${cup} · ${VISION_TEXT.distance(VISION_TEXT.sink, 2.3)}`, "sink") },
    marks: [{ id: "sink", label: "싱크대", u: 0.96, v: 0.48, off: true, angle: 10 }],
  },
  "put-cup": { view: { ...live, command: step(4, STEP_COMMAND.placeCup, cup, "sink") }, marks: [ring("sink", "싱크대", 0.42, 0.58)] },
  idle: { view: live, marks: [] },
  weak: { view: { ...live, limited: true, command: pickCup }, marks: [ring("cup", "컵", 0.5, 0.56)] },
  align: { view: { ...live, ...notAligned }, marks: [] },
  mic: { view: { ...live, listening: "denied" }, marks: [] },
  offline: { view: { ...live, connected: false, command: pickCup }, marks: [] },
  settings: { view: { ...live, settingsOpen: true }, marks: [] },
  "no-camera": { view: { ...live, settingsOpen: true, cameraOff: true }, marks: [] },
  anchors: { view: { ...live, ...notAligned, setup: "anchors", hit: true }, marks: [] },
  place: { view: { ...live, setup: "place", hit: true }, marks: [] },
  question: {
    view: { ...live, command: { id: "plan:pam-2", step: "plan:pam-2:1", text: ASK_PROMPT.text, vision: null, choices: ASK_PROMPT.choices.map(({ id, label }) => ({ id, label })), target: null } },
    marks: [],
  },
  // 위험 목록 가전 명령: 승인·거절
  approve: { view: { ...live, pending: [{ token: "t1", deviceLabel: "현관문", reason: "현관문 잠금 해제", choices: answers(["approve", "reject"]) }] }, marks: [] },
  // 처음 하는 계획: 첫 단계 전에 묻는다
  "approve-task": {
    view: { ...live, command: { id: "plan:pam-3", step: "plan:pam-3:approve", text: APPROVAL_TEXT.ask("컵 치우기"), vision: null, choices: answers(["approve", "reject"]), target: null } },
    marks: [],
  },
};
