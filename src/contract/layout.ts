// 장면(scene.json)·배치 보정 메시지 계약(docs/plan.md 계약 C). 순수 타입만 둔다: 서버(src/layout/editor.ts)와 대시보드(ui/src/twin/3d)가 같이 본다.
// 평면도 좌표: x 오른쪽(동), y 아래쪽(남), facing_deg 0 = +x, 90 = +y. 장면 좌표 position = [x, 높이, y], 회전 y = (90 − facing_deg)°.

export type Vec2 = [number, number];
export type Vec3 = [number, number, number];

export interface ScenePlace {
  position: Vec2;
  facing_deg: number;
  elevation: number;
  on?: string | null;
  surface?: string | null;
  wall?: string | null;
}

export interface SceneObject {
  id: string;
  name: string;
  type: string;
  asset: string | null;
  category: string;
  mount: string;
  room: string | null;
  plan: ScenePlace;
  position: Vec3;
  rotation: Vec3;
  scale: Vec3;
  interactive: boolean;
  attrs: Record<string, unknown>;
  states: Record<string, unknown>;
  state: Record<string, unknown>;
  footprint?: Vec2;
  height?: number;
  [key: string]: unknown;
}

export interface SceneRoom {
  id: string;
  label?: string;
  polygon?: Vec2[];
  floor_z?: number;
}

export interface SceneWall {
  id: string;
  a: Vec2;
  b: Vec2;
  thickness?: number;
  /** 방 쪽 면(twin-studio가 쓴다): 그 면이 보는 방과 바깥 법선. 폰 위치 맞추기 벽 모양 짝에 쓴다(src/layout/home-plan.ts). */
  faces?: { room: string; normal: Vec2 }[];
}

export interface SceneJson {
  plan: { ceiling_height?: number; rooms?: SceneRoom[]; walls?: SceneWall[]; [key: string]: unknown };
  objects: unknown[];
  [key: string]: unknown;
}

/** /events {type:"layout"}: 실행 중 배치 보정. 접속 때는 원래 scene.json을 지금 배치로 맞추는 메시지(syncMessages)가 온다. */
export type LayoutMessage =
  | { type: "layout"; op: "move"; id: string; room: string | null; plan: { position: Vec2; facing_deg: number; elevation: number }; position: Vec3; rotation: Vec3 }
  | { type: "layout"; op: "add"; object: SceneObject }
  | { type: "layout"; op: "remove"; id: string };
