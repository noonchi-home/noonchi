// API 경로: 집 장면·배치 보정(src/layout/), 고를 수 있는 집.
import { HttpError, readJson, type RouteKit } from "./kit.js";

export function layoutRoutes({ route, opts, sameHome }: RouteKit): void {
  // ── 집 장면·배치 보정 ──

  route("GET", /^\/api\/scene$/, async () => {
    const scene = opts.scene?.();
    if (!scene) throw new HttpError(404, "집 장면이 없어요.");
    return { ok: true, scene };
  });

  // 배치 맞추기 메시지(syncMessages)는 뷰어가 이 장면을 읽었다고 보고 차이만 보낸다
  route("GET", /^\/api\/scene\/baked$/, async () => {
    const scene = opts.bakedScene?.();
    if (!scene) throw new HttpError(404, "집 장면이 없어요.");
    return { ok: true, scene };
  });

  const requireLayout = () => {
    if (!opts.layout) throw new HttpError(404, "배치 보정을 쓸 수 없습니다(집 scene.json이 없음).");
    return opts.layout;
  };
  route("GET", /^\/api\/layout$/, async () => {
    const editor = requireLayout();
    return { ok: true, ...editor.status(), items: editor.edits() };
  });
  route("POST", /^\/api\/layout\/save$/, async (req) => {
    sameHome(await readJson(req));
    return { ok: true, ...requireLayout().save() };
  });
  route("POST", /^\/api\/layout\/reset$/, async (req) => {
    sameHome(await readJson(req));
    return { ok: true, reverted: requireLayout().reset().length };
  });
}

export function homeRoutes({ route, opts }: RouteKit): void {
  route("GET", /^\/api\/homes$/, async () => ({ current: opts.home?.id ?? null, homes: opts.homes ?? (opts.home ? [opts.home] : []) }));
}
