export async function api<T>(path: string, body?: unknown): Promise<{ ok: boolean; status: number; json: T | null }> {
  const res = await fetch(path, body === undefined ? undefined : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const json = (await res.json().catch(() => null)) as T | null;
  return { ok: res.ok, status: res.status, json };
}
