// 서버를 켜는 입구(npm start의 src/server/main.ts): 시작 검사(src/server/preflight.ts)를 먼저 하고, 지나면 서버 묶음(src/server/start.ts)을 불러와 띄운다.
// 서버 묶음은 에이전트·기록·집 실행·버스·폰을 끌어와 처음 불러오는 데 수 초가 걸린다. 틀린 설정이면 그 전에 바로 멈춘다.
import { preflight } from "./preflight.js";
import type { RunningServer, StartServerOptions } from "./start.js";

export async function bootServer(opts: StartServerOptions = {}): Promise<RunningServer> {
  preflight(opts.env ?? process.env);
  const { startServer } = await import("./start.js");
  return startServer(opts);
}
