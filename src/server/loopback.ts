// 서버가 들을 주소: 와이파이 직접 연결은 쓰지 않는다. 대시보드(HOST)·폰 서버(PHONE_HOST)는 이 PC(루프백)에서만 듣고,
// 폰·다른 기기는 Tailscale serve HTTPS로 들어온다. 폰 서버는 인증이 없어 같은 와이파이 기기가 승인 token을 받고 confirm을 보낼 수 있었다.
// 컨테이너(Dockerfile의 NOONCHI_IN_CONTAINER=1)는 안에서 0.0.0.0·::로 듣고 compose가 호스트의 127.0.0.1로만 낸다.
import { isLoopbackHost } from "../shared/net.js";

const WILDCARD = new Set(["0.0.0.0", "::", "[::]"]);

/** 들을 수 없는 주소면 시작을 막을 오류 글, 괜찮으면 null. 비운 값은 기본 127.0.0.1이다. */
export function lanBindingError(env: Record<string, string | undefined>): string | null {
  const container = env.NOONCHI_IN_CONTAINER?.trim() === "1";
  for (const name of ["HOST", "PHONE_HOST"] as const) {
    const host = env[name]?.trim();
    if (!host || isLoopbackHost(host) || (container && WILDCARD.has(host))) continue;
    return `와이파이 직접 연결은 쓰지 않아요. ${name}=${host} 대신 ${name}를 비우거나 127.0.0.1로 두고, 폰·대시보드는 Tailscale serve로 여세요.`;
  }
  return null;
}
