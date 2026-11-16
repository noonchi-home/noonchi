// API 경로: 말 요청 에이전트(대화·승인·취소·승인 대기).
import { newSessionId } from "../../agent/index.js";
import { HttpError, readJson, type RouteKit } from "./kit.js";

export function agentRoutes({ route, hub, agent, policy }: RouteKit): void {
  route("POST", /^\/api\/agent\/chat$/, async (req) => {
    if (!agent) throw new HttpError(503, "에이전트가 설정되지 않았습니다.");
    const body = await readJson(req);
    const message = typeof body.message === "string" ? body.message.trim() : "";
    if (!message) throw new HttpError(400, "message(보낼 말)가 필요합니다.");
    if (message.length > 2000) throw new HttpError(400, "message가 너무 깁니다(최대 2000자).");
    const sessionId = typeof body.sessionId === "string" && body.sessionId.trim() ? body.sessionId.trim().slice(0, 100) : newSessionId();
    return agent.chat(sessionId, message);
  });

  route("POST", /^\/api\/agent\/confirm$/, async (req) => {
    const body = await readJson(req);
    if (typeof body.token !== "string" || !body.token) throw new HttpError(400, "token이 필요합니다.");
    if (agent) return agent.confirm(body.token);
    const p = policy.pending().find((x) => x.token === body.token);
    const r = await policy.confirm(hub, body.token);
    return { ...r, deviceId: p?.deviceId, reply: r.ok ? "승인한 명령을 실행했어요." : r.error };
  }, (b) => ((b as { ok: boolean }).ok ? 200 : 400));

  route("POST", /^\/api\/agent\/cancel$/, async (req) => {
    const body = await readJson(req);
    if (typeof body.token !== "string" || !body.token) throw new HttpError(400, "token이 필요합니다.");
    if (agent) return agent.cancel(body.token);
    const p = policy.consume(body.token);
    return { ok: !!p, reply: p ? "취소했어요." : "취소할 승인 대기가 없어요." };
  });

  route("GET", /^\/api\/agent\/pending$/, async (_req, url) => {
    const sessionId = url.searchParams.get("sessionId") ?? undefined;
    if (agent) return agent.pending(sessionId);
    return policy.pending().map((p) => ({ ...p, expiresAt: new Date(p.expiresAt).toISOString() }));
  });
}
