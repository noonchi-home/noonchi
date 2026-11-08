// 실제 폰 화면 상태 예시: 화면 시험(ui/tests/phone-screen.test.tsx)과 화면 사진 페이지(shots.tsx)가 함께 쓴다.
// 부탁 글·선택은 src/act/prompts.ts의 「컵 치우기」와 같다. 마스코트 말풍선 글(brainLine)은 서버가 보내는 판단 글·관찰 모양이다.
// 모든 상태를 세로(390×844·412×915·360×780)로 찍고, 가로 배치는 busy 하나를 844×390으로 찍어 본다.
import { initialView, statusLine, type Anchor, type FocusMark, type PhoneView } from "./state";

export const SHOT_NAMES = ["intro", "camera", "overlay", "menu", "request", "busy", "busy-anchors", "talk", "listening", "error"] as const;
export type ShotName = (typeof SHOT_NAMES)[number];
export interface Shot { view: PhoneView; draw: { hit: boolean; marks: FocusMark[] } }

const anchors: Anchor[] = [
  { id: "A", label: "거실 창 오른쪽 벽", recorded: true },
  { id: "B", label: "반대편 벽", recorded: false },
];
const intro: PhoneView = { ...initialView(true), support: { kind: "ready" }, mode: "touch", anchors };
const camera: PhoneView = {
  ...intro, ar: true, fps: "11.5 fps",
  status: statusLine({ aligned: false, mode: "touch", mismatchM: null, limited: false, anchorCount: "1/2", note: null }),
};
const aligned: PhoneView = {
  ...camera, aligned: true, anchors: anchors.map((a) => ({ ...a, recorded: true })),
  status: statusLine({ aligned: true, mode: "touch", mismatchM: 0.06, limited: false, anchorCount: "2/2", note: null }),
};
const none = { hit: false, marks: [] as FocusMark[] };
const cup: FocusMark = { id: "cup", label: "컵", u: 0.5, v: 0.42, off: false, angle: 0 };
const cupAction = { id: "a1", text: "식탁 위 컵을 치워 주세요", would: "로봇이 식탁의 컵을 싱크대로 옮긴다", choices: [{ id: "done", label: "치웠어요" }, { id: "later", label: "나중에" }] };
const doorPending = [{ token: "t1", deviceLabel: "현관문", reason: "현관문 잠금 해제" }];

export const SHOTS: Record<ShotName, Shot> = {
  intro: { view: intro, draw: none },
  camera: { view: camera, draw: { hit: true, marks: [] } },
  overlay: {
    view: { ...aligned, brainLine: "식탁 위 컵을 보고 있어요", toast: "A 지점을 기록했어요" },
    draw: { hit: true, marks: [cup, { id: "fridge", label: "냉장고", u: 0.92, v: 0.6, off: true, angle: 15 }] },
  },
  menu: {
    view: {
      ...aligned, menuOpen: true,
      perfDetail: [
        "보낸 화면 11.5 / 목표 12 fps · 장당 18.4KB",
        "readPixels 3.1ms · 인코딩 9.8ms",
        "와이파이 대기 0KB · 크기 360×480",
        "2초간 건너뜀: 인코딩 중 0 · 버퍼 가득 0 · 순서 뒤바뀜 0",
        "표시 영상 꺼짐",
      ].join("\n"),
    },
    draw: none,
  },
  request: {
    view: {
      ...aligned, request: { id: "r1", text: "컵 안을 비춰 주세요" }, action: cupAction,
      brainLine: "사람이 자리를 비웠고 식탁에 컵이 남아 있어서 컵 안이 비었는지 보려고 해요",
    },
    draw: { hit: true, marks: [cup] },
  },
  // 모두 뜬 상태: 판단 줄·알림·사진 요청·승인 대기·행동 부탁(맞춘 뒤)
  busy: {
    view: {
      ...aligned, brainLine: "식탁 위 컵을 보고 있어요", toast: "사진을 위치와 함께 보냈어요",
      request: { id: "r1", text: "컵 안을 비춰 주세요" }, pending: doorPending, action: cupAction,
    },
    draw: { hit: true, marks: [cup] },
  },
  // 맞추기 전에 뜬 상태: 기준점 단추·승인 대기·행동 부탁·판단 줄
  "busy-anchors": {
    view: { ...camera, brainLine: "식탁 위 컵을 보고 있어요", pending: doorPending, action: cupAction },
    draw: { hit: false, marks: [] },
  },
  talk: {
    view: { ...intro, reply: "현관문 잠금 해제는 승인이 필요해요.", pending: [{ token: "t1", deviceLabel: "현관문", reason: "현관문 잠금 해제" }] },
    draw: none,
  },
  listening: { view: { ...intro, listening: "intro", reply: "🎙 TV 켜줘" }, draw: none },
  error: { view: { ...intro, support: { kind: "insecure" }, reply: "마이크 권한이 없어요. 크롬 사이트 설정에서 마이크를 허용해 주세요." }, draw: none },
};
