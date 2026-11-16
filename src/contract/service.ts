// 외부 연락(전화 에이전트) 계약: 에이전트 도구 call_service가 만드는 연락 하나와 그 결과. 순수 타입만 둔다.
// 연락은 늘 실제 폰으로 승인을 먼저 묻고(src/agent/policy.ts askService), 승인되면 외부 API 통로(src/infer/call-service.ts)가 CALL_SERVICE_URL로 보낸다.

/** 연락 종류: as_center 가전 고장으로 AS센터에 전화(상담·방문 예약), guardian 사람 상태로 보호자에게 연락. */
export type ServiceKind = "as_center" | "guardian";

/** 연락 하나: 무엇 때문에(가전·고장 설명·에러 코드, 또는 사람 상태 요약), 누구에게. 없는 값은 null. */
export interface ServiceCall {
  kind: ServiceKind;
  /** 누구에게(「LG전자 서비스센터」·「딸」). 모델이 정하지 않으면 종류 이름(AS센터·보호자). */
  to: string;
  /** 고장 난 가전(등록부 종류 키). */
  device: { id: string; label: string; kind: string } | null;
  /** 고장 설명 한 문장. */
  problem: string | null;
  /** 가전 화면의 에러 코드(UE·OE 등). */
  errorCode: string | null;
  /** 사람 상태 요약 한 문장. */
  person: string | null;
}

/** 연락 결과: sent 보냄(전화 서비스가 2xx), refused 거절(승인 답 거절·취소), unconnected 연결 없음(CALL_SERVICE_URL 없음), failed 실패(2xx 아님·연결 오류). */
export type ServiceOutcome = "sent" | "refused" | "unconnected" | "failed";

/** 연락 결과 하나(서버가 기록 DB service 줄과 말풍선 카드에 쓴다). id는 연락마다 새 값이고 보낸 요청의 id와 같다. error는 실패 까닭. */
export interface ServiceResult { id: string; call: ServiceCall; outcome: ServiceOutcome; atMs: number; error?: string }
