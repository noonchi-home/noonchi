/**
 * 폰 주소 고르기: https 주소(PHONE_URL·Tailscale, AR이 바로 된다)를 먼저. 그 안에서 집 공유기 대역(192.168.x), 10.x 순서.
 * WSL·VPN 가상 어댑터 주소는 뒤로. 같은 순위는 서버가 준 순서 그대로.
 */
const band = (u: string) => (u.includes("//192.168.") ? 0 : u.includes("//10.") ? 1 : 2);
const rank = (u: string) => (u.startsWith("https://") ? 0 : 3) + band(u);

export function pickPhoneUrl(urls: string[]): { best: string | null; others: string[] } {
  const sorted = [...urls].sort((a, b) => rank(a) - rank(b));
  return { best: sorted[0] ?? null, others: sorted.slice(1) };
}
