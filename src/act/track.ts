// 실행 추적: 판단 → 계획(에이전트 계획 모드) → 실행 중 → 완료 또는 실패. 단계마다 execution 기록을 낸다(plan_id는 plan:<판단 id>).
// 판단 하나마다 한 번만 정한다: 늦은 답·판단 실패·대기·진행 중(또는 계획을 만드는 중)인 행동과 같은 행동은 기록만 하고, 계획 전 검사(LLM 없음)를
// 통과하면 에이전트를 계획 모드로 한 번 부른다(planner). 같은 행동은 planGapMs 안에 다시 부르지 않는다(「가까이 본 뒤 다시 판단」으로 닫은 계획은 세지 않는다). 주기 tick은 에이전트를 부르지 않는다.
// 계획을 만들지 않는 행동(TaskSpec.plan false, 컵 그대로 두기): 계획 전 검사를 통과하면 에이전트를 부르지 않고 실제 폰에도 보내지 않으며
// 그 판단 줄에 「그대로 둠」만 남긴다(leftGapMs에 한 번). 진행 중인 다른 계획은 바꾸지 않는다. 대시보드 말풍선 카드는 leftAt()으로 그 시각을 본다.
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
// 다시 알리기(tell)·사람 부탁(askCloser)은 모델이 쓴 글이라, 위험 가전 이름이 나오거나 지금 단계가 위험 가전 단계(대상이 위험 가전이거나 hand_device가 붙음)면 보내지 않는다(기본 거부).
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
// 사람 부탁(askCloser)은 지금 그 계획의 그 사람 단계일 때만 같은 계획·단계 id로 명령 글만 바꿔 다시 보낸다(소리로 읽음).
// 판단 뒤 가까이 본 사실(관찰 모드 B는 PAM을 막지 않는다): 그 행동 대상 종류 물건의 볼 면(TaskSpec.look)을 판단 뒤에 가까이 보기가 바꿨고
// (World State closer_rev가 판단 기록의 횟수와 다름) 지금 값이 판단 때 본 값과 다르면, 판단을 받을 때와 계획을 받을 때 실행하지 않고
// 「가까이 본 뒤 다시 판단」만 남긴다. 계획을 받은 뒤 첫 명령 전(승인 답·실행 전 검사를 기다리는 사이)이면 시작하지 않고 그 기록으로 계획을 취소로 닫는다.
// 다음 판단이 새 사실로 다시 고른다. 첫 명령을 보낸 뒤에는 멈추지 않는다: 단계마다 끝나는 조건을 World State로 보고, 멈춘 단계의 가까이 보기(A)가
// 그 면을 바꾸는 것도 이 계획의 관찰이다. 다른 행동이 맞으면 다음 판단이 새 계획으로 바꾼다.
// 치운 물건(placed): 놓기 단계를 끝낸 물건과 그 계획의 넣은 곳(끝낸 때 싱크볼 안이면 그 싱크볼)을 남긴다. VLM 자리 사실이 싱크대 안이 아니어도
// 계획 전·실행 전 검사·계획 입력·제출 검사와 대상 고르기가 이미 치운 것으로 본다. 다시 집거나(손에 있음 확인됨) 그 영역 밖(다른 면, 싱크볼이면 싱크볼 밖)에서 보이면 지운다.
import type { BrainLog, ExecState, DecisionRecord } from "../contract/events.js";
import type { HeardAt, PhoneStepKind, PlannedCommand, PlannedCommandMessage } from "../contract/phone.js";
import type { OffTrack, PlanView, StepStatus, XZ } from "../contract/plan.js";
import type { Facet, WorldChange, WorldChangeKind, WorldEye, WorldObject, WorldView } from "../contract/world.js";
import type { LookSpot } from "../observe/index.js";
import type { FloorPlan } from "../layout/index.js";
import type { PlanHub } from "./hub.js";
import { AGAIN_TEXT, APPROVAL_TEXT, CAUTION_TEXT, CLOSER_TEXT, DEVICE_UNKNOWN, EXEC_TEXT, TELL_TEXT, VISION_TEXT, type TellMode } from "./labels.js";
import { placeName, type PlaceNames } from "../layout/index.js";
import { roomAt } from "../layout/index.js";
import { OBJECT_NAME, PLACE_UNKNOWN, STATE_TEXT, onSurface } from "../world/labels.js";
import { ConditionWatch, type Condition, type ConditionContext } from "../world/index.js";
import { DEVICE_STATES, NEAR_M, PHONE_NEAR_M } from "../world/vocab.js";
import { approvalNeed, taskKey, type ApprovalAnswer, type ApprovalBook } from "../agent/index.js";

import { HUMAN_KINDS, TOOL_STATES, needsPhone, objectNames, riskyHand, selfStopWait, type AgentPlan, type AgentStep, type PlanResult } from "../agent/index.js";
import { offStep } from "./off-step.js";
import { talkGrade } from "./talk-grade.js";
import type { ToolResult } from "../agent/index.js";
import type { CheckResult } from "./check.js";
import { QUIET_HINT_MS, quietLabels, type LessonBook, type StepOutcome } from "./lessons.js";
import { AGAIN, APPROVE, STEP_DONE, STOP, type ActionChoice } from "./prompts.js";
import { clearsAway, matchChoice, planIdOf, taskOf, type Placed } from "./tasks.js";

/** 기기 단계 실행(src/server/home.ts: 기기 도구 + 정책). run이 승인 토큰을 내면 실제 폰에 묻고 confirm·cancel로 답한다.
 *  결과의 unverified(ThinQ가 받았지만 다시 읽은 값이 다름)·state 「모름」(신호 없음)은 적용을 확인하지 못한 것이다. */
export interface DeviceRunner {
  /** live가 거짓이면(계획이 바뀌었거나 닫힘) 가전에 보내지 않는다. 보내기 바로 앞에서 본다. */
  run(tool: string, deviceId: string, args: Record<string, unknown>, live: () => boolean): Promise<ToolResult>;
  confirm(token: string, live: () => boolean): Promise<Pick<ToolResult, "ok" | "error" | "unverified" | "state">>;
  cancel(token: string): void;
}

export interface TrackerOptions {
  plans: PlanHub;
  world: () => WorldView;
  /** 계획 전 검사(src/act/check.ts checkDecision). 에이전트를 부르기 전에 본다. 없으면 통과. */
  precheck?: (d: DecisionRecord) => CheckResult;
  /** 실행 전 검사(src/act/check.ts checkPlan). */
  check: (d: DecisionRecord, plan: PlanView) => CheckResult;
  /** 에이전트 계획 모드(src/agent/planner.ts). 판단 하나에 한 번 부른다. 새 판단·「그만」·멈춤이면 signal을 끊는다. */
  planner: (d: DecisionRecord, signal: AbortSignal) => PlanResult | Promise<PlanResult>;
  floor: () => FloorPlan;
  /** 실제 폰으로 보낸다: 명령(command)·지우기(command_clear). 폰 서버가 명령 대상 자리를 AR 자리로 바꾼다. */
  toPhone: (msg: PlannedCommandMessage) => void;
  /** 평면도 물건의 이름과 트윈 자리 [x, 높이, y](명령 대상 고리·가까이 볼 자리, 면이면 윗면 가운데). 모르면 undefined. */
  locate?: (id: string) => { label: string; position: [number, number, number] } | undefined;
  /** 부르는 이름 자료(src/layout/names.ts, 계획 단계와 같은 것). 배치 이름이 없으면 locate 이름을 배치 이름으로 본다. */
  names?: PlaceNames;
  emit: (l: BrainLog) => void;
  /** 승인 기억(task:<행동 이름>). 처음 하는 계획은 묻고, 답을 남긴다. */
  approvals: ApprovalBook;
  /** 기기 단계 실행. 없으면 기기 단계는 실패한다. */
  devices?: DeviceRunner;
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
  /** 계획 없는 행동(그대로 두기)의 기록을 다시 남기기 전 기다리는 시간(ms). */
  leftGapMs?: number;
  /** 수업 기록(코치 계획의 잘한 단계 말 줄이기). 없으면 기록하지 않고 모든 명령을 읽는다. */
  lessons?: LessonBook;
  /** 코치 계획 중 다른 행동을 본 것 같을 때(관찰 모드 계기 off_track, src/act/look.ts). 받았으면 true(그때만 센다). 없으면 부르지 않는다. */
  strayed?: (s: Stray) => boolean;
  /** 다른 행동 알림을 이보다 자주(ms) 부르지 않는다. */
  strayGapMs?: number;
  /** 단계마다 다른 행동 알림 상한(받은 것만). */
  strayMax?: number;
  /** tell로 바꾼 명령 글을 이만큼(ms) 뒤 원래 명령으로 되돌린다. */
  tellHoldMs?: number;
  /** 이 집 가전(id·종류·이름): 손으로 켜는 단계가 위험 목록인지와 묻는 글의 이름. 없으면 손으로 켜는 단계는 모두 묻는다. */
  handDevices?: () => readonly { id: string; kind: string; label: string }[];
  /** 켠 채 닫힌 계획의 끄기 안내를 이만큼(ms)마다 다시 읽는다(줄에 다른 가전 안내가 있으면 차례를 돌린다). 지우지 않는다. */
  offHoldMs?: number;
  /** 풀린 가전이 풀린 근거 촬영 시각 뒤 이만큼(ms) 안에 다시 켜지면 추적을 다시 건다. */
  rearmMs?: number;
  /** 끄기 do 단계가 이만큼(ms) 넘게 안 끝나고 그 가전 상태가 이미 꺼짐이면 보이게 해 달라는 부탁을 한 번 보낸다. */
  showAskMs?: number;
  /** 판본이 맞는 실제 폰이 붙어 있는가(src/phone/server.ts ready). 없으면 늘 붙어 있다고 본다. */
  phoneReady?: () => boolean;
  /** 명령 줄을 바꾸지 않고 붙은 폰에 소리로만 알린다(src/server/home.ts가 폰 서버 reply에 잇는다). 줄에서 기다리는 끄기 안내가 쓴다. */
  sayAloud?: (text: string) => void;
  /** 멈춘 집기·놓기 단계 알림(관찰 모드 A, src/act/look.ts). 받았으면 true(그때만 센다). 받은 부름은 끝날 때 s.settle(counted)를 부른다. 없으면 부르지 않는다. */
  stalled?: (s: Stall) => boolean;
  /** 집기·놓기 단계가 이만큼(ms) 안 끝나면 stalled를 부른다(단계 시작 뒤, 받은 부름 뒤). */
  stallMs?: number;
  /** 단계마다 stalled를 받아 센 횟수 상한(settle(false)로 돌려받은 부름은 넣지 않는다). */
  stallMax?: number;
}

/** 기본값: 다시 읽기 30초, 비전 상태 0.5초에 한 번, 검사 3초, 승인 답 2분, 같은 행동 다시 계획 15초, 그대로 두기 기록 60초에 한 번, 멈춘 단계 8초·단계마다 3번,
 *  끄기 안내 다시 읽기 2분, 다시 걸기 10분, 끄기 단계 부탁 20초. 단계 시간 한도는 계획 단계마다 있다. */
export const TRACK_DEFAULTS = {
  repeatMs: 30_000, visionMs: 500, recheckMs: 3000, askMs: 120_000, planGapMs: 15_000, leftGapMs: 60_000, stallMs: 8000, stallMax: 3, offHoldMs: 120_000, strayGapMs: 6000, strayMax: 2, tellHoldMs: 8000,
  rearmMs: 600_000, showAskMs: 20_000,
} as const;

/** 코치 계획 중 다른 행동을 본 것 같다: 지금 단계(이름·명령·번호 1부터)와 계획 단계 목록, 방금 본 변화 줄(최근 30초, 오래된 것부터, 들은 말은 넣지 않는다).
 *  signal은 이 단계가 끝나면 끊긴다. */
export interface Stray {
  planId: string; stepId: string; label: string; command: string; steps: { label: string; status: StepStatus }[]; at: number;
  changes: string[]; signal: AbortSignal;
}

/** 켜기 회차: 회차 번호(가전마다 1부터), 회차 시작 시각(켜라고 한 시각, 다시 걸면 그 켜짐의 촬영 시각), 이 회차에 보낸 첫 부탁 시각. */
export interface Cycle { cycle: number; onAt: number; askedAt: number | null }
/** 작동 한 번 끝남 판정(cycleEnded): switch(아는 켜짐 → 꺼짐) 또는 confirmed(부탁 뒤 가까이 본 명시 꺼짐), 근거 촬영 시각, 회차 번호. */
export interface CycleEnd { via: "switch" | "confirmed"; evidenceAt: number; cycle: number }

/** 끄기 안내 하나: 그 가전, 실제 폰 명령의 계획·단계 id와 글. ask면 보이게 해 달라는 부탁(답 단추 없음). */
interface OffNote { planId: string; step: string; deviceId: string; text: string; ask: boolean }

type DeviceView = WorldView["devices"][number];
type HistoryLine = DeviceView["history"][number];
/** 작동 한 번의 켜짐·꺼짐 값: 전원 켜짐 → 꺼짐, 작동 중 → 멈춤. */
const CYCLE_VALUES: readonly { attr: string; on: unknown; off: unknown }[] = [
  { attr: DEVICE_STATES.on.attr, on: DEVICE_STATES.on.value, off: DEVICE_STATES.off.value },
  { attr: DEVICE_STATES.running.attr, on: DEVICE_STATES.running.value, off: DEVICE_STATES.stopped.value },
];
/** 이력 줄의 근거 시각: 카메라면 근거 사진 촬영 시각(seen_ms), 허브·실제 가전 신호면 도착 시각. */
const evidenceTime = (h: HistoryLine) => h.seen_ms ?? h.at_ms;
/** 지금 상태가 켜짐(켜짐·작동 중)을 말하는가. */
const onNow = (d: DeviceView) => d.state.includes("on") || d.state.includes("running");
/** 지금 상태가 이미 꺼짐(꺼짐·멈춤, 켜짐 아님)인가. 신호가 없거나 가전을 모르면 아니다. */
const offNow = (d: DeviceView | undefined) => !!d && d.status !== null && !onNow(d) && (d.state.includes("off") || d.state.includes("stopped"));
/** after 뒤(until까지) 그 가전이 켜졌다는 근거 시각(촬영 시각) 가운데 가장 이른 것(last면 가장 늦은 것). 이력의 켜짐 줄(허브·실제 가전 신호·카메라 명시·추정)과
 *  카메라 마지막 관측(sight_last, 허브가 꺼짐을 말해 이력 줄이 없을 때도 남는다)의 켜짐을 본다. 없으면 null. */
function onSeenAfter(d: DeviceView | undefined, after: number, until = Number.POSITIVE_INFINITY, last = false): number | null {
  if (!d) return null;
  const lines = d.history.filter((h) => CYCLE_VALUES.some((k) => h.attr === k.attr && h.to === k.on)).map(evidenceTime);
  const seen = CYCLE_VALUES.flatMap((k) => {
    const s = d.sight_last?.[k.attr];
    return s && s.value === k.on ? [s.seen_ms] : [];
  });
  const times = [...lines, ...seen].filter((x) => x > after && x <= until);
  return times.length ? (last ? Math.max(...times) : Math.min(...times)) : null;
}

/** 다른 행동의 계기가 되는 변화: 사람 방, 가전 상태, 가전 설비 상태. */
const STRAY_KINDS: ReadonlySet<WorldChangeKind> = new Set<WorldChangeKind>(["person_room", "device", "fixture"]);
/** 방금 본 변화 줄에 넣지 않는 것: 프레임마다 오는 줄과 들은 말. */
const QUIET_KINDS: ReadonlySet<WorldChangeKind> = new Set<WorldChangeKind>(["vlm", "vlm_missing", "yolo_missing", "heard"]);
/** 방금 본 변화 줄을 두는 시간(ms). */
const STRAY_KEEP_MS = 30_000;
/** 놓기를 끝낸 물건이 사라진 뒤 새 id로 다시 잡히기를 기다리는 시간(ms). 등장 확인(물건 4초)·사라짐(6초)보다 넉넉히. */
const PUT_HANDOVER_MS = 30_000;

/** 멈춘 집기·놓기 단계. command: 실제 폰에 띄운 지금 명령 글. stuckMs: 단계 시작 뒤 지난 시간. looks: 이 단계에서 센 부름 수(시도).
 *  spots: 계획 물건(지금 따라가는 World State 물건, 자리를 알 때)과 단계 대상 자리(평면도, 물건과 다를 때).
 *  gen: 단계 세대(단계가 바뀌거나 계획이 닫힐 때마다 오른다). signal: 이 단계가 끝나면(다음 단계·완료·실패·그만·새 계획·멈춤) 끊긴다.
 *  settle(counted): 받은 부름(stalled가 true)이 끝나면 부른다. 받을 때 시도로 먼저 세고, settle(false)면(자원 사정: 가까이 보기 no_fresh_frames·vlm_busy) 돌려받아
 *  stallMax에 넣지 않는다. settle(true)는 그대로 센다. 처음 한 번만 듣고, 그 단계 세대가 지났으면(다른 단계·닫힌 계획) 아무것도 하지 않는다.
 *  다음 부름은 셈과 상관없이 받은 부름에서 stallMs 뒤다. */
export interface Stall {
  planId: string; stepId: string; kind: "pick" | "place" | "do"; label: string; command: string; until: Condition;
  stuckMs: number; looks: number; spots: LookSpot[]; gen: number; signal: AbortSignal;
  settle(counted: boolean): void;
}

/** 들은 말의 결과: 답으로 받음, 말할 때와 다른 명령에 온 답이라 버림(stale), 답이 아님(null). */
export type HeardResult = { kind: "answer"; choice: ActionChoice } | { kind: "stale" } | null;

/** 실제 폰에 띄운 질문: 첫 단계 전 승인, 위험 목록 가전 승인(토큰), 시간 초과로 다시 묻기. */
type Asking = { why: "plan" } | { why: "device"; token: string } | { why: "again" } | { why: "hand" };

/** at: 지금 단계 번호(실행 전 -1). sent: 실제 폰에 띄운 지금 명령. others: 계획 물건 id → 계획을 받을 때 있던 같은 종류의 다른 물건.
 *  alias: 계획 물건 id → 지금 그 물건으로 보는 World State id(옮겨서 새 id가 붙으면 이어 간다). carried: 집기 단계를 마친(사람이 든) 계획 물건.
 *  device: 기기 단계 실행 상태(sent는 보냈지만 적용을 확인하지 못함). gen: 단계가 바뀔 때마다 올라 늦게 온 기기 결과를 버린다.
 *  deadline: 이 단계 시간 한도(계속이면 한 번 늘어난다). again: 이 단계에서 시간 초과로 한 번 다시 물었다.
 *  looks·lookAt: 이 단계에서 받아 센 멈춘 단계 부름 수(돌려받은 것은 뺌)와 마지막으로 받은 시각. stepEnd: 이 단계가 끝나면 끊는 신호(멈춘 단계 알림). */
interface Run {
  plan: AgentPlan; decision: DecisionRecord; state: ExecState; since: number;
  at: number; stepAt: number; spokeAt: number; visionAt: number; sent: PlannedCommand | null;
  asking: Asking | null; askAt: number; watch: ConditionWatch | null; others: Map<string, Set<string>>; alias: Map<string, string>; carried: Set<string>;
  /** 평면도 물건의 평면 자리(따라가기 거리). */
  placeAt: (id: string | null) => XZ | null;
  deadline: number; again: boolean; device: "idle" | "running" | "done" | "sent"; gen: number;
  looks: number; lookAt: number; stepEnd: AbortController | null;
  /** 같은 행동 다시 계획 간격을 세려고 적은 시각(Job.at). */
  gapAt: number;
  /** 켜라고 한 가전과 지금 켜기 회차(추적을 풀어도 지우지 않는다. 다시 걸면 새 회차로 바뀐다). */
  onAt: Map<string, Cycle>;
  /** 아직 작동 한 번 끝남을 확인하지 못한 켠 가전(안전 추적). releaseIfOff만 빼고, 닫힐 때 handOver가 끄기 안내 줄로 옮긴다. */
  hot: Set<string>;
  /** 이 계획이 켠 가전마다 지금 회차가 풀린 근거(회차 번호·근거 촬영 시각·판정 길·푼 시각). 가전 이력(최근 몇 줄만 남음)에 기대지 않고 끄기 do 단계가 읽는다.
   *  회차가 바뀌거나 계획이 닫히면 지우고, 푼 뒤 rearmMs가 지나면 지운다(그 가전의 끄기 do 단계가 열려 있는 동안은 두고). */
  ends: Map<string, { cycle: number; seenAt: number; how: CycleEnd["via"]; at: number }>;
  /** 끄기 do 단계의 보이게 해 달라는 부탁을 보낸 단계 세대(단계마다 한 번). deferred: 끄기 안내 때문에 시작을 미룬다고 기록했다. */
  offAsked: number; deferred: boolean;
  /** 판본이 맞는 폰이 없어 시작을 미룬다고 기록했다. phone: 폰이 필요한 계획(needsPhone, 시작할 때 정한다). 폰 명령 줄을 쓰는 동안 끄기 안내는 기다린다. */
  phoneWait: boolean; phone: boolean;
  /** 이 단계에서 받은 다른 행동 알림 수와 마지막으로 부른 시각, 폰이 가까이 간 다른 자리(그 자리마다 한 번). */
  strays: number; strayAt: number; strayNear: string | null;
  /** tell로 바꿔 띄운 글: 되돌릴 원래 명령 글과 되돌릴 시각. */
  told: { text: string; until: number } | null;
  /** 이 단계에서 도움을 받았다(다시 읽기·다시 알리기·가까이 비춰 달라는 부탁·조용한 단계 힌트·시간 초과 질문): 혼자 해낸 단계로 세지 않는다. */
  helped: boolean;
  /** 조용히 띄울 단계 이름(지난 수업에서 이어서 혼자 해낸 단계). quietOn: 지금 단계를 조용히 띄웠고 아직 힌트를 읽지 않았다. */
  quiet: Set<string>; quietOn: boolean;
  /** 끝낸 사람 단계의 결과(수업 기록에 남길 것). */
  outcomes: StepOutcome[];
}

/** at: 같은 행동 다시 계획 간격(planGapMs)을 세려고 적은 시각. */
interface Job { decision: DecisionRecord; gen: number; abort: AbortController; at: number }

const OPEN = new Set<ExecState>(["planned", "running", "verifying"]);
const clsOf = (w: WorldView, id: string) => w.objects.find((o) => o.id === id)?.cls ?? id.replace(/_\d+$/, "");

export class ExecutionTracker {
  private run: Run | null = null;
  private planning: Job | null = null;
  /** 놓기 단계를 끝낸 물건(placed). */
  private readonly put = new Map<string, { target: string; part?: "basin"; atMs: number }>();
  /** 놓기를 끝낸 물건의 종류(새 id로 다시 잡혔을 때 같은 종류만 이어 간다). */
  private readonly putCls = new Map<string, string>();
  private readonly jobs = new Set<Promise<void>>();
  private readonly planAt = new Map<string, number>();
  private gen = 0;
  private lastSeq = 0;
  /** 마지막으로 기다리기·기기 단계가 시작된 시각. 그 전에 보낸 다른 행동 판단은 쓰지 않는다. */
  private quietFrom = -Infinity;
  private stopped = false;
  private eye: { position: XZ; at: number } | null = null;
  /** 마지막으로 「그대로 둠」을 기록한 시각: 간격을 세는 실행 추적 시계(leftNoteAt)와 말풍선 카드가 보는 Date.now 시계(leftWallAt). */
  private leftNoteAt = Number.NEGATIVE_INFINITY;
  private leftWallAt: number | null = null;
  private readonly clock: { now(): number };
  /** 켠 채 닫힌 계획의 끄기 안내: 실제 폰에 떠 있는 것(reminder, 띄운 시각)과 그 뒤에 띄울 것(offQueue). 가전마다 하나. */
  private reminder: { sent: PlannedCommand; at: number; note: OffNote } | null = null;
  private offQueue: OffNote[] = [];
  /** 줄에서 기다리는 끄기 안내를 마지막으로 소리로 알린 시각(실행 추적 시계, 다시 알릴 때를 센다)과 그 가전(다음 차례를 센다), 그 가전 이름·Date.now 시각(말풍선 카드). */
  private offToldAt: number | null = null;
  private offToldId: string | null = null;
  private offToldWall: { device: string; atMs: number } | null = null;
  /** 가전마다 지금 켜기 회차(계획이 닫혀도 남는다). */
  private readonly cycles = new Map<string, Cycle>();
  /** 추적이 풀린 가전: 그 계획, 풀린 근거 촬영 시각, 판정 길, 푼 시각(다시 걸기 rearmIfOn이 본다). */
  private readonly released = new Map<string, { planId: string; evidenceAt: number; via: CycleEnd["via"]; at: number }>();
  /** 방금 본 변화 줄(다른 행동 알림에 넣는다). */
  private seen: { at: number; text: string }[] = [];
  /** 마지막으로 tell을 보낸 시각(Date.now 시계, 대시보드 말풍선 카드). */
  private toldWallAt: number | null = null;
  private readonly cfg: {
    repeatMs: number; visionMs: number; recheckMs: number; askMs: number; planGapMs: number; leftGapMs: number; stallMs: number; stallMax: number; offHoldMs: number; strayGapMs: number; strayMax: number;
    tellHoldMs: number; rearmMs: number; showAskMs: number;
  };

  constructor(private readonly o: TrackerOptions) {
    this.clock = o.clock ?? { now: () => Date.now() };
    this.cfg = {
      repeatMs: o.repeatMs ?? TRACK_DEFAULTS.repeatMs, visionMs: o.visionMs ?? TRACK_DEFAULTS.visionMs, recheckMs: o.recheckMs ?? TRACK_DEFAULTS.recheckMs,
      askMs: o.askMs ?? TRACK_DEFAULTS.askMs, planGapMs: o.planGapMs ?? TRACK_DEFAULTS.planGapMs, leftGapMs: o.leftGapMs ?? TRACK_DEFAULTS.leftGapMs,
      stallMs: o.stallMs ?? TRACK_DEFAULTS.stallMs, stallMax: o.stallMax ?? TRACK_DEFAULTS.stallMax, offHoldMs: o.offHoldMs ?? TRACK_DEFAULTS.offHoldMs,
      strayGapMs: o.strayGapMs ?? TRACK_DEFAULTS.strayGapMs, strayMax: o.strayMax ?? TRACK_DEFAULTS.strayMax, tellHoldMs: o.tellHoldMs ?? TRACK_DEFAULTS.tellHoldMs,
      rearmMs: o.rearmMs ?? TRACK_DEFAULTS.rearmMs, showAskMs: o.showAskMs ?? TRACK_DEFAULTS.showAskMs,
    };
  }

  current(): { planId: string; state: ExecState } | null {
    return this.run && { planId: this.run.plan.view.id, state: this.run.state };
  }

  /** 마지막으로 「그대로 둠」을 기록한 시각(Date.now 시계, 계획 updatedAt과 같은 시계). 없으면 null. */
  leftAt(): number | null {
    return this.leftWallAt;
  }

  /** 실제 폰에 띄운 지금 명령·질문(답을 기다리는 중). 승인·다시 묻기·질문 단계는 질문(ask), 그 밖은 부탁(command). 없으면 null. */
  openCommand(): { planId: string; stepId: string; kind: "command" | "ask"; text: string; choices: ActionChoice[] } | null {
    // 끄기 안내가 떠 있으면 명령 줄은 그 안내다(폰이 필요 없는 가전 계획이 함께 돌 수 있다)
    const off = this.reminder;
    if (off && !this.stopped) return { planId: off.sent.id, stepId: off.sent.step, kind: "command", text: off.sent.text, choices: off.note.ask ? [] : [STEP_DONE] };
    const r = this.shown();
    if (!r) return null;
    const ask = r.asking !== null || this.stepOf(r)?.kind === "ask";
    return { planId: r.plan.view.id, stepId: r.sent.step, kind: ask ? "ask" : "command", text: r.sent.text, choices: choicesOf(r, this.stepOf(r)) };
  }

  onDecision(d: DecisionRecord): void {
    if (this.stopped) return;
    if (d.seq < this.lastSeq) return this.note(d, EXEC_TEXT.late);
    // 받은 가장 새 판단 번호: 기록만 한 판단(같은 행동 등)보다 먼저 보낸 판단이 늦게 와도 쓰지 않는다
    this.lastSeq = d.seq;
    // 기다리기·기기 단계 전에 보낸 판단이 그 뒤에 오면 낡은 관찰이라 쓰지 않는다(다시 부르는 판단이 새 관찰로 정한다)
    if (d.atMs < this.quietFrom && this.open()?.decision.action !== d.action) return this.note(d, EXEC_TEXT.late);
    if (d.status !== "valid") return this.note(d, EXEC_TEXT.decisionFailed);
    if (!d.action) return this.note(d, EXEC_TEXT.wait);
    const open = this.open();
    if (open?.decision.action === d.action || this.planning?.decision.action === d.action) return this.note(d, EXEC_TEXT.same);
    // 행동 중 기다리기·기기 단계에는 다른 판단으로 바꾸지 않는다(그동안 판단도 멈춘다, waiting)
    if (open && this.waiting()) return this.note(d, EXEC_TEXT.busy);
    if (this.closerNewer(d)) return this.note(d, EXEC_TEXT.closerNewer);
    const pre = this.o.precheck?.(d) ?? { ok: true };
    if (!pre.ok) {
      this.emit(planIdOf(d.id), "decided");
      this.emit(planIdOf(d.id), "failed", pre.text);
      return;
    }
    const now = this.clock.now();
    // 계획을 만들지 않는 행동(컵 그대로 두기): 에이전트를 부르지 않고 그 판단 줄에 기록만 한다. 열린 계획·만들던 계획은 건드리지 않는다
    if (taskOf(d.action)?.plan === false) {
      if (now - this.leftNoteAt < this.cfg.leftGapMs) return;
      this.leftNoteAt = now;
      this.leftWallAt = Date.now();
      this.emit(planIdOf(d.id), "decided");
      return this.emit(planIdOf(d.id), "done", EXEC_TEXT.left);
    }
    const last = this.planAt.get(d.action);
    if (last !== undefined && now - last < this.cfg.planGapMs) return this.note(d, EXEC_TEXT.held);
    this.planAt.set(d.action, now);
    // 계획을 만드는 중이던 다른 행동은 끊고 버린다(답이 와도 쓰지 않는다)
    this.dropPlanning(EXEC_TEXT.superseded);
    const job: Job = { decision: d, gen: ++this.gen, abort: new AbortController(), at: now };
    this.planning = job;
    this.emit(planIdOf(d.id), "decided");
    let out: PlanResult | Promise<PlanResult>;
    try {
      out = this.o.planner(d, job.abort.signal);
    } catch (e) {
      out = { ok: false, error: (e as Error).message };
    }
    if (!(out instanceof Promise)) return this.planned(job, out);
    const p = out.then((r) => this.planned(job, r), (e: unknown) => this.planned(job, { ok: false, error: (e as Error).message }))
      .finally(() => { this.jobs.delete(p); });
    this.jobs.add(p);
  }

  /** 폰 눈(맞춘 자세)의 평면 자리 [x, z]. 맞추기 전 추정 눈은 쓰지 않는다. 이동 단계는 다음 tick에 본다. */
  onEye(position: XZ, estimated = false): void {
    if (estimated || !position.every(Number.isFinite)) return;
    this.eye = { position: [position[0], position[1]], at: this.clock.now() };
  }

  /** 답 단추(「완료」·질문 답·승인 답·계속·그만). 지금 명령의 계획·단계·답이 아니면 무시한다. 받았으면 true. */
  onAnswer(planId: string, stepId: string, choice: string): boolean {
    const off = this.reminder;
    if (!this.stopped && off && off.sent.id === planId && off.sent.step === stepId) {
      // 「완료」는 확인된 꺼짐일 때만 지운다. 아니면 보이게 해 달라는 부탁으로 바꾼다(부를 이름이 없으면 그대로)
      if (choice !== STEP_DONE.id || off.note.ask) return false;
      if (!this.releaseIfOff(off.note.deviceId)) this.askToShow(off.note.deviceId);
      return true;
    }
    const r = this.shown();
    if (!r || r.plan.view.id !== planId || r.sent.step !== stepId) return false;
    const step = this.stepOf(r);
    const picked = choicesOf(r, step).find((c) => c.id === choice);
    if (!picked) return false;
    const a = r.asking;
    // 기한이 지난 답은 받지 않는다(시간 초과가 먼저다)
    const now = this.clock.now();
    if (a && now - r.askAt > this.cfg.askMs) {
      this.finish(r, "failed", EXEC_TEXT.noAnswer);
      return false;
    }
    if (!a && step && now > r.deadline) {
      this.timeout(r, step);
      return false;
    }
    if (a?.why === "plan") this.approvedPlan(r, picked.id as ApprovalAnswer);
    else if (a?.why === "device") this.approvedDevice(r, a.token, picked.id as ApprovalAnswer);
    else if (a?.why === "hand") this.approvedHand(r, picked.id as ApprovalAnswer);
    else if (a?.why === "again") {
      if (picked.id === "continue") this.resume(r);
      else this.finish(r, "failed", EXEC_TEXT.stopped, "cancelled");
    } else if (step?.kind === "ask") {
      if (r.at + 1 >= r.plan.steps.length || step.prompt?.ends.includes(picked.id)) this.finish(r, "done", EXEC_TEXT.answered(picked.label));
      else this.advance(r);
    } else this.advance(r);
    return true;
  }

  /** 폰에서 들은 말. at: 말할 때 폰에 떠 있던 명령(새 폰은 늘 싣는다. 칸이 없으면 옛 탭).
   *  「그만」은 at과 상관없이(칸이 없어도) 계획을 그만두는 답으로 받는다(명령이 없는 기다리기·기기 단계·만드는 중인 계획도).
   *  지금 명령(질문·승인 질문 포함)의 답 말이면 at이 그 명령(계획 id·단계 id)일 때만 그 답으로 받고, at이 다른 명령·none이거나 칸이 없으면 버린다(stale).
   *  떠 있는 끄기 안내의 「완료」·「다 했어」는 버린다(확인된 꺼짐으로만 푼다). 지금 명령이 없는데 at이 명령인 「완료」·「다 했어」도 버린다. 그 밖은 답이 아니다(null). */
  onHeard(text: string, at?: HeardAt): HeardResult {
    if (this.stopped) return null;
    const open = this.open();
    // 명령이 없는 단계(기다리기·기기)와 만드는 중인 계획에도 「그만」은 받는다
    if ((open || this.planning) && matchChoice(text, [STOP])) {
      this.dropPlanning(EXEC_TEXT.stopped);
      if (open) this.finish(open, "failed", EXEC_TEXT.stopped, "cancelled");
      return { kind: "answer", choice: STOP };
    }
    const r = this.reminder ? null : this.shown();
    if (r) {
      const picked = matchChoice(text, choicesOf(r, this.stepOf(r)));
      if (!picked) return null;
      if (at?.kind !== "command" || at.id !== r.plan.view.id || at.step !== r.sent.step) return { kind: "stale" };
      this.onAnswer(r.plan.view.id, r.sent.step, picked.id);
      return { kind: "answer", choice: picked };
    }
    if (matchChoice(text, [STEP_DONE]) && (this.reminder || at?.kind === "command")) return { kind: "stale" };
    return null;
  }

  /** World State가 바뀌었다: 치운 물건을 다시 보고, 지금 단계가 됐는지 바로 본다. changes(그 변화 줄)를 주면 코치 계획의 다른 행동 계기도 본다:
   *  사람 방·가전·가전 설비 변화가 왔는데 지금 단계가 넘어가지 않았으면 strayed를 부른다. */
  onWorld(changes: readonly WorldChange[] = []): void {
    this.placed();
    this.reminderTick();
    const now = this.clock.now();
    this.seen = [...this.seen, ...changes.filter((c) => !QUIET_KINDS.has(c.kind)).map((c) => ({ at: now, text: c.text }))].filter((c) => now - c.at <= STRAY_KEEP_MS);
    const r = this.run;
    if (this.stopped || r?.state !== "running") return;
    const gen = r.gen;
    if (this.look(r) || r.gen !== gen) return;
    if (changes.some((c) => c.meaningful && STRAY_KINDS.has(c.kind))) this.stray(r);
  }

  /** 코치 계획의 지금 사람 단계(들은 말 돕기, src/act/look.ts heard). 질문 중·사람 단계가 아님·코치가 아닌 계획·닫힌 계획이면 null. */
  coachStep(): Omit<Stray, "changes"> | null {
    const r = this.run;
    const step = r ? this.stepOf(r) : undefined;
    if (this.stopped || !r || r.state !== "running" || r.asking || !r.sent || !r.stepEnd || !step || !HUMAN_KINDS.includes(step.kind)) return null;
    if (taskOf(r.plan.task)?.coach !== true) return null;
    return {
      planId: r.plan.view.id, stepId: step.id, label: step.label, command: step.command ?? r.sent.text, at: r.at + 1,
      steps: (this.o.plans.current()?.id === r.plan.view.id ? this.o.plans.current()!.steps : r.plan.view.steps).map((s) => ({ label: s.label, status: s.status })),
      signal: r.stepEnd.signal,
    };
  }

  /** 다른 행동 알림: 코치 계획의 사람 단계이고 단계마다 strayMax번·strayGapMs에 한 번 안이면 strayed를 부른다. 받은 것만 센다. more는 덧붙일 변화 줄. */
  private stray(r: Run, more: string[] = []): void {
    if (!this.o.strayed || r.strays >= this.cfg.strayMax) return;
    const now = this.clock.now();
    if (now - r.strayAt < this.cfg.strayGapMs) return;
    const at = this.coachStep();
    if (!at) return;
    if (!this.o.strayed({ ...at, changes: [...this.seen.map((c) => c.text), ...more] })) return;
    r.strayAt = now;
    r.strays++;
  }

  /** 폰이 지금 단계 자리를 떠나 다른 평면도 자리 가까이로 갔는가(이동 단계는 보지 않는다). 그 자리마다 한 번 다른 행동 알림을 부른다. */
  private strayNear(r: Run, step: AgentStep): void {
    if (!this.o.strayed || step.kind === "go" || !HUMAN_KINDS.includes(step.kind) || r.asking) return;
    const e = this.eye;
    const fp = this.o.floor();
    const here = step.target ? fp.objects.get(step.target)?.position ?? null : null;
    if (!e || !here || this.clock.now() - e.at > STRAY_KEEP_MS) return;
    const far = (p: XZ) => Math.hypot(e.position[0] - p[0], e.position[1] - p[1]);
    if (far(here) <= PHONE_NEAR_M) {
      r.strayNear = null;
      return;
    }
    const near = [...fp.objects.values()].filter((o) => o.id !== step.target && this.nameOf(o.id) && far(o.position) <= PHONE_NEAR_M).sort((a, b) => far(a.position) - far(b.position))[0];
    if (!near || near.id === r.strayNear) return;
    r.strayNear = near.id;
    this.stray(r, [VISION_TEXT.movedNear(this.nameOf(near.id)!)]);
  }

  /** 관찰 모드의 다시 알리기(tell_person): 지금 그 계획의 그 사람 단계면 명령 글을 서버 글 한 줄(지금 명령 그대로, 또는 「먼저」를 붙인 것)로 바꿔 소리로 읽고,
   *  tellHoldMs 뒤 원래 명령으로 되돌린다(되돌릴 때는 읽지 않는다). 단계가 넘어가면 되돌리지 않는다(새 명령이 이미 떴다).
   *  켜기 전 질문 중과 손 조작 단계에는 보내지 않는다. 보낸 글, 못 보냈으면 null. */
  tell(planId: string, stepId: string, mode: TellMode): string | null {
    const r = this.run;
    const step = r ? this.stepOf(r) : undefined;
    if (this.stopped || !r || r.state !== "running" || r.asking || !r.sent || !step || !HUMAN_KINDS.includes(step.kind)) return null;
    if (r.plan.view.id !== planId || step.id !== stepId || r.sent.step !== stepId || !step.command || this.handStep(step) || !Object.hasOwn(TELL_TEXT, mode)) return null;
    const said = TELL_TEXT[mode](step.command);
    const now = this.clock.now();
    r.told = { text: r.told?.text ?? r.sent.text, until: now + this.cfg.tellHoldMs };
    r.spokeAt = now;
    r.helped = true;
    r.quietOn = false;
    r.sent = { ...r.sent, text: said, speak: true };
    this.toldWallAt = Date.now();
    this.send(r.sent);
    return said;
  }

  /** 마지막으로 다시 알린(tell) 시각(Date.now 시계). 없으면 null. */
  toldAt(): number | null {
    return this.toldWallAt;
  }

  /** 놓기 단계를 끝낸 물건(이미 치운 것): World State id → 그 계획의 넣은 곳, 끝낸 때 싱크볼 안이었으면 part basin, 끝낸 시각.
   *  그 뒤 손에 있음이 확인되거나(다시 집음, VLM 한 번의 손에 있음은 싱크대 속 컵에도 나와 확인됨만 본다) 트윈 자리가 그 영역을 벗어나거나
   *  (다른 면·면 없음, part basin이면 같은 면이어도 싱크볼 밖: 옮김) 사라지면 지운다. 사라진 뒤 같은 종류가 그 넣은 곳에 새 id로 다시 잡히면 그 물건으로 이어 간다.
   *  돌려줄 때는 지금 싱크볼 안이고 손에 있음이 확인되지 않은 물건도 더한다(넣은 기억이 없어도 치운 것).
   *  계획을 만들지 않는다. 계획 전·실행 전 검사와 대상 고르기가 이미 치운 것을 아는 근거로만 쓴다. */
  placed(): Placed {
    const objects = this.o.world().objects;
    const now = this.clock.now();
    for (const [id, p] of this.put) {
      const o = objects.find((x) => x.id === id);
      const hand = o?.facts.place;
      const picked = hand?.value === "in_hand" && hand.certainty === "confirmed" && hand.at_ms > p.atMs;
      // 트윈 자리를 모르는 채(맞추기 전) 본 것은 옮긴 근거가 아니다
      const out = !!o && (o.surface !== p.target || (p.part !== undefined && o.surface_part !== p.part));
      const moved = !!o && o.last_seen_ms > p.atMs && o.position !== null && out;
      if (picked || moved) {
        this.put.delete(id);
        this.putCls.delete(id);
      } else if (!o || o.status === "gone") this.carryPut(id, p, objects, now);
    }
    // 싱크볼 안에 있고 손에 있음이 확인되지 않은 물건도 치운 것이다(치우기 계획 놓기 끝 자리: 싱크대 면의 싱크볼 안이고 손에 없음).
    // 실행 추적이 넣은 기억이 없는 컵(서버를 다시 띄운 뒤 본 컵, 새 id로 잡힌 컵)을 다시 치우지 않게 한다(2026-11-16 23:48)
    const all = new Map(this.put);
    for (const o of objects) {
      if (all.has(o.id) || o.status === "gone" || o.surface === null || o.surface_part !== "basin") continue;
      if (o.facts.place?.value === "in_hand" && o.facts.place.certainty === "confirmed") continue;
      all.set(o.id, { target: o.surface, part: "basin", atMs: o.first_seen_ms });
    }
    return all;
  }

  /** 놓기를 끝낸 물건이 사라졌다: 같은 종류 물건이 그 넣은 곳(싱크볼이었으면 싱크볼)에 새 id로 다시 잡혔으면 그 물건으로 이어 간다
   *  (놓은 컵이 끝낸 뒤 2초 만에 새 id로 잡혀 치운 기억이 없어졌다, 2026-11-16 23:36). 아직 없으면 PUT_HANDOVER_MS 동안 기다린다. */
  private carryPut(id: string, p: { target: string; part?: "basin"; atMs: number }, objects: WorldView["objects"], now: number): void {
    const cls = this.putCls.get(id);
    const next = objects.filter((o) => o.id !== id && o.status !== "gone" && o.cls === cls && o.surface === p.target
      && (p.part === undefined || o.surface_part === p.part) && o.first_seen_ms >= p.atMs - PUT_HANDOVER_MS && !this.put.has(o.id));
    if (next.length || now - p.atMs > PUT_HANDOVER_MS) {
      this.put.delete(id);
      this.putCls.delete(id);
    }
    for (const o of next) {
      this.put.set(o.id, p);
      if (cls) this.putCls.set(o.id, cls);
    }
  }

  /** 놓기 단계를 끝낸 물건을 적는다: 지금 그 물건으로 보는 World State id(따라가지 못하면 계획 물건 id)와 그 계획의 넣은 곳.
   *  그때 트윈 자리가 넣은 곳 면의 싱크볼 안이면 part basin도 적는다(그 뒤 싱크볼 밖이면 옮긴 것). */
  private remember(r: Run, object: string, target: string): void {
    const now = this.clock.now();
    const objs = ours(r, object, this.o.world()).filter((o) => o.status !== "gone");
    const at = objs.length ? objs.map((o) => ({ id: o.id, basin: o.position !== null && o.surface === target && o.surface_part === "basin" })) : [{ id: r.alias.get(object) ?? object, basin: false }];
    const cls = objs[0]?.cls ?? this.o.world().objects.find((o) => o.id === (r.alias.get(object) ?? object))?.cls ?? object.replace(/_\d+$/, "");
    for (const { id, basin } of at) {
      this.put.set(id, { target, ...(basin ? { part: "basin" as const } : {}), atMs: now });
      this.putCls.set(id, cls);
    }
  }

  /** 관찰 모드의 사람 부탁(ask_person): 지금 그 계획의 그 사람 단계면 같은 계획·단계 id로 명령 글만 서버 글(그 곳이 보이게 가까이 대 달라는 부탁)로 바꿔 다시 보낸다(소리로 읽음).
   *  spot은 가까이 볼 곳 id(그 단계의 계획 물건·대상 자리)이고 그 이름으로 글을 만든다. 모르는 곳이면 보내지 않는다.
   *  단계 종류·대상·답 단추·비전 상태는 그대로라 실제 폰은 새 단계로 보지 않는다. 그 뒤 다시 읽기·비전 상태도 이 글이다. 보낸 글, 못 보냈으면 null. */
  askCloser(planId: string, stepId: string, spot: string): string | null {
    const r = this.run;
    const step = r ? this.stepOf(r) : undefined;
    if (this.stopped || !r || r.state !== "running" || r.asking || !r.sent || !step || !HUMAN_KINDS.includes(step.kind)) return null;
    if (r.plan.view.id !== planId || step.id !== stepId || r.sent.step !== stepId || this.handStep(step)) return null;
    // 평면도 자리는 같은 이름 찾기(src/layout/names.ts)로, 물건은 그 종류 이름으로 부른다. 부를 이름이 없으면 보내지 않는다(id를 폰 글에 쓰지 않는다)
    const listed = this.spots(r, step, this.o.world()).find((p) => p.id === spot);
    const name = this.o.floor().objects.has(spot) ? (listed || spot === step.target ? this.nameOf(spot) : null) : listed?.label ?? null;
    if (!name) return null;
    const said = CLOSER_TEXT(name);
    r.spokeAt = this.clock.now();
    r.helped = true;
    r.quietOn = false;
    r.sent = { ...r.sent, text: said, speak: true };
    this.send(r.sent);
    return said;
  }

  /** 지금 조용히 띄운 단계 이름(소리로 읽지 않고 지켜보는 중, 대시보드 말풍선 카드). 아니면 null. */
  quietStep(): string | null {
    const r = this.run;
    return !this.stopped && r?.state === "running" && r.quietOn && !r.asking ? this.stepOf(r)?.label ?? null : null;
  }

  /** 타이머(250ms)가 부른다: 검사 다시 보기, 지금 단계 보기, 멈춘 단계 알림, 다시 읽기, 시간 초과. 에이전트는 부르지 않는다. */
  tick(): void {
    const r = this.run;
    if (!this.stopped) this.reminderTick();
    if (this.stopped || !r || !OPEN.has(r.state)) return;
    const now = this.clock.now();
    if (r.state === "planned" && !r.asking) return this.tryStart(r, now - r.since >= this.cfg.recheckMs);
    if (r.asking) {
      if (r.asking.why === "again" && this.look(r)) return;
      if (now - r.askAt > this.cfg.askMs) return this.finish(r, "failed", EXEC_TEXT.noAnswer);
      return this.repeat(r, now);
    }
    if (r.state !== "running" || this.look(r)) return;
    const step = this.stepOf(r);
    if (!step) return;
    if (now > r.deadline) return this.timeout(r, step);
    // tell로 바꾼 글은 tellHoldMs 뒤 원래 명령으로 되돌린다(읽지 않는다)
    if (r.told && now >= r.told.until && r.sent) {
      r.sent = { ...r.sent, text: r.told.text, speak: false };
      r.told = null;
      this.send(r.sent);
    }
    this.strayNear(r, step);
    this.offAsk(r, step, now);
    // 조용한 단계가 QUIET_HINT_MS 안에 안 끝나면 한 번 읽는다(그 단계는 혼자 해낸 것으로 세지 않는다)
    if (r.quietOn && r.sent && now - r.stepAt >= QUIET_HINT_MS) {
      r.quietOn = false;
      r.helped = true;
      r.spokeAt = now;
      this.send({ ...r.sent, speak: true });
    }
    this.stall(r, step, now);
    if (HUMAN_KINDS.includes(step.kind) || step.kind === "ask") this.repeat(r, now);
  }

  /** 멈추면 더 기록하지 않고 폰에도 보내지 않는다. 만들던 계획과 멈춘 단계 알림은 끊는다. */
  stop(): void {
    this.planning?.abort.abort();
    this.planning = null;
    this.run?.stepEnd?.abort();
    const a = this.run?.asking;
    if (a?.why === "device") this.o.devices?.cancel(a.token);
    this.stopped = true;
  }

  /** 행동 중 기다리기·기기 단계인가: 그동안 판단(PAM)을 멈추고 다른 행동으로 바꾸지 않는다(src/brain/decide.ts hold). */
  waiting(): boolean {
    const r = this.run;
    const kind = r && r.state === "running" ? this.stepOf(r)?.kind : undefined;
    return !this.stopped && (kind === "wait" || kind === "device");
  }

  /** 코치 행동(TaskSpec.coach) 계획이 열려 있거나 만드는 중인가: 그동안 판단 호출(PAM)을 쉰다(src/server/home.ts hold). */
  coaching(): boolean {
    if (this.stopped) return false;
    const open = this.open();
    return taskOf(open?.plan.task ?? null)?.coach === true || taskOf(this.planning?.decision.action ?? null)?.coach === true;
  }

  /** 손으로 켜는 위험 가전 단계인가. 이 집 가전 목록을 모르면 손으로 켜는 단계는 모두 위험한 것으로 본다(묻는다). */
  private risky(step: AgentStep | undefined): boolean {
    if (!step || step.kind !== "do" || step.hand?.to !== "on") return false;
    const devices = this.o.handDevices?.();
    return devices ? riskyHand(step, devices) : true;
  }

  /** 손 조작 단계(켜기·끄기·열기·닫기)인가: 그 명령 자리는 켜기 전 질문·승인 뒤 명령만 쓴다(다시 알리기·사람 부탁으로 바꾸지 않는다). */
  private handStep(step: AgentStep): boolean {
    return step.hand !== null;
  }

  /** 손으로 다루는 가전 이름(묻는 글·끄기 안내): 같은 이름 찾기(src/layout/names.ts)로 그 가전, 없으면 단계 대상 자리. 둘 다 없으면 「가전」. */
  private handLabel(deviceId: string, target: string | null = null): string {
    return this.nameOf(deviceId) ?? (target ? this.nameOf(target) : null) ?? DEVICE_UNKNOWN;
  }

  /** 켜기 전 질문의 답(기억하지 않는다): 승인이면 그때 켜라는 명령을 보내고(그 가전은 끄는 단계가 끝날 때까지 켠 것으로 본다), 거절이면 취소로 닫는다.
   *  기다린 시간은 단계 시간 한도·끝나는 조건 기준 시각에 넣지 않는다. */
  private approvedHand(r: Run, answer: ApprovalAnswer): void {
    const step = this.stepOf(r);
    if (answer === "reject" || !step?.hand) return this.finish(r, "failed", APPROVAL_TEXT.refused, "cancelled");
    const now = this.clock.now();
    Object.assign(r, { asking: null, stepAt: now, spokeAt: now, visionAt: now, deadline: now + step.timeoutMs, watch: step.until ? new ConditionWatch(step.until) : null });
    const id = step.hand.deviceId;
    const cycle: Cycle = { cycle: (this.cycles.get(id)?.cycle ?? 0) + 1, onAt: now, askedAt: null };
    this.cycles.set(id, cycle);
    r.onAt.set(id, cycle);
    r.hot.add(id);
    r.ends.delete(id);
    this.released.delete(id);
    this.show(r, step);
  }

  /** 다음 끄기 안내를 띄운다. 다른 계획이 실제 폰 명령 줄을 쓰는 중(진행 중·승인 질문 중)이면 띄우지 않고 그 계획이 끝난 뒤 띄운다.
   *  rotate: 떠 있는 안내를 줄 끝으로 돌리고 다음 가전 안내를 띄운다(줄에 다른 안내가 있을 때만). 꺼내기 전에 작동이 끝난 가전은 releaseIfOff가 줄에서 뺀다.
   *  남은 것이 없으면 미뤄 둔 새 계획을 시작해 본다. */
  private nextReminder(rotate = false): void {
    if (this.stopped || this.lineBusy()) return;
    const r = this.run;
    const off = this.reminder;
    if (off && rotate && this.offQueue.length) {
      this.offQueue.push(off.note);
      this.reminder = null;
      this.send({ type: "command_clear", id: off.sent.id });
    }
    if (this.reminder) return;
    while (this.offQueue.length && this.releaseIfOff(this.offQueue[0]!.deviceId));
    const note = this.offQueue.shift();
    const now = this.clock.now();
    if (note) {
      const sent: PlannedCommand = {
        type: "command", id: note.planId, step: note.step, text: note.text, vision: null,
        choices: note.ask ? [] : [{ id: STEP_DONE.id, label: STEP_DONE.label }], target: null, speak: true,
      };
      this.reminder = { sent, at: now, note };
      this.offToldAt = null;
      const cycle = this.cycles.get(note.deviceId);
      if (note.ask && cycle && cycle.askedAt === null) cycle.askedAt = now;
      this.send(sent);
      return;
    }
    if (r?.state === "planned" && !r.asking) {
      r.since = now;
      this.tryStart(r, false);
    }
  }

  /** 켠 위험 가전 추적 보기(tick·World State 변화마다, 실행 추적이 쉬는 동안에도): 지금 계획 hot·끄기 안내에 남은 가전마다 releaseIfOff,
   *  풀린 가전마다 rearmIfOn. 떠 있는 끄기 안내는 offHoldMs마다 같은 글을 다시 소리로 보내고, 줄에 다른 가전 안내가 기다리면 차례를 돌린다. */
  private reminderTick(): void {
    if (this.stopped) return;
    const tracked = new Set([...(this.run?.hot ?? []), ...(this.reminder ? [this.reminder.note.deviceId] : []), ...this.offQueue.map((n) => n.deviceId)]);
    for (const id of tracked) this.releaseIfOff(id);
    for (const id of [...this.released.keys()]) this.rearmIfOn(id);
    const now = this.clock.now();
    const r = this.run;
    if (r) for (const [id, end] of r.ends) if (now - end.at > this.cfg.rearmMs && !this.offStepOpen(r, id)) r.ends.delete(id);
    // 폰이 필요한 다른 계획이 도는 동안 줄에서 기다리는 안내: offHoldMs마다 소리로만 다시 알리고, 여러 가전이 기다리면 마지막으로 알린 가전 다음 차례로 돌아가며 알린다
    if (!this.reminder && this.offQueue.length && this.offToldAt !== null && now - this.offToldAt > this.cfg.offHoldMs) {
      const ids = this.offQueue.map((n) => n.deviceId);
      this.tellWaiting(ids[(ids.indexOf(this.offToldId ?? "") + 1) % ids.length]!);
    }
    const off = this.reminder;
    if (!off || now - off.at <= this.cfg.offHoldMs) return;
    if (this.offQueue.length) return this.nextReminder(true);
    off.at = now;
    this.send({ ...off.sent, speak: true });
  }

  /** 작동 한 번 끝남 판정(하나뿐, 그 가전의 지금 켜기 회차에 대해). 아니면 null. 근거 시각은 촬영 시각(카메라 seen_ms, 허브·실제 가전 신호는 도착 시각)이고
   *  근거는 명시만 쓴다(카메라 추정 꺼짐은 쓰지 않는다. 허브·실제 가전 신호 줄은 명시로 본다).
   *  switch: 회차 onAt 뒤에 촬영된 근거로 아는 켜짐 값(on·running)에서 꺼짐으로 바뀌었고(앞 값이 모름·null이면 아님), 그 바뀜이 명시이거나
   *  그 뒤(켜짐 없이) 같은 꺼짐 값의 명시 근거 줄이 있다. 그 뒤 다시 켜짐 줄이 오면 그 바뀜은 지난 것이다.
   *  confirmed: 이 회차에 보낸 부탁(askedAt) 뒤이고 회차 onAt 뒤에 촬영된, 가까이 본(close) 명시 꺼짐 관측(sight_last)이 있다(켜짐을 놓쳤을 때의 복구).
   *  지금 상태(허브·실제 가전 신호)가 켜짐이거나 그 근거보다 새 카메라 명시 값이 켜짐이면 null. */
  private cycleEnded(deviceId: string): CycleEnd | null {
    const c = this.cycles.get(deviceId);
    const d = this.o.world().devices.find((x) => x.id === deviceId);
    if (!c || !d || d.status === null || onNow(d)) return null;
    for (const k of CYCLE_VALUES) {
      let switched: number | null = null;
      let pending = false;
      for (const h of d.history) {
        if (h.attr !== k.attr || evidenceTime(h) <= c.onAt) continue;
        if (h.to === k.on) {
          switched = null;
          pending = false;
        } else if (h.to === k.off && h.from === k.on) {
          pending = h.explicit === false;
          switched = pending ? null : evidenceTime(h);
        } else if (h.to === k.off && h.from === k.off && pending && h.explicit !== false) {
          pending = false;
          switched = evidenceTime(h);
        }
      }
      const seen = d.sight_last?.[k.attr];
      const confirmed = c.askedAt !== null && seen && seen.value === k.off && seen.explicit && seen.close && seen.seen_ms > c.askedAt && seen.seen_ms > c.onAt ? seen.seen_ms : null;
      const end: CycleEnd | null = switched !== null ? { via: "switch", evidenceAt: switched, cycle: c.cycle } : confirmed !== null ? { via: "confirmed", evidenceAt: confirmed, cycle: c.cycle } : null;
      if (!end) continue;
      if (seen && seen.value === k.on && seen.explicit && seen.seen_ms >= end.evidenceAt) return null;
      return end;
    }
    return null;
  }

  /** 그 가전의 켜기 단계가 아직 끝나지 않았는가: 열린 계획의 지금 단계가 그 가전을 켜는 손 조작 do(켜기 전 질문 중 포함)다. */
  private onStepOpen(deviceId: string): boolean {
    const r = this.run;
    const step = r && OPEN.has(r.state) ? this.stepOf(r) : undefined;
    return step?.kind === "do" && step.hand?.to === "on" && step.hand.deviceId === deviceId;
  }

  /** 추적을 푸는 하나뿐인 자리. 그 가전의 켜기 단계가 끝났고(onStepOpen 아님) cycleEnded가 null이 아니면 hot·떠 있는 끄기 안내·줄의 끄기 안내에서
   *  그 가전을 지우고 released에 그 계획과 근거를 남긴 뒤 true. 아니면 false. 떠 있던 안내를 지웠으면 다음 안내를 띄운다. */
  private releaseIfOff(deviceId: string): boolean {
    const r = this.run;
    const off = this.reminder;
    const shown = off?.note.deviceId === deviceId ? off : null;
    const queued = this.offQueue.find((n) => n.deviceId === deviceId);
    const inHot = !!r?.hot.has(deviceId);
    if (!inHot && !shown && !queued) return false;
    if (this.onStepOpen(deviceId)) return false;
    const end = this.cycleEnded(deviceId);
    if (!end) return false;
    const planId = inHot ? r!.plan.view.id : (shown?.note ?? queued)!.planId;
    r?.hot.delete(deviceId);
    for (let i = this.offQueue.length - 1; i >= 0; i--) if (this.offQueue[i]!.deviceId === deviceId) this.offQueue.splice(i, 1);
    const now = this.clock.now();
    this.released.set(deviceId, { planId, evidenceAt: end.evidenceAt, via: end.via, at: now });
    if (r?.onAt.has(deviceId)) r.ends.set(deviceId, { cycle: end.cycle, seenAt: end.evidenceAt, how: end.via, at: now });
    if (shown) {
      this.reminder = null;
      this.send({ type: "command_clear", id: shown.sent.id });
      this.nextReminder();
    }
    return true;
  }

  /** 다시 걸기: 풀린 가전의 새 켜짐(근거 촬영 시각이 풀린 근거의 촬영 시각 evidenceAt 뒤이고 그 뒤 rearmMs 안)을 보면 추적을 다시 건다.
   *  켜짐 근거는 이력 줄과 카메라 마지막 관측(sight_last), 명시·추정 모두 받는다(onSeenAfter). 회차를 올리고(onAt은 그 켜짐 촬영 시각, 옛 부탁은 버림) 같은 계획이 열려 있으면 hot에 다시 넣고,
   *  닫혔으면 끄기 안내 줄에 넣는다(다른 계획이 도는 중이면 그 계획이 끝난 뒤 뜬다). 푼 뒤 rearmMs가 지나면 더 보지 않는다. */
  private rearmIfOn(deviceId: string): boolean {
    const rel = this.released.get(deviceId);
    if (!rel) return false;
    if (this.clock.now() - rel.at > this.cfg.rearmMs) {
      this.released.delete(deviceId);
      return false;
    }
    const d = this.o.world().devices.find((x) => x.id === deviceId);
    const on = onSeenAfter(d, rel.evidenceAt, rel.evidenceAt + this.cfg.rearmMs);
    if (on === null) return false;
    this.released.delete(deviceId);
    const cycle: Cycle = { cycle: (this.cycles.get(deviceId)?.cycle ?? 0) + 1, onAt: on, askedAt: null };
    this.cycles.set(deviceId, cycle);
    const r = this.run;
    if (r && OPEN.has(r.state) && r.plan.view.id === rel.planId) {
      r.onAt.set(deviceId, cycle);
      r.hot.add(deviceId);
      r.ends.delete(deviceId);
      return true;
    }
    this.queueOff(rel.planId, deviceId, false);
    this.nextReminder();
    // 다른 계획이 명령 줄을 쓰는 중이라 안내가 줄에서 기다리면 소리로만 바로 알린다
    if (this.lineBusy()) this.tellWaiting(deviceId);
    return true;
  }

  /** 폰이 필요한 계획이 실제 폰 명령 줄을 쓰는 중인가(진행 중·확인 중·승인 질문 중). 그동안 끄기 안내는 줄에서 기다린다. */
  private lineBusy(): boolean {
    const r = this.run;
    return !!r && r.phone && (r.state === "running" || r.state === "verifying" || (r.state === "planned" && r.asking !== null));
  }

  /** 줄에서 기다리는 끄기 안내를 붙은 폰에 소리로만 알리고(명령 줄은 그대로) 그 시각을 남긴다. */
  private tellWaiting(deviceId: string): void {
    const name = this.handLabel(deviceId);
    this.o.sayAloud?.(CAUTION_TEXT.rearmed(name));
    this.offToldAt = this.clock.now();
    this.offToldId = deviceId;
    this.offToldWall = { device: name, atMs: Date.now() };
  }

  /** 끄기 안내를 줄에 넣는다(가전마다 하나: 그 가전 안내가 이미 떠 있거나 줄에 있으면 넣지 않는다). 명령 id는 그 계획 id, 단계 id는 off:<계획>:<가전>:<지금 회차>.
   *  ask면 보이게 해 달라는 부탁, 부를 이름이 없으면 끄라는 안내. */
  private queueOff(planId: string, deviceId: string, ask: boolean): void {
    if (this.reminder?.note.deviceId === deviceId || this.offQueue.some((n) => n.deviceId === deviceId)) return;
    const name = ask ? this.nameOf(deviceId) : null;
    const step = offStep(planId, deviceId, this.cycles.get(deviceId)?.cycle ?? 1);
    this.offQueue.push({ planId, step, deviceId, text: name ? CLOSER_TEXT(name) : CAUTION_TEXT.off(this.handLabel(deviceId)), ask: !!name });
  }

  /** 끄기 안내가 떠 있거나 줄에 남았는가. 참이면 폰이 필요한 계획의 첫 명령(승인 질문 포함)을 보내지 않는다. */
  private offPending(): boolean {
    return this.reminder !== null || this.offQueue.length > 0;
  }

  /** 닫히는 계획의 hot을 끄기 안내 줄로 옮긴다(푸는 것이 아니다. 이미 작동이 끝난 가전은 releaseIfOff가 푼다). 그 가전 상태가 이미 꺼짐인데
   *  작동 끝남을 확인하지 못했으면 끄라는 안내 대신 보이게 해 달라는 부탁으로 넣는다. 그 뒤 기다리던 안내(다른 계획 것 포함)를 띄운다. */
  private handOver(r: Run): void {
    if (this.stopped) return;
    for (const id of [...r.hot]) this.releaseIfOff(id);
    const devices = this.o.world().devices;
    for (const id of r.hot) this.queueOff(r.plan.view.id, id, offNow(devices.find((d) => d.id === id)));
    r.hot.clear();
    this.nextReminder();
  }

  /** 보이게 해 달라는 부탁(CLOSER_TEXT(가전 이름), 답 단추 없음)을 보내고 지금 회차의 첫 부탁 시각(askedAt)을 남긴다. 떠 있는 끄기 안내가 그 가전이면
   *  그 안내를, 아니면 그 가전을 끄는 지금 do 단계 명령 줄(그 단계 id)을 바꾼다. 부를 이름이 없거나 바꿀 자리가 없으면 보내지 않는다. 보냈으면 true. */
  private askToShow(deviceId: string): boolean {
    const name = this.nameOf(deviceId);
    if (!name) return false;
    const text = CLOSER_TEXT(name);
    const now = this.clock.now();
    const off = this.reminder;
    const r = this.run;
    const step = r ? this.stepOf(r) : undefined;
    if (off?.note.deviceId === deviceId) {
      off.note = { ...off.note, text, ask: true };
      off.sent = { ...off.sent, text, choices: [], speak: true };
      off.at = now;
      this.send(off.sent);
    } else if (r?.state === "running" && !r.asking && step && ((r.sent && step.kind === "do" && step.hand?.to === "off" && step.hand.deviceId === deviceId)
      || selfStopWait(step, this.o.handDevices?.() ?? []) === deviceId)) {
      // 끄기 do는 그 명령 글을, 꺼짐 기다리기(명령이 없는 단계)는 그 단계 id로 새 명령을 띄운다(답 단추 없음)
      Object.assign(r, { spokeAt: now, helped: true, quietOn: false });
      r.sent = r.sent
        ? { ...r.sent, text, choices: [], speak: true }
        : { type: "command", id: r.plan.view.id, step: step.id, text, vision: null, choices: [], target: null, speak: true };
      this.send(r.sent);
    } else return false;
    const cycle = this.cycles.get(deviceId);
    if (cycle && cycle.askedAt === null) cycle.askedAt = now;
    return true;
  }

  /** 실행 중 끄는 단계(끄기 do·꺼짐 기다리기): showAskMs 넘게 안 끝나고 그 가전 상태가 이미 꺼짐인데 작동 끝남을 확인하지 못했으면(켜짐을 놓침) 부탁을 그 단계에 한 번 보낸다. */
  private offAsk(r: Run, step: AgentStep, now: number): void {
    const id = this.offTarget(step);
    if (!id || !r.hot.has(id) || r.asking || (!r.sent && step.kind === "do") || r.offAsked === r.gen || now - r.stepAt < this.cfg.showAskMs) return;
    if (!offNow(this.o.world().devices.find((d) => d.id === id))) return;
    r.offAsked = r.gen;
    this.askToShow(id);
  }

  /** 그 단계가 끄는 가전: 손 조작 끄기 do의 그 가전, 저절로 꺼지는 가전의 꺼짐 기다리기(selfStopWait)의 그 가전. 아니면 null. */
  private offTarget(step: AgentStep | undefined): string | null {
    if (!step) return null;
    return selfStopWait(step, this.o.handDevices?.() ?? []) ?? (step.kind === "do" && step.hand?.to === "off" ? step.hand.deviceId : null);
  }

  /** 가전을 끄는 단계인가(그 명령·부탁은 안전 등급): 끄는 단계(offTarget: 손 끄기 do·꺼짐 기다리기), 또는 끝나는 조건이 가전 꺼짐·멈춤인 단계. */
  private turnsOff(step: AgentStep): boolean {
    if (this.offTarget(step) !== null) return true;
    const u = step.until as Record<string, unknown> | null;
    return !!u && typeof u.device === "string" && typeof u.state === "string" && TOOL_STATES.turn_off!.includes(u.state);
  }

  /** 실제 폰으로 보내는 하나뿐인 길: 명령에는 소리 등급(talkGrade)을 붙인다. 열린 계획의 단계 명령이면 그 단계가 끄는 단계인지 본다. */
  private send(msg: PlannedCommandMessage): void {
    if (msg.type !== "command") return this.o.toPhone(msg);
    const r = this.run;
    const step = r?.plan.view.id === msg.id ? r.plan.steps.find((x) => x.id === msg.step) : undefined;
    const grade = talkGrade(msg, !!step && this.turnsOff(step));
    this.o.toPhone(grade ? { ...msg, grade } : msg);
  }

  /** 지금 단계가 그 가전을 끄는 단계(끄기 do·꺼짐 기다리기)인가. */
  private offStepOpen(r: Run, deviceId: string): boolean {
    return OPEN.has(r.state) && this.offTarget(this.stepOf(r)) === deviceId;
  }

  /** 끄는 단계(끄기 do·꺼짐 기다리기, offTarget)의 판단 하나: 이 계획이 켠 그 가전의 지금 회차가 풀렸으면(실행 추적이 든 풀린 근거 r.ends, 가전 이력에 기대지 않음) 그 근거 뒤 새 켜짐을 직접 본다.
   *  새 켜짐이 없으면(허브·실제 가전 신호가 켜짐이 아니고 근거 뒤 이력·카메라 마지막 관측에 켜짐이 없음) 그 단계는 끝난다.
   *  켜져 있으면 다시 걸기 기간과 상관없이 그 자리에서 새 회차로 hot에 다시 건다. 지금 회차의 풀린 근거가 없는데(기록이 지워짐) 켜짐도 아니면
   *  끝내지 않고 같은 회차로 hot에 다시 넣어 추적(releaseIfOff·부탁 offAsk)이 이어지게 한다. */
  private offReleased(r: Run, step: AgentStep): boolean {
    const id = this.offTarget(step);
    const cycle = id ? this.cycles.get(id) : undefined;
    if (!id || !cycle || !r.onAt.has(id) || r.hot.has(id)) return false;
    const d = this.o.world().devices.find((x) => x.id === id);
    const rec = r.ends.get(id);
    const end = rec?.cycle === cycle.cycle ? rec : undefined;
    const since = end?.seenAt ?? cycle.onAt;
    const onAgain = (!!d && onNow(d)) || (!!end && onSeenAfter(d, since) !== null);
    if (!end && !onAgain) {
      r.ends.delete(id);
      r.hot.add(id);
      return false;
    }
    if (onAgain) {
      // 새 회차의 시작: 그 켜짐의 가장 늦은 근거(지금 켜져 있게 한 켜짐), 모르면 지금
      const next: Cycle = { cycle: cycle.cycle + 1, onAt: onSeenAfter(d, since, Number.POSITIVE_INFINITY, true) ?? this.clock.now(), askedAt: null };
      this.cycles.set(id, next);
      this.released.delete(id);
      r.ends.delete(id);
      r.onAt.set(id, next);
      r.hot.add(id);
      return false;
    }
    return true;
  }

  /** 줄에서 기다리는 끄기 안내를 마지막으로 소리로 알린 가전 이름과 시각(Date.now, 대시보드 말풍선 카드). 없으면 null. */
  offTold(): { device: string; atMs: number } | null {
    return this.stopped ? null : this.offToldWall;
  }

  /** 끄기 안내 때문에 새 계획 시작을 미루는 중이면 기다리는 가전 이름(대시보드 말풍선 카드). 아니면 null. */
  offWaiting(): string | null {
    const r = this.run;
    if (this.stopped || r?.state !== "planned" || r.asking || !r.deferred) return null;
    const id = this.reminder?.note.deviceId ?? this.offQueue[0]?.deviceId;
    return id ? this.handLabel(id) : null;
  }

  /** 끄기 추적 요약(GET /api/plan off, 영상 판정): 지금 계획 hot 가전과 끄기 안내가 떠 있거나 줄에서 기다리는 가전. 멈췄으면 빈 요약. */
  offTrack(): OffTrack {
    if (this.stopped) return { hot: [], notices: [] };
    return { hot: [...(this.run?.hot ?? [])], notices: [...(this.reminder ? [this.reminder.note.deviceId] : []), ...this.offQueue.map((n) => n.deviceId)] };
  }

  /** 켠 위험 가전 추적(시험·안내 자리): 지금 계획의 hot, 가전마다 지금 켜기 회차, 풀린 가전과 그 근거. */
  safety(): { hot: string[]; cycles: Record<string, Cycle>; released: Record<string, { planId: string; evidenceAt: number; via: CycleEnd["via"] }> } {
    return {
      hot: [...(this.run?.hot ?? [])],
      cycles: Object.fromEntries([...this.cycles].map(([id, c]) => [id, { ...c }])),
      released: Object.fromEntries([...this.released].map(([id, { planId, evidenceAt, via }]) => [id, { planId, evidenceAt, via }])),
    };
  }

  /** 판단 뒤에 가까이 보기가 그 행동 대상 종류 물건의 볼 면을 바꿨는가: 사라지지 않은 그 종류 물건의 볼 면 가까이 보기 횟수(closer_rev)가
   *  판단 때 횟수(판단 기록 World State 요약, 그때 없던 물건이면 0)와 다르고, 지금 값도 판단 때 본 값과 다르다.
   *  횟수는 지금 값의 출처와 따로 남으므로 가까이 보기가 바꾼 값을 그 뒤 전체 사진이 다시 바꿔도 잡는다. */
  private closerNewer(d: DecisionRecord): boolean {
    const spec = taskOf(d.action);
    const facets = spec?.look ?? [];
    if (!spec?.target || !facets.length) return false;
    const then = new Map(d.world.objects.map((o) => [o.id, o]));
    return this.o.world().objects.some((o) => o.cls === spec.target && o.status !== "gone" && facets.some((f) => {
      const before = then.get(o.id);
      return (o.closer_rev?.[f] ?? 0) !== (before?.closer_rev?.[f] ?? 0) && before?.facts[f]?.value !== o.facts[f]?.value;
    }));
  }

  /** 「가까이 본 뒤 다시 판단」으로 닫은 계획은 같은 행동 다시 계획 간격(planGapMs)에 넣지 않는다: 다음 판단이 새 사실로 바로 다시 고른다.
   *  그 판단이 적은 시각일 때만 지운다. */
  private ungap(d: DecisionRecord, at: number): void {
    if (d.action && this.planAt.get(d.action) === at) this.planAt.delete(d.action);
  }

  /** 만들던 계획을 끊고 그 판단 줄에 까닭을 남긴다. */
  private dropPlanning(text: string): void {
    const job = this.planning;
    if (!job) return;
    this.planning = null;
    job.abort.abort();
    this.emit(planIdOf(job.decision.id), "failed", text);
  }

  /** 만들던 계획이 끝날 때까지 기다린다(시험용). */
  async idle(): Promise<void> {
    while (this.jobs.size) await Promise.all([...this.jobs]);
  }

  private open(): Run | null {
    return this.run && OPEN.has(this.run.state) ? this.run : null;
  }

  private stepOf(r: Run): AgentStep | undefined {
    return r.plan.steps[r.at];
  }

  /** 실제 폰에 명령·질문을 띄운 계획: 진행 중이거나 승인 답을 기다리는 중. */
  private shown(): (Run & { sent: PlannedCommand }) | null {
    const r = this.run;
    return !this.stopped && r && r.sent && (r.state === "running" || (r.state === "planned" && r.asking)) ? (r as Run & { sent: PlannedCommand }) : null;
  }

  /** 에이전트가 만든 계획을 받는다. 그 사이 다른 판단이 왔으면 버린다. 진행 중인 다른 계획은 새 계획이 바꾼다. */
  private planned(job: Job, r: PlanResult): void {
    if (this.stopped || this.planning !== job) return;
    this.planning = null;
    const d = job.decision;
    if (!r.ok) return this.emit(planIdOf(d.id), "failed", EXEC_TEXT.badPlan);
    // 만드는 사이 진행 중 계획이 기다리기·기기 단계에 들어갔으면 바꾸지 않는다(그 판단은 그 단계 전 관찰이다)
    if (this.waiting() || d.atMs < this.quietFrom) return this.emit(planIdOf(d.id), "failed", EXEC_TEXT.busy);
    if (this.closerNewer(d)) {
      this.ungap(d, job.at);
      return this.emit(planIdOf(d.id), "failed", EXEC_TEXT.closerNewer);
    }
    const open = this.open();
    // 새 계획이 있으면 PlanHub.onDecision이 지금 계획을 취소로 닫고 supersedes를 단다
    if (open) this.finish(open, "failed", EXEC_TEXT.superseded, null);
    const now = this.clock.now();
    const world = this.o.world();
    const ids = new Set<string>();
    for (const s of r.plan.steps) {
      if (s.object) ids.add(s.object);
      // 그 자리에서 하는 일의 대상 물건도 계획 물건이다(옮겨 새 id가 붙으면 이어 간다)
      if (s.kind === "do" && s.target && world.objects.some((o) => o.id === s.target)) ids.add(s.target);
      if (s.until) for (const n of objectNames(s.until)) if (world.objects.some((o) => o.id === n)) ids.add(n);
    }
    const others = new Map([...ids].map((id) => [id, new Set(world.objects.filter((o) => o.cls === clsOf(world, id) && o.id !== id).map((o) => o.id))]));
    const run: Run = {
      plan: r.plan, decision: d, state: "decided", since: now, at: -1, stepAt: now, spokeAt: now, visionAt: now, sent: null,
      asking: null, askAt: now, watch: null, others, alias: new Map([...ids].map((id) => [id, id])), carried: new Set(), placeAt: (id) => (id ? this.o.floor().objects.get(id)?.position ?? null : null), deadline: now, again: false, device: "idle", gen: 0,
      looks: 0, lookAt: Number.NEGATIVE_INFINITY, stepEnd: null, gapAt: job.at, onAt: new Map(), hot: new Set(), ends: new Map(), offAsked: -1, deferred: false, phoneWait: false, phone: false,
      strays: 0, strayAt: Number.NEGATIVE_INFINITY, strayNear: null, told: null, helped: false,
      quiet: taskOf(r.plan.task)?.coach ? quietLabels(this.o.lessons?.get(r.plan.task) ?? null) : new Set(), quietOn: false, outcomes: [],
    };
    this.run = run;
    this.o.plans.onDecision(r.plan.view);
    this.step(run, "planned");
    this.tryStart(run, false);
  }

  /** 질문·알림만 있는 계획은 승인을 묻지 않는다. */
  private approval(r: Run): ReturnType<typeof approvalNeed> {
    if (r.plan.steps.every((s) => s.kind === "ask" || s.kind === "say")) return null;
    return approvalNeed({ key: taskKey(r.plan.task), risky: false, requested: false, memory: this.o.approvals.memory() });
  }

  /** 첫 단계를 시작해 본다(계획을 받을 때·검사를 다시 볼 때·승인 답 뒤). 첫 명령 전에 가까이 보기가 볼 면을 바꿨으면 시작하지 않고
   *  「가까이 본 뒤 다시 판단」으로 닫는다(다음 판단이 새 사실로 다시 고른다). 첫 명령을 보낸 뒤에는 보지 않는다. */
  private tryStart(r: Run, last: boolean): void {
    if (this.closerNewer(r.decision)) {
      this.ungap(r.decision, r.gapAt);
      return this.finish(r, "failed", EXEC_TEXT.closerNewer, "cancelled");
    }
    const c = this.o.check(r.decision, r.plan.view);
    if (!c.ok) {
      if (last) this.finish(r, "failed", c.text);
      return;
    }
    const why = this.approval(r);
    r.phone = needsPhone(r.plan, why, this.o.handDevices?.() ?? []);
    // 끄기 안내가 남아 있으면 폰이 필요한 계획은 첫 명령(승인 질문 포함)을 미룬다(한 번 기록): 안내가 다 풀리면 nextReminder가 다시 부른다.
    // 폰이 필요 없는 가전 계획은 그대로 시작한다
    if (r.phone && this.offPending()) {
      const id = this.reminder?.note.deviceId ?? this.offQueue[0]!.deviceId;
      if (!r.deferred) {
        r.deferred = true;
        this.emit(r.plan.view.id, "planned", EXEC_TEXT.deferred(this.handLabel(id)));
      }
      if (!this.reminder) this.nextReminder();
      return;
    }
    // 폰이 필요한 계획은 판본이 맞는 실제 폰이 붙어 있을 때만 시작한다(한 번 기록, 붙으면 tick이 다시 부른다)
    if (!this.phoneOk() && r.phone) {
      if (!r.phoneWait) {
        r.phoneWait = true;
        this.emit(r.plan.view.id, "planned", EXEC_TEXT.phoneOld);
      }
      return;
    }
    if (why) return this.ask(r, { why: "plan" }, APPROVAL_TEXT.ask(r.plan.task), `${r.plan.view.id}:approve`);
    this.begin(r);
  }

  private begin(r: Run): void {
    this.step(r, "running");
    if (r.plan.steps.length === 0) return this.finish(r, "done");
    this.activate(r, 0);
  }

  /** 판본이 맞는 실제 폰이 붙어 있는가(모르면 붙어 있다고 본다). */
  private phoneOk(): boolean {
    return this.o.phoneReady?.() ?? true;
  }

  /** 실제 폰에 질문(승인·다시 묻기): 위에 질문, 아래 답 단추. 물을 폰(판본이 맞는 폰)이 없으면 기다리지 않고 실패로 닫는다. */
  private ask(r: Run, asking: Asking, text: string, stepId: string): void {
    if (!this.phoneOk()) {
      if (asking.why === "device") this.o.devices?.cancel(asking.token);
      return this.finish(r, "failed", EXEC_TEXT.phoneGone);
    }
    const now = this.clock.now();
    Object.assign(r, { asking, askAt: now, spokeAt: now });
    r.sent = {
      type: "command", id: r.plan.view.id, step: stepId, text, vision: null,
      choices: choicesOf(r, this.stepOf(r)).map(({ id, label }) => ({ id, label })), target: null, speak: true,
    };
    this.send(r.sent);
  }

  /** 첫 단계 전 승인 답: 승인이면 기억하고, 실행 전 검사를 다시 본 뒤 첫 단계로(답을 기다리는 사이 대상이 바뀌었을 수 있다). 거절이면 기억하지 않고 취소로 닫는다. */
  private approvedPlan(r: Run, answer: ApprovalAnswer): void {
    this.o.approvals.answer(taskKey(r.plan.task), answer);
    if (answer === "reject") return this.finish(r, "failed", APPROVAL_TEXT.refused, "cancelled");
    r.asking = null;
    r.since = this.clock.now();
    this.clear(r);
    this.tryStart(r, false);
  }

  /** 위험 목록 가전 승인 답(기억하지 않음): 승인이면 그 토큰으로 실행, 거절이면 실행하지 않고 취소로 닫는다. */
  private approvedDevice(r: Run, token: string, answer: ApprovalAnswer): void {
    r.asking = null;
    this.clear(r);
    if (answer === "reject") {
      this.o.devices?.cancel(token);
      return this.finish(r, "failed", APPROVAL_TEXT.refused, "cancelled");
    }
    const gen = r.gen;
    r.device = "running";
    // 승인을 기다린 시간은 이 단계 시간 한도에 넣지 않는다
    r.deadline = this.clock.now() + (this.stepOf(r)?.timeoutMs ?? 0);
    this.o.devices!.confirm(token, () => this.live(r, gen)).then((res) => this.deviceResult(r, gen, res), () => this.deviceResult(r, gen, { ok: false }));
  }

  /** 지금 단계를 끝내고 다음 단계로. 마지막이었으면 계획 완료. 집기를 마치면 그 물건은 사람이 들고 다니고, 놓기를 마치면 그 물건은 넣은 곳에 치운 것이다. */
  private advance(r: Run): void {
    const done = this.stepOf(r);
    if (done && HUMAN_KINDS.includes(done.kind)) r.outcomes.push({ label: done.label, alone: !r.helped });
    if (done?.kind === "pick" && done.object) r.carried.add(done.object);
    if (done?.kind === "place" && done.object) {
      r.carried.delete(done.object);
      // 치운 물건으로 남기는 것은 그 행동의 치우는 대상뿐이다(src/act/tasks.ts clearsAway): 따르고 내려놓은 병처럼 다시 쓰는 물건은 남기지 않는다
      if (done.target && clearsAway(taskOf(r.plan.task), clsOf(this.o.world(), done.object))) this.remember(r, done.object, done.target);
    }
    if (r.at + 1 >= r.plan.steps.length) return this.finish(r, "done");
    this.activate(r, r.at + 1);
  }

  /** i번째 단계를 지금 단계로: PlanHub 단계 상태(앞 단계 done, 이 단계 active)를 한 번에 바꾸고 단계 종류대로 시작한다. */
  private activate(r: Run, i: number): void {
    const prev = r.plan.steps[r.at];
    const step = r.plan.steps[i]!;
    const now = this.clock.now();
    r.stepEnd?.abort();
    Object.assign(r, {
      at: i, stepAt: now, spokeAt: now, visionAt: now, deadline: now + step.timeoutMs, asking: null, watch: step.until ? new ConditionWatch(step.until) : null,
      again: false, device: "idle", gen: r.gen + 1, looks: 0, lookAt: Number.NEGATIVE_INFINITY, stepEnd: new AbortController(),
      strays: 0, strayAt: Number.NEGATIVE_INFINITY, strayNear: null, told: null, helped: false, quietOn: false,
    });
    this.o.plans.setSteps(r.plan.view.id, { ...(prev ? { [prev.id]: "done" as const } : {}), [step.id]: "active" });
    if (step.kind === "wait" || step.kind === "device") this.quietFrom = now;
    if (step.kind === "wait") return this.clear(r);
    if (step.kind === "device") {
      this.clear(r);
      return this.runDevice(r, step);
    }
    // 손으로 켜는 위험 가전: 명령보다 먼저 안전 문구와 함께 묻는다(승인 뒤에만 켜라는 명령, approvedHand)
    if (this.risky(step)) {
      r.watch = null;
      return this.ask(r, { why: "hand" }, CAUTION_TEXT.ask(step.caution ?? "", this.handLabel(step.hand!.deviceId, step.target)), `${step.id}:hand`);
    }
    this.show(r, step);
  }

  /** 사람 단계·질문·알림을 실제 폰에 띄운다(소리로 읽음). */
  private show(r: Run, step: AgentStep): void {
    const world = this.o.world();
    const human = HUMAN_KINDS.includes(step.kind);
    // 조용한 단계: 지난 수업에서 이어서 혼자 해낸 사람 단계는 글만 띄운다. 손으로 켜는 위험 가전 단계는 늘 읽는다
    r.quietOn = human && r.quiet.has(step.label) && !this.risky(step) && !r.helped;
    r.sent = {
      type: "command", id: r.plan.view.id, step: step.id, text: (human ? step.command : step.kind === "ask" ? step.prompt?.text : step.text) ?? step.label,
      vision: human ? this.vision(r, step, world) : null, choices: choicesOf(r, step).map(({ id, label }) => ({ id, label })),
      target: human ? this.target(r, step, world) : null, speak: !r.quietOn,
      ...(human ? { kind: step.kind as PhoneStepKind } : {}),
    };
    // 알림 글은 판본이 맞는 폰이 없거나 끄기 안내가 명령 줄에 떠 있으면 보내지 않는다(폰 없이 도는 가전 계획, 명령 줄에는 하나만)
    if (step.kind === "say" && (!this.phoneOk() || this.reminder)) return;
    this.send(r.sent);
  }

  /** 기기 단계: 정책을 거쳐 기기 도구를 부른다. 승인 토큰이 오면 실제 폰에 묻는다. */
  private runDevice(r: Run, step: AgentStep): void {
    const devices = this.o.devices;
    if (!devices || !step.device) return this.finish(r, "failed", EXEC_TEXT.deviceFailed);
    const gen = r.gen;
    r.device = "running";
    devices.run(step.device.tool, step.device.deviceId, step.device.args, () => this.live(r, gen)).then(
      (res) => {
        const token = res.needsConfirmation?.token;
        if (!this.live(r, gen)) {
          if (token) devices.cancel(token);
          return;
        }
        if (token) return this.ask(r, { why: "device", token }, APPROVAL_TEXT.ask(step.label), `${step.id}:approve`);
        this.deviceResult(r, gen, res);
      },
      () => this.deviceResult(r, gen, { ok: false }),
    );
  }

  /** 기기 결과: 실패면 실패로 닫는다. 적용을 확인하지 못했으면(신호 없음·미확인) 끝나는 조건이 참이 될 때까지만 기다리고, 조건이 없으면 실패로 닫는다. */
  private deviceResult(r: Run, gen: number, res: Pick<ToolResult, "ok" | "error" | "unverified" | "state">): void {
    if (!this.live(r, gen)) return;
    if (!res.ok) return this.finish(r, "failed", EXEC_TEXT.deviceFailed);
    const verified = !res.unverified && res.state !== "모름";
    if (!verified && !r.watch) return this.finish(r, "failed", EXEC_TEXT.deviceUnverified);
    r.device = verified ? "done" : "sent";
    this.look(r);
  }

  /** 시간 초과 질문에 「계속」: 시간 한도만 한 번 더 준다. 조건 기준 시각·기기 실행 기록은 그대로라 기기를 다시 보내지 않는다. */
  private resume(r: Run): void {
    const step = this.stepOf(r)!;
    const now = this.clock.now();
    Object.assign(r, { asking: null, deadline: now + step.timeoutMs });
    if (HUMAN_KINDS.includes(step.kind) || step.kind === "ask" || step.kind === "say") this.show(r, step);
    else this.clear(r);
  }

  /** 그 계획의 그 단계가 아직 진행 중인가(늦게 온 기기 결과를 버린다). */
  private live(r: Run, gen: number): boolean {
    return !this.stopped && this.run === r && r.gen === gen && r.state === "running";
  }

  /** 지금 단계가 됐으면 다음 단계로 넘기고 true. 아니면 사람 단계의 비전 상태가 바뀌었을 때 보낸다(visionMs에 한 번까지). */
  private look(r: Run): boolean {
    const step = this.stepOf(r);
    if (!step || r.state !== "running" || step.kind === "ask") return false;
    if (r.asking && r.asking.why !== "again") return false;
    // 시간 한도가 지난 뒤 온 관찰·기기 결과로는 넘기지 않는다(시간 초과가 먼저다)
    if (!r.asking && this.clock.now() > r.deadline) {
      this.timeout(r, step);
      return true;
    }
    if (step.kind === "device" && r.device !== "done" && r.device !== "sent") return false;
    const world = this.o.world();
    // 끄기 do 단계는 그 가전 추적이 풀려도(확인된 꺼짐) 끝난다. 저절로 꺼지는 가전의 꺼짐 기다리기는 그것으로만 넘긴다(끝 조건을 보지 않는다)
    const self = selfStopWait(step, this.o.handDevices?.() ?? []) !== null;
    const reached = (!self && (r.watch ? r.watch.check(this.conditionView(world), this.context(r, world)) : step.kind === "device" && r.device === "done"))
      || this.offReleased(r, step);
    if (reached) {
      this.advance(r);
      return true;
    }
    if (!HUMAN_KINDS.includes(step.kind) || !r.sent || r.asking) return false;
    const vision = this.vision(r, step, world);
    const now = this.clock.now();
    if (vision !== r.sent.vision && now - r.visionAt >= this.cfg.visionMs) {
      r.visionAt = now;
      r.sent = { ...r.sent, vision, speak: false };
      this.send(r.sent);
    }
    return false;
  }

  /** 시간 한도를 넘은 단계: on_timeout이 ask이고 아직 묻지 않았으면 실제 폰에 계속할지 한 번 묻고, 아니면 실패로 닫는다. */
  private timeout(r: Run, step: AgentStep): void {
    if (step.onTimeout === "ask" && !r.again) {
      r.again = true;
      r.helped = true;
      return this.ask(r, { why: "again" }, AGAIN_TEXT.ask(step.label), `${step.id}:again`);
    }
    this.finish(r, "failed", step.kind === "ask" ? EXEC_TEXT.noAnswer : EXEC_TEXT.timeout);
  }

  /** 끝나는 조건이 있는 집기·놓기 단계가 stallMs 넘게(단계 시작 뒤, 받은 부름 뒤) 안 끝나면 관찰 모드를 부른다. 단계마다 stallMax번까지.
   *  받은 것만 먼저 세고, 그 부름의 settle(false)는 셈을 돌려준다(같은 계획·단계 세대일 때만, 한 번). */
  private stall(r: Run, step: AgentStep, now: number): void {
    if (!this.o.stalled || (step.kind !== "pick" && step.kind !== "place" && step.kind !== "do") || !step.until || !r.sent || r.asking || !r.stepEnd) return;
    if (r.looks >= this.cfg.stallMax || now - r.stepAt < this.cfg.stallMs || now - r.lookAt < this.cfg.stallMs) return;
    const gen = r.gen;
    // asking: stalled를 부르는 중(그 안에서 정하면 받은 뒤 셈에 바로 반영), open: 받았고 아직 안 정함, done: 정함(또는 받지 않음)
    let state: "asking" | "open" | "done" = "asking";
    let counted = true;
    const s: Stall = {
      planId: r.plan.view.id, stepId: step.id, kind: step.kind, label: step.label, command: r.sent.text, until: step.until,
      stuckMs: now - r.stepAt, looks: r.looks, spots: this.spots(r, step, this.o.world()), gen, signal: r.stepEnd.signal,
      settle: (c) => {
        if (state === "done") return;
        const open = state === "open";
        state = "done";
        counted = c;
        if (open && !c && this.run === r && r.gen === gen && r.looks > 0) r.looks--;
      },
    };
    if (!this.o.stalled(s)) {
      state = "done";
      return;
    }
    if (state === "asking") state = "open";
    if (counted) r.looks++;
    r.lookAt = now;
  }

  /** 가까이 볼 곳: 계획 물건(지금 따라가는 World State 물건, 자리를 알 때)과 단계 대상 자리(평면도, 물건과 다를 때). */
  private spots(r: Run, step: AgentStep, world: WorldView): LookSpot[] {
    const out: LookSpot[] = [];
    const id = step.object ?? step.target;
    const obj = id ? ours(r, id, world).find((o) => o.status !== "gone" && o.position) : undefined;
    if (obj?.position) out.push({ id: obj.id, label: OBJECT_NAME[obj.cls] ?? obj.cls, position: obj.position });
    const at = step.target ? this.o.locate?.(step.target) : undefined;
    if (step.target && at && step.target !== id && step.target !== obj?.id) out.push({ id: step.target, label: this.nameOf(step.target) ?? PLACE_UNKNOWN, position: at.position });
    return out;
  }

  /** repeatMs마다 지금 명령·질문을 다시 읽는다. */
  private repeat(r: Run, now: number): void {
    if (!r.sent || now - r.spokeAt < this.cfg.repeatMs) return;
    r.spokeAt = now;
    r.helped = true;
    this.send({ ...r.sent, speak: true });
  }

  /** 실제 폰 명령을 지운다(기다리기·기기 단계). */
  private clear(r: Run): void {
    if (!r.sent) return;
    r.sent = null;
    this.send({ type: "command_clear", id: r.plan.view.id });
  }

  /** 조건을 볼 World State: 폰 자리는 실행 추적이 받은 맞춘 눈과 World State 눈 중 새것. */
  private conditionView(w: WorldView): WorldView {
    const e = this.eye;
    if (!e || (w.eye && w.eye.at_ms >= e.at)) return w;
    const eye: WorldEye = {
      position: e.position, height_m: w.eye?.height_m ?? 0, yaw_deg: w.eye?.yaw_deg ?? 0, pitch_deg: w.eye?.pitch_deg ?? 0,
      room: roomAt(this.o.floor(), e.position), room_label: null, at_ms: e.at,
    };
    return { ...w, eye };
  }

  private context(r: Run, world: WorldView): ConditionContext {
    const fp = this.o.floor();
    return {
      nowMs: this.clock.now(), sinceMs: r.stepAt, offsetMinutes: this.o.offsetMinutes,
      locate: (id) => fp.objects.get(id)?.position ?? null,
      roomOf: (id) => {
        const o = fp.objects.get(id);
        return o ? o.room ?? roomAt(fp, o.position) : null;
      },
      follow: (id) => ours(r, id, world).map((o) => o.id),
    };
  }

  /** 비전 상태 한 줄: go는 든 물건 자리와 목표까지 거리, pick·place는 그 물건 자리. 비전으로 못 보는 단계면 null.
   *  do는 대상이 World State 물건이면 그 이름과 끝나는 조건이 보는 면의 지금 값(없으면 그 물건 자리), 평면도 자리면 거기까지 거리. */
  private vision(r: Run, step: AgentStep, world: WorldView): string | null {
    if (step.kind === "do") {
      const id = step.target;
      if (!id) return null;
      if (this.o.floor().objects.has(id)) return VISION_TEXT.distance(this.nameOf(id), this.distance(id, world));
      const o = ours(r, id, world).find((x) => x.status !== "gone") ?? null;
      const value = step.until ? factFacets(step.until).map((f) => o?.facts[f]?.value).find((v) => v !== undefined) : undefined;
      const cls = clsOf(world, id);
      return `${OBJECT_NAME[cls] ?? cls} · ${value ? STATE_TEXT[value] ?? value : place(o)}`;
    }
    if (step.kind === "go") {
      const carried = this.carried(r);
      const place = step.target ? this.nameOf(step.target) : null;
      const far = VISION_TEXT.distance(place, this.distance(step.target, world));
      return carried ? `${objectLine(r, carried, world)} · ${far}` : far;
    }
    return step.object ? objectLine(r, step.object, world) : null;
  }

  /** 지금 단계 앞의 마지막 집기 물건(그 뒤에 내려놓기가 없을 때). */
  private carried(r: Run): string | null {
    for (let i = r.at - 1; i >= 0; i--) {
      const s = r.plan.steps[i]!;
      if (s.kind === "place") return null;
      if (s.kind === "pick") return s.object;
    }
    return null;
  }

  /** 평면도 물건·가전을 부르는 이름(src/layout/names.ts placeName, 계획 단계 글과 같은 차례). 없으면 null(id를 사람 글에 쓰지 않는다). */
  private nameOf(id: string): string | null {
    const names = this.o.names ?? {};
    return placeName(id, this.o.floor().objects.get(id)?.type, {
      ...names, layoutName: names.layoutName ?? ((x) => this.o.locate?.(x)?.label), deviceKind: names.deviceKind ?? ((x) => this.o.handDevices?.().find((d) => d.id === x)?.kind),
    });
  }

  /** 명령 대상(실제 폰 고리 하나): 집기는 그 물건, do는 그 일을 받는 물건(World State 자리), 그 밖은 목표 자리(평면도). 자리를 모르면 null. */
  private target(r: Run, step: AgentStep, world: WorldView): PlannedCommand["target"] {
    const thing = step.kind === "pick" ? step.object : step.kind === "do" ? step.target : null;
    const obj = thing ? ours(r, thing, world).find((o) => o.status !== "gone") : undefined;
    if (obj?.position) return { id: obj.id, label: OBJECT_NAME[obj.cls] ?? obj.cls, position: obj.position };
    const id = step.target;
    const at = id ? this.o.locate?.(id) : undefined;
    return id && at ? { id, label: at.label, position: at.position } : null;
  }

  /** 폰 눈에서 평면도 물건까지 거리(m). 눈이나 목표 자리를 모르면 null. */
  private distance(id: string | null, world: WorldView): number | null {
    const at = id ? this.o.floor().objects.get(id)?.position : undefined;
    const eye = this.conditionView(world).eye?.position;
    return eye && at ? Math.hypot(eye[0] - at[0], eye[1] - at[1]) : null;
  }

  /** close: 계획을 닫을 상태. null이면 닫지 않는다(새 계획이 PlanHub.onDecision으로 취소로 닫는다). */
  private finish(r: Run, state: "done" | "failed", text?: string, close: "done" | "failed" | "cancelled" | null = state): void {
    if (r.asking?.why === "device") this.o.devices?.cancel(r.asking.token);
    r.asking = null;
    r.gen++;
    r.stepEnd?.abort();
    this.step(r, state, text);
    // 수업 기록: 코치 계획을 끝까지 마친 판만 남긴다
    if (state === "done" && taskOf(r.plan.task)?.coach && r.outcomes.length) this.o.lessons?.record(r.plan.task, r.outcomes, new Date(this.clock.now()).toISOString());
    if (r.sent) {
      r.sent = null;
      this.send({ type: "command_clear", id: r.plan.view.id });
    }
    if (close) this.o.plans.close(r.plan.view.id, close);
    // 손으로 켠 위험 가전이 작동 끝남 확인 전에 닫혔다: 가전마다 끄기 안내 줄로 옮기고 차례로 띄운다(확인된 꺼짐으로만 하나씩 지운다)
    this.handOver(r);
    r.ends.clear();
  }

  private step(r: Run, state: ExecState, text?: string): void {
    r.state = state;
    r.since = this.clock.now();
    this.emit(r.plan.view.id, state, text);
  }

  /** 계획을 만들지 않는 판단(대기·실패·같은 행동·늦은 답·잠시 뒤)은 그 판단 줄에 기록만 한다. */
  private note(d: DecisionRecord, text: string): void {
    this.emit(planIdOf(d.id), "decided", text);
  }

  private emit(planId: string, state: ExecState, text?: string): void {
    if (this.stopped) return;
    this.o.emit({ type: "execution", at_ms: this.clock.now(), plan_id: planId, state, text: text ?? EXEC_TEXT[state] });
  }
}

/** 가까이 봐서 찾은 물건을 전체 사진이 못 봐도 지키는 중이거나(World State closer_hold), 지키던 중 같은 종류 새 물건이 다른 자리에 생겼는가(followed_by).
 *  그동안 보인 것이 아니라 「아직 있음」으로 세지 않는다. */
const held = (o: WorldObject) => o.closer_hold === true || !!o.followed_by;

/** 계획 물건으로 보는 지금 World State 물건(하나, 없으면 빈 목록). 지금 id가 사라졌거나(그 자리가 시야 안인데 없음), 사람이 들고 다니다 시야 밖이 됐거나,
 *  가까이 봐서 지키는 중이거나 옮김 표시(followed_by)가 있을 때만 그 뒤에 처음 보인 같은 종류 물건(계획 전부터 있던 것·앞서 이은 것은 뺀다)이 하나일 때 그것으로 이어 간다.
 *  옮김 표시가 가리키는 물건은 처음 보인 시각과 상관없이 후보다. 후보가 여럿이면(옮김 표시가 가리키는 것이 끼어 있어도) 어느 것인지 모르므로 잇지 않는다.
 *  여럿이거나 들지 않은 물건이 시야 밖이면 잇지 않는다(「완료」로 넘긴다). */
function ours(r: Run, id: string, world: WorldView): WorldObject[] {
  const cur = r.alias.get(id) ?? id;
  const own = world.objects.find((o) => o.id === cur);
  if (own && own.status !== "gone" && !held(own) && !(own.status === "out_of_view" && r.carried.has(id))) return [own];
  const cls = clsOf(world, id);
  const others = r.others.get(id) ?? new Set<string>();
  const seen = new Set(r.alias.values());
  const after = own?.last_seen_ms ?? -Infinity;
  const marked = own?.followed_by ?? null;
  // 들고 다니다 시야 밖이 된 물건은 내려놓기 목표 자리 가까이(NEAR_M 안)에서 새로 보인 것만 잇는다(그 자리를 모르면 거리는 보지 않는다)
  const step = r.plan.steps[r.at];
  const near = own?.status === "out_of_view" && step?.kind === "place" ? r.placeAt(step.target) : null;
  const next = world.objects.filter((o) => o.cls === cls && o.id !== cur && o.id !== id && !others.has(o.id) && !seen.has(o.id) && o.status !== "gone"
    && (o.first_seen_ms > after || o.id === marked)
    && (!near || !o.position || Math.hypot(o.position[0] - near[0], o.position[2] - near[1]) <= NEAR_M));
  const pick = next.length === 1 ? next[0] : undefined;
  if (pick) {
    r.alias.set(id, pick.id);
    return [pick];
  }
  return own ? [own] : [];
}

/** 물건 줄: 「컵 · 손에 있음」. 사라지지 않은 같은 물건 중 가장 최근 것. */
function objectLine(r: Run, id: string, world: WorldView): string {
  const cls = clsOf(world, id);
  return `${OBJECT_NAME[cls] ?? cls} · ${place(ours(r, id, world).find((o) => o.status !== "gone") ?? null)}`;
}

/** 조건이 보는 물건 사실의 면(쓴 순서, 겹치지 않게). */
function factFacets(c: Condition, out: Facet[] = []): Facet[] {
  if ("all" in c) c.all.forEach((x) => factFacets(x, out));
  else if ("any" in c) c.any.forEach((x) => factFacets(x, out));
  else if ("seq" in c) c.seq.forEach((x) => factFacets(x, out));
  else if ("not" in c) factFacets(c.not, out);
  else if ("for_s" in c) factFacets(c.cond, out);
  else if ("object" in c) for (const f of Object.keys(c.facts ?? {}) as Facet[]) if (!out.includes(f)) out.push(f);
  return out;
}

/** 승인 질문은 승인·거절, 다시 묻기는 계속·그만, 사람 단계는 「완료」 하나, 질문은 그 답들, 알림·기다리기·기기는 없음. */
function choicesOf(r: Run, step: AgentStep | undefined): ActionChoice[] {
  if (r.asking?.why === "again") return AGAIN;
  if (r.asking) return APPROVE;
  if (!step) return [];
  if (step.kind === "ask") return step.prompt?.choices ?? [];
  return HUMAN_KINDS.includes(step.kind) ? [STEP_DONE] : [];
}

/** World State 물건 자리 글: VLM이 본 자리, 없으면 놓인 면, 그것도 없으면 자리 모름. 없으면 안 보임. */
function place(o: WorldObject | null): string {
  if (!o) return VISION_TEXT.unseen;
  const p = o.facts.place?.value;
  if (p) return STATE_TEXT[p] ?? p;
  return o.surface_label ? onSurface(o.surface_label) : PLACE_UNKNOWN;
}
