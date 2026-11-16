// API 경로: 관찰 흐름 상태(GET /api/brain)와 지금 World State(GET /api/world).
import { HttpError, type RouteKit } from "./kit.js";

export function observeRoutes({ route, opts }: RouteKit): void {
  route("GET", /^\/api\/brain$/, async () => {
    if (!opts.brain) throw new HttpError(404, "관찰 흐름이 꺼져 있습니다(BRAIN=1, PHONE_PORT 필요)");
    return { ok: true, ...opts.brain.status() };
  });

  route("GET", /^\/api\/world$/, async () => {
    if (!opts.world) throw new HttpError(404, "관찰 흐름이 꺼져 있습니다(BRAIN=1, PHONE_PORT 필요)");
    return { ok: true, world: opts.world() };
  });
}
