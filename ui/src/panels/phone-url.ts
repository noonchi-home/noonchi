/** 서버가 아는 폰 주소 중 집 공유기 대역(192.168.x)을 먼저, 그다음 10.x. WSL·VPN 가상 어댑터 주소는 뒤로. */
const rank = (u: string) => (u.includes("//192.168.") ? 0 : u.includes("//10.") ? 1 : 2);

export function pickPhoneUrl(urls: string[]): { best: string | null; others: string[] } {
  const sorted = [...urls].sort((a, b) => rank(a) - rank(b));
  return { best: sorted[0] ?? null, others: sorted.slice(1) };
}
