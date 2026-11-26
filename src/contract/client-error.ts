// 앱(apps/android) → 허브 계약: POST /api/mobile/client-error. 앱이 화면을 그리다 난 오류를 허브 서버 로그로 남긴다(src/server/client-error.ts).
// 순수 타입만 둔다. 사진·개인 정보는 싣지 않는다: 오류 글과 스택, 앱 판본, 시각뿐이다.

/** 본문. 서버는 이 다섯 칸 밖의 칸이 있거나, 본문이 16KB를 넘거나, 분당 10건을 넘으면 받지 않는다. */
export interface ClientErrorReport {
  /** 오류 글(예: "TypeError: object null is not iterable"). 앞 1,000자까지. */
  message: string;
  /** JS 스택. 앞 4,000자까지. 없으면 null. */
  stack: string | null;
  /** 오류가 난 화면 부품 줄(React componentStack). 앞 4,000자까지. 없으면 null. */
  component_stack: string | null;
  /** 앱 판본(app.json expo.version). */
  app_version: string;
  /** 오류가 난 때(폰 시계, ms). */
  at_ms: number;
}

export interface ClientErrorAccepted {
  ok: true;
}
