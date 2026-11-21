// 집 실행 묶음(src/server/home/)의 안쪽 공유 객체 HomeCore: 도메인별 잇기(devices·agent·phone·act·observe·say)가 함께 쓰는 상태와 집 맥락.
// startHome 한 함수가 나눠 쓰던 클로저 변수를 칸으로 둔 것이다. 조립(index.ts)이 만들어 도메인별 잇기를 옛 차례대로 부르고, 닫을 때도 이 칸을 본다.
// 칸은 그 잇기가 채우기 전에는 읽지 않는다. 말풍선 카드 speak는 say.ts가 채우기 전까지 아무것도 하지 않는다.
import { ProgressReplies, modeNow, type ExecutionTracker, type LessonStore, type Looker, type Mode, type PlanHub, type loadActConfig } from "../../act/index.js";
import type { Agent, ApprovalStore, Observer, PlaceInfo, Planner, Policy } from "../../agent/index.js";
import type { BrainPlans, MakePlan, Decider, PersonLane, ThoughtFeed } from "../../brain/index.js";
import type { BrainLog, SeenEvent } from "../../contract/events.js";
import type { PendingGoal } from "../../contract/goal.js";
import type { HabitFsm } from "../../contract/habit.js";
import type { PlannedCommand } from "../../contract/phone.js";
import type { SignalHub, ThinqLink } from "../../devices/index.js";
import type { FloorPlan, HomePlan, PlaceNames, TwinData, loadLayout, loadScene } from "../../layout/index.js";
import { realClock, type Body, type BusNode, type Clock, type Outbox } from "../../bus/index.js";
import { HomeMachines } from "./machines.js";
import type { LookClient, ObservationPipeline, PerceptionNode } from "../../observe/index.js";
import type { WorldView } from "../../contract/world.js";
import type { EyeFeed, FrameHeader, PhoneServer, StartStore, twinLandmarks } from "../../phone/index.js";
import type { PlaneSurface, WorldMirror, WorldNode, WorldState } from "../../world/index.js";
import type { TwinHomeApp } from "../app.js";
import type { StartedHub } from "../hubFactory.js";
import type { HomeContext } from "./index.js";

/** 폰에서 말한 것은 "phone" 세션 하나로 이어진다(대시보드 대화와 따로 기억). */
export const PHONE_SESSION = "phone";
/** 폰 대화(말 요청 에이전트)가 끝난 뒤 이만큼(ms) 실행 추적이 사람을 움직이게 하지 않는다(에이전트 답을 읽는 동안). */
export const TALK_QUIET_MS = 10_000;

/** 집 하나를 띄우는 동안의 공유 상태. */
export class HomeCore {
  // 가전(devices.ts)
  twin!: TwinData;
  started!: StartedHub;
  signals!: SignalHub;
  /** 기기 id → twin 기기(이름·종류). */
  specOf!: Map<string, TwinData["devices"][number]>;
  unsubHistory!: () => void;
  /** ThinQ 연결(실제 모드). 닫힌 집이면 붙이지 않는다. */
  link: ThinqLink | null = null;
  closed = false;
  // 에이전트(agent.ts)
  approvals!: ApprovalStore;
  policy!: Policy;
  layout: ReturnType<typeof loadLayout>;
  /** 들은 말을 기록·방송에 그대로 남길지(KEEP_HEARD_TEXT). */
  keepHeard = false;
  agent!: Agent;
  planner!: Planner;
  observer!: Observer;
  unsubFocus: () => void = () => {};
  // 실제 폰(phone.ts)
  phoneOn = false;
  phoneReady = false;
  speechOrder: string | null = null;
  readonly followupFeedback = new Map<string, import("../../contract/events.js").FeedbackLog>();
  readonly progress = new ProgressReplies();
  phoneOwner: Body<"/phone/owner">["owner"] = null;
  claimStamp = 0;
  phoneClaims = new Map<string, Body<"/phone/claim">["kind"]>();
  feed: EyeFeed | undefined;
  eyeHeightM = 0;
  /** 방·벽(scene.json, 없거나 깨졌으면 빈 목록). */
  plan!: HomePlan;
  startStore: StartStore | undefined;
  /** 지금 배치의 물건 기준점(폰 위치 맞추기). */
  landmarksNow!: () => ReturnType<typeof twinLandmarks>;
  /** 엔진 프레임 헤더(찍은 순간 AR 자세·투영): 감지가 끝나면 기준점 상자와 함께 폰 위치 맞추기로 넘긴다. */
  engineHeaders = new WeakMap<Buffer, FrameHeader>();
  phone: PhoneServer | undefined;
  phoneUrls: string[] = [];
  phonePort: number | undefined;
  // 계획·판단·실행(act.ts)
  scene!: ReturnType<typeof loadScene>;
  floorPlan!: FloorPlan;
  placeNames!: PlaceNames;
  places!: () => PlaceInfo[];
  plans!: PlanHub;
  act!: ReturnType<typeof loadActConfig>;
  lessons!: LessonStore;
  thoughts: ThoughtFeed | null = null;
  decider: Decider | null = null;
  tracker: ExecutionTracker | null = null;
  looker: Looker | null = null;
  /** 실제 폰 대화(말 요청 에이전트) 사용: 처리 중인 말 수와 마지막으로 끝난 시각. 실행 추적이 끼어들지 않게 본다(act.ts talking). */
  talk = { inflight: 0, at: Number.NEGATIVE_INFINITY };
  // 관찰 흐름·World State(observe.ts)
  surfaces!: () => PlaneSurface[];
  world: WorldState | null = null;
  pipeline: ObservationPipeline | null = null;
  // 노드(src/bus): 집 세대, 인식·집 상태·거울(act)·폰·가전 노드
  epoch!: { boot: string; home: string };
  looks: LookClient | null = null;
  perception: PerceptionNode | null = null;
  worldNode: WorldNode | null = null;
  goalMirror: WorldMirror | null = null;
  goalPlans: BrainPlans | null = null;
  goalPulse: number | null = null;
  tvWatch?: import("../../goal/index.js").TvWatch;
  goalFacts: import("../../goal/index.js").TriggerFacts | null = null;
  checkingVisit: (import("../../goal/index.js").CheckingVisit & {cup:string;surface:string}) | null = null;
  managerNode: BusNode | null = null;
  brainMirror: WorldMirror | null = null;
  brainPlans: BrainPlans | null = null;
  brainStatus: Body<"/act/status"> | null = null;
  makePlan!: MakePlan;
  invalidateMemory = () => {};
  mirror: WorldMirror | null = null;
  phoneNode: BusNode | null = null;
  machineRecorder: BusNode | null = null;
  readonly machines = new HomeMachines();
  pamHeard = false;
  devicesNode: BusNode | null = null;
  /** 노드가 내는 입력의 차례대로 보내기 줄(실패하면 같은 봉투로 다시, 닫기 전 비운다): 실행 추적(거울 노드)·폰·가전. */
  out: { act?: Outbox; brain?: Outbox; goal?: Outbox; manager?: Outbox; phone?: Outbox; devices?: Outbox } = {};
  unsubWorld: () => void = () => {};
  decideTimer: NodeJS.Timeout | undefined;
  // 말풍선 카드(say.ts): 실제 폰에 낸 지금 명령, 마지막 판단·물체 모양, 보낸 글, 가까이 보기·반성·외부 연락 결과
  speak: () => void = () => {};
  command: PlannedCommand | null = null;
  lastDecision: BrainLog | null = null;
  lastSeen: SeenEvent | null = null;
  statusSent: string | null = null;
  actStatus: Body<"/act/status"> | null = null;
  said: string | null = null;
  /** 지금 말풍선 말이 안전 알림인가(src/act/say.ts sayOf). */
  saidSafety = false;
  /** 대시보드에 마지막으로 보낸 행동 모드. */
  modeSent: Mode | null = null;
  /** 마지막 미리 세운 목표(src/goal/watch.ts, 접속한 대시보드에 다시 보낸다). */
  goal: PendingGoal | null = null;
  /** 마지막으로 보낸 습관 FSM 그림 자료(src/brain/habit.ts, 접속한 대시보드에 다시 보낸다). 판단 전이면 null. */
  habit: HabitFsm | null = null;
  /** 시간 줄 사람 줄 자료(src/brain/person.ts): 판단·World State로 정한 지금 사람 상태(접속한 대시보드에 마지막 것을 다시 보낸다). */
  person: PersonLane | null = null;
  lookSay: { place: string; atMs: number } | null = null;
  reflected: { atMs: number; learned: number; active: number } | null = null;
  serviceSaid: { text: string; atMs: number } | null = null;
  /** 마지막 도움 기록 글과 그 시각(메시지 상자, src/act/help-record.ts). */
  helpSaid: { text: string; atMs: number } | null = null;
  // 앱(index.ts)
  app: TwinHomeApp | undefined;

  constructor(readonly ctx: HomeContext) {}

  /** 지금 시각(시험 시계가 있으면 그 시계). */
  nowMs(): number {
    return this.ctx.brain?.clock?.now() ?? Date.now();
  }

  /** 노드 시계: 시각은 nowMs(시험 시계가 있으면 그 시계), 타이머는 실제 시계. */
  busClock(): Clock {
    return { now: () => this.nowMs(), every: realClock.every, after: realClock.after };
  }

  /** 집 상태 보기: 거울이 받은 가장 새 /world/state(관찰 흐름이 없거나 아직 못 받았으면 null). */
  view(): WorldView | null {
    return this.mirror?.view() ?? null;
  }

  /** 지금 행동 모드(눈치·코치)를 정하는 한 곳(src/act/mode.ts): 비상(쓰러짐 의심·끄기 안내)이거나 코치 계획이 열려 있거나 만드는 중이면 코치.
   *  action: 판단 기록에 붙일 때 이번 판단이 고른 행동. 집 상태는 거울 보기다. */
  mode(action: string | null = null): Mode {
    const tracker = this.tracker;
    return modeNow({ world: this.view(), offNotices: tracker?.offTrack().notices ?? [], coaching: tracker?.coaching() ?? false, plan: this.plans.current(), action });
  }
}
