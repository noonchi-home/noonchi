// 도면 설비(twin-studio data/homes/<id>/drawn_fixtures.json, 공개 도면에서 읽은 욕실·주방 설비)를 scene.json 물건 모양으로 바꾼다.
// 구운 3D의 drawn_<id> 노드와 같은 파일에서 와서 자리가 같다. 옮길 수 없고(interactive false) 기기가 아니다(attrs 없음).
import type { SceneJson, SceneObject } from "../layout/editor.js";

export interface DrawnFixture {
  id: string; kind: string; room: string; position: [number, number]; facing_deg: number; footprint: [number, number]; height: number;
  /** 개수대 가운데(싱크 조리대만). */
  sink?: [number, number];
}

export const DRAWN_NAME: Record<string, string> = { sink_counter: "싱크대", counter: "조리대", toilet: "변기", vanity: "세면대", bathtub: "욕조" };

const round = (v: number) => Math.round(v * 1e6) / 1e6;
/** 도면 설비 모델은 앞이 배치 물건과 반대다: −(facing + 90)°, (−180°, 180°]. 구운 GLB drawn_<id> 노드와 같다. */
const yaw = (facing: number) => {
  const d = (((-(facing + 90) % 360) + 540) % 360) - 180;
  return round(((d === -180 ? 180 : d) * Math.PI) / 180);
};

export function drawnObject(f: DrawnFixture, roomLabel: string | undefined): SceneObject {
  const [x, y] = f.position;
  const kind = DRAWN_NAME[f.kind] ?? f.kind;
  return {
    id: f.id, name: roomLabel ? `${roomLabel} ${kind}` : kind, type: f.kind, asset: null, category: "fixtures", mount: "floor", room: f.room,
    plan: { position: [x, y], facing_deg: f.facing_deg, elevation: 0, on: null, surface: null, wall: null },
    position: [x, 0, y], rotation: [0, yaw(f.facing_deg), 0], scale: [1, 1, 1],
    interactive: false, attrs: {}, states: {}, state: {}, footprint: f.footprint, height: f.height,
    ...(f.sink ? { anchors: { basin: f.sink } } : {}),
    provenance: { origin: "plan_drawing", size: "plan", facing: "plan", height: "plan", model: "drawn", builder: "drawn" },
  };
}

/** scene.json 물건 뒤에 도면 설비를 더한다. 같은 id가 이미 있으면 더하지 않는다. */
export function withDrawn(scene: SceneJson, fixtures: DrawnFixture[]): SceneJson {
  const have = new Set(scene.objects.map((o) => (o as { id?: string }).id));
  const label = new Map((scene.plan.rooms ?? []).map((r) => [r.id, r.label]));
  const add = fixtures.filter((f) => !have.has(f.id)).map((f) => drawnObject(f, label.get(f.room)));
  return add.length ? { ...scene, objects: [...scene.objects, ...add] } : scene;
}
