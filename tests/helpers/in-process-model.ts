import { defaultReply, type FakeRequest, type FakeResponse } from "../../scripts/fake-openai.js";

interface Fixture {
  reply?: (body: any) => string | null | Promise<string | null>;
  respond?: (body: any) => FakeResponse | null | Promise<FakeResponse | null>;
}

/** Inject just the wire transport. The production clients still parse the provider JSON. */
export function inProcessModel(fixture: Fixture = {}) {
  const base = "http://adaptive-fixture.invalid/v1";
  const requests: FakeRequest[] = [];
  const network: string[] = [];
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const req = new Request(input, init);
    req.signal.throwIfAborted();
    const url = new URL(req.url);
    const allowed = url.origin === new URL(base).origin && req.method === "POST" &&
      ["/v1/responses", "/v1/chat/completions"].includes(url.pathname);
    if (!allowed) {
      network.push(url.origin + url.pathname);
      throw new Error("Offline replay attempted network use");
    }
    const body = await req.json() as { model?: string };
    const n = requests.push({ method: req.method, path: url.pathname, body });
    if (url.pathname.endsWith("/chat/completions")) {
      const content = await fixture.reply?.(body) ?? defaultReply(body);
      req.signal.throwIfAborted();
      return Response.json({ id: "completion-" + n, object: "chat.completion", model: body.model,
        choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }] });
    }
    const result = await fixture.respond?.(body) ?? { text: "" };
    req.signal.throwIfAborted();
    const output = (result.calls ?? []).map((call, i) => ({ type: "function_call", id: `fc-${n}-${i}`, call_id: `call-${n}-${i}`,
      name: call.name, arguments: JSON.stringify(call.args), status: "completed" }));
    return Response.json({ id: "response-" + n, object: "response", model: body.model, status: "completed",
      output: result.text ? [...output, { type: "message", id: "reply-" + n, role: "assistant",
        content: [{ type: "output_text", text: result.text, annotations: [] }] }] : output });
  };
  return { base, requests, network, fetch };
}
