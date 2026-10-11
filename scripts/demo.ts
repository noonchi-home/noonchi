// npm run demo: npm start와 같은 경로(startServer)로 임의 포트에 서버를 띄우고(기본 HUB=matter, local 전송, mock 에이전트)
// 시나리오 5개(+승인)를 REST·WS로 돌려 결과 표를 찍는다. 모두 기대대로면 종료 코드 0.
//   MATTER_TRANSPORT=network npm run demo  → 브리지를 실제로 커미셔닝해서 돌린다(임시 저장 폴더·임의 포트)
//   HUB=memory npm run demo                → Matter 없이

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startServer } from "../src/server/start.js";
import { runScenarios, type ScenarioRow } from "./scenarios.js";

function width(s: string): number {
  let w = 0;
  for (const ch of s) w += /[ᄀ-ᇿ　-鿿가-힯＀-￯]/.test(ch) ? 2 : 1;
  return w;
}

function pad(s: string, n: number): string {
  let out = s;
  while (width(out) > n) out = out.slice(0, -1);
  if (out !== s) out = out.slice(0, -1) + "…";
  return out + " ".repeat(Math.max(0, n - width(out)));
}

async function main(): Promise<void> {
  const storageDir = mkdtempSync(join(tmpdir(), "twin-home-demo-"));
  const env = {
    ...process.env,
    PORT: "0",
    AGENT_PROVIDER: "mock",
    MATTER_TRANSPORT: process.env.MATTER_TRANSPORT ?? "local",
    MATTER_STORAGE_DIR: storageDir,
    // 실행 중인 npm start(5540)와 겹치지 않게
    MATTER_PORT: process.env.MATTER_PORT ?? String(20000 + Math.floor(Math.random() * 20000)),
  };
  const quiet: string[] = [];
  const srv = await startServer({ env, log: (m) => (m.startsWith("[경고]") ? console.log(m) : quiet.push(m)) });
  const hubText = `${srv.hubKind}${srv.transport ? `/${srv.transport}` : ""}`;
  console.log(`twin-home 데모 서버: ${srv.url} (기기 ${srv.twin.devices.length}개, ${srv.twin.source}, 허브 ${hubText}, mock 에이전트)\n`);

  let rows: ScenarioRow[] = [];
  try {
    rows = await runScenarios({ url: srv.url, hub: srv.hub, devices: srv.twin.devices, sessionId: "demo" });
  } finally {
    await srv.close();
    try {
      rmSync(storageDir, { recursive: true, force: true });
    } catch {
      // 임시 폴더(잠금이 늦게 풀리면 남을 수 있다)
    }
  }

  const cols = { no: 4, say: 22, expect: 28, reply: 40, ws: 3, matter: 44 };
  const line = (r: Record<keyof typeof cols, string> & { pass: string }) =>
    `${pad(r.no, cols.no)} ${pad(r.say, cols.say)} ${pad(r.expect, cols.expect)} ${pad(r.reply, cols.reply)} ${pad(r.ws, cols.ws)} ${pad(r.matter, cols.matter)} ${r.pass}`;
  console.log(line({ no: "#", say: "요청", expect: "기대", reply: "에이전트 답", ws: "WS", matter: "Matter 속성(허브)", pass: "결과" }));
  console.log("-".repeat(Object.values(cols).reduce((a, b) => a + b, 0) + 12));
  for (const r of rows) console.log(line({ ...r, ws: String(r.ws), pass: r.pass ? "통과" : "실패" }));
  const passed = rows.filter((r) => r.pass).length;
  console.log(`\n${passed}/${rows.length} 통과 (허브 ${hubText}, WS 상태 이벤트 합계 ${rows.reduce((n, r) => n + r.ws, 0)}개)`);
  process.exit(passed === rows.length && rows.length > 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(`데모 실패: ${(e as Error).stack ?? e}`);
  process.exit(1);
});
