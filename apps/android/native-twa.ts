import { requireOptionalNativeModule } from "expo";
import { createConnectedHub } from "./connected-hub";
import { readTwaTarget } from "./twa";

const chrome = requireOptionalNativeModule<{
  open(url: string, origin: string, token: string): Promise<void>;
  cancel(token: string): Promise<void>;
}>("NoonchiTwa");
let nextToken = 0;

export async function startNativeAr(hubUrl: string, { signal }: { signal: AbortSignal }) {
  if (!chrome) throw new Error("클로이드를 켜려면 설치용 NOONCHI 앱을 사용해 주세요.");
  const check = new AbortController();
  const token = String(++nextToken);
  const cancel = () => {
    check.abort();
    void chrome.cancel(token).catch(() => {});
  };
  if (signal.aborted) return;
  signal.addEventListener("abort", cancel, { once: true });
  const timer = setTimeout(() => check.abort(), 8000);
  try {
    const setup = await createConnectedHub(hubUrl).get<unknown>("/api/setup", check.signal);
    if (signal.aborted) return;
    if (check.signal.aborted) throw new Error("응답 시간 초과");
    clearTimeout(timer);
    const target = readTwaTarget(setup);
    await chrome.open(target.url, target.origin, token);
  } catch (error) {
    if (signal.aborted) return;
    if (check.signal.aborted) throw new Error("허브의 응답이 늦어졌어요. 다시 시도해 주세요.");
    throw error;
  } finally {
    clearTimeout(timer);
    signal.removeEventListener("abort", cancel);
  }
}
