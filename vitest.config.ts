import { defineConfig } from "vitest/config";

// 루트 시험은 서버 쪽(tests/)만 돈다. 화면 시험(ui/tests)은 ui/의 jsdom 설정으로 따로 돈다.
// tests/setup/no-real-thinq.ts: 시험에서 실제 ThinQ로 가는 fetch를 막는다.
// tests/setup/no-real-ai.ts: 시험에서 실제 AI API(OpenAI·OpenRouter·Anthropic)로 가는 fetch를 막는다.
export default defineConfig({
  test: { include: ["tests/**/*.test.ts"], setupFiles: ["tests/setup/no-real-thinq.ts", "tests/setup/no-real-ai.ts"] },
});
