// 실제 폰 ↔ 폰 서버(WebSocket /phone/events) 메시지 중 명령·비전 상태·답 단추·지우기와 말의 답. 순수 타입만 둔다: ui/가 그대로 가져다 쓴다.
// 실제 폰은 에이전트의 손이다: 서버가 계획 단계마다 명령 하나를 보내고(src/act/track.ts), 위에는 명령, 아래 엄지 자리에는 비전 상태 한 줄과
// 그 바로 아래 답 단추를 둔다. 질문(사용자에게 물어보기)도 같은 자리에 질문과 답 단추를 둔다. 계획·할 일 이름·몇 번째 단계는 대시보드에만 있다.

/** 아래 엄지 자리 답 단추 하나. 단계 명령이면 「완료」 하나(id "done"), 질문이면 답마다 하나. */
export interface PhoneChoice { id: string; label: string }

/** 명령 대상 하나(실제 폰은 이것에만 작은 고리를 그린다). ar: 실제 폰 AR 좌표(폰 서버가 맞춘 기준점으로 트윈 자리를 바꾼 것). */
export interface PhoneTarget { id: string; label: string; ar: [number, number, number] }

/**
 * 서버 → 실제 폰: 지금 할 명령. 바뀔 때마다 통째로 보낸다. 같은 id·step이면 같은 명령이고 비전 상태만 바뀐 것이다.
 * 새로 붙은 폰은 상태(status) 다음에 지금 명령을 speak false로 받는다.
 */
export interface PhoneCommand {
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
}

/** 서버 안(실행 추적 → 폰 서버)의 명령: 대상 자리가 트윈 좌표 [x, 높이, y]다. 폰 서버가 AR 좌표로 바꿔 PhoneCommand로 보낸다. */
export interface PlannedCommand extends Omit<PhoneCommand, "target"> {
  target: { id: string; label: string; position: [number, number, number] } | null;
}

/** 서버 → 실제 폰: 명령을 지운다(계획 완료·실패·그만·새 계획으로 바뀜). id가 있으면 그 명령일 때만, 없으면 무엇이든 지운다(명령이 없는 서버에 붙은 폰). */
export interface PhoneCommandClear { type: "command_clear"; id?: string }

/** 실제 폰 → 서버: 답 단추를 눌렀다(「완료」·질문 답). id·step은 받은 명령 그대로. 지금 단계가 아니면 서버가 무시한다. */
export interface PhoneAnswer { type: "answer"; id: string; step: string; choice: string }

/** 승인을 기다리는 실제 가전 작업(실제 모드). 폰은 위에 「deviceLabel: reason」, 아래에 승인·취소 단추를 두고 confirm·cancel로 답한다. */
export interface PhonePending { token: string; deviceLabel: string; reason: string }

/** 실제 폰 → 서버: 들은 말(say), 승인(confirm)·취소(cancel). 들은 말이 명령·질문의 답이면 서버가 그 답으로 받는다(「완료」「다 했어」, 「그만」은 계획을 그만둔다). */
export type PhoneTalk = { type: "say"; text: string } | { type: "confirm" | "cancel"; token: string };

/** 서버 → 실제 폰: 말·승인의 답. text가 빈 글이면 보이지도 읽지도 않는다(명령의 답을 말로 한 때: 다음 명령이 따로 온다).
 *  pending은 에이전트 답에만 싣는 지금 승인 대기 목록이다. 없으면(명령의 답·승인·취소·오류) 실제 폰은 목록을 그대로 둔다. */
export interface PhoneTalkReply { type: "reply"; text: string; pending?: PhonePending[] }

/** 서버가 실제 폰에 보내는 명령 메시지. */
export type PhoneCommandMessage = PhoneCommand | PhoneCommandClear;
/** 실행 추적이 폰 서버에 넘기는 명령 메시지. */
export type PlannedCommandMessage = PlannedCommand | PhoneCommandClear;
