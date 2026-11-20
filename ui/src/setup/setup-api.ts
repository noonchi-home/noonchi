// 설정 화면이 서버와 주고받는 작은 도우미. 서버가 판단·검사를 하고 화면은 고른 것을 보내고 결과를 그린다.

export type Fail = { ok?: false; error?: string };
export type Reply<T> = { status: number; json: T | Fail };

/** body가 있으면 POST(JSON). 서버에 못 닿거나 응답을 못 읽어도 던지지 않고 오류 글을 돌려준다. */
export async function call<T>(path: string, body?: unknown, method: "POST" | "PUT" = "POST"): Promise<Reply<T>> {
  const init = body === undefined ? undefined : { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
  try {
    const res = await fetch(path, init);
    const json = (await res.json().catch(() => ({ ok: false, error: "응답을 읽지 못했어요." }))) as T | Fail;
    return { status: res.status, json };
  } catch {
    return { status: 0, json: { ok: false, error: "서버에 닿지 못했어요." } };
  }
}

/** 2xx이고 ok: true인 응답. */
export function isOk<T>(r: Reply<T>): r is { status: number; json: T } {
  return r.status >= 200 && r.status < 300 && (r.json as { ok?: unknown } | null)?.ok === true;
}

export const failText = (r: Reply<unknown>, fallback: string) => (r.json as Fail | null)?.error ?? fallback;
