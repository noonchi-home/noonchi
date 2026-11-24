// npm start: twin-studio 데이터를 읽고 허브(기본 HUB=matter)·정책·에이전트·서버를 띄운다.
// 설정(고른 집·가전 신호 출처·끝냄)은 RUNTIME_DIR(기본 runtime/)에 저장하고 다음 시작 때 읽는다. 저장이 없으면 HOME_ID 집.
// Matter network 커미셔닝이 제한 시간(MATTER_COMMISSION_TIMEOUT_MS, 기본 30초) 안에 안 되면 local 전송으로 대신 뜬다.

import { existsSync } from "node:fs";
import dotenv from "dotenv";
import { findServedPhoneUrls, phoneUrlWarning, runCommand } from "../phone/index.js";
import { installShutdown, installStdinShutdown } from "./shutdown.js";
import { startServer } from "./start.js";

async function main(): Promise<void> {
  dotenv.config({ quiet: true });
  // tailscale serve로 폰 포트를 https로 열어 두었으면 그 주소를 폰 주소 앞에 둔다(없거나 실패하면 이 PC 주소만)
  const srv = await startServer({
    env: process.env, persistSetup: true, servedPhoneUrls: (port) => findServedPhoneUrls(port, runCommand),
    servedHubUrls: async port => (await findServedPhoneUrls(port, runCommand)).map(url => new URL(url).origin),
  });
  // 서버 줄을 찍자마자 온 SIGTERM·표준 입력 종료도 받도록 줄을 찍기 전에 건다
  const shutdown = installShutdown(process, () => srv.close(), { log: console.log });
  installStdinShutdown(process.stdin, shutdown, process.env);
  const { url, hubKind, transport, agent } = srv;
  const provider = agent.provider;

  console.log(`twin-home 서버: ${url}  (허브 ${hubKind}${transport ? `/${transport}` : ""}, 에이전트 ${provider.name}${provider.model ? `/${provider.model}` : ""})`);
  console.log(`  웹 화면   ${url}/`);
  console.log(`  폰 홈     ${url}/mobile/`);
  console.log(`  WS 이벤트 ${url.replace(/^http/, "ws")}/events`);
  console.log(`  3D 트윈   ${existsSync(srv.twinDir) ? `${url}/twin/` : `(아직 없음: ${srv.twinDir})`}`);
  for (const phoneUrl of srv.phoneUrls) console.log(`  폰 AR     ${phoneUrl}`);
  const phoneWarning = phoneUrlWarning(process.env.PHONE_URL);
  if (phoneWarning) console.log(`  [경고] ${phoneWarning}`);
  if (hubKind === "matter" && transport === "network") {
    console.log(`  Matter    다른 컨트롤러(Home Assistant 등) 추가: curl -X POST ${url}/api/matter/commissioning-window 후 나온 페어링 코드 입력(README "Matter 페어링")`);
  }
}

main().catch((e) => {
  console.error(`twin-home 서버를 시작하지 못했습니다: ${(e as Error).message}`);
  process.exit(1);
});
