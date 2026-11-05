import { defineConfig } from "vitest/config";

// 루트 시험은 서버 쪽(tests/)만 돈다. 화면 시험(ui/tests)은 ui/의 jsdom 설정으로 따로 돈다.
export default defineConfig({
  test: { include: ["tests/**/*.test.ts"] },
});
