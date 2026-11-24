// 로딩 화면 배치(시안 2의 B): 마스코트 상체가 화면 아래 60%를 채우고 발·꼬리는 화면 밖으로 잘린다.
// 워드마크는 위 안전 영역 아래부터 마스코트 위끝 사이의 가운데에 둔다.

/** assets/mascot-large.webp 618×1080. 화면 아래 끝이 그림 y=640을 지나고, 몸통 중심 x=420이 화면 가운데에 온다. */
const MASCOT = { width: 618, height: 1080, visibleBottom: 640, bodyCenterX: 420 } as const;
const MASCOT_TOP = 0.4;
/** BrandWordmark 그림 2130×374. */
const WORDMARK_RATIO = 374 / 2130;

export type Box = { left: number; top: number; width: number; height: number };

export function launchLayout(width: number, height: number, topInset: number): { wordmark: Box; mascot: Box } {
  const mascotTop = MASCOT_TOP * height;
  const mascotHeight = (height - mascotTop) * MASCOT.height / MASCOT.visibleBottom;
  const mascotWidth = mascotHeight * MASCOT.width / MASCOT.height;
  const wordmarkWidth = Math.min(0.59 * width, 270);
  const wordmarkHeight = wordmarkWidth * WORDMARK_RATIO;
  return {
    wordmark: {
      left: (width - wordmarkWidth) / 2,
      top: topInset + (mascotTop - topInset - wordmarkHeight) / 2,
      width: wordmarkWidth,
      height: wordmarkHeight,
    },
    mascot: {
      // 음수면 그림 왼쪽이 화면 밖으로 잘린다
      left: width / 2 - mascotWidth * MASCOT.bodyCenterX / MASCOT.width,
      top: mascotTop,
      width: mascotWidth,
      height: mascotHeight,
    },
  };
}
