// 시험용 자식 프로세스: 주어진 런타임 폴더로 서버(시험 모드, 모델 주소는 닫힌 포트)를 띄우고 「up <포트>」를 찍은 뒤 기다린다.
// tests/server-lock.test.ts가 이 프로세스를 강제 종료한 뒤 같은 폴더로 다시 뜨는지 본다.
import { startServer } from "../../src/server/start.js";

const runtime = process.argv[2];
if (!runtime) throw new Error("런타임 폴더가 필요해요");
const srv = await startServer({
  env: {
    HUB: "memory", PORT: "0", RUNTIME_DIR: runtime, REFLECT_AT: "off",
    VLM_BASE_URL: "http://127.0.0.1:9/v1", PAM_LLM_BASE_URL: "http://127.0.0.1:9/v1", OPENAI_BASE_URL: "http://127.0.0.1:9/v1",
  },
  log: () => {},
});
console.log(`up ${srv.port}`);
