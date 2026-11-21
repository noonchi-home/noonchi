// 실제 폰 ↔ 폰 서버(WebSocket /phone/events) 메시지 중 명령·비전 상태·답 단추·지우기와 말의 답. 순수 타입만 둔다: ui/가 그대로 가져다 쓴다.
// 실제 폰은 에이전트의 손이다: 서버가 계획 단계마다 명령 하나를 보내고(src/act/track/), 위에는 명령, 아래 엄지 자리에는 비전 상태 한 줄과
// 그 바로 아래 답 단추를 둔다. 질문(사용자에게 물어보기)도 같은 자리에 질문과 답 단추를 둔다. 계획·할 일 이름·몇 번째 단계는 대시보드에만 있다.

/** 아래 엄지 자리 답 단추 하나. 단계 명령이면 「완료」 하나(id "done"), 질문·승인이면 답마다 하나. */
export interface PhoneChoice { id: string; label: string }

/** 명령 대상 하나(실제 폰은 이것에만 작은 고리를 그린다). ar: 실제 폰 AR 좌표(폰 서버가 맞춘 기준점으로 트윈 자리를 바꾼 것). */
/** look: 관찰 자리 가기에서 도착해 비출 곳(AR 좌표). 「…을 비춰 주세요」 명령에만 있다. */
export interface PhoneTarget { id: string; label: string; ar: [number, number, number]; look?: [number, number, number] }

/** 사람 단계 종류: 가기·집기·놓기·그 자리에서 하는 일(따르기). */
export type PhoneStepKind = "go" | "pick" | "place" | "do";

/** 소리 등급: safety 끄기 안내·다시 켜짐 경고, question 승인·물음. 서버 글 틀이라 짧아 실제 폰은 자르거나 건너뛰지 않고 끝까지 읽는다.
 *  칸이 없으면 명령(command)·에이전트 답(reply)이고, 듣기 멈춤 시간이 모자라면 실제 폰이 줄이거나 건너뛴다(reply 먼저). */
export type TalkGrade = "safety" | "question";

/**
 * 서버 → 실제 폰: 지금 할 명령. 바뀔 때마다 통째로 보낸다. 같은 id·step이면 같은 명령이고 비전 상태만 바뀐 것이다.
 * 새로 붙은 폰은 상태(status) 다음에 지금 명령을 speak false로 받는다.
 */
export type WalkPoint<P> = P & (
  | {kind:"portal"; id:string; from_room:string; to_room:string}
  | {kind:"via" | "stand"; room:string}
);
export interface WalkGuide<P> {
  pose_gen?:number;
  revision:number;
  near_m:number;
  remaining:[WalkPoint<P>, ...WalkPoint<P>[]];
}
export type TwinWalkGuide = WalkGuide<{position:[number,number,number]}>;
export type NavigationPose = {observed_ms:number; pose_gen:number; quality:"usable"|"unavailable"; position:[number,number]|null; error_m?:number};

export interface PhoneCommand {
  guide?: WalkGuide<{ar:[number,number,number]}> | null;
  type: "command";
  /** 계획 id(plan:pam-N). */
  id: string;
  /** 지금 단계 id. 답(answer)에 그대로 돌려준다. */
  step: string;
  /** 위 한 줄: 사람에게 하는 명령(「컵을 들어 주세요」) 또는 질문. */
  text: string;
  /** 아래 엄지 자리 답 단추 바로 위 한 줄: 비전이 보는 지금 상태(「식탁까지 2.4m」·「컵 · 손에 있음」). 질문이면 null. */
  vision: string | null;
  choices: PhoneChoice[];
  /** 명령 대상(식탁·컵·싱크대). 질문이거나, 기준점을 맞추기 전이거나, 자리를 모르면 null. 맞추면 같은 명령이 대상과 함께 다시 온다. */
  target: PhoneTarget | null;
  /** true면 text를 소리로 읽는다: 새 명령, 한 단계가 오래 걸려 다시 읽을 때. 비전 상태·대상만 바뀌면 false. */
  speak: boolean;
  /** 사람 단계 명령의 단계 종류. 질문·승인·알림에는 없다. 영상 모드가 단계 영상을 고를 때 쓴다. */
  kind?: PhoneStepKind;
  /** go 명령이 끝나는 폰-대상 수평 거리(m, 가까이 가서 보기의 「컵 가까이 가 주세요」). 영상 모드는 그 안까지 걷는다. 없으면 보통 go. */
  near_m?: number;
  /** above: 대상을 위에서 내려다보는 do 명령(「컵 안이 보이게 위에서 비춰 주세요」). 영상 모드는 폰을 대상 위로 옮긴다. */
  view?: "above";
  /** 소리 등급(실행 추적이 붙인다, src/act/talk-grade.ts). 보통 명령이면 없다. */
  grade?: TalkGrade;
}

/** 서버 안(실행 추적 → 폰 서버)의 명령: 대상 자리가 트윈 좌표 [x, 높이, y]다. 폰 서버가 AR 좌표로 바꿔 PhoneCommand로 보낸다. */
export interface PlannedCommand extends Omit<PhoneCommand, "target" | "guide"> {
  guide?: TwinWalkGuide | null;
  /** look: 관찰 자리 가기에서 도착해 비출 곳(트윈 [x, 높이, y]). 폰 서버가 AR 좌표로 바꿔 보낸다. */
  target: { id: string; label: string; position: [number, number, number]; look?: [number, number, number] } | null;
}

/** 서버 → 실제 폰: 명령을 지운다(계획 완료·실패·그만·새 계획으로 바뀜). id가 있으면 그 명령일 때만, 없으면 무엇이든 지운다(명령이 없는 서버에 붙은 폰). */
export interface PhoneCommandClear { type: "command_clear"; id?: string }

/** 실제 폰 → 서버: 답 단추를 눌렀다(「완료」·질문 답). id·step은 받은 명령 그대로. 지금 단계가 아니면 서버가 무시한다. */
export interface PhoneAnswer { type: "answer"; id: string; step: string; choice: string }

/** 승인 답: 승인(기억, 같은 일은 다음부터 묻지 않음), 거절(이번만, 하지 않고 기억하지 않음). 위험 목록은 둘 다 이번만. src/agent/approval.ts가 기억한다. */
export type ApprovalAnswer = "approve" | "reject";

/** 승인을 기다리는 가전 명령(위험 목록)이나 외부 연락(AS센터 전화·보호자 연락). 폰은 위에 「deviceLabel: reason」(deviceLabel이 빈 글이면 reason만),
 *  아래에 답(choices: 승인·거절)마다 단추 하나를 두고 confirm(choice)로 답한다. */
export interface PhonePending { token: string; deviceLabel: string; reason: string; choices: PhoneChoice[] }

/** 말하기 시작할 때 폰에 떠 있던 것: 명령 줄(명령의 계획 id·단계 id, 없으면 none)과 승인 대기 목록에 보인 token들. 새 폰은 늘 싣는다. 칸이 없으면 옛 탭이다.
 *  서버는 말 답(「완료」·질문 답·승인·거절)을 이 명령·token에만 받는다(src/act/track/answers.ts onHeard, src/server/home/phone.ts). */
export type HeardAt = ({ kind: "command"; id: string; step: string } | { kind: "none" }) & { pending: string[] };

/** 실제 폰 → 서버: 들은 말(say, at은 말할 때 떠 있던 것), 승인 답(confirm, choice가 없으면 approve)·취소(cancel).
 *  들은 말이 지금 명령·질문의 답이고 at이 그 명령이면 서버가 그 답으로 받는다(「완료」「다 했어」, 「그만」은 at과 상관없이 계획을 그만둔다). */
export type PhoneTalk = { type: "say"; text: string; at?: HeardAt } | { type: "confirm"; token: string; choice?: ApprovalAnswer } | { type: "cancel"; token: string };

/** 실제 폰 → 서버: 연결하자마자 보내는 폰 계약 판본(형 src/contract/phone-version.ts, 값 src/phone/protocol.ts·ui/src/phone/protocol.ts). 없거나 다르면 서버가 그 탭을 옛 탭으로 둔다. */
export interface PhoneHello { type: "hello"; protocol: number }

/** 서버 → 실제 폰: 말·승인의 답. text가 빈 글이면 보이지도 읽지도 않는다(명령의 답을 말로 한 때: 다음 명령이 따로 온다).
 *  pending은 에이전트 답에만 싣는 지금 승인 대기 목록이다. 없으면(명령의 답·승인·취소·오류) 실제 폰은 목록을 그대로 둔다. */
export interface PhoneTalkReply { type: "reply"; text: string; pending?: PhonePending[]; grade?: "safety" }

/** 서버가 실제 폰에 보내는 명령 메시지. */
export type PhoneCommandMessage = PhoneCommand | PhoneCommandClear;
/** 실행 추적이 폰 서버에 넘기는 명령 메시지. */
export type PlannedCommandMessage = PlannedCommand | PhoneCommandClear;
