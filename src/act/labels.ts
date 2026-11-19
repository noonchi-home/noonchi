// 서버가 만들어 화면에 그대로 나가는 글. npm run lint가 이 파일도 검사한다(60자 아래, 화살표·괄호 없음).
import { josa } from "../shared/korean.js";
import type { CloserMiss, TopDrop } from "../contract/events.js";
import { KINDS, KIND_ORDER } from "../devices/kinds.js";
import { OBJECT_NAME } from "../world/labels.js";
import { TASK_SAY } from "./tasks.js";

export const STEP_LABEL = {
  goTable: "식탁으로 가기", pickCup: "컵 집기", goSink: "싱크대로 가기", placeCup: "컵 내려놓기",
  askUser: "폰으로 물어보기", device: (device: string, verb: string) => `${device} ${verb}`.trim(),
};

/** 실제 폰 위에 보내는 단계 명령(src/act/track/steps.ts). 열쇠는 STEP_LABEL과 같다. 사람에게 하는 말이고, 클로이드가 스스로 하는 말로 쓰지 않는다. */
export const STEP_COMMAND = {
  goTable: "식탁으로 가 주세요", pickCup: "컵을 들어 주세요", goSink: "싱크대로 가 주세요", placeCup: "컵을 싱크대에 넣어 주세요",
} as const;

/** 실제 폰 「완료」 바로 위 비전 상태 한 줄: 이동은 남은 거리, 집기·내려놓기는 World State의 컵 자리. */
export const VISION_TEXT = {
  table: "식탁", sink: "싱크대", cup: "컵", unseen: "안 보임",
  /** 부를 이름을 모르면(null) 거리만 쓴다(id는 화면에 내지 않는다). */
  distance: (place: string | null, m: number | null) => (place === null ? (m === null ? "거리 모름" : `${m.toFixed(1)}m 남음`) : m === null ? `${place}까지 거리 모름` : `${place}까지 ${m.toFixed(1)}m`),
  /** 관찰 모드에 주는 변화 줄: 폰이 지금 단계 자리를 떠나 다른 자리 가까이로 감. */
  movedNear: (place: string) => `폰이 ${place} 가까이로 감`,
};

/** 가전 이름을 하나도 못 찾았을 때 묻는 글·끄기 안내에 쓰는 말(src/act/track/core.ts handLabel). */
export const DEVICE_UNKNOWN = "가전";

export const GOAL = { clearCup: "컵 치우기", askUser: "사용자에게 물어보기" };

/** 실제 폰 명령(사람에게 「~주세요」)의 끝 → 대시보드 메시지 상자의 클로이드 말(「~ㄹ게요」). 긴 끝부터 본다. */
const WILL_END: readonly [string, string][] = [
  ["꺼내 주세요", "꺼낼게요"], ["들어 주세요", "들게요"], ["내려 주세요", "내릴게요"], ["넣어 주세요", "넣을게요"], ["올려 주세요", "올릴게요"],
  ["놓아 주세요", "놓을게요"], ["따라 주세요", "따를게요"], ["받아 주세요", "받을게요"], ["저어 주세요", "저을게요"], ["열어 주세요", "열게요"],
  ["닫아 주세요", "닫을게요"], ["켜 주세요", "켤게요"], ["꺼 주세요", "끌게요"], ["가 주세요", "갈게요"],
];

/** 대시보드 말풍선 말 한 문장(src/act/say.ts): 클로이드가 정한 것과 하는 일을 클로이드가 직접 하는 말로 쓴다(「컵을 치울게요」·「식탁으로 갈게요」).
 *  실제 폰 명령(STEP_COMMAND·STEP_TEXT)만 사람에게 「~주세요」다(2026-11-18 사용자 바로잡음). */
export const SAY_TEXT = {
  watching: "지켜보고 있어요.",
  /** 사람 자세가 쓰러짐 의심(src/world/fall.ts)인 동안: 다른 글보다 먼저. */
  fall: "사람이 쓰러진 것 같아요.",
  /** 반성 뒤: 새로 배운 습관 수, 새로 배운 것이 없으면 쓰고 있는 습관 수. */
  learned: (n: number) => `어제 기록으로 새 습관 ${n}개를 배웠어요.`,
  using: (n: number) => `배운 습관 ${n}개를 쓰고 있어요.`,
  looking: (surface: string) => `${josa(surface, "을/를")} 보고 있어요.`,
  closer: (place: string) => `${josa(place, "을/를")} 가까이 보고 있어요.`,
  decided: (goal: string, surface: string | null = null) =>
    goal === GOAL.clearCup && surface ? `${surface} 컵을 치울게요.` : `${TASK_SAY[goal]?.will ?? `${josa(goal, "을/를")} 할게요`}.`,
  /** 실제 폰에 낸 사람 단계 명령 → 클로이드 말(「컵을 들어 주세요」 → 「컵을 들게요.」). 끝을 모르면 단계 이름으로 「<이름>을 할게요.」. */
  will: (command: string, label: string) => {
    const hit = WILL_END.find(([end]) => command.endsWith(end));
    return hit ? `${command.replace(new RegExp(`${hit[0]}$`), hit[1])}.` : `${josa(label, "을/를")} 할게요.`;
  },
  said: "폰으로 알렸어요.",
  /** 컵 안 보기 단계(위에서 비추기 명령)를 띄운 동안. */
  lookIn: (item: string) => `${item} 안을 볼게요.`,
  waiting: (label: string) => `${josa(label, "을/를")} 기다리고 있어요.`,
  device: (label: string) => `${josa(label, "을/를")} 하고 있어요.`,
  asked: "폰으로 물어봤어요.",
  /** 코치 계획: 다시 알린 뒤, 조용한 단계(소리로 읽지 않고 지켜봄), 켠 채 닫힌 계획의 끄기 안내가 떠 있는 동안. */
  retold: "다시 알려 줬어요.",
  quiet: (label: string) => `${josa(label, "을/를")} 지켜보고 있어요.`,
  offAsked: "불을 끌게요.",
  /** 끄기 안내가 남아 새 계획 시작을 미루는 동안(그 가전 이름). */
  offWait: (device: string) => `${device} 꺼짐을 기다리고 있어요.`,
  /** 다른 계획이 도는 동안 닫힌 계획의 가전이 다시 켜져 끄기 안내가 줄에서 기다릴 때(20초). */
  rearmed: (device: string) => `${josa(device, "이/가")} 다시 켜졌어요.`,
  done: (goal: string) => DONE[goal] ?? `${josa(goal, "을/를")} 마쳤어요.`,
  stopped: (goal: string) => `${josa(goal, "을/를")} 그만뒀어요.`,
};
const DONE: Record<string, string> = { [GOAL.clearCup]: "컵을 다 치웠어요." };

/** 기기를 바꾸는 에이전트 도구 → 단계 글 끝말. 여기 없는 도구(읽기·배치)는 계획을 만들지 않는다. */
export const DEVICE_VERB: Record<string, string> = {
  turn_on: "켜기", turn_off: "끄기", set_level: "맞추기", set_climate: "맞추기", set_covering: "맞추기",
  lock: "잠그기", unlock: "잠금 풀기", start: "시작", stop: "멈추기", set_valve: "맞추기",
};

/** 실행 전 검사를 통과하지 못한 이유(src/act/check.ts). */
export const CHECK_TEXT = {
  unknown_task: "행동 목록에 없는 행동이라 실행하지 않아요",
  no_target: "대상 물건이 보이지 않아 실행하지 않아요",
  in_sink: "대상 물건이 이미 싱크대 안이라 실행하지 않아요",
  stale: "판단 뒤에 대상을 다시 확인하지 못했어요",
  in_hand: "사람이 그 물건을 쓰는 중이라 실행하지 않아요",
  unreachable: "갈 수 있는 길이 없어 실행하지 않아요",
  device_mode: "시험 모드라 실제 가전은 부르지 않아요",
  unknown_contents: "대상 물건 안을 몰라 실행하지 않아요",
  kept: "그대로 두기로 한 물건이라 실행하지 않아요",
  contents_mismatch: "대상 물건 안이 맞지 않아 실행하지 않아요",
} as const;

/** 가까이 가서 보기(src/act/track/contents.ts): 컵 안을 모를 때 폰을 든 사람에게 하는 명령(「주세요」로 끝남). 사용자에게 묻지 않는다. */
export const PEEK_TEXT = {
  go: (item: string) => `${item} 가까이 가 주세요`,
  above: (item: string) => `${item} 안이 보이게 위에서 비춰 주세요`,
} as const;

/** 컵 안 보기 단계(src/act/track/steps.ts topStep): 단계 이름과 남은 음료 질문. 명령 글은 가까이 가서 보기의 위에서 비추기와 같다(PEEK_TEXT.above). */
export const TOP_TEXT = {
  label: (item: string) => `${item} 안 보기`,
  ask: "남은 음료를 버리고 치울까요?",
} as const;

/** 찾기(src/act/track/find.ts): 대상이 안 보일 때 마지막으로 본 자리로 폰을 든 사람을 보내는 명령(「주세요」로 끝남). 면이 있으면 가기는 계획의 가기 글(STEP_TEXT go:가기)을 쓴다. */
export const FIND_TEXT = {
  goSpot: (item: string) => `${item} 있던 곳으로 가 주세요`,
  aim: (place: string) => `${place} 위를 비춰 주세요`,
  aimSpot: (item: string) => `${item} 있던 곳을 비춰 주세요`,
} as const;

/** 찾기의 생각 말풍선 상태 줄(src/act/track/find.ts → src/brain/thought.ts note): 해요체 한 문장, 끝에 마침표 없음. place는 면 이름(없으면 그 물건 있던 곳). */
export const FIND_THOUGHT = {
  start: (item: string, place: string | null) => `${josa(item, "이/가")} 안 보여서 ${place ? `${place} 쪽` : `${item} 있던 곳`}을 다시 볼게요`,
  found: (item: string) => `${josa(item, "을/를")} 찾았어요`,
  lost: (item: string) => `${josa(item, "을/를")} 못 찾았어요`,
} as const;

/** 쓰는 중 지킴(src/act/track/use.ts): 사람이 손대는 행동의 대상을 쓰는 것을 볼 때 생각 말풍선에 올리는 상태 줄(활동 이름·물건 이름). */
export const USE_THOUGHT = {
  act: (label: string) => `사람이 ${label}이라 지켜볼게요`,
  holding: (item: string) => `사람이 ${josa(item, "을/를")} 들고 있어서 지켜볼게요`,
  using: (item: string) => `사람이 ${josa(item, "을/를")} 쓰는 중이라 지켜볼게요`,
} as const;

/** 미리 세운 목표(src/act/track/goal.ts): 메시지 상자 줄(클로이드가 하는 말, 「<규칙 조건> <행동 말>」, 조건은 src/world/labels.ts ruleIf·행동 말은 src/act/tasks.ts TASK_SAY). */
export const GOAL_TEXT = {
  armed: (cond: string, will: string) => `${cond} ${will}`,
} as const;

/** 미리 세운 목표 기록 줄(기록 DB goal, 영상 판정 시각표 「목표」 줄): 세움·미리 만들기·사람 떠남·씀·버림과 그 까닭. */
export const GOAL_LOG = {
  armed: (action: string) => `세움 · ${action}`,
  planning: "계획 미리 만드는 중", ready: "계획 준비됨", failed: "계획 못 만듦", fired: "사람 떠남 · 판단 부름", used: "준비한 계획으로 시작",
  dropped: (why: string) => `버림 · ${why}`,
  /** 까닭 글이 있는 미리 만들기 실패와, 준비한 계획을 버리고 계획 모드로 넘어감. */
  failedWhy: (why: string) => `계획 못 만듦 · ${why}`,
  dropPlan: (why: string) => `준비한 계획 버림 · ${why}`,
  why: {
    took: "들고 나감", back: "다시 나타남", moved: "컵이 옮겨지거나 사라짐", replaced: "다른 일이 맡음", safety: "안전 알림", mode: "코치 모드", dock: "충전 자리로 가는 중",
    expired: "30분 지남", pam: "PAM이 고르지 않음", stale: "준비한 계획이 지금과 안 맞음", stop: "그만",
  },
  /** 계획 검사 글이 없는 까닭: 받은 계획이 목표 물건이 아닌 같은 종류 물건을 다룸, 목표 물건이 미리 만든 때와 다른 면에 있음, 미리 만든 계획이 없음. */
  error: { notMine: "목표 물건이 아닌 물건을 다루는 계획", surface: "목표 물건이 다른 면으로 옮겨짐", none: "미리 만든 계획 없음" },
  /** 서버 로그 줄(src/act/track/start.ts 「계획 버림」 줄과 같은 꼴). */
  log: {
    failed: (id: string, action: string, why: string) => `[실행 추적] ${id} 계획 못 만듦(${action}): ${why}`,
    dropPlan: (id: string, action: string, why: string) => `[실행 추적] ${id} 준비한 계획 버림(${action}): ${why}`,
  },
} as const;

/** 승인(src/act/track/approval.ts): 처음 하는 계획을 실제 폰에 묻는 글, 「거절」을 받은 계획의 실행 기록. */
export const APPROVAL_TEXT = {
  ask: (task: string) => `${josa(task, "을/를")} 할까요?`,
  refused: "사용자가 거절한 일",
};

/** 사람 단계 동작(act): 단계 종류마다 고를 수 있는 것. 모델은 동작·대상·물건(item)만 고르고, 단계 이름과 폰 명령은 아래 글 틀로 서버가 만든다
 *  (src/agent/planTools.ts). 모델이 쓴 문장은 폰으로 나가지 않는다. */
export const STEP_ACTS = {
  go: ["가기"],
  pick: ["들기", "꺼내기", "내리기"],
  place: ["넣기", "올리기", "놓기"],
  do: ["따르기", "물 받기", "넣기", "젓기", "열기", "닫기", "켜기", "끄기"],
} as const;
export type StepAct = (typeof STEP_ACTS)[keyof typeof STEP_ACTS][number];
/** 모든 동작(중복 없이, 도구 칸 enum). */
export const ALL_ACTS = [...new Set(Object.values(STEP_ACTS).flat())] as [StepAct, ...StepAct[]];

/** 시나리오에 쓰는 물건 이름(낱말 표 물건 이름 밖). 모델이 item으로 고를 수 있는 이름은 낱말 표 물건 이름과 이것이다. */
export const EXTRA_ITEMS = ["면과 스프", "물", "물병", "콜라", "세탁물"] as const;
/** 시나리오 물건 이름이 가리키는 World State 물건 종류(보이는 병을 「물병」으로 불러도 같은 물건이다). 여기 없는 이름은 그 종류 이름과 같아야 한다. */
export const ITEM_CLASS: Partial<Record<string, string>> = { "물병": "bottle", "콜라": "bottle", "면과 스프": "ramen" };

/** 사람 단계 글 틀(단계 종류:동작). place는 자리·대상 이름, item은 물건 이름(없으면 null). 물건이 꼭 있어야 하는 틀은 item이 없으면 null을 낸다. */
export const STEP_TEXT: Record<string, (o: { place: string; item: string | null }) => { label: string; command: string } | null> = {
  "go:가기": ({ place }) => ({ label: `${josa(place, "으로/로")} 가기`, command: `${josa(place, "으로/로")} 가 주세요` }),
  "pick:들기": ({ item }) => (item ? { label: `${item} 집기`, command: `${josa(item, "을/를")} 들어 주세요` } : null),
  "pick:꺼내기": ({ item }) => (item ? { label: `${item} 꺼내기`, command: `${josa(item, "을/를")} 꺼내 주세요` } : null),
  "pick:내리기": ({ place, item }) => (item ? { label: `${item} 내리기`, command: `${josa(item, "을/를")} ${place}에서 내려 주세요` } : null),
  "place:넣기": ({ place, item }) => (item ? { label: `${item} 내려놓기`, command: `${josa(item, "을/를")} ${place}에 넣어 주세요` } : null),
  "place:올리기": ({ place, item }) => (item ? { label: `${item} 올리기`, command: `${josa(item, "을/를")} ${place}에 올려 주세요` } : null),
  "place:놓기": ({ place, item }) => (item ? { label: `${item} 내려놓기`, command: `${josa(item, "을/를")} ${place}에 놓아 주세요` } : null),
  "do:따르기": ({ place, item }) => (item ? { label: `${place}에 ${item} 따르기`, command: `${place}에 ${josa(item, "을/를")} 따라 주세요` } : null),
  "do:물 받기": ({ item }) => ({ label: "물 받기", command: item ? `${item}에 물을 받아 주세요` : "물을 받아 주세요" }),
  "do:넣기": ({ item }) => (item ? { label: `${item} 넣기`, command: `${josa(item, "을/를")} 넣어 주세요` } : null),
  "do:젓기": ({ item }) => (item ? { label: `${item} 젓기`, command: `${josa(item, "을/를")} 저어 주세요` } : null),
  "do:열기": ({ place }) => ({ label: `${place} 문 열기`, command: `${place} 문을 열어 주세요` }),
  "do:닫기": ({ place }) => ({ label: `${place} 문 닫기`, command: `${place} 문을 닫아 주세요` }),
  "do:켜기": ({ place }) => ({ label: `${place} 켜기`, command: `${josa(place, "을/를")} 켜 주세요` }),
  "do:끄기": ({ place }) => ({ label: `${place} 끄기`, command: `${josa(place, "을/를")} 꺼 주세요` }),
};

/** 알림(say)·기다리기(wait) 닫힌 목록(notice): 모델은 열쇠만 고르고 글은 서버가 정한다. say는 폰이 읽을 한 줄, wait는 화면 단계 이름(시간 초과 질문에도 쓴다).
 *  끝 알림은 item(물건 이름)이 있으면 그 이름을 넣는다. 기다리기가 없는 열쇠(끝)는 wait에 쓰지 않는다. */
export const NOTICES: Record<string, { say: (item: string | null) => string; wait: string | null }> = {
  "물 끓기": { say: () => "물이 끓을 때까지 기다려요.", wait: "물 끓기 기다리기" },
  "익기": { say: () => "익을 때까지 기다려요.", wait: "익기 기다리기" },
  "다 되기": { say: () => "다 될 때까지 기다려요.", wait: "다 되기 기다리기" },
  "세탁": { say: () => "세탁이 끝났어요.", wait: "세탁 멈춤" },
  "끝": { say: (item) => (item ? `${josa(item, "이/가")} 다 됐어요.` : "다 됐어요."), wait: null },
};
export const NOTICE_KEYS = Object.keys(NOTICES) as [string, ...string[]];
/** 알림 단계 이름. */
export const noticeLabel = (key: string) => `${key} 알림`;

/** 관찰 모드의 다시 알리기 글(src/act/track/coach.ts tell). 모델은 방식만 고르고 글은 지금 명령으로 만든다: repeat 그대로, earlier 「먼저」를 붙여 지금 할 일부터 하라는 말. */
export const TELL_TEXT = {
  repeat: (command: string) => command,
  earlier: (command: string) => `먼저 ${command}`,
};
export type TellMode = keyof typeof TELL_TEXT;
/** 관찰 모드의 사람 부탁 글(src/act/track/coach.ts askCloser): 가까이 볼 곳 이름으로 그 곳이 보이게 폰을 가까이 대 달라고 한다. */
export const CLOSER_TEXT = (place: string) => `${josa(place, "이/가")} 보이게 폰을 가까이 대 주세요`;

/** 위험 가전을 켜는 단계에서 켜기 전 질문 앞에 읽는 안전 한 줄(가전 종류마다, 서버 글, 등록부 riskyOn.caution). 열쇠는 가전 종류다. */
export const CAUTION_LINE: Record<string, string> = Object.fromEntries(KIND_ORDER.flatMap((k) => { const r = KINDS[k].riskyOn; return r ? [[k, r.caution]] : []; }));

/** 손으로 켜는 위험 가전(src/act/track/approval.ts·safety.ts): 켜기 전에 안전 문구와 함께 묻는 글, 켠 채 계획이 닫혔을 때 끄라고 알리는 명령. */
/** 판본이 다른(옛) 폰 탭에 보내는 명령 줄 글(src/phone/server.ts). 옛 탭도 그리는 보통 명령으로 간다. */
export const REFRESH_TEXT = "화면을 새로 고쳐 주세요";

export const CAUTION_TEXT = {
  ask: (caution: string, label: string) => `${caution} ${josa(label, "을/를")} 켤까요?`.trim(),
  off: (label: string) => `${josa(label, "을/를")} 꺼 주세요`,
  /** 다른 계획이 도는 동안 닫힌 계획의 가전이 다시 켜졌을 때 폰에 소리로만 알리는 글(명령 줄은 그 계획 것 그대로). */
  rearmed: (label: string) => `${josa(label, "이/가")} 다시 켜졌어요. 꺼 주세요`,
};

/** 시간 안에 끝나지 않은 단계를 실제 폰에 다시 묻는 글(src/act/track/steps.ts timeout, 답은 계속·그만). */
export const AGAIN_TEXT = { ask: (label: string) => `${josa(label, "을/를")} 계속할까요?` };

/** 비전 상태 줄에 쓰는 평면도 물건 짧은 이름(낱말 표에 없는 종류). 낱말 표 종류(식탁 등)는 그 글을 쓰고(placeShort), 둘 다 없으면 배치 이름을 쓴다. */
export const PLACE_SHORT: Record<string, string> = {
  sink_counter: "싱크대", utility_sink: "싱크대", induction_counter: "인덕션", kitchen_cabinet: "수납장", counter: "조리대", washer: "세탁기", dryer: "건조기",
  fridge: "냉장고", kimchi_fridge: "김치냉장고", dishwasher: "식기세척기", sofa: "소파", desk: "책상", coffee_table: "탁자",
  bed_queen: "침대", bed_single: "침대", stand_ac: "에어컨", wall_ac: "에어컨",
};

/** 평면도 물건 종류의 짧은 이름. 없으면 undefined. */
export const placeShort = (type: string): string | undefined => PLACE_SHORT[type] ?? OBJECT_NAME[type];

/** 실행 추적 글(src/act/track/): 단계 이름과 끝난 까닭. */
export const EXEC_TEXT = {
  decided: "판단", planned: "계획", running: "실행 중", verifying: "결과 확인", done: "완료", failed: "실패",
  wait: "대기", decisionFailed: "판단 실패", superseded: "새 판단으로 바뀜", noPlan: "계획을 만들 수 없음", stopped: "사용자가 그만둠",
  timeout: "단계가 시간 안에 끝나지 않음", noAnswer: "답을 받지 못함", same: "같은 행동을 진행 중", late: "앞선 판단이라 쓰지 않음", spoken: "사람이 말로 부탁함",
  answered: (label: string) => `완료: ${label}`,
  badPlan: "계획이 맞지 않아 버림", held: "방금 계획한 일이라 잠시 뒤 다시 봄", deviceFailed: "가전 명령이 실패함",
  deviceUnverified: "가전 명령 결과를 확인하지 못함", busy: "할 일 중 기다리는 동안이라 쓰지 않음",
  closerNewer: "가까이 본 뒤 다시 판단",
  kept: "그대로 두기로 함", topUnknown: "위에서 봐도 컵 안을 몰라 그만둠",
  /** 켠 위험 가전 끄기 안내가 남아 새 계획 시작을 미룸(그 가전 이름). */
  deferred: (device: string) => `${device} 꺼짐 확인 전이라 새 일을 미룸`,
  /** 판본이 맞는 실제 폰이 없어 폰이 필요한 계획 시작을 미룸. 계획 도중 폰이 없어 물을 수 없어 닫음. 말할 때와 다른 명령에 온 말 답을 버림. */
  phoneOld: "폰 화면 새로 고침 전이라 새 일을 미룸",
  phoneGone: "폰이 없어 물을 수 없어 그만둠",
  staleAnswer: "늦은 답이라 쓰지 않음",
  /** 내용물 보류에서 풀렸지만 폰 대화·승인 대기로 첫 명령을 holdMs 넘게 미뤄 닫음. */
  phoneBusy: "폰을 쓰는 중이라 실행하지 않아요",
  /** 찾기(src/act/track/find.ts): 대상이 안 보여 마지막 자리로 찾으러 감, 찾는 동안 받은 같은 행동 판단, 실행 전 찾기에서 다른 물건을 찾아 계획을 닫음. */
  finding: (item: string) => `${josa(item, "을/를")} 찾으러 가요`,
  findingSame: (item: string) => `${josa(item, "을/를")} 찾는 중이에요`,
  foundNew: "찾은 뒤 다시 판단",
  /** 쓰는 중 지킴(src/act/track/use.ts): 사람이 계획 대상을 쓰는 중이라 첫 명령을 미룸, holdMs 넘게 이어져 닫음. */
  inUse: "사람이 쓰는 중이라 기다려요",
  inUseLong: "사람이 쓰는 중이라 실행하지 않아요",
  /** 손대는 단계(집기·내려놓기·들고 가기) 중 받은 다른 행동 판단: 계획을 바꾸지 않는다(src/act/track/start.ts). */
  handling: "물건을 다루는 중이라 새 판단을 미룸",
  /** 충전 자리 돌아가기(src/act/track/dock.ts): 계획이 끝난 뒤 사용자 위치 확인·충전 자리로 가는 동안 받은 행동 판단. */
  docking: "충전 자리로 가는 중이라 새 일을 미룸",
  /** 미리 세운 목표(src/act/track/goal.ts)와 같은 행동을 사람이 떠나기 전에 고른 판단: 목표가 맡는다(사람이 떠나면 판단을 다시 부른다). */
  goalWait: "다 쓰고 떠나면 할 일로 두었어요",
  beforeLeave: "사람이 떠나기 전 판단이라 쓰지 않음",
  goalSafety: "안전 알림이 있어 시작하지 않아요",
} as const;

/** 충전 자리 돌아가기(src/act/track/dock.ts): 실제 폰 명령(사람에게 「주세요」), 대상·비전 이름, 메시지 상자 줄(클로이드가 직접 하는 말). */
export const DOCK_TEXT = {
  command: "충전 자리로 가 주세요",
  label: "충전 자리",
  userHere: (room: string) => `사용자는 ${room}에 계세요`,
  userLast: (room: string) => `사용자를 마지막으로 ${room}에서 봤어요`,
  userUnknown: "사용자가 어디 계신지 몰라요",
  going: "충전 자리로 갈게요",
  docked: "충전 자리에서 지켜볼게요",
  gaveUp: "충전 자리로 가지 못했어요",
} as const;

/** 관찰 모드 기록 글(src/act/look.ts, 기록 종류 look). 가까이 본 결과, 못 본 까닭, 사람 부탁, 기다리기. capped·failed는 모델 대신 쓰는 까닭 글이다. */
export const LOOK_TEXT = {
  closer: (place: string, seen: string) => `${place} 쪽을 가까이 봄 · ${seen}`,
  seen: (names: readonly string[]) => (names.length ? `${[...new Set(names)].join("·")} 보임` : "찾은 것 없음"),
  // 열쇠는 가까이 보기 결과(CloserMiss)다. "closed"는 관찰 흐름이 닫힘이라 낱말 표 값(닫힘)과 다르고, 낱말 목록 검사(tests/world-vocab.test.ts)와 헷갈리지 않게 따옴표로 쓴다
  miss: {
    no_fresh_frames: "새 사진이 모자라 못 봄", vlm_busy: "VLM 자리가 없어 못 봄", no_view: "카메라를 맞추기 전이라 못 봄", out_of_view: "사진 밖이라 못 봄",
    no_detector: "감지기가 없어 못 봄", aborted: "단계가 바뀌어 그만 봄", "closed": "멈춰서 못 봄", error: "감지 오류로 못 봄",
    world_timeout: "집 상태 답이 늦어 못 봄",
  } satisfies Record<CloserMiss, string>,
  vlmMissing: "VLM 답 없음",
  /** 위에서 보기(내용물 보류의 가까이 가서 보기): 기록 까닭과 넣지 않은 장의 까닭. */
  above: (item: string) => `${item} 안을 위에서 봄`,
  topDrop: {
    moved: "옮겨져 넣지 않음", vlm_missing: "VLM 답 없음", not_visible: "컵이 안 보여 버림", no_contents: "안이 안 보여 버림",
    no_vessel: "그릇 감지가 없어 버림", crowded: "같은 종류가 가까이 있어 버림",
  } satisfies Record<TopDrop, string>,
  vlmAborted: "단계가 끝나 VLM 답은 넣지 않음",
  vlmStale: "새 사진이 끊겨 VLM 답은 넣지 않음",
  notSent: "단계가 바뀌어 부탁하지 않음",
  /** 코치 계획: 지금 할 일을 다시 알림, 들은 말을 말 요청 에이전트로 넘김. */
  told: (text: string) => `다시 알림 · ${text}`,
  passed: "말 요청으로 넘김",
  waited: (place: string | null) => (place ? `${place} 쪽은 기다림` : "기다림"),
  capped: "한 시간 관찰 횟수를 다 써서 부르지 않음",
  /** 내용물 보류의 가까이 보기 까닭(관찰 모드를 부르지 않는다). */
  held: (place: string) => `${place} 안을 몰라 가까이 봄`,
  /** 찾기의 다시 가까이 보기 까닭(src/act/track/find.ts). */
  find: (place: string) => `${place} 쪽에서 대상을 찾으려고 가까이 봄`,
  failed: (why: string) => `관찰 모드 호출 실패: ${why}`,
};
