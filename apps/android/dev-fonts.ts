import { type FontSource, useFonts } from "expo-font";
import { fontFamily } from "./fonts";

// 빌드한 앱은 expo-font 설정 플러그인이 글꼴을 넣지만 Expo Go에는 없어서, 개발 때만 같은 이름으로 올린다.
const devFonts: Record<string, FontSource> = __DEV__ ? {
  [fontFamily[600]]: require("./assets/fonts/Pretendard-SemiBold.otf"),
  [fontFamily[700]]: require("./assets/fonts/Pretendard-Bold.otf"),
} : {};

/** 올리는 중이면 loading, 쓸 수 있으면 ready, 올리다 실패하면 missing. missing이어도 화면은 시스템 글꼴로 연다(AppText의 FontsMissing). */
export function useAppFonts(): "loading" | "ready" | "missing" {
  const [loaded, error] = useFonts(devFonts);
  return error != null ? "missing" : loaded ? "ready" : "loading";
}
