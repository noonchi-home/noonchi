// World State 낱말 표: 하나뿐인 원본. 감지기 거름(src/observe/detector.ts), VLM 스키마·프롬프트(src/observe/scene.ts), World State 면(src/world/state/facts.ts),
// 화면·관찰 텍스트 글(src/world/labels.ts), 가전 상태·사건(src/world/relations.ts), 계획 조건(src/world/conditions.ts), 문서(docs/world-vocabulary.md)가 여기서 나온다.
// 손으로 맞춘 다른 목록을 두지 않는다. tests/world-vocab.test.ts가 어긋나면 실패한다. 이 파일은 다른 파일을 import하지 않는다(ui 타입 검사도 읽는다).
// 글(label)은 화면과 PAM 관찰 텍스트에 그대로 나간다: npm run lint가 60자 아래, 화살표·괄호 없음을 본다. 보는 방법·계기 예는 src/world/vocab-doc.ts.

/** object: World State가 id·자리·사실을 쌓는 물건. fixture: 자리가 정해진 가전·설비, 보이는 상태만 방마다 하나. scene: 트윈 배치에 이미 있는 가구라 거른다. */
export type Role = "person" | "object" | "fixture" | "scene";
/** 사실의 면. 면마다 값 하나. */
export type Facet = "place" | "contents" | "body" | "open" | "use" | "screen" | "posture" | "holding" | "activity" | "moment";
/** 사실이 붙는 곳. */
export type Target = "person" | "object" | "fixture";

export interface ClassEntry {
  label: string;
  role: Role;
  /** COCO 80종 번호 → 이름(YOLO26s 감지). 둘 이상이면 같은 종류로 본다. */
  coco: Readonly<Record<number, string>>;
  /** World State가 받는 최소 신뢰도. */
  minScore: number;
  /** 이 종류에 붙는 면. */
  facets: readonly Facet[];
  /** 같은 물체로 볼 거리(m). 없으면 World State 기본값(0.25). */
  identityM?: number;
  /** VLM 종류 기준(프롬프트에 「종류 = 이 글」로 그대로 싣는다). 이 글이 있는 물건이 VLM이 상자로 찾는 물건(VLM_FIND)이다.
   *  행동이 쓰는 종류(src/act/tasks.ts 대상·집는 것·코치 물건)는 모두 있어야 한다(tests/act-tasks.test.ts). */
  vlm?: string;
}

const OBJ = ["place", "use"] as const;
/** 마시는 그릇: 안 내용과 몸통(옆면으로 안이 비치는가)이 있다. */
const VESSEL = ["place", "contents", "body", "use"] as const;

/** 감지 종류. 순서가 감지 결과 순서다(사람 먼저). */
export const CLASSES = {
  person: { label: "사람", role: "person", coco: { 0: "person" }, minScore: 0.5, facets: ["posture", "place", "holding", "activity", "moment"] },
  cup: { label: "컵", role: "object", coco: { 41: "cup", 40: "wine glass" }, minScore: 0.4, facets: VESSEL, vlm: "any drinking vessel you drink from directly: drinking glass (clear or colored), cup, mug, tumbler, wine glass" },
  bottle: { label: "병", role: "object", coco: { 39: "bottle" }, minScore: 0.4, facets: VESSEL, vlm: "only a container with a narrow neck or a cap for pouring, such as a water, wine or soda bottle" },
  bowl: { label: "그릇", role: "object", coco: { 45: "bowl" }, minScore: 0.4, facets: VESSEL, vlm: "a wide, low open dish for food; a drinking glass, cup or mug is never a bowl" },
  fork: { label: "포크", role: "object", coco: { 42: "fork" }, minScore: 0.45, facets: OBJ },
  knife: { label: "칼", role: "object", coco: { 43: "knife" }, minScore: 0.45, facets: OBJ },
  spoon: { label: "숟가락", role: "object", coco: { 44: "spoon" }, minScore: 0.45, facets: OBJ },
  book: { label: "책", role: "object", coco: { 73: "book" }, minScore: 0.4, facets: ["place", "open", "use"] },
  cell_phone: { label: "휴대폰", role: "object", coco: { 67: "cell phone" }, minScore: 0.4, facets: ["place", "screen", "use"] },
  remote: { label: "리모컨", role: "object", coco: { 65: "remote" }, minScore: 0.45, facets: OBJ },
  laptop: { label: "노트북", role: "object", coco: { 63: "laptop" }, minScore: 0.4, facets: ["place", "open", "screen", "use"] },
  scissors: { label: "가위", role: "object", coco: { 76: "scissors" }, minScore: 0.5, facets: OBJ },
  toothbrush: { label: "칫솔", role: "object", coco: { 79: "toothbrush" }, minScore: 0.5, facets: OBJ },
  hair_drier: { label: "드라이어", role: "object", coco: { 78: "hair drier" }, minScore: 0.5, facets: OBJ },
  teddy_bear: { label: "인형", role: "object", coco: { 77: "teddy bear" }, minScore: 0.5, facets: ["place"] },
  backpack: { label: "배낭", role: "object", coco: { 24: "backpack" }, minScore: 0.4, facets: ["place", "open"] },
  handbag: { label: "가방", role: "object", coco: { 26: "handbag" }, minScore: 0.4, facets: ["place", "open"] },
  suitcase: { label: "여행 가방", role: "object", coco: { 28: "suitcase" }, minScore: 0.45, facets: ["place", "open"] },
  umbrella: { label: "우산", role: "object", coco: { 25: "umbrella" }, minScore: 0.4, facets: ["place", "open"] },
  banana: { label: "바나나", role: "object", coco: { 46: "banana" }, minScore: 0.5, facets: ["place"] },
  apple: { label: "사과", role: "object", coco: { 47: "apple" }, minScore: 0.5, facets: ["place"] },
  orange: { label: "오렌지", role: "object", coco: { 49: "orange" }, minScore: 0.5, facets: ["place"] },
  broccoli: { label: "브로콜리", role: "object", coco: { 50: "broccoli" }, minScore: 0.5, facets: ["place"] },
  carrot: { label: "당근", role: "object", coco: { 51: "carrot" }, minScore: 0.5, facets: ["place"] },
  sandwich: { label: "샌드위치", role: "object", coco: { 48: "sandwich" }, minScore: 0.5, facets: ["place"] },
  hot_dog: { label: "핫도그", role: "object", coco: { 52: "hot dog" }, minScore: 0.5, facets: ["place"] },
  pizza: { label: "피자", role: "object", coco: { 53: "pizza" }, minScore: 0.5, facets: ["place"] },
  donut: { label: "도넛", role: "object", coco: { 54: "donut" }, minScore: 0.5, facets: ["place"] },
  cake: { label: "케이크", role: "object", coco: { 55: "cake" }, minScore: 0.5, facets: ["place"] },
  // 코치 물건(라면 끓이기): YOLO 종류가 없어 VLM으로만 찾는다
  pot: { label: "냄비", role: "object", coco: {}, minScore: 0.5, facets: ["place", "open", "use"], vlm: "a cooking pot or saucepan for boiling water or noodles" },
  ramen: { label: "라면", role: "object", coco: {}, minScore: 0.5, facets: ["place", "open"], vlm: "an instant noodle (ramen) packet, opened or not" },
  cat: { label: "고양이", role: "object", coco: { 15: "cat" }, minScore: 0.5, facets: ["place"], identityM: 1.5 },
  dog: { label: "개", role: "object", coco: { 16: "dog" }, minScore: 0.5, facets: ["place"], identityM: 1.5 },
  tv: { label: "TV", role: "fixture", coco: { 62: "tv" }, minScore: 0.5, facets: ["screen"] },
  refrigerator: { label: "냉장고", role: "fixture", coco: { 72: "refrigerator" }, minScore: 0.5, facets: ["open"] },
  microwave: { label: "전자레인지", role: "fixture", coco: { 68: "microwave" }, minScore: 0.5, facets: ["open", "use"] },
  oven: { label: "오븐", role: "fixture", coco: { 69: "oven" }, minScore: 0.5, facets: ["open", "use"] },
  toaster: { label: "토스터", role: "fixture", coco: { 70: "toaster" }, minScore: 0.5, facets: ["use"] },
  sink: { label: "싱크대", role: "fixture", coco: { 71: "sink" }, minScore: 0.5, facets: ["use"] },
  chair: { label: "의자", role: "scene", coco: { 56: "chair" }, minScore: 1, facets: [] },
  couch: { label: "소파", role: "scene", coco: { 57: "couch" }, minScore: 1, facets: [] },
  potted_plant: { label: "화분", role: "scene", coco: { 58: "potted plant" }, minScore: 1, facets: [] },
  bed: { label: "침대", role: "scene", coco: { 59: "bed" }, minScore: 1, facets: [] },
  dining_table: { label: "식탁", role: "scene", coco: { 60: "dining table" }, minScore: 1, facets: [] },
  toilet: { label: "변기", role: "scene", coco: { 61: "toilet" }, minScore: 1, facets: [] },
  mouse: { label: "마우스", role: "scene", coco: { 64: "mouse" }, minScore: 1, facets: [] },
  keyboard: { label: "키보드", role: "scene", coco: { 66: "keyboard" }, minScore: 1, facets: [] },
  clock: { label: "시계", role: "scene", coco: { 74: "clock" }, minScore: 1, facets: [] },
  vase: { label: "꽃병", role: "scene", coco: { 75: "vase" }, minScore: 1, facets: [] },
} as const satisfies Record<string, ClassEntry>;

export type ClassKey = keyof typeof CLASSES;
type RoleOf<R extends Role> = { [K in ClassKey]: (typeof CLASSES)[K]["role"] extends R ? K : never }[ClassKey];
/** World State가 id·자리를 쌓는 물건 종류. */
export type ObjClass = RoleOf<"object">;
/** 방마다 보이는 상태만 두는 가전·설비 종류. */
export type FixtureClass = RoleOf<"fixture">;
/** 감지기가 내는 종류: 사람·물건·가전 설비(가구는 거른다). */
export type DetLabel = "person" | ObjClass | FixtureClass;

export interface StateEntry {
  facet: Facet;
  label: string;
  /** 이 값이 붙을 수 있는 곳. */
  for: readonly Target[];
  /** VLM 프롬프트에 붙이는 영어 설명(src/observe/scene.ts). */
  hint?: string;
  /** 관절만 정하는 값: VLM 스키마·프롬프트에 넣지 않는다(쓰러짐 의심, src/world/fall.ts). */
  pose?: true;
}

/** VLM·관절이 고르는 사실 값. 키가 VLM 스키마 enum이고, 글이 관찰 텍스트다. */
export const STATES = {
  on_table: { facet: "place", label: "식탁 위", for: ["object"], hint: "dining or coffee table" },
  on_counter: { facet: "place", label: "조리대 위", for: ["object"], hint: "kitchen counter top beside the sink, not inside the sink basin" },
  on_desk: { facet: "place", label: "책상 위", for: ["object"] },
  on_shelf: { facet: "place", label: "선반 위", for: ["object"], hint: "shelf, cabinet, stand or dresser top" },
  on_sofa: { facet: "place", label: "소파 위", for: ["object", "person"] },
  on_bed: { facet: "place", label: "침대 위", for: ["object", "person"] },
  on_chair: { facet: "place", label: "의자 위", for: ["object", "person"] },
  on_floor: { facet: "place", label: "바닥", for: ["object", "person"], hint: "the room floor, never the bottom of a sink basin" },
  in_sink: { facet: "place", label: "싱크대 안", for: ["object"], hint: "inside the sink basin, including a cup standing or lying on the sink bottom near the drain" },
  in_dish_rack: { facet: "place", label: "식기 건조대 안", for: ["object"], hint: "dish drying rack" },
  in_fridge: { facet: "place", label: "냉장고 안", for: ["object"], hint: "inside an open fridge" },
  in_hand: { facet: "place", label: "손에 있음", for: ["object"] },
  empty: { facet: "contents", label: "비어 있음", for: ["object"] },
  has_contents: { facet: "contents", label: "내용물 있음", for: ["object"] },
  contents_unknown: { facet: "contents", label: "안이 안 보임", for: ["object"], hint: "inside not visible" },
  see_through: { facet: "body", label: "속이 비침", for: ["object"], hint: "clear or translucent sides that show the drink level, like a glass or clear plastic cup" },
  opaque: { facet: "body", label: "불투명", for: ["object"], hint: "sides you cannot see through, like a ceramic mug, can or paper cup" },
  open: { facet: "open", label: "열림", for: ["object", "fixture"] },
  closed: { facet: "open", label: "닫힘", for: ["object", "fixture"] },
  in_use: { facet: "use", label: "쓰는 중", for: ["object", "fixture"], hint: "used right now, or an appliance running" },
  not_in_use: { facet: "use", label: "꺼져 있음", for: ["fixture"], hint: "appliance clearly switched off: no light, display, flame or heat visible" },
  water_running: { facet: "use", label: "물이 흐름", for: ["fixture"], hint: "water flowing from a sink tap" },
  screen_on: { facet: "screen", label: "화면 켜짐", for: ["object", "fixture"] },
  screen_off: { facet: "screen", label: "화면 꺼짐", for: ["object", "fixture"] },
  standing: { facet: "posture", label: "서 있음", for: ["person"] },
  sitting: { facet: "posture", label: "앉아 있음", for: ["person"] },
  lying: { facet: "posture", label: "누워 있음", for: ["person"] },
  fall_suspected: { facet: "posture", label: "쓰러짐 의심", for: ["person"], pose: true },
  holding_object: { facet: "holding", label: "물건을 들고 있음", for: ["person"] },
  eating: { facet: "activity", label: "먹는 중", for: ["person"] },
  drinking: { facet: "activity", label: "마시는 중", for: ["person"] },
  cooking: { facet: "activity", label: "요리하는 중", for: ["person"] },
  washing_dishes: { facet: "activity", label: "설거지하는 중", for: ["person"] },
  cleaning: { facet: "activity", label: "청소하는 중", for: ["person"] },
  doing_laundry: { facet: "activity", label: "빨래하는 중", for: ["person"] },
  putting_away: { facet: "activity", label: "정리하는 중", for: ["person"], hint: "tidying or storing things" },
  picking_up: { facet: "moment", label: "물건을 집어 듦", for: ["person"] },
  putting_down: { facet: "moment", label: "물건을 내려놓음", for: ["person"] },
  throwing_away: { facet: "moment", label: "버리는 중", for: ["person"] },
  watching_tv: { facet: "activity", label: "TV 보는 중", for: ["person"] },
  using_phone: { facet: "activity", label: "휴대폰 쓰는 중", for: ["person"] },
  using_laptop: { facet: "activity", label: "노트북 쓰는 중", for: ["person"] },
  reading: { facet: "activity", label: "읽는 중", for: ["person"] },
  talking: { facet: "activity", label: "이야기하는 중", for: ["person"], hint: "with someone or on a call" },
  taking_medicine: { facet: "activity", label: "약 먹는 중", for: ["person"] },
  exercising: { facet: "activity", label: "운동하는 중", for: ["person"] },
  grooming: { facet: "activity", label: "씻거나 단장하는 중", for: ["person"], hint: "washing face or hands, brushing teeth, hair or makeup" },
  dressing: { facet: "activity", label: "옷을 입거나 벗는 중", for: ["person"], hint: "putting clothes on or off" },
  resting: { facet: "activity", label: "쉬거나 자는 중", for: ["person"], hint: "lying or sitting still, relaxing or asleep" },
  walking: { facet: "activity", label: "걷는 중", for: ["person"] },
  entering_home: { facet: "moment", label: "집에 들어옴", for: ["person"], hint: "coming in through the front door" },
  leaving_home: { facet: "moment", label: "집을 나섬", for: ["person"], hint: "going out through the front door" },
  lying_on_floor: { facet: "activity", label: "바닥에 누워 있음", for: ["person"], hint: "lying on the floor, not on a bed or sofa" },
  other: { facet: "activity", label: "다른 일을 하는 중", for: ["person"] },
  unknown: { facet: "activity", label: "하는 일 모름", for: ["person"] },
} as const satisfies Record<string, StateEntry>;

export type StateKey = keyof typeof STATES;
export type StateOf<F extends Facet> = { [K in StateKey]: (typeof STATES)[K]["facet"] extends F ? K : never }[StateKey];
export type Activity = StateOf<"activity">;

/** VLM이 장면·가까이 본 사진에서 상자와 함께 찾아 답하는 물건 종류(VLM 물건 목록): 낱말 표에 VLM 종류 기준(vlm)이 있는 물건. World State 물건은 이 답으로만 생긴다
 *  (사용자 결정 2026-11-18). 행동이 쓰는 종류만 둔다: 답에 물건 하나가 늘 때마다 VLM 답이 약 0.25초 늦다(2026-11-18 실제 판 530장 중앙값). */
export const VLM_FIND = (Object.keys(CLASSES) as ClassKey[]).filter((k) => CLASSES[k].role === "object" && "vlm" in CLASSES[k]) as ObjClass[];
/** VLM 물건 목록에서 빼는 것: 컵·병·그릇 모양 장식품(0af95a1·키 큰 컵 q1·q2: 창턱·선반의 트로피 모양 잔을 컵으로 답해 식탁 위 컵이 여러 id로 갈라졌다). */
export const VLM_SKIP = "Leave out decorations even when shaped like a cup, bottle or bowl: trophies, vases, figurines, candle holders and decorative glassware displayed on a window ledge or shelf.";

/** 마시는 그릇 무리: 같은 물건을 VLM·YOLO가 서로 다른 종류로 볼 수 있다(투명한 유리컵 ↔ 병). 찾기는 같은 자리면 이 무리를 찾던 대상으로 잇는다(src/act/track/find.ts). */
export const DRINKWARE = ["cup", "bottle"] as const satisfies readonly ClassKey[];
/** 두 종류가 같거나 둘 다 마시는 그릇 무리인가. */
export const sameDrinkware = (a: string, b: string): boolean =>
  a === b || ((DRINKWARE as readonly string[]).includes(a) && (DRINKWARE as readonly string[]).includes(b));

/** VLM이 낼 수 있지만 사실로 쌓지 않는 값: 감지 목록의 물건이 가려 안 보임. */
export const VLM_ONLY = ["not_visible"] as const;
/** 관절만 정하는 사실 값(pose). */
type PoseOnly = { [K in StateKey]: (typeof STATES)[K] extends { pose: true } ? K : never }[StateKey];
/** VLM 스키마 enum: 관절만 정하는 값을 뺀 사실 값 전부 + VLM만 내는 값. */
export const SCENE_STATES = [...(Object.keys(STATES) as StateKey[]).filter((k): k is Exclude<StateKey, PoseOnly> => !("pose" in STATES[k])), ...VLM_ONLY] as const;

/** 지금만 맞는 면: 그 대상을 본 프레임의 VLM 답에 없으면 지운다. 사람의 자리(소파 위·침대 위·의자 위·바닥)도 일어나면 바뀌므로 지운다.
 *  하는 일(activity)은 이어지는 일, 순간 동작(moment)은 그 답의 사진들 사이에 일어난 일이다. */
export const NOW_FACETS: Readonly<Record<Target, readonly Facet[]>> = {
  person: ["holding", "activity", "moment", "place"],
  object: ["use"],
  fixture: ["use"],
};

/** 관절 자세 → 사람 자세 값(src/world/pose.ts Posture). 다리 가림·모름은 사실을 바꾸지 않는다. */
export const POSE_POSTURE = { standing: "standing", sitting: "sitting", lying: "lying" } as const satisfies Record<string, StateOf<"posture">>;
/** 쉬는 가구 종류 → 그 위에 있는 사람의 자리 값. 쓰러짐 의심(src/world/fall.ts)은 몸이 그 가구 자리에 비치고 VLM이 이 자리라고 답했을 때만 그 가구 위로 뺀다. */
export const REST_PLACES = { bed: "on_bed", sofa: "on_sofa" } as const satisfies Record<string, StateOf<"place">>;
export type RestKind = keyof typeof REST_PLACES;
/** 쓰러짐 의심(src/world/fall.ts): 서 있다가 갑자기 바닥에 누운 자세로 이어지면 사람 자세를 이 값으로 둔다. */
export const POSE_FALL = "fall_suspected" as const satisfies StateOf<"posture">;
/** 관절로 든 물건이 보이면 그 물건의 자리 값과 사람의 들고 있음 값. */
export const POSE_HOLD = { object: "in_hand", person: "holding_object" } as const satisfies { object: StateOf<"place">; person: StateOf<"holding"> };

// ── 가전 ──

export interface DeviceStateEntry {
  /** 트윈 속성(scene.json states·카탈로그 attrs 이름). */
  attr: string;
  value: string | boolean;
  /** 지금 상태 글([지속] 줄). */
  label: string;
  /** 이 상태가 된 사건 글(변화 줄). */
  became: string;
  /** 켜짐·작동·열림처럼 신경 쓸 상태: [지속] 줄에 늘 나온다. */
  active: boolean;
}

/** 가전 상태 값. 키는 계획 조건·FSM이 쓰는 이름이고, 사건은 「그 상태가 됨」이다(세탁 끝남 = stopped가 됨). */
export const DEVICE_STATES = {
  running: { attr: "running", value: true, label: "작동 중", became: "작동 시작", active: true },
  stopped: { attr: "running", value: false, label: "멈춤", became: "작동 멈춤", active: false },
  on: { attr: "power", value: "on", label: "켜짐", became: "켜짐", active: true },
  off: { attr: "power", value: "off", label: "꺼짐", became: "꺼짐", active: false },
  door_open: { attr: "door", value: "open", label: "문 열림", became: "문 열림", active: true },
  door_closed: { attr: "door", value: "closed", label: "문 닫힘", became: "문 닫힘", active: false },
  unlocked: { attr: "lock", value: "unlocked", label: "잠금 풀림", became: "잠금 풀림", active: true },
  locked: { attr: "lock", value: "locked", label: "잠김", became: "잠김", active: false },
  faucet_on: { attr: "faucet", value: "on", label: "물 나옴", became: "물 틀어짐", active: true },
  faucet_off: { attr: "faucet", value: "off", label: "물 잠김", became: "물 잠김", active: false },
  water_on: { attr: "water", value: "on", label: "물 나옴", became: "물 틀어짐", active: true },
  water_off: { attr: "water", value: "off", label: "물 잠김", became: "물 잠김", active: false },
  heating_on: { attr: "heating", value: "on", label: "난방 중", became: "난방 켜짐", active: true },
  heating_off: { attr: "heating", value: "off", label: "난방 꺼짐", became: "난방 꺼짐", active: false },
  charging: { attr: "charging", value: "on", label: "충전 중", became: "충전 시작", active: false },
  not_charging: { attr: "charging", value: "off", label: "충전 안 함", became: "충전 끝남", active: false },
  curtain_open: { attr: "curtain", value: "open", label: "열림", became: "열림", active: false },
  curtain_closed: { attr: "curtain", value: "closed", label: "닫힘", became: "닫힘", active: false },
  blind_open: { attr: "blind", value: "open", label: "열림", became: "열림", active: false },
  blind_closed: { attr: "blind", value: "closed", label: "닫힘", became: "닫힘", active: false },
} as const satisfies Record<string, DeviceStateEntry>;

export type DeviceStateKey = keyof typeof DEVICE_STATES;

// 가전 종류마다 바꿔 쓰는 글(세탁기 작동 멈춤 → 세탁 멈춤)은 가전 종류 등록부(src/devices/kinds.ts stateText)에 있다. 트윈 신호는 running 참·거짓뿐이라
// 끝까지 돈 것과 중간에 끈 것을 가르지 못해 「멈춤」이다.

/** 시간이 지나야 나는 가전 사건: 그 상태가 afterMs 넘게 이어지면 한 번. 사건이 나는 가전 종류는 등록부(src/devices/kinds.ts longEvents)에 있다. */
export const DEVICE_LONG = {
  door_open_long: { state: "door_open", afterMs: 60_000, label: "문이 1분 넘게 열림" },
} as const satisfies Record<string, { state: DeviceStateKey; afterMs: number; label: string }>;
export type DeviceLongKey = keyof typeof DEVICE_LONG;

// ── 카메라로 맞추는 가전 상태 ──

export interface SightRule {
  /** 가전 설비 사실 면. */
  facet: Facet;
  /** 트윈 가전 속성. 이 속성이 없는 가전에는 넘기지 않는다. */
  attr: string;
  /** VLM 값 → 트윈 속성 값. */
  values: Partial<Record<StateKey, string | boolean>>;
  /** 그 프레임 VLM 답이 이 면 값을 하나도 말하지 않았을 때의 트윈 값(쓰는 중은 지금만 맞는 면이라 답에 없으면 안 쓰는 중). 없으면 아무것도 넘기지 않는다. */
  absent?: string | boolean;
}

// 가전 설비 종류 → 카메라로 맞추는 트윈 가전 상태(규칙 SightRule)는 가전 종류 등록부(src/devices/kinds.ts camera)에 있다. 오븐·토스터는 트윈 가전 종류가 없어 맞추지 않는다.

/** 카메라 상태 안정: 같은 가전·속성에서 같은 값이 연속 frames번(엔진 프레임 2초면 2장) 이어야 넘긴다. 앞 값과 withinMs 넘게 떨어지면 처음부터 센다. */
export const SIGHT_STABLE = { frames: 2, withinMs: 4000 } as const;

/** 카메라로 가전 고르기: 가운데가 화면(NDC ±1) 밖으로 viewMargin까지 나가도 시야 안. 상자 가운데 광선과 가전 가운데 방향의 각이 maxDeg 넘으면 아님,
 *  둘 이상이면 가장 가까운 것이 다음 것보다 marginDeg 넘게 가까워야 고른다. 실제 프레임으로 아직 맞추지 않은 값이다. */
export const SIGHT_MATCH = { viewMargin: 0.25, maxDeg: 25, marginDeg: 8 } as const;

// ── 사람 위치 ──

/** 사람이 이 거리(m) 안이면 그 가전·가구 가까이. */
export const NEAR_M = 1.5;
/** 폰(손)이 이 평면 거리(m) 안이고 같은 방이면 그 자리 근처(실행 추적 도착 기준과 같다). */
export const PHONE_NEAR_M = 1.2;
/** 사람 발 자리·폰 자리는 이만큼(ms) 안에 본 것만 조건에 쓴다. */
export const FRESH_MS = 5000;
/** 지금만 맞는 면(하는 일·쓰는 중 등)은 이만큼(ms) 안의 VLM 답만 조건에 쓴다(엔진 프레임 2초, 답 한두 번 놓쳐도 된다). */
export const FACT_FRESH_MS = 10_000;
/** 「모름」을 뜻하는 값: 다른 값과 견주면 모름이다. */
export const UNKNOWN_STATES: readonly StateKey[] = ["contents_unknown", "unknown"];

// ── 때 ──

/** 하루 때: 시작 시(포함) 순서. [때] 줄에 쓴다. */
export const DAY_PARTS = [
  { from: 0, key: "dawn", label: "새벽" },
  { from: 5, key: "morning", label: "아침" },
  { from: 9, key: "forenoon", label: "오전" },
  { from: 12, key: "afternoon", label: "오후" },
  { from: 17, key: "evening", label: "저녁" },
  { from: 21, key: "night", label: "밤" },
] as const;
export const WEEKDAYS = ["일요일", "월요일", "화요일", "수요일", "목요일", "금요일", "토요일"] as const;
