// 위에서 보기(src/observe/pipeline.ts topLook)의 장마다 거르기: 그 컵 하나만 d1로 VLM에 보낸 답을 대상 확인을 거친 것만 World State에 넣는다.
// 차례: 옮겨짐(사라짐·옮김 표시·트윈 자리가 TOP_SAME_M 넘게 바뀜) → VLM 답 없음 → d1에 not_visible → 내용물 값이 비어 있음·내용물 있음이 아님(바닥이 안 보임)
// → 잘라 키운 사진에 그릇 감지(내용물 면이 있는 종류)가 d1 상자 안에 없음 → 같은 종류 다른 물건이 컵 자리 TOP_SAME_M 안. 다 거치면 그 내용물 값.
import type { TopDrop } from "../contract/events.js";
import type { Detection, SceneObservation } from "../contract/observe.js";
import type { WorldObject } from "../contract/world.js";
import { CLASSES, VLM_ONLY, type ClassKey } from "../world/vocab.js";

type V3 = [number, number, number];
type Box = [number, number, number, number];
/** 위에서 보기 대상 거리(m): 컵 자리가 이보다 더 바뀌면 옮겨짐, 같은 종류 다른 물건이 이 안이면 어느 컵인지 모른다. */
export const TOP_SAME_M = 0.1;
/** 그릇 감지로 보는 종류: 내용물 면이 있는 종류(위에서 본 컵은 YOLO가 그릇으로 볼 수 있다). */
const VESSELS: ReadonlySet<string> = new Set((Object.keys(CLASSES) as ClassKey[]).filter((k) => (CLASSES[k].facets as readonly string[]).includes("contents")));
const dist3 = (a: V3, b: V3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/** 위에서 본 장 하나의 거르기. start: 위에서 보기를 시작한 때 컵 자리, now: 답이 왔을 때 그 컵(없으면 undefined), others: 같은 종류 다른 물건,
 *  scene: 그 장 VLM 답(없으면 null), dets: 잘라 키운 사진의 감지(그 사진 픽셀), box: d1 상자(그 사진 픽셀). */
export function topDropOf(o: { start: V3; now: WorldObject | undefined; others: readonly WorldObject[]; scene: SceneObservation | null; dets: readonly Detection[]; box: Box }): { drop: TopDrop } | { value: "empty" | "has_contents" } {
  const now = o.now;
  if (!now || now.status === "gone" || now.followed_by || !now.position || dist3(now.position, o.start) > TOP_SAME_M) return { drop: "moved" };
  if (!o.scene) return { drop: "vlm_missing" };
  const said = o.scene.observations.filter((ob) => ob.object_id === "d1").map((ob) => ob.state as string);
  if (said.some((s) => (VLM_ONLY as readonly string[]).includes(s))) return { drop: "not_visible" };
  const value = said.find((s): s is "empty" | "has_contents" => s === "empty" || s === "has_contents");
  if (!value) return { drop: "no_contents" };
  const [bx, by, bw, bh] = o.box;
  const inside = (d: Detection) => {
    const cx = d.box[0] + d.box[2] / 2, cy = d.box[1] + d.box[3] / 2;
    return cx >= bx && cx <= bx + bw && cy >= by && cy <= by + bh;
  };
  if (!o.dets.some((d) => VESSELS.has(d.label) && inside(d))) return { drop: "no_vessel" };
  if (o.others.some((x) => x.position && dist3(x.position, o.start) <= TOP_SAME_M)) return { drop: "crowded" };
  return { value };
}
