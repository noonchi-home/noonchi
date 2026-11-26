const mobilePath = "/mobile/";
const localHost = /^(?:localhost\.?|.*\.localhost\.?|127\..*|0\.0\.0\.0|\[::1\]|\[::\])$/i;

function secureRemote(value: string): URL | null {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password && !localHost.test(url.hostname) ? url : null;
  } catch { return null; }
}

export function mobileHubUrl(origin: string, advertised: readonly string[] = []): string {
  const current = secureRemote(origin);
  if (current) return new URL(mobilePath, current.origin).href;

  for (const candidate of advertised) {
    const hub = secureRemote(candidate);
    if (hub?.pathname === mobilePath && !hub.search && !hub.hash) return new URL(mobilePath, hub.origin).href;
  }
  return "";
}
