// VLM 무조건 우선(사용자 결정 2026-11-18): VLM 답과 YOLO가 다르면 VLM이 이긴다. VLM이 답하지 않았을 때(답 없음·끊김)만 YOLO를 따른다.
// 예외는 사용자가 정한 셋뿐이다: 대시보드 미니맵 표시, 폰 위치 맞추기, 쓰러짐 감지(src/world/fall.ts). 그 셋은 이 함수를 부르지 않는다.
// World State가 YOLO와 VLM을 합치는 곳(가까이 보기 src/world/state/closer.ts …)은 이 함수 하나로 정한다. tests/world-merge.test.ts가 지킨다.

/** 그 자리에 그 물건이 있는가. yolo: YOLO가 봤나. vlm: VLM이 봤나(답에 있음 true, 답했지만 없음 false, 답하지 않음 null). */
export function vlmFirst(yolo: boolean, vlm: boolean | null): boolean {
  return vlm ?? yolo;
}
