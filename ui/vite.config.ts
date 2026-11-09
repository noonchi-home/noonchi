/// <reference types="vitest/config" />
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import tailwind from "@tailwindcss/vite";
import { defineConfig } from "vite";

// 개발 중에는 twin-home 서버(기본 8200)로 붙는다. iframe 뷰어도 같은 출처가 되어야 aptViewer를 읽을 수 있다.
const SERVER = process.env.TWIN_HOME_URL ?? "http://127.0.0.1:8200";
const page = (p: string) => fileURLToPath(new URL(p, import.meta.url));
// 화면 사진 페이지(ui/phone/shots/)는 PHONE_SHOTS=1 빌드에만 넣는다(상태마다 npm run capture로 찍을 때).
const shots: Record<string, string> = process.env.PHONE_SHOTS === "1" ? { phoneShots: page("phone/shots/index.html") } : {};

export default defineConfig({
  plugins: [react(), tailwind()],
  // @viewer: 저장소 안 트윈 뷰어 모듈(twin/apartment/viewer). 대시보드 트윈이 벽 보기·상태 규칙을 그대로 import한다.
  resolve: { alias: { "@": page("src"), "@viewer": page("../twin/apartment/viewer") } },
  build: { outDir: "dist", emptyOutDir: true, rollupOptions: { input: { main: page("index.html"), setup: page("setup/index.html"), phone: page("phone/index.html"), ...shots } } },
  server: {
    host: "127.0.0.1", port: 5173, strictPort: true,
    fs: { allow: [page("..")] },
    proxy: { "/api": SERVER, "/twin": SERVER, "/events": { target: SERVER.replace(/^http/, "ws"), ws: true } },
  },
  test: { environment: "jsdom", include: ["tests/**/*.test.{ts,tsx}"], setupFiles: ["tests/setup.ts"] },
});
