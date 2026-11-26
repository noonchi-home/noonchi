// 집 장면 주소: 서버(src/server/routes/layout.ts), 트윈 엔진(ui/src/twin/3d/engine.ts twinScenes), 장면 사진 가짜 서버(scripts/twin3d/home-shots.ts)가 같이 쓴다.
/** 고친 배치 장면(배치 편집기 물건). 원뿔 걷기 격자·대시보드 평면이 쓴다. */
export const SCENE_PATH = "/api/scene";
/** 구운 장면(배치를 고치기 전). 트윈 3D가 구운 GLB 물건(상태·정적 합치기·기본 보기)을 잇는다. 배치 맞추기 메시지는 이 장면과의 차이만 보낸다. */
export const BAKED_SCENE_PATH = "/api/scene/baked";
