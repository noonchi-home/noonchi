const probeTimeoutMs = 8000;
const localHost = /^(?:localhost\.?|.*\.localhost\.?|127\..*|0\.0\.0\.0|\[::1\]|\[::\])$/i;
const qrText = /^https:\/\/[^/?#@\s\\]+\/mobile\/?$/i;

function dashboardUrl(raw: string): URL {
  const text = raw.trim();
  try {
    const url = new URL(text);
    if (qrText.test(text) && url.protocol === "https:" && !localHost.test(url.hostname) &&
        (url.pathname === "/mobile/" || url.pathname === "/mobile")) {
      return new URL("/mobile/", url.origin);
    }
  } catch { /* Invalid QR text. */ }
  throw new Error("대시보드에 표시된 NOONCHI HTTPS 연결 QR을 스캔해 주세요.");
}

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function isHome(value: unknown): boolean {
  return isObject(value) && typeof value.id === "string" && typeof value.name === "string";
}

function isHubSetup(value: unknown): boolean {
  return isObject(value) && value.ok === true && typeof value.done === "boolean" &&
    typeof value.switching === "boolean" && (value.home === null || isHome(value.home)) &&
    Array.isArray(value.homes) && value.homes.every(isHome) &&
    Array.isArray(value.mobile_urls) && value.mobile_urls.every(url => typeof url === "string");
}

async function checkHub(endpoint: string, signal: AbortSignal): Promise<void> {
  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: "GET", credentials: "omit", redirect: "error", signal, headers: { accept: "application/json" },
    });
  } catch {
    throw new Error("허브에 연결하지 못했어요. 휴대폰의 네트워크 연결을 확인해 주세요.");
  }
  const invalid = () => new Error("이 QR 주소에서 NOONCHI 허브를 확인하지 못했어요.");
  if (signal.aborted || !response.ok || response.redirected || response.url !== endpoint) throw invalid();
  if (!isHubSetup(await response.json().catch(() => null))) throw invalid();
}

/** Resolve the scanned hub's mobile home after one read-only setup check. */
export async function connectDashboard(raw: string, options: { signal?: AbortSignal } = {}): Promise<string> {
  const { signal } = options;
  const canceled = () => Object.assign(new Error("연결을 취소했어요."), { name: "AbortError" });
  if (signal?.aborted) throw canceled();

  const mobile = dashboardUrl(raw);
  const endpoint = new URL("/api/setup", mobile.origin).href;
  const request = new AbortController();
  let rejectInterrupted!: (error: Error) => void;
  const interrupted = new Promise<never>((_, reject) => { rejectInterrupted = reject; });
  const stop = (error: Error) => {
    rejectInterrupted(error);
    request.abort();
  };
  const cancel = () => stop(canceled());
  signal?.addEventListener("abort", cancel, { once: true });
  const timeout = setTimeout(() => stop(Object.assign(
    new Error("허브 응답을 기다리는 시간이 지났어요. 다시 스캔해 주세요."), { name: "TimeoutError" },
  )), probeTimeoutMs);
  try {
    await Promise.race([checkHub(endpoint, request.signal), interrupted]);
    if (signal?.aborted) throw canceled();
    return mobile.href;
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener("abort", cancel);
  }
}
