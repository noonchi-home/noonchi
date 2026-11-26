import { afterEach, expect, it, vi } from "vitest";
import { connectDashboard } from "../apps/android/pairing.js";

const origin = "https://hub.example.ts.net";
const mobile = `${origin}/mobile/`;
const setup = `${origin}/api/setup`;
const unregistered = { ok: true, done: false, switching: false, home: null, homes: [], mobile_urls: [] };

function reply(body: unknown, url = setup, init: ResponseInit = {}): Response {
  return withUrl(Response.json(body, init), url);
}

function withUrl(response: Response, url = setup): Response {
  return Object.defineProperty(response, "url", { value: url });
}

function mockFetch(response?: Response) {
  const send = vi.fn<typeof fetch>();
  if (response) send.mockResolvedValue(response);
  vi.stubGlobal("fetch", send);
  return send;
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it("checks the scanned origin with one read-only setup request and opens the same hub before registration", async () => {
  const send = mockFetch(reply({ ...unregistered, mobile_urls: ["https://elsewhere.example/mobile/"] }));
  await expect(connectDashboard("  https://HUB.example.ts.net:443/mobile  ")).resolves.toBe(mobile);
  expect(send).toHaveBeenCalledTimes(1);
  expect(send).toHaveBeenCalledWith(setup, expect.objectContaining({
    method: "GET", credentials: "omit", redirect: "error", signal: expect.any(AbortSignal),
  }));
});

it.each([
  "not a URL", "https:hub.example.ts.net/mobile/", "https://hub.example.ts.net/phone/",
  "https://hub.example.ts.net/mobile/settings/", "https://hub.example.ts.net/mobile/?tab=home",
  "https://hub.example.ts.net/mobile/#jump", "https://name:pass@hub.example.ts.net/mobile/",
  "http://192.168.0.12:8200/mobile/", "http://hub.example.ts.net/mobile/", "http://localhost/mobile/",
  "https://127.0.0.1/mobile/", "https://localhost/mobile/", "custom://hub.example.ts.net/mobile/",
])("rejects invalid or unusable app QR before contacting the server: %s", async raw => {
  const send = mockFetch();
  await expect(connectDashboard(raw)).rejects.toThrow();
  expect(send).not.toHaveBeenCalled();
});

it.each([
  ["foreign response", () => reply({ ...unregistered }, "https://other.example/api/setup")],
  ["different same-origin route", () => reply({ ...unregistered }, `${origin}/api/health`)],
  ["redirect status", () => reply(unregistered, setup, { status: 302, headers: { location: "https://other.example/api/setup" } })],
  ["failed HTTP", () => reply(unregistered, setup, { status: 503 })],
  ["unrelated JSON", () => reply({ ok: true, done: false })],
  ["wrong setup shape", () => reply({ ...unregistered, homes: [{ id: 42, name: "home" }] })],
  ["HTML instead of JSON", () => withUrl(new Response("<html>hello</html>"))],
] as const)("does not open a URL on %s", async (_, response) => {
  mockFetch(response());
  await expect(connectDashboard(mobile)).rejects.toThrow();
});

it("reports a network failure without opening the app", async () => {
  mockFetch().mockRejectedValue(new TypeError("offline"));
  await expect(connectDashboard(mobile)).rejects.toThrow(/허브/);
});

it("rejects an already canceled scan without calling fetch", async () => {
  const send = mockFetch();
  const cancel = new AbortController();
  cancel.abort();
  await expect(connectDashboard(mobile, { signal: cancel.signal })).rejects.toMatchObject({ name: "AbortError" });
  expect(send).not.toHaveBeenCalled();
});

it("cancel abandons a request even if the underlying fetch does not settle", async () => {
  const send = mockFetch();
  send.mockImplementation(() => new Promise(() => {}));
  const cancel = new AbortController();
  const claim = expect(connectDashboard(mobile, { signal: cancel.signal })).rejects.toMatchObject({ name: "AbortError" });
  cancel.abort();
  await claim;
  expect(send.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
});

it("the 8-second deadline includes an unfinished JSON body", async () => {
  vi.useFakeTimers();
  const response = reply(unregistered);
  vi.spyOn(response, "json").mockImplementation(() => new Promise(() => {}));
  const send = mockFetch(response);
  const claim = expect(connectDashboard(mobile)).rejects.toMatchObject({ name: "TimeoutError" });
  await vi.advanceTimersByTimeAsync(8000);
  await claim;
  expect(response.json).toHaveBeenCalledOnce();
  expect(send.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
});
