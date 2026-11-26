// 이름마다 글꼴 파일이 하나라서 굵기는 fontWeight가 아니라 이름으로 고른다. 빌드한 앱은 app.json의 expo-font가,
// Expo Go는 dev-fonts.ts가 이 이름으로 글꼴을 넣는다. 600보다 가는 굵기는 두지 않는다.
export const fontFamily = { 600: "Pretendard-SemiBold", 700: "Pretendard-Bold" } as const;

export type FontWeight = keyof typeof fontFamily;

export function font(weight: FontWeight = 600) {
  return { fontFamily: fontFamily[weight] };
}

const base = font();

/** 바깥 글자는 SemiBold를 먼저 두고 받은 스타일을 얹는다. 다른 Text 안에 든 글자는 바깥 글꼴을 물려받게 받은 스타일만 둔다. */
export function withFont<S>(style: S, nested: boolean): S | [typeof base, S] {
  return nested ? style : [base, style];
}

const weights = Object.keys(fontFamily) as `${FontWeight}`[];

/**
 * 글꼴 파일을 못 올렸을 때(dev-fonts.ts의 missing)만 쓴다. 등록되지 않은 이름은 굵기 없이 400으로 그려지므로,
 * 펼친 스타일에서 Pretendard 이름을 빼고 그 이름의 굵기를 시스템 글꼴에 준다. 이름이 없는 안쪽 글자는 바깥 굵기를 물려받게 그대로 둔다.
 */
export function systemFont<S extends object>(flat: S | null | undefined) {
  if (!flat) return flat;
  const { fontFamily: name, ...rest } = flat as S & { fontFamily?: unknown };
  const weight = weights.find(w => fontFamily[w] === name);
  return weight ? { ...rest, fontWeight: weight } : flat;
}
