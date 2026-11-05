// 폰에서 열 주소. 순서: PHONE_URL → tailscale serve가 폰 포트로 잇는 https 주소(AR은 https에서만 된다) → 와이파이 주소.
// tailscale 명령 실행은 주입한다(시험은 가짜 출력, 실제 서버는 main.ts가 runCommand를 넘긴다).
import { execFile } from "node:child_process";

export type RunCommand = (cmd: string, args: string[]) => Promise<string>;

const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** `tailscale serve status --json` 설정에서 이 PC의 폰 포트로 이어진 https 사이트를 /phone/ 주소로. */
export function servedPhoneUrls(config: unknown, phonePort: number): string[] {
  const web = isRecord(config) ? config.Web : undefined;
  if (!isRecord(web)) return [];
  const out: string[] = [];
  for (const [hostPort, site] of Object.entries(web)) {
    const m = /^(.+):(\d+)$/.exec(hostPort);
    const handlers = isRecord(site) ? site.Handlers : undefined;
    if (!m || !isRecord(handlers)) continue;
    const [, host, port] = m;
    for (const [mount, handler] of Object.entries(handlers)) {
      const proxy = isRecord(handler) && typeof handler.Proxy === "string" ? handler.Proxy : "";
      let target: URL;
      try {
        target = new URL(proxy);
      } catch {
        continue;
      }
      const targetPort = Number(target.port || (target.protocol === "https:" ? 443 : 80));
      if (!LOCAL_HOSTS.has(target.hostname) || targetPort !== phonePort || target.pathname !== "/") continue;
      out.push(`https://${host}${port === "443" ? "" : `:${port}`}${mount.replace(/\/+$/, "")}/phone/`);
    }
  }
  return out;
}

/** PHONE_URL(있으면) → tailscale → 와이파이. 같은 주소는 한 번만. */
export function orderPhoneUrls(lan: string[], tailscale: string[], envUrl?: string): string[] {
  const first = envUrl?.trim() ? [envUrl.trim()] : [];
  return [...new Set([...first, ...tailscale, ...lan])];
}

/** tailscale serve 설정을 읽어 폰 주소를 찾는다. tailscale이 없거나 실패하면 빈 목록. */
export async function findServedPhoneUrls(phonePort: number, run: RunCommand): Promise<string[]> {
  try {
    return servedPhoneUrls(JSON.parse(await run("tailscale", ["serve", "status", "--json"])), phonePort);
  } catch {
    return [];
  }
}

/** 실제 명령 실행. 오래 걸리면(timeoutMs) 실패로 본다. */
export const runCommand = (cmd: string, args: string[], timeoutMs = 3000): Promise<string> =>
  new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout: timeoutMs, windowsHide: true }, (error, stdout) => (error ? reject(error) : resolve(String(stdout))));
  });
