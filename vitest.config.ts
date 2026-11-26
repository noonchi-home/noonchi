import { defineConfig } from "vitest/config";

// 루트 시험은 서버 쪽(tests/)만 돈다. 화면 시험(ui/tests)은 ui/의 jsdom 설정으로 따로 돈다.
// tests/setup/no-real-thinq.ts: 시험에서 실제 ThinQ로 가는 fetch를 막는다.
// tests/setup/no-real-ai.ts: 시험에서 실제 AI API(OpenAI·OpenRouter·Anthropic)로 가는 fetch를 막는다.
// tsconfig: 모든 파일을 루트 tsconfig.json으로 변환한다. 시험이 가져오는 apps/android 코드의 tsconfig는 expo/tsconfig.base를 이어받아
// apps/android/node_modules가 없는 폴더에서는 읽지 못한다(tests/vitest-config.test.ts).
export default defineConfig({
  tsconfig: "tsconfig.json",
  test: { include: ["tests/**/*.test.ts"], setupFiles: ["tests/setup/no-real-thinq.ts", "tests/setup/no-real-ai.ts"] },
});
