// API 경로: 폰 위치 맞추기 시작 위치(자리·방향)와 맞춤 상태(src/phone/sync/).
import { StartPoseError, type StartPose } from "../../phone/index.js";
import { HttpError, readJson, type RouteKit } from "./kit.js";

export function phoneRoutes({ route, opts, sameHome }: RouteKit): void {
  // ── 폰 위치 맞추기: 시작 위치(자리·방향)와 맞춤 상태 ──

  const requireStart = () => {
    if (!opts.start) throw new HttpError(404, "시작 위치를 쓸 수 없습니다(집 scene.json이 없음).");
    return opts.start;
  };
  const startView = (s: StartPose | null) => ({
    ok: true, start: s ? { position: s.position, yaw_deg: s.yawDeg, label: s.label, facing_label: s.facingLabel } : null,
  });
  route("GET", /^\/api\/phone\/start-pose$/, async () => startView(requireStart().get()));
  route("POST", /^\/api\/phone\/start-pose$/, async (req) => {
    const store = requireStart();
    const body = await readJson(req);
    sameHome(body);
    try {
      return startView(store.save(body));
    } catch (e) {
      if (e instanceof StartPoseError) throw new HttpError(400, e.message);
      throw e;
    }
  });
  // 저장하지 않고 검사·이름 채우기만(설정 화면이 자리·방향을 바꿀 때)
  route("POST", /^\/api\/phone\/start-pose\/preview$/, async (req) => {
    const store = requireStart();
    const body = await readJson(req);
    sameHome(body);
    try {
      return startView(store.preview(body));
    } catch (e) {
      if (e instanceof StartPoseError) throw new HttpError(400, e.message);
      throw e;
    }
  });
  route("POST", /^\/api\/phone\/start-pose\/clear$/, async (req) => {
    sameHome(await readJson(req));
    requireStart().clear();
    return startView(null);
  });
  route("GET", /^\/api\/phone\/sync$/, async () => ({ ok: true, sync: opts.phoneSync?.() ?? null }));
}
