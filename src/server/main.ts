// npm start: twin-studio 데이터를 읽고 허브(기본 HUB=matter)·정책·에이전트·서버를 띄운다.
// Matter network 커미셔닝이 제한 시간(MATTER_COMMISSION_TIMEOUT_MS, 기본 30초) 안에 안 되면 local 전송으로 대신 뜬다.

import { existsSync } from "node:fs";
import dotenv from "dotenv";
import { startServer } from "./start.js";

async function main(): Promise<void> {
  dotenv.config({ quiet: true });
  const srv = await startServer({ env: process.env });
  const { url, hubKind, transport, agent } = srv;
  const provider = agent.provider;

  console.log(`twin-home 서버: ${url}  (허브 ${hubKind}${transport ? `/${transport}` : ""}, 에이전트 ${provider.name}${provider.model ? `/${provider.model}` : ""})`);
  console.log(`  웹 화면   ${url}/`);
  console.log(`  WS 이벤트 ${url.replace(/^http/, "ws")}/events`);
  console.log(`  3D 트윈   ${existsSync(srv.twinDir) ? `${url}/twin/` : `(아직 없음: ${srv.twinDir})`}`);
  if (hubKind === "matter" && transport === "network") {
    console.log(`  Matter    다른 컨트롤러(Home Assistant 등) 추가: curl -X POST ${url}/api/matter/commissioning-window 후 나온 페어링 코드 입력(README "Matter 페어링")`);
  }

  let stopping = false;
  const shutdown = async () => {
    if (stopping) return;
    stopping = true;
    console.log("종료하는 중…");
    await srv.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((e) => {
  console.error(`twin-home 서버를 시작하지 못했습니다: ${(e as Error).message}`);
  process.exit(1);
});
