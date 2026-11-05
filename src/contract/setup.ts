// 설정 화면 ↔ 서버 계약(GET /api/setup, /api/setup/*). 순수 타입만 둔다: ui/가 이 파일을 그대로 가져다 쓴다.

/** ThinQ 기기 목록 한 줄(GET /api/setup/thinq). */
export interface ThinqDeviceView {
  id: string;
  /** ThinQ deviceType(예: DEVICE_AIR_CONDITIONER). */
  type: string;
  /** ThinQ 앱에서 붙인 이름(alias). */
  name: string;
  model: string;
}
