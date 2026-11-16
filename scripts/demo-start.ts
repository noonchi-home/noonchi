// 시연 장면 시작 위치: 장면마다 바라볼 대상과 거리. 대상 가운데에서 그 방 다각형 가운데 쪽으로 거리만큼 물러선 자리에서 대상을 본다.
// 폰 AR 시작 위치(src/phone/sync/start.ts)와 같은 평면 규칙(방향 0 = +x, 90 = +y)이다.
import type { SceneJson } from "../src/contract/layout.js";

/** 장면 → 대상 평면도 물건 id와 대상까지 거리(m). 소파 id는 twin/homes/mokryeon_180b/scene.json의 거실 소파다. */
export const DEMO_STARTS: Record<"cup" | "tv" | "microwave" | "kitchen", { target: string; distanceM: number }> = {
  cup: { target: "dining_table_978b20c7", distanceM: 1.5 },
  tv: { target: "sofa_a848b595", distanceM: 1.8 },
  microwave: { target: "microwave_kitchen", distanceM: 1.2 },
  kitchen: { target: "induction_counter_5641ccf0", distanceM: 1.5 },
};
export type DemoScene = keyof typeof DEMO_STARTS;

interface SceneObjectLike { id: string; room?: string; plan?: { position?: number[] } }
interface SceneRoomLike { id?: string; polygon?: number[][] }

const inside = (p: [number, number], poly: number[][]) => {
  let hit = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i] as [number, number];
    const [xj, yj] = poly[j] as [number, number];
    if ((yi > p[1]) !== (yj > p[1]) && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
};

/** 대상 가운데에서 그 방 다각형 가운데 쪽으로 distanceM 물러선 자리와 대상을 보는 방향(평면 각, 도). 대상·방을 모르면 던진다. */
export function startFor(scene: SceneJson, target: string, distanceM: number): { position: [number, number]; yaw_deg: number } {
  const o = (scene.objects as SceneObjectLike[]).find((x) => x.id === target);
  const at = o?.plan?.position;
  if (!o || !at || at.length < 2) throw new Error(`장면에 ${target}이 없어요`);
  const c: [number, number] = [at[0]!, at[1]!];
  const rooms = (scene.plan.rooms ?? []) as SceneRoomLike[];
  const room = rooms.find((r) => r.id === o.room && Array.isArray(r.polygon)) ?? rooms.find((r) => Array.isArray(r.polygon) && r.polygon.length >= 3 && inside(c, r.polygon));
  if (!room?.polygon?.length) throw new Error(`${target}이 있는 방을 몰라요`);
  const mid = room.polygon.reduce<[number, number]>((s, p) => [s[0] + p[0]! / room.polygon!.length, s[1] + p[1]! / room.polygon!.length], [0, 0]);
  const dx = mid[0] - c[0];
  const dy = mid[1] - c[1];
  const len = Math.hypot(dx, dy) || 1;
  const position: [number, number] = [c[0] + (dx / len) * distanceM, c[1] + (dy / len) * distanceM];
  const yaw = (Math.atan2(c[1] - position[1], c[0] - position[0]) * 180) / Math.PI;
  return { position: [Math.round(position[0] * 1000) / 1000, Math.round(position[1] * 1000) / 1000], yaw_deg: Math.round((((yaw % 360) + 360) % 360) * 10) / 10 };
}
