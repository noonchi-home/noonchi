// 와이파이 직접 연결은 없다: 대시보드·폰 서버는 이 PC(루프백)에서만 듣고, 폰·다른 기기는 Tailscale serve HTTPS로만 들어온다.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { fetchRetry } from "../src/shared/net.js";
import { startServer, type RunningServer } from "../src/server/start.js";

let srv: RunningServer | undefined;
afterEach(async () => {
  await srv?.close();
  srv = undefined;
});

const baseEnv = () => ({ HUB: "memory", PORT: "0", RUNTIME_DIR: mkdtempSync(join(tmpdir(), "rt-")) });

/** 시작하면 안 되는 설정의 오류 글. 그래도 떴으면 바로 닫고 실패로 본다. */
async function refusal(env: Record<string, string | undefined>): Promise<string> {
  const message = await startServer({ env: { ...baseEnv(), ...env }, log: () => {} }).then(
    async (started) => { await started.close(); return null; },
    (e: Error) => e.message,
  );
  if (message === null) throw new Error(`서버가 ${JSON.stringify(env)}로 시작했다`);
  return message;
}

describe("와이파이 직접 연결 없음", () => {
  it.each([
    { HOST: "0.0.0.0" },
    { HOST: "::" },
    { HOST: "192.0.2.10" },
    { PHONE_PORT: "0", PHONE_HOST: "0.0.0.0" },
    { PHONE_PORT: "0", PHONE_HOST: "192.0.2.10" },
    { NOONCHI_IN_CONTAINER: "1", HOST: "192.0.2.10" },
  ])("컨테이너 밖에서 루프백이 아닌 주소(%o)로는 시작하지 않고 Tailscale serve로 열라고 한다", async (env) => {
    expect(await refusal(env)).toMatch(/와이파이 직접 연결은 쓰지 않아요.*Tailscale serve/);
  });

  it("허브 mobile_urls에는 HUB_URL과 tailscale serve의 HTTPS 주소만 들어가고 이 PC 네트워크 주소는 없다", async () => {
    srv = await startServer({
      env: { ...baseEnv(), ALLOWED_ORIGINS: "https://hub.test.ts.net", HUB_URL: "https://hub.test.ts.net" }, log: () => {},
      servedHubUrls: async () => ["https://served.test.ts.net", "http://100.101.102.103:8200", "http://192.168.0.53:8200"],
    });
    const setup = (await (await fetchRetry(`${srv.url}/api/setup`)).json()) as { mobile_urls: string[] };
    expect(setup.mobile_urls).toEqual(["https://served.test.ts.net/mobile/", "https://hub.test.ts.net/mobile/"]);
  });
});
