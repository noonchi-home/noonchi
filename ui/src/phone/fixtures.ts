// 실제 폰 화면 상태 예시: 화면 시험(ui/tests/phone-screen.test.tsx)과 화면 사진 페이지(shots.tsx)가 함께 쓴다.
// 명령·비전 상태·질문·승인 글은 서버 글(src/plan/labels.ts STEP_COMMAND·VISION_TEXT·APPROVAL_TEXT, src/act/prompts.ts) 그대로다. marks는 명령 대상(command.target) 고리 하나다.
// 모든 상태를 세로(390×844·412×915·360×780)와 가로(844×390·780×360)로 찍어 본다.
import { APPROVE, ASK_PROMPT, STEP_DONE } from "../../../src/act/prompts.ts";
import { APPROVAL_TEXT, STEP_COMMAND, VISION_TEXT } from "../../../src/plan/labels.ts";
import { initialView, type Command, type FocusMark, type PhoneView, type SyncView } from "./state";

export const SHOT_NAMES = [
  "intro", "go-table", "pick-cup", "low-cup", "go-sink", "put-cup", "idle", "weak", "no-start", "mic", "offline", "settings", "no-camera", "place", "question", "approve",
  "approve-task", "intro-nostart", "start", "aligning",
] as const;
export type ShotName = (typeof SHOT_NAMES)[number];
export interface Shot { view: PhoneView; marks: FocusMark[] }

// 위치 맞춤: 시작 위치 이름은 목련 트윈에서 설정이 채우는 글(가까운 물건 「… 앞」, 보는 쪽 물건)
const spot = { label: "거실·복도 테이블 앞", facing: "거실·복도 TV수납장" };
const sync = (over: Partial<SyncView> = {}): SyncView => ({ state: "none", source: null, start: spot, started: false, anchors: 0, wallPoints: 0, residualM: null, ...over });
const intro: PhoneView = { ...initialView(), support: { kind: "ready" }, sync: sync() };
/** AR 중, 시작 위치에서 시작해 벽 모양으로 맞춘 상태. */
const live: PhoneView = {
  ...intro, ar: true, connected: true, listening: "on", aligned: true,
  sync: sync({ state: "aligned", source: "walls", started: true, anchors: 2, wallPoints: 84, residualM: 0.03 }),
};
const notAligned: Partial<PhoneView> = { aligned: false, sync: sync() };
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
  // 집에 시작 위치가 없다: 설정 화면에서 정하라는 모달
  "no-start": { view: { ...live, aligned: false, sync: sync({ start: null }) }, marks: [] },
  mic: { view: { ...live, listening: "denied" }, marks: [] },
  offline: { view: { ...live, connected: false, command: pickCup }, marks: [] },
  settings: { view: { ...live, settingsOpen: true }, marks: [] },
  "no-camera": { view: { ...live, settingsOpen: true, cameraOff: true }, marks: [] },
  place: { view: { ...live, setup: "place", hit: true }, marks: [] },
  question: {
    view: { ...live, command: { id: "plan:pam-2", step: "plan:pam-2:1", text: ASK_PROMPT.text, vision: null, choices: ASK_PROMPT.choices.map(({ id, label }) => ({ id, label })), target: null } },
    marks: [],
  },
  // 위험 목록 가전 명령: 승인·거절
  approve: { view: { ...live, pending: [{ token: "t1", deviceLabel: "현관문", reason: "현관문 잠금 해제", choices: answers(["approve", "reject"]) }] }, marks: [] },
  // 시작 위치를 아직 정하지 않은 집의 처음 화면
  "intro-nostart": { view: { ...intro, sync: sync({ start: null }) }, marks: [] },
  // AR을 켜면 시작 위치 맞추기: 그 자리에 서서 그 쪽을 보고 「여기서 시작」
  start: { view: { ...live, ...notAligned, setup: "start", sync: sync() }, marks: [] },
  // 시작 위치로 어림 맞춤, 걸으며 맞추는 중
  aligning: { view: { ...live, ...notAligned, command: pickCup, sync: sync({ state: "estimated", source: "start", started: true }) }, marks: [ring("cup", "컵", 0.5, 0.56)] },
  // 처음 하는 계획: 첫 단계 전에 묻는다
  "approve-task": {
    view: { ...live, command: { id: "plan:pam-3", step: "plan:pam-3:approve", text: APPROVAL_TEXT.ask("컵 치우기"), vision: null, choices: answers(["approve", "reject"]), target: null } },
    marks: [],
  },
};
