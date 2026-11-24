// 루트 시험은 앱 코드(apps/android)와 실제 서버를 한 시험에서 같이 돌린다. apps/android/tsconfig.json은 expo/tsconfig.base를 이어받아서
// apps/android/node_modules가 없는 폴더(새 워크트리 등)에서 그 tsconfig를 읽으면 변환이 「Failed to load tsconfig 'expo/tsconfig.base'」로 실패한다.
import { describe, expect, it } from "vitest";
import config from "../vitest.config.js";

describe("vitest 설정", () => {
  it("모든 파일을 루트 tsconfig.json으로 변환한다(apps/android의 expo tsconfig를 읽지 않는다)", () => {
    expect(config.tsconfig).toBe("tsconfig.json");
  });
});
