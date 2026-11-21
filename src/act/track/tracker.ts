// 실행 추적: 판단 → 계획(에이전트 계획 모드) → 실행 중 → 완료 또는 실패. 단계마다 execution 기록을 낸다(plan_id는 plan:<판단 id>).
// 판단 하나마다 한 번만 정한다: 늦은 답·판단 실패·대기·진행 중(또는 계획을 만드는 중)인 행동과 같은 행동은 기록만 하고, 계획 전 검사(LLM 없음)를
// 통과하면 에이전트를 계획 모드로 한 번 부른다(planner). 같은 행동은 planGapMs 안에 다시 부르지 않는다(「가까이 본 뒤 다시 판단」으로 닫은 계획은 세지 않는다). 주기 tick은 에이전트를 부르지 않는다.
// 손으로 켜는 위험 가전(코치 계획의 do 단계, AgentStep.hand가 위험 목록 가전을 켬): 그 단계가 되면 명령보다 먼저 안전 문구와 함께 묻는다(승인·거절, 단계 id :hand).
// 승인 뒤에만 켜라는 명령을 보내고, 거절이면 취소로 닫는다. 답은 기억하지 않는다(다음 판에도 또 묻는다). 묻는 동안은 「완료」·말·비전으로 넘어가지 않는다.
// 켜라는 명령을 보낸 가전은 작동 한 번이 끝난 것을 확인할 때까지 「켠 것」(hot)으로 본다. 켜기 회차(Run.onAt: 회차 번호·켜라고 한 시각·부탁 시각)는 풀어도 남는다.
// 작동 끝남은 cycleEnded 하나만 판정하고(명시 근거만: 켜라고 한 뒤 촬영된 아는 켜짐 → 꺼짐, 또는 부탁 뒤 촬영된 가까이 본 명시 꺼짐) 추적은 releaseIfOff 하나만 푼다.
// 「완료」·말·만료·끄기 단계 넘김은 풀지 않는다(끄기 do 단계는 「완료」로 넘어가도 hot이 남고, 추적이 풀리면 그 단계도 끝난다).
// 켠 채 계획이 닫히면(그만·시간 초과·실패·새 계획·끝까지 마침) handOver가 가전마다 끄라는 안내 하나(명령 id는 닫힌 계획 id, 단계 id off:<계획>:<가전>:<회차>,
// src/act/off-step.ts, 「완료」 하나)를 줄에 넣고 실제 폰 명령 줄에 보통 명령처럼 차례로 띄운다. 상태가 이미 꺼짐인데 끝남을 확인하지 못한 가전은 보이게 해 달라는 부탁(답 단추 없음)으로 넣는다. 안내의 「완료」는 풀리지 않으면 부탁으로 바뀐다.
// 안내는 offHoldMs마다 다시 읽고, 줄에 다른 가전이 기다리면 차례를 돌린다. 풀린 가전이 rearmMs 안에 다시 켜지면 다시 건다(rearmIfOn).
// 안내가 남아 있는 동안 폰이 필요한 새 계획(needsPhone)은 첫 명령(승인 질문 포함)을 미루고(실행 기록 EXEC_TEXT.deferred), 안내가 다 풀리면 시작한다.
// 폰이 필요 없는 가전 계획은 그대로 돌고, 그 알림 줄(say)은 안내가 떠 있는 동안 명령 줄로 보내지 않는다.
// 폰이 필요한 다른 계획이 도는 동안 다시 걸려 생긴 안내는 그 계획이 끝난 뒤 띄우고(그 계획은 막지 않는다), 기다리는 동안 붙은 폰에 소리로만 알린다
// (sayAloud, CAUTION_TEXT.rearmed, offHoldMs마다 다시, 여러 가전이 기다리면 돌아가며). 그 시각은 offTold()로 말풍선 카드가 본다.
// 다시 알리기(tell)는 모델이 쓴 글이라, 위험 가전 이름이 나오거나 지금 단계가 위험 가전 단계(대상이 위험 가전이거나 hand_device가 붙음)면 보내지 않는다(기본 거부).
// 코치 행동(TaskSpec.coach) 계획이 열려 있거나 만드는 중이면 coaching()이 참이다: 그동안 판단 호출(PAM)을 쉰다.
// 폰 판본(phoneReady, src/phone/server.ts): 판본이 맞는 실제 폰이 없으면 폰이 필요한 계획(needsPhone)만 시작을 미루고(실행 기록 EXEC_TEXT.phoneOld, 한 번),
// 맞는 폰이 붙으면 시작한다. 계획 도중 폰에 물어야 할 때(승인·시간 초과 질문) 맞는 폰이 없으면 기다리지 않고 실패로 닫는다(EXEC_TEXT.phoneGone).
// 들은 말(onHeard)은 말할 때 폰에 떠 있던 명령(at)의 답일 때만 받는다: 다른 명령·옛 탭(at 없음)이면 버린다(stale). 「그만」은 at과 상관없다.
// 저절로 꺼지는 가전의 꺼짐 기다리기(selfStopWait, 전자레인지 「다 되기 기다리기」)는 끝 조건(지금 상태 꺼짐) 대신 이 계획이 켠 그 가전의 지금 회차가 풀렸을 때만 넘긴다.
// 끄기 do와 같은 판단(offReleased): 실행 추적이 든 풀린 근거(Run.ends, cycleEnded로 풀 때 남김)로 보고 가전 이력에 기대지 않으며, 그 뒤 새 켜짐이면 새 회차로 다시 건다.
// 그 단계가 showAskMs 넘게 안 끝나고 상태가 이미 꺼짐이면(켜짐을 놓침) 그 단계 id로 보이게 해 달라는 부탁을 한 번 띄운다.
// 다른 행동 알림(코치 계획, 관찰 모드 계기 off_track): 사람 단계가 진행 중인데 의미 있는 변화(사람 방·가전 상태·가전 설비 상태)가 왔고 그 단계가 넘어가지 않았거나,
// 이동이 아닌 단계에서 폰이 그 단계 자리를 떠나 다른 평면도 자리 가까이로 갔으면 strayed를 부른다(결정론). 단계마다 strayMax번(받은 것만), strayGapMs에 한 번.
// 무엇이 틀렸는지와 할 말은 관찰 모드(LLM)가 정한다. tell: 지금 명령 글을 그 한 줄로 바꿔 읽고 tellHoldMs 뒤 원래 명령으로 되돌린다(읽지 않음).
// 수업 기록(코치 계획, src/act/lessons.ts): 사람 단계가 끝날 때마다 도움(다시 읽기·다시 알리기·가까이 비춰 달라는 부탁·조용한 단계 힌트·시간 초과 질문) 없이
// 끝냈는지 모으고, 계획이 완료로 끝날 때만 기록한다. 지난 기록에서 이어서 QUIET_AFTER번 혼자 해낸 단계는 명령을 소리로 읽지 않고 글만 띄운다(조용한 단계).
// QUIET_HINT_MS 안에 안 끝나면 한 번 읽고 그 단계는 혼자 해낸 것으로 세지 않는다. 손으로 켜는 위험 가전 단계는 늘 묻고 읽는다.
// 계획은 어떤 것이든 같은 방법으로 돌린다(src/agent/planTools.ts AgentStep):
// - 사람 단계(go·pick·place·do): 실제 폰(에이전트의 손, src/contract/phone.ts)에 사람에게 하는 명령 하나와 「완료」를 보내고(소리로도 읽음),
//   끝나는 조건(World State 낱말 조건, ConditionWatch)이 참이거나 「완료」면 다음 단계로. repeatMs마다 명령을 다시 읽는다.
//   명령마다 대상 하나(목표 자리·그 물건, 트윈 자리)를 같이 보내 실제 폰이 그것에만 고리를 그린다. 비전 상태는 바뀔 때만, visionMs에 한 번까지.
// - 질문(ask): 같은 자리에 질문과 답 단추. 답을 받으면 다음 단계(마지막이거나 끝내는 답이면 완료). 알림(say): 한 줄을 읽고 조건(기본 몇 초)이 되면 다음.
// - 기기(device): 그 단계가 되면 기기 도구를 정책(승인 규칙)을 거쳐 부른다. 위험 목록이면 실제 폰에 승인 질문, 승인이면 실행, 거절이면 취소로 닫는다.
// - 기다리기(wait): 실제 폰 명령을 지우고 아무것도 보내지 않는다. 조건이 참이면 다음. PAM에 다시 묻지 않는다(대시보드 진행도에만 보인다).
// 한 번 볼 때(tick·World State 변화·답) 한 단계만 넘긴다. 단계마다 시간 한도가 있고, 넘으면 on_timeout대로 한 번 다시 묻거나(계속·그만) 실패로 닫는다.
// 「그만」(말)은 계획을 그만둔다. 실행 전 검사는 통과할 때까지 tick마다 다시 보고, recheckMs가 지나도 안 되면 그 이유로 실패한다.
// 검사를 막은 대상 물건의 손에 있음이 들고 감 보호(carried)에서만 왔으면 보호가 풀릴 때까지 그 기한을 세지 않는다.
// 승인(src/agent/approval.ts): 검사를 통과한 계획이 처음 하는 일이면(승인을 받은 적 없음) 첫 단계 전에 실제 폰에 「…를 할까요?」와 답 둘(승인·거절)을 띄운다.
// 승인이면 기억하고 첫 단계로, 거절이면 기억하지 않고 취소로 닫는다. 질문·알림만 있는 계획은 묻지 않는다. 위험 목록 가전 승인은 기억하지 않는다.
// 같은 물건 따라가기: 기준점을 맞춘 뒤 물건이 identityM 넘게 움직이면 World State가 새 id를 붙인다. 계획을 받을 때 그 종류의 다른 물건을 적어 두고,
// 계획 물건과 그 뒤에 새로 생긴 같은 종류 물건을 모두 그 물건으로 본다(조건의 follow, 비전 상태 줄, 고리).
// 폰 근처 조건은 실행 추적이 받은 맞춘 눈(받은 시각)과 World State 눈 중 새것으로 본다.
// 그 자리에서 하는 일(do: 따르기): 대상은 그 일을 받는 World State 물건(없으면 평면도 자리)이다. 집기·놓기가 아니라 든 물건(carried)·치운 물건(placed)을 바꾸지 않는다.
// 멈춘 단계(관찰 모드 A): 끝나는 조건이 있는 집기·놓기·do 단계가 stallMs 넘게(단계 시작 뒤, 받은 부름 뒤) 안 끝나면 stalled를 부른다. 단계마다 stallMax번,
// 받은 것만 센다. 받은 부름은 끝날 때 Stall.settle(counted)로 셈을 정하고, 자원 사정(새 사진 모자람·VLM 자리 없음)은 settle(false)로 돌려받는다.
// 알림마다 그 단계 세대와 신호가 있고, 단계가 끝나면(다음 단계·완료·실패·그만·새 계획·멈춤) 신호를 끊는다. 지난 세대의 settle은 아무것도 하지 않는다.
// 같은 물건 따라가기에서 가까이 봐서 지키는 중이거나 옮김 표시(World State followed_by)가 있는 물건은 「아직 있음」으로 세지 않는다.
// 계획이 도는 동안 폰은 그 단계 명령의 것이다: 관찰 모드가 폰으로 사람에게 부탁하는 길은 없다(src/act/look.ts A는 look_closer·wait).
// 판단 뒤 가까이 본 사실(관찰 모드 B는 PAM을 막지 않는다): 그 행동 대상 종류 물건의 볼 면(TaskSpec.look)을 판단 뒤에 가까이 보기가 바꿨고
// (World State closer_rev가 판단 기록의 횟수와 다름) 지금 값이 판단 때 본 값과 다르면, 판단을 받을 때와 계획을 받을 때 실행하지 않고
// 「가까이 본 뒤 다시 판단」만 남긴다. 계획을 받은 뒤 첫 명령 전(승인 답·실행 전 검사를 기다리는 사이)이면 시작하지 않고 그 기록으로 계획을 취소로 닫는다.
// 다음 판단이 새 사실로 다시 고른다. 첫 명령을 보낸 뒤에는 멈추지 않는다: 단계마다 끝나는 조건을 World State로 보고, 멈춘 단계의 가까이 보기(A)가
// 그 면을 바꾸는 것도 이 계획의 관찰이다. 다른 행동이 맞으면 다음 판단이 새 계획으로 바꾼다.
// 치운 물건(placed): 놓기 단계를 끝낸 물건과 그 계획의 넣은 곳(끝낸 때 싱크볼 안이면 그 싱크볼)을 남긴다. VLM 자리 사실이 싱크대 안이 아니어도
// 계획 전·실행 전 검사·계획 입력·제출 검사와 대상 고르기가 이미 치운 것으로 본다. 다시 집거나(손에 있음 확인됨) 그 영역 밖(다른 면, 싱크볼이면 싱크볼 밖)에서 보이면 지운다.
// 파일 나눔(src/act/track/): tracker.ts 겉 클래스·공개 메서드·tick, core.ts 안쪽 공유 객체 TrackCore(상태·기록·실제 폰 길)와 Run, start.ts 판단 받기·계획 시작,
// steps.ts 단계 진행·치운 물건, approval.ts 승인 질문, safety.ts 켠 위험 가전 추적·끄기 안내(SafetyTracker, 추적 상태는 # 칸), answers.ts 폰 명령 줄·답·말·보내기,
// coach.ts 다시 알리기·다른 행동·조용한 단계, contents.ts 내용물 보류(실행 전 검사가 컵 안을 몰라 막은 계획: 잘라 보기 → 사진 기다리기 → 가까이 가서 위에서 보기, 사용자에게 묻지 않음),
// find.ts 찾기(대상이 안 보여 검사가 막은 판단·계획: 마지막으로 본 자리로 가기 → 비추기 → 다시 가까이 보기, 사용자에게 묻지 않음), phone-line.ts 사람 단계 명령 줄 규칙.
// 다른 도메인은 src/act/index.ts로 가져온다.
import type { BrainLog, ExecState, DecisionRecord } from "../../contract/events.js";
import type { RobotFacts } from "../../machines/index.js";
import { RobotMachine } from "../robot/machine.js";
import type { HeardAt, PlannedCommandMessage } from "../../contract/phone.js";
import type { OffTrack, PlanView, XZ } from "../../contract/plan.js";
import type { WorldChange, WorldView } from "../../contract/world.js";
import type { FloorPlan, PlaceNames } from "../../layout/index.js";
import type { PlanHub } from "../hub.js";
import { EXEC_TEXT, type TellMode } from "../labels.js";
import type { Stall } from "../robot/steps.js";
import { HUMAN_KINDS, type AgentPlan, type ApprovalBook, type PlanAhead, type PlanResult, type ToolResult } from "../../agent/index.js";
import type { PlaneSurface } from "../../world/index.js";
import type { PendingGoal } from "../../contract/goal.js";
import type { CheckResult } from "../check.js";
import { QUIET_HINT_MS, type LessonBook } from "../lessons.js";
import type { ActionChoice } from "../prompts.js";
import { taskOf, type Placed } from "../tasks.js";
import { Answers, type HeardResult } from "./answers.js";
import type { Stray } from "../robot/coach.js";
import type { ContentsLook } from "../robot/contents.js";
import { OPEN, TrackCore, type TrackConfig } from "./core.js";
import { SafetyTracker, type Cycle, type CycleEnd } from "./safety.js";
import { Starter } from "../robot/start.js";
import { UseWatch } from "../../manage/index.js";
import { GoalWatch, type GoalPorts } from "../../goal/index.js";
import { noticeTick } from "../robot/phone-line.js";
import { stationDirectives, visitPhoneBusy } from "../robot/directive.js";
import type { DirectiveResult, ManagerDirective } from "../../contract/machines.js";
export { DONE_NOTICE_MS } from "../robot/phone-line.js";

export type { HeardResult } from "./answers.js";
export type { Stray } from "../robot/coach.js";
export type { ContentsLook } from "../robot/contents.js";
export type { Cycle, CycleEnd } from "./safety.js";
export type { Stall } from "../robot/steps.js";

/** 기기 단계 실행(src/server/home/act.ts: 기기 도구 + 정책). run이 승인 토큰을 내면 실제 폰에 묻고 confirm·cancel로 답한다.
 *  결과의 unverified(ThinQ가 받았지만 다시 읽은 값이 다름)·state 「모름」(신호 없음)은 적용을 확인하지 못한 것이다. */
export interface DeviceRunner {
  /** live가 거짓이면(계획이 바뀌었거나 닫힘) 가전에 보내지 않는다. 보내기 바로 앞에서 본다. */
  run(tool: string, deviceId: string, args: Record<string, unknown>, live: () => boolean, commandId?:string): Promise<ToolResult>;
  confirm(token: string, live: () => boolean): Promise<Pick<ToolResult, "ok" | "error" | "unverified" | "state">>;
  cancel(token: string): void;
}

/** 말 부탁(말 요청 에이전트 request_task·묻기 답): 행동 이름, 들은 말, 받은 때, 그때까지 보낸 마지막 PAM 요청 번호. */
export interface SpeechRequest { task: string; heard: string; atMs: number; afterSeq: number; via?: "answer" }

export interface TrackerOptions {
  /** Recheck the current resident after any approval or phone wait. */
  cupAnswers?: {
    discardLeftover?: () => boolean;
    rememberLeftover?: (allow:boolean) => void;
  };
  stations?: {
    map?():import("../../contract/stations.js").StationMap | null;
    rev():number;
    /** look: 도착해서 비출 곳 이름(그 자리가 보는 구역 이름). 보는 구역이 없는 자리는 null. */
    target(id:string): {id:string;label:string;position:[number,number,number];look:string|null} | null;
    choose?(job:Extract<import("../../contract/machines.js").HouseholdOffer,{kind:"choose_station"}>, signal:AbortSignal):Promise<string|null>;
    tvAllowed?(job:import("../../contract/machines.js").HouseholdOffer):boolean;
    result(value:DirectiveResult):void;
  };
  plans: PlanHub;
  /** 계획 전 검사(src/act/check.ts checkDecision). 에이전트를 부르기 전에 본다. 없으면 통과. */
  precheck?: (d: DecisionRecord) => CheckResult;
  /** 실행 전 검사(src/act/check.ts checkPlan). seenSince: 미리 만든 계획이면 사람이 떠난 때(CheckInput.seenSince, src/goal/watch.ts). */
  check: (d: DecisionRecord, plan: PlanView, seenSince?: number) => CheckResult;
  /** 에이전트 계획 모드(src/agent/planner.ts). 판단 하나에 한 번 부른다. 새 판단·「그만」·멈춤이면 signal을 끊는다.
   *  ahead가 있으면 미리 세운 목표의 계획이다(src/goal/watch.ts, 계획 입력에 [미리 세운 목표] 줄, 목표 물건만 받는다). */
  planner: (d: DecisionRecord, signal: AbortSignal, ahead?: PlanAhead) => PlanResult | Promise<PlanResult>;
  /** 목표를 세워 둘 수 있는 시간(ms). 없으면 GOAL_DEFAULTS.armMs(30분). */
  goalArmMs?: number;
  /** 처음 하는 일 묻기를 켜 볼 때만(시험). 없으면 src/agent/approval.ts ASK_FIRST_TIME(끔)이다. */
  askFirst?: boolean;
  /** 승인 기억(task:<행동 이름>). 처음 하는 계획은 묻고, 답을 남긴다. */
  approvals: ApprovalBook;
  clock?: { now(): number };
  /** 하루 때 조건의 시간대(분). */
  offsetMinutes?: number;
  /** 사람 단계·질문이 이만큼(ms) 안 끝나면 다시 소리로 읽는다(그 뒤로도 이만큼마다). */
  repeatMs?: number;
  /** 비전 상태를 이보다 자주(ms) 보내지 않는다. */
  visionMs?: number;
  /** 검사를 다시 보는 시간(ms). */
  recheckMs?: number;
  /** 승인·다시 묻기 질문의 답을 기다리는 시간(ms). */
  askMs?: number;
  /** 같은 행동의 계획을 다시 만들기 전 기다리는 시간(ms). */
  planGapMs?: number;
  /** 수업 기록(코치 계획의 잘한 단계 말 줄이기). 없으면 기록하지 않고 모든 명령을 읽는다. */
  lessons?: LessonBook;
  /** 다른 행동 알림을 이보다 자주(ms) 부르지 않는다. */
  strayGapMs?: number;
  /** 단계마다 다른 행동 알림 상한(받은 것만). */
  strayMax?: number;
  /** tell로 바꾼 명령 글을 이만큼(ms) 뒤 원래 명령으로 되돌린다. */
  tellHoldMs?: number;
  /** 켠 채 닫힌 계획의 끄기 안내를 이만큼(ms)마다 다시 읽는다(줄에 다른 가전 안내가 있으면 차례를 돌린다). 지우지 않는다. */
  offHoldMs?: number;
  /** 풀린 가전이 풀린 근거 촬영 시각 뒤 이만큼(ms) 안에 다시 켜지면 추적을 다시 건다. */
  rearmMs?: number;
  /** 끄기 do 단계가 이만큼(ms) 넘게 안 끝나고 그 가전 상태가 이미 꺼짐이면 보이게 해 달라는 부탁을 한 번 보낸다. */
  showAskMs?: number;
  /** 실행 전 검사의 낡음 기준(ms, STALE_MS). 실행 전 찾기가 찾았다고 보는 신선도다. 없으면 3초. */
  staleMs?: number;
  /** 집기·놓기 단계가 이만큼(ms) 안 끝나면 stalled를 부른다(단계 시작 뒤, 받은 부름 뒤). */
  stallMs?: number;
  /** 단계마다 stalled를 받아 센 횟수 상한(settle(false)로 돌려받은 부름은 넣지 않는다). */
  stallMax?: number;
  state: {
    view: () => WorldView;
    /** 보기 지킴(src/world/state/world.ts guard): 위에서 비추는 동안 그 컵을 사라짐으로 세지 않게 걸고(true) 그 차례가 끝나면 푼다(false). */
    guardObject?: (objectId: string, on: boolean) => void;
    /** 지금 집기·내려놓기 하는 대상과 자리(집기는 그 물건 자리, 내려놓기는 목적지, 수평 [x, z])를 World State에 알린다(src/world/state/world.ts focus). null이면 푼다. */
    focusObject?: (objectId: string | null, f?: { step: "pick" | "place" | "carry"; spot: [number, number] | null }) => void;
    /** 찾기가 겨눈 자리에서 찾은 다른 id의 같은 무리 물건(from)을 계획 대상 id(to)로 잇는다(src/world/state/world.ts relink). 이었으면 true. 없으면 잇지 않는다. */
    linkObject?: (fromId: string, toId: string) => boolean;
    /** 그 자리에서 하는 일 단계가 물건 안을 바꾸는 단계(끝 조건에 그 물건 내용물)일 때 창을 연다·닫는다(src/world/state/world.ts contentsAction). */
    contentsAction?: (objectId: string, on: boolean) => void;
  };
  layout: {
    walking?:()=>import("../../layout/index.js").WalkingMap|null;
    /** 트윈 면(식탁·책상·조리대·싱크대). 미리 세운 목표가 컵이 놓이기 전에 사람 곁 면을 다 쓰고 둘 자리로 본다(goal.ts useSpot). 없으면 후보를 본 면만 쓴다. */
    surfaces?: () => PlaneSurface[];
    floor: () => FloorPlan;
    /** 평면도 물건의 이름과 트윈 자리 [x, 높이, y](명령 대상 고리·가까이 볼 자리, 면이면 윗면 가운데). 모르면 undefined. */
    locate?: (id: string) => { label: string; position: [number, number, number] } | undefined;
    /** 이 집의 충전 자리(트윈 자리 [x, 높이, y], twin/data/homes/<집>/dock.json). 없으면(null) 계획이 끝나도 충전 자리로 가지 않는다(src/act/robot/dock.ts). */
    batteryLow?: () => boolean | null;
    dock?: () => [number, number, number] | null;
    /** 부르는 이름 자료(src/layout/names.ts, 계획 단계와 같은 것). 배치 이름이 없으면 locate 이름을 배치 이름으로 본다. */
    names?: PlaceNames;
  };
  phone: {
    /** 실제 폰으로 보낸다: 명령(command)·지우기(command_clear). 폰 서버가 명령 대상 자리를 AR 자리로 바꾼다. */
    toPhone: (msg: PlannedCommandMessage) => void;
    /** 판본이 맞는 실제 폰이 붙어 있는가(src/phone/server.ts ready). 없으면 늘 붙어 있다고 본다. */
    ready?: () => boolean;
    /** 명령 줄을 바꾸지 않고 붙은 폰에 소리로만 알린다(src/server/home/act.ts가 폰 서버 reply에 잇는다). 줄에서 기다리는 끄기 안내가 쓴다. */
    sayAloud?: (text: string) => void;
    /** 실제 폰에 승인 대기(가전·외부 연락)가 떠 있는가. 그동안 가까이 가서 보라고 하지 않고 보류에서 풀린 첫 명령도 미룬다. 없으면 없다고 본다. */
    approvalsWaiting?: () => boolean;
    /** 실제 폰 대화를 쓰는 중인가(에이전트가 들은 말을 처리하는 중이거나 끝난 지 얼마 안 됨). 그동안 가까이 가서 보라고 하지 않고 보류에서 풀린 첫 명령도 미룬다.
     *  없으면 아니라고 본다. */
    talking?: () => boolean;
  };
  brain: {
    /** 지금까지 보낸 마지막 PAM 요청 번호(src/brain/decide.ts sentSeq). 묻기 답 → 말 부탁이 afterSeq로 쓴다. 없으면 0. */
    sentSeq?: () => number;
    /** 말 부탁으로 만든 판단(source speech)을 받는다: 서버가 판단 기록으로 남긴다(src/brain/decide.ts logSpeech). */
    onSpeech?: (d: DecisionRecord) => void;
    /** 계획 전 검사가 분명한 까닭으로 막은 판단의 계획 id(src/act/robot/start.ts): 서버가 판단에 넘겨 그 화살표를 기다리지 않게 한다(src/brain/decide.ts onRefused). */
    onRefused?: (planId: string) => void;
    /** 사람 상태 FSM: 그날 기억(판본)과 마지막 판단의 사람 상태(src/brain/decide.ts fsmState). 사람이 쓰는 것을 보면 지금 상태에서 나가는 화살표로 목표를 세운다(goal.ts).
     *  없으면 목표를 세우지 않는다. */
    habit?: GoalPorts["habit"];
    /** 목표의 사람이 떠났다: 판단을 다음 판단 타이머에 바로 부르게 한다(src/brain/decide.ts nudge). */
    nudge?: () => void;
    /** 이번 판단에 보내는 행동 목록(src/act/tasks.ts tasksFor). 내용물 행동(want)이 있을 때만 계획 밖으로 가까이 가서 본다. 없으면 빈 목록으로 본다. */
    tasks?: () => readonly string[];
  };
  goals: {
    meal?: GoalPorts["meal"];
    update?: () => void;
    view?: () => WorldView;
    prepare?: TrackerOptions["planner"];
    /** 미리 만든 계획을 지금 판단·World State로 다시 검사해 그 판단의 계획으로 낸다(src/agent/planTools.ts resubmit). 없으면 미리 만든 계획을 쓰지 않는다.
     *  rename: 계획의 물건 id → 지금 묶을 World State id(대신 물건·같은 컵의 다른 id, goal.ts take). */
    reuse?: (d: DecisionRecord, plan: AgentPlan, rename?: Readonly<Record<string, string>>) => PlanResult;
    /** 목표가 바뀔 때(세움·미리 만들기·사람 떠남·씀·버림): 서버가 /brain/goal_changes·/brain/goal과 대시보드로 보낸다. */
    publish?: (g: PendingGoal) => void;
  };
  manager: {
    offerSpeech?: (d: DecisionRecord) => void;
    cancelSpeech?: () => void;
  };
  observe: {
    /** 코치 계획 중 다른 행동을 본 것 같을 때(관찰 모드 계기 off_track, src/act/look.ts). 받았으면 true(그때만 센다). 없으면 부르지 않는다. */
    strayed?: (s: Stray) => boolean;
    /** 멈춘 집기·놓기 단계 알림(관찰 모드 A, src/act/look.ts). 받았으면 true(그때만 센다). 받은 부름은 끝날 때 s.settle(counted)를 부른다. 없으면 부르지 않는다. */
    stalled?: (s: Stall) => boolean;
    /** 내용물 보류의 가까이 보기(src/act/look.ts contents). 받았으면 true(끝나면 h.done). 없으면 가까이 보지 않고 사진만 기다린다. */
    lookContents?: (h: ContentsLook) => boolean;
    /** 위에서 비추기가 끝났는가(src/observe/pipeline.ts topReady): sinceMs 뒤 그 컵 안을 내려다본 VLM 프레임 쌍이 있다. 없으면 위에서 비추기가 끝나지 않는다. */
    topReady?: (objectId: string, sinceMs: number) => boolean;
    /** 찾기의 비추기가 끝났는가(src/observe/pipeline.ts spotReady): 가까이 보기가 그 자리(트윈 [x, 높이, y])를 sinceMs 뒤 사진으로만 고를 수 있다.
     *  없으면 비추기가 끝나지 않는다(src/act/robot/find.ts). */
    spotReady?: (position: [number, number, number], sinceMs: number) => boolean;
  };
  events: {
    /** 서버 로그 한 줄(계획 검사에서 버린 계획의 까닭 등). 없으면 남기지 않는다. */
    log?: (line: string) => void;
    emit: (l: BrainLog) => void;
    /** 생각 말풍선에 정한 상태 글 한 줄을 올린다(src/brain/thought.ts note): 찾기 시작·찾음·못 찾음. decisionId는 그 일의 판단 id. 없으면 올리지 않는다. */
    thought?: (text: string, decisionId: string) => void;
  };
  appliances: {
    /** 기기 단계 실행. 없으면 기기 단계는 실패한다. */
    run?: DeviceRunner;
    /** 이 집 가전(id·종류·이름): 손으로 켜는 단계가 위험 목록인지와 묻는 글의 이름. 없으면 손으로 켜는 단계는 모두 묻는다. */
    handDevices?: () => readonly { id: string; kind: string; label: string }[];
  };
}

/** 기본값: 다시 읽기 30초, 비전 상태 0.5초에 한 번, 검사 3초, 승인 답 2분, 같은 행동 다시 계획 15초, 그대로 두기 기록 60초에 한 번, 멈춘 단계 8초·단계마다 3번,
 *  끄기 안내 다시 읽기 2분, 다시 걸기 10분, 끄기 단계 부탁 20초. 단계 시간 한도는 계획 단계마다 있다. */
export const TRACK_DEFAULTS = {
  repeatMs: 30_000, visionMs: 500, recheckMs: 3000, askMs: 120_000, planGapMs: 15_000, stallMs: 8000, stallMax: 3, offHoldMs: 120_000, strayGapMs: 6000, strayMax: 2, tellHoldMs: 8000,
  rearmMs: 600_000, showAskMs: 20_000,
} as const;

export class ExecutionTracker {
  private readonly core: TrackCore;

  constructor(o: TrackerOptions) {
    const clock = o.clock ?? { now: () => Date.now() };
    const cfg: TrackConfig = {
      repeatMs: o.repeatMs ?? TRACK_DEFAULTS.repeatMs, visionMs: o.visionMs ?? TRACK_DEFAULTS.visionMs, recheckMs: o.recheckMs ?? TRACK_DEFAULTS.recheckMs,
      askMs: o.askMs ?? TRACK_DEFAULTS.askMs, planGapMs: o.planGapMs ?? TRACK_DEFAULTS.planGapMs,
      stallMs: o.stallMs ?? TRACK_DEFAULTS.stallMs, stallMax: o.stallMax ?? TRACK_DEFAULTS.stallMax, offHoldMs: o.offHoldMs ?? TRACK_DEFAULTS.offHoldMs,
      strayGapMs: o.strayGapMs ?? TRACK_DEFAULTS.strayGapMs, strayMax: o.strayMax ?? TRACK_DEFAULTS.strayMax, tellHoldMs: o.tellHoldMs ?? TRACK_DEFAULTS.tellHoldMs,
      rearmMs: o.rearmMs ?? TRACK_DEFAULTS.rearmMs, showAskMs: o.showAskMs ?? TRACK_DEFAULTS.showAskMs,
    };
    const core = new TrackCore(o, clock, cfg);
    core.start = new Starter(core);
    core.safety = new SafetyTracker(core);
    core.answers = new Answers(core);
    core.use = new UseWatch({
      world: o.state.view, tasks: o.brain.tasks, touching: () => core.touching(),
      checking: t => t.cls === "cup" && core.goal.protects(t.id ?? null),
      thought: (text) => { if (!core.stopped) o.events.thought?.(text, core.lastDecision ?? "use"); },
    });
    core.goal = new GoalWatch({
      world: o.goals.view ?? o.state.view, now: () => clock.now(), stopped: () => core.stopped, openState: () => core.open()?.state ?? null,
      planning: () => !!core.planning, docking: () => core.dock.busy(), notices: () => core.safety.offTrack().notices,
      placed: () => core.steps.placed(), holding: () => core.use.holding(), planner: o.goals.prepare ?? o.planner, habit: o.brain.habit,
      meal: o.goals.meal, reuse: o.goals.reuse, surfaces: o.layout.surfaces, tasks: o.brain.tasks, nudge: o.brain.nudge, onGoal: o.goals.publish,
      thought: o.events.thought, log: o.events.log, goalArmMs: o.goalArmMs,
    });
    core.robot = new RobotMachine(core);
    core.directives = stationDirectives(core);
    this.core = core;
  }

  current(): { planId: string; state: ExecState } | null {
    const r = this.core.run;
    return r && { planId: r.plan.view.id, state: r.state };
  }

  /** 상태 토픽이 읽을 실행·복귀·찾기의 현재 차례. 명령이나 쓰기 가능한 실행 객체를 내주지 않는다. */
  machineFacts() { return this.core.robot.facts(); }

  robotTransition(facts: RobotFacts, now: number) { return this.core.robot.transition(facts, now); }

  updateGoal() { if (!this.core.stopped) this.core.goal.update(); }
  private changedGoal() {
    if (this.core.o.goals.update) this.core.o.goals.update();
    else this.updateGoal();
  }
  workContext() { return this.core.start.context(); }
  visitPhoneBusy() { return visitPhoneBusy(this.core); }
  onDirective(d:ManagerDirective) { this.core.directives.receive(d); }
  onOrder(d: DecisionRecord, gate: Parameters<typeof this.core.start.order>[1], resumed: boolean, check?: CheckResult) {
    this.core.start.order(d, gate, resumed, check);
  }


  robotLast() { return this.core.robot.last(); }

  /** 화살표 없는 PAM 답이 미리 세운 목표의 트리거면 그 목표 행동(goal.ts triggerOf), 아니면 null. 판단(Decider goalTrigger)이 기록을 내기 전에 묻는다. */
  goalTrigger(d: DecisionRecord): string | null {
    return this.core.goal.triggerOf(d);
  }

  /** 미리 세운 목표(goal.ts). 없으면 null. */
  goal(): PendingGoal | null {
    return this.core.goal.current();
  }

  /** 실제 폰에 띄운 지금 명령·질문(답을 기다리는 중). 승인·다시 묻기·질문 단계는 질문(ask), 그 밖은 부탁(command). 없으면 null. */
  openCommand(): { planId: string; stepId: string; kind: "command" | "ask"; text: string; choices: ActionChoice[] } | null {
    return this.core.answers.openCommand();
  }

  onDecision(d: DecisionRecord, prechecked?: CheckResult): void {
    this.core.start.onDecision(d, false, prechecked);
  }

  /** 말 부탁: 들은 말 부탁을 판단 기록 꼴(source speech)로 만들어 판단 받기 길에 넣는다(계획 전 검사·계획 모드·승인·실행이 PAM 판단과 같다). */
  onRequest(r: SpeechRequest): void {
    this.core.directives.cancel();
    if (this.core.goal.current()?.meal) this.core.goal.drop("replaced");
    this.core.start.request(r);
  }

  /** 폰 눈(맞춘 자세)의 평면 자리 [x, z]. 맞추기 전 추정 눈은 쓰지 않는다. 이동 단계는 다음 tick에 본다. */
  onNavigationReading(p:import("../../contract/phone.js").NavigationPose|{observed_ms:number}) {
    if("quality" in p) this.onNavigationPose(p); else this.core.navigation.missing(p.observed_ms);
  }
  onNavigationPose(p: import("../../contract/phone.js").NavigationPose) { this.core.navigation.pose(p); }

  onEye(position: XZ, estimated = false): void {
    if (!position.every(Number.isFinite)) return;
    // 추정 눈: 위치 맞춤을 다시 하는 중이다(그 전 맞춘 눈은 지금 것이 아니다)
    if (estimated) {
      this.core.eyeLostAt = this.core.clock.now();
      return;
    }
    this.core.eye = { position: [position[0], position[1]], at: this.core.clock.now() };
  }

  /** 답 단추(「완료」·질문 답·승인 답·계속·그만). 지금 명령의 계획·단계·답이 아니면 무시한다. 받았으면 true. */
  onAnswer(planId: string, stepId: string, choice: string): boolean {
    return this.core.answers.onAnswer(planId, stepId, choice);
  }

  /** 폰에서 들은 말(answers.ts onHeard). 받은 답, 다른 명령에 온 답이라 버림(stale), 답이 아님(null). */
  onHeard(text: string, at?: HeardAt): HeardResult {
    return this.core.answers.onHeard(text, at);
  }

  /** World State가 바뀌었다: 치운 물건을 다시 보고, 지금 단계가 됐는지 바로 본다. changes(그 변화 줄)를 주면 코치 계획의 다른 행동 계기도 본다:
   *  사람 방·가전·가전 설비 변화가 왔는데 지금 단계가 넘어가지 않았으면 strayed를 부른다. */
  onWorld(changes: readonly WorldChange[] = []): void {
    const core = this.core;
    core.steps.placed();
    core.safety.reminderTick();
    core.coach.see(changes);
    // 미리 세운 목표: 사람이 떠남(사람 사라짐 변화)을 그 자리에서 본다(판단을 바로 부르게 한다, goal.ts)
    if (!core.stopped) this.changedGoal();
    const r = core.run;
    if (core.stopped || r?.state !== "running") return;
    const gen = r.gen;
    if (core.steps.look(r) || r.gen !== gen) return;
    core.coach.strayOn(r, changes);
  }

  /** 코치 계획의 지금 사람 단계(들은 말 돕기, src/act/look.ts heard). 질문 중·사람 단계가 아님·코치가 아닌 계획·닫힌 계획이면 null. */
  coachStep(): Omit<Stray, "changes"> | null {
    return this.core.coach.coachStep();
  }

  /** 관찰 모드의 다시 알리기(tell_person, coach.ts tell). 보낸 글, 못 보냈으면 null. */
  tell(planId: string, stepId: string, mode: TellMode): string | null {
    return this.core.coach.tell(planId, stepId, mode);
  }

  /** 마지막으로 다시 알린(tell) 시각(Date.now 시계). 없으면 null. */
  toldAt(): number | null {
    return this.core.coach.toldAt();
  }

  /** 놓기 단계를 끝낸 물건(이미 치운 것, steps.ts placed). 계획 전·실행 전 검사와 대상 고르기가 이미 치운 것을 아는 근거로만 쓴다. */
  placed(): Placed {
    return this.core.steps.placed();
  }


  /** 지금 조용히 띄운 단계 이름(소리로 읽지 않고 지켜보는 중, 대시보드 말풍선 카드). 아니면 null. */
  quietStep(): string | null {
    return this.core.coach.quietStep();
  }

  /** 타이머(250ms)가 부른다: 검사 다시 보기, 지금 단계 보기, 멈춘 단계 알림, 다시 읽기, 시간 초과. 에이전트는 부르지 않는다. */
  tick(): void {
    const core = this.core;
    const { steps, safety } = core;
    if (!core.stopped) safety.reminderTick();
    if (!core.stopped) core.directives.tick();
    if (!core.stopped && core.start.resumeRequest()) return;
    const r = core.run;
    // 계획 전 찾기(대상이 안 보여 막은 판단)가 먼저, 계획 밖 가까이 가서 보기(판단 전 보기 B 뒤에도 모를 때)는 계획·찾기가 없을 때만 하고 막는 것이 생기면 거둔다
    // 사람이 손대는 행동 대상을 쓰는지 먼저 본다(쓰는 중이면 찾기·가까이 가서 보기가 그 종류로 사람을 보내지 않는다, use.ts)
    if (!core.stopped) core.use.update();
    // 쓰는 것을 보면 습관 FSM 한 걸음 앞의 할 일을 목표로 세우고 계획을 미리 만든다. 사람이 떠나면 판단을 바로 부른다(goal.ts)
    if (!core.stopped) this.changedGoal();
    // 계획이 끝난 뒤 사용자 위치 확인·충전 자리 돌아가기(그동안 계획 밖 가까이 가서 보기는 하지 않는다)
    if (!core.stopped) core.dock.tick();
    // 계획을 마친 완료 문장(실제 폰 명령 줄, 띄운 뒤 DONE_NOTICE_MS 뒤 지움)
    if (!core.stopped) noticeTick(core, core.clock.now());
    if (!core.stopped) core.finder.idle();
    if (!core.stopped) core.contents.idle();
    if (core.stopped || !r || !OPEN.has(r.state)) return;
    const now = core.clock.now();
    if (r.state === "planned" && !r.asking) return core.start.tryStart(r, now - r.since >= core.cfg.recheckMs);
    if (r.asking) {
      if (r.asking.why === "again" && steps.look(r)) return;
      if (now - r.askAt > core.cfg.askMs) return steps.finish(r, "failed", EXEC_TEXT.noAnswer);
      return steps.repeat(r, now);
    }
    if (r.state !== "running" || steps.look(r)) return;
    const step = core.stepOf(r);
    if (!step) return;
    if (now > r.deadline) return steps.timeout(r, step);
    // tell로 바꾼 글은 tellHoldMs 뒤 원래 명령으로 되돌린다(읽지 않는다)
    if (r.told && now >= r.told.until && r.sent) {
      r.sent = { ...r.sent, text: r.told.text, speak: false };
      r.told = null;
      core.robot.commands.show(r.sent);
    }
    core.coach.strayNear(r, step);
    safety.offAsk(r, step, now);
    // 조용한 단계가 QUIET_HINT_MS 안에 안 끝나면 한 번 읽는다(그 단계는 혼자 해낸 것으로 세지 않는다)
    if (r.quietOn && r.sent && now - r.stepAt >= QUIET_HINT_MS) {
      r.quietOn = false;
      r.helped = true;
      r.spokeAt = now;
      core.robot.commands.show({ ...r.sent, speak: true });
    }
    steps.stall(r, step, now);
    if (HUMAN_KINDS.includes(step.kind) || step.kind === "ask") steps.repeat(r, now);
  }

  /** 가까이 보는 차례인가(찾기 비추기·가까이 보기, 내용물 보류 잘라 보기·위에서 보기). */
  looking(): boolean {
    const core = this.core;
    return !core.stopped && (!!core.run?.top || core.finder.looking() || core.contents.looking());
  }

  /** VLM 사진 간격을 줄일 때인가(src/observe/pipeline.ts vlmFast, FAST_VLM_MS 1초): 가까이 보는 차례이거나 미리 세운 목표가 서 있는 동안(세움·떠남).
   *  목표가 버려지거나 계획이 시작되면(씀) 원래 간격이다(2026-11-18 사용자 결정: 목표 동안 컵 확정(사진 2장)을 빨리). */
  fastVlm(): boolean {
    const core = this.core;
    return !core.stopped && (this.looking() || core.goal.current() !== null);
  }

  /** 판단 전 보기 B가 그 컵을 잘라 봤다(src/act/look.ts looked): 계획 밖으로 가까이 가서 볼지 본다. */
  lookedIdle(objectId: string): void {
    this.core.contents.lookedIdle(objectId);
  }

  /** 멈추면 더 기록하지 않고 폰에도 보내지 않는다. 만들던 계획과 멈춘 단계 알림은 끊는다. */
  stop(): void {
    const core = this.core;
    core.directives.close();
    core.manager.cancel();
    core.goal.stop();
    if (core.run) core.steps.endTop(core.run);
    if (core.run) core.contents.release(core.run);
    if (core.run) core.finder.release(core.run);
    core.contents.dropIdle();
    core.finder.drop();
    core.dock.drop();
    core.planning?.abort.abort();
    core.planning = null;
    core.run?.stepEnd?.abort();
    const a = core.run?.asking;
    if (a?.why === "device") core.o.appliances.run?.cancel(a.token);
    // 집기·내려놓기 대상(World State focus)도 푼다
    core.o.state.focusObject?.(null);
    core.stopped = true;
    core.robot.commands.close();
  }

  /** 행동 중 기다리기·기기 단계인가: 그동안 판단(PAM)을 멈추고 다른 행동으로 바꾸지 않는다(src/brain/decide.ts hold). */
  waiting(): boolean {
    return this.core.waiting();
  }

  /** 코치 행동(TaskSpec.coach) 계획이 열려 있거나 만드는 중인가: 그동안 판단 호출(PAM)을 쉰다(src/server/home/act.ts hold). */
  coaching(): boolean {
    const core = this.core;
    if (core.stopped) return false;
    const open = core.open();
    return taskOf(open?.plan.task ?? null)?.coach === true || taskOf(core.planning?.decision.action ?? null)?.coach === true;
  }

  /** 줄에서 기다리는 끄기 안내를 마지막으로 소리로 알린 가전 이름과 시각(Date.now, 대시보드 말풍선 카드). 없으면 null. */
  offTold(): { device: string; atMs: number } | null {
    return this.core.safety.offTold();
  }

  /** 끄기 안내 때문에 새 계획 시작을 미루는 중이면 기다리는 가전 이름(대시보드 말풍선 카드). 아니면 null. */
  offWaiting(): string | null {
    return this.core.safety.offWaiting();
  }

  /** 끄기 추적 요약(GET /api/plan off, 영상 판정): 지금 계획 hot 가전과 끄기 안내가 떠 있거나 줄에서 기다리는 가전. 멈췄으면 빈 요약. */
  offTrack(): OffTrack {
    return this.core.safety.offTrack();
  }

  /** 켠 위험 가전 추적(시험·안내 자리): 지금 계획의 hot, 가전마다 지금 켜기 회차, 풀린 가전과 그 근거. */
  safety(): { hot: string[]; cycles: Record<string, Cycle>; released: Record<string, { planId: string; evidenceAt: number; via: CycleEnd["via"] }> } {
    return this.core.safety.snapshot();
  }

  /** 만들던 계획이 끝날 때까지 기다린다(시험용). */
  async idle(): Promise<void> {
    await Promise.all([this.core.start.idle(), this.core.goal.idle()]);
  }
}
