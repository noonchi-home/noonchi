// 대시보드 마스코트 그림: 브랜드 마스코트 전신 그림 ui/public/brand/mascot.png(1254×1254, 서 있는 미어캣, 오른쪽을 봄, 바탕 투명)와 그 안에서 잰 자리.

/** 마스코트 전신 그림과 그 안에서 잰 자리(그림 픽셀, 알파 128 넘는 픽셀). */
export interface MascotImage {
  src: string;
  width: number;
  height: number;
  /** 마스코트 단추에 담는 그림 열: 귀 뒤보다 왼쪽에서 주둥이 끝보다 오른쪽까지. */
  x0: number;
  x1: number;
  /** 머리 꼭대기 [x, y]. */
  headTop: [number, number];
  /** 귀 뒤(머리 가장 왼쪽) x. */
  earBack: number;
  /** 주둥이 끝 [x, y]: 그림에서 가장 오른쪽 점. 그림은 이쪽(오른쪽)을 본다. */
  snout: [number, number];
  /** 가슴 LG 표시를 담는 원: 가운데 [x, y]와 반지름. 둘레는 고른 가슴 크림색이다. */
  logo: { center: [number, number]; r: number };
  /** 화면 밑 선에 오는 줄 y(손 아래, 무릎 위). 그 아래는 화면 밖이다. */
  cut: number;
}

export const MASCOT: MascotImage = {
  src: `${import.meta.env.BASE_URL}brand/mascot.png`, width: 1254, height: 1254,
  x0: 462, x1: 900, headTop: [674, 64], earBack: 477, snout: [886, 196], cut: 960,
  logo: { center: [726.5, 497], r: 29 },
};
