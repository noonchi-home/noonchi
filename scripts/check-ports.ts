// 키 없는 컨테이너 확인(scripts/container-smoke.ts)이 여는 호스트 포트(127.0.0.1). CHECK_HUB_PORT·CHECK_PHONE_PORT·CHECK_PAM_PORT로 바꾼다.
// 기본은 허브 8500·폰 8510·pam 8530이다. 8520~8529는 화면 캡처 서버 자리라 기본으로 쓰지 않는다.

export type CheckPorts = { hub: number; phone: number; pam: number };

export const CHECK_PORT_DEFAULTS: Readonly<CheckPorts> = { hub: 8500, phone: 8510, pam: 8530 };
const NAMES: Record<keyof CheckPorts, string> = { hub: "CHECK_HUB_PORT", phone: "CHECK_PHONE_PORT", pam: "CHECK_PAM_PORT" };

/** env의 CHECK_*_PORT(없거나 비면 기본값). 포트가 아닌 값이나 겹치는 포트면 오류. */
export function checkPorts(env: Record<string, string | undefined>): CheckPorts {
  const pick = (k: keyof CheckPorts) => {
    const raw = env[NAMES[k]]?.trim();
    const n = raw ? Number(raw) : CHECK_PORT_DEFAULTS[k];
    if (!Number.isInteger(n) || n < 1 || n > 65535) throw new Error(`${NAMES[k]}는 1~65535 정수여야 해요(${raw})`);
    return n;
  };
  const ports = { hub: pick("hub"), phone: pick("phone"), pam: pick("pam") };
  if (new Set(Object.values(ports)).size !== 3) throw new Error(`허브·폰·pam 포트가 겹쳐요(${ports.hub}, ${ports.phone}, ${ports.pam})`);
  return ports;
}
