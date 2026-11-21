// World State 입력 모양: 감지·관절·물체 모양·엔진 프레임·카메라. 관찰 흐름·실제 폰이 만들고 World State·기록이 받는다.

import type { DetLabel, SCENE_STATES } from "../world/vocab.js";
import type { EyePose, Vec3 } from "./events.js";

export type Box = [number, number, number, number];
/** 물체 모양: 프로토 격자(160×160, 레터박스 4px = 1칸)에서 그 물체 상자만 잘라 낸 0/1 그림. */
export interface Mask {
  /** 원본 사진 픽셀에서 이 그림이 덮는 자리 [x, y, w, h]. 사진 밖으로 나갈 수 있다(자르지 않음). */
  at: Box;
  /** 그림 크기(칸). 모양을 못 만든 감지는 0. */
  cols: number;
  rows: number;
  /** 줄 순서 비트(1 = 물체, 바이트 안에서는 높은 비트부터), base64. 길이 ceil(cols*rows/8). */
  bits: string;
}

export interface Detection {
  label: DetLabel;
  score: number;
  /** 마스크 바깥 테두리(원본 사진 픽셀 [x, y, w, h]). 마스크가 비면 모델 상자. */
  box: [number, number, number, number];
  /** COCO 클래스 번호(0 person, 41 cup, 40 wine glass …). */
  cls: number;
  /** 물체 모양. 못 만들었으면 칸 수 0. */
  mask: Mask;
  /** 마스크 가장 아래 줄의 가운데(원본 픽셀 [x, y]). 마스크가 비면 상자 아랫변 가운데. */
  foot: [number, number];
}

/** COCO 관절 하나: 원본 사진 픽셀 x, y와 신뢰도(0~1). */
export type Keypoint = [number, number, number];

/** 사람 한 명의 관절(YOLO26-pose). keypoints는 COCO 순서 17개(0 코 … 9·10 왼·오른 손목 … 15·16 발목). */
export interface Pose {
  score: number;
  /** 원본 사진 픽셀 [x, y, w, h]. */
  box: [number, number, number, number];
  keypoints: Keypoint[];
}

export type Quat = [number, number, number, number]; // x, y, z, w

/** 엔진 프레임의 카메라: 원점은 트윈 눈 위치 [x, 높이, y], 방향 계산에 쓸 AR 회전과 맞춤 회전(theta), 투영 행렬(16개, 열 우선). */
export interface CameraView {
  origin: Vec3;
  orientation: Quat;
  theta: number;
  projection: number[];
}

export interface EngineFrame {
  id: string;
  /** 촬영 시각(가장 이른 가능 시각, captureTime). */
  capturedAtMs: number;
  /** 가장 늦은 가능 촬영 시각. */
  latestAtMs: number;
  jpeg: Buffer;
  sha256: string;
  width: number;
  height: number;
  /** 그 순간 트윈 눈 자세(맞추기 전 null). */
  eye: EyePose | null;
  /** 그 순간 카메라(맞추기 전·투영 없음이면 null). */
  view: CameraView | null;
  /** 가까이 보기로 잘라 키운 사진이면 잘라 낸 자리(원래 엔진 프레임 픽셀 [x, y, w, h]). 고리에는 넣지 않고 VLM 풀에만 간다. */
  crop?: [number, number, number, number];
  /** 이 프레임을 VLM·기록·가까이 보기에 쓰는가. false면 YOLO만 돌리는 빠른 프레임이다. 없으면 VLM 프레임. */
  vlm?: boolean;
}

/** VLM이 그 사진에서 찾은 물건 하나(VLM 물건 목록): 번호(v1…), 종류(src/world/vocab.ts VLM_FIND), 상자(그 사진 너비·높이의 비율 0~1),
 *  같은 물건의 감지 번호(감지 목록에 있을 때만, 없으면 null). 가까이 본 사진이면 잘라 키운 사진 기준이다. */
export interface SceneObject { id: string; cls: string; box: { x: number; y: number; w: number; h: number }; det: string | null }

/** VLM 장면 분석 한 번의 결과: 가장 새 사진의 장면 설명, 감지 id마다 보이는 사실(낱말 표의 장면 상태), 여러 장 사이 요약.
 *  observe/scene.ts의 SceneSchema(zod)와 같은 모양을 손으로 적은 것이다. 그 파일이 두 타입이 같은지 양쪽으로 확인한다(계약은 zod를 가져오지 않는다). */
export interface HouseholdObservation {
  seats: "clear" | "obscured" | "unknown";
  people: { id: string | null; attention: "toward_tv" | "elsewhere" | "unknown" }[];
  dining_food: "yes" | "no" | "unknown";
}
export interface SceneObservation {
  household?: HouseholdObservation;
  scene: string;
  observations: { object_id: string; state: (typeof SCENE_STATES)[number] }[];
  /** VLM 물건 목록(감지에 없는 물건도). 옛 답에는 없다(없으면 빈 목록과 같다). */
  objects?: SceneObject[];
  summary: string;
}

/** 장면 VLM 답을 받은 사진의 카메라·크기와 그때 폰 눈 자리(트윈 [x, y], 없으면 null): 집 상태가 VLM 물건 상자를 트윈 자리로 옮긴다(src/world/state/sceneobjects.ts SceneLook). */
export interface SceneLookInput { localized_position?: [number,number,number]; view: CameraView; width: number; height: number; eye?: [number, number] | null; dets?: LookDetInput[]; fresh?: boolean; person_ids?: string[] }
/** 그 사진의 YOLO 감지 하나(감지 번호 d1…, 엔진 프레임 픽셀 상자, 바닥 점): 이어진 VLM 물건은 자리를 감지 바닥 점으로 낸다(src/world/state/sceneobjects.ts LookDet). */
export interface LookDetInput { id: string; box: [number, number, number, number]; foot?: [number, number] }
/** 가까이 본 그 장의 카메라·크기·자른 자리(엔진 프레임 픽셀 [x, y, w, h], src/world/state/closer.ts CloserLookAt). */
export interface CloserAtInput { view: CameraView; width: number; height: number; crop: [number, number, number, number] }

/** 사진 없는 엔진 프레임: 관찰 흐름이 집 상태 노드에 넘기는 프레임. JPEG·해시는 인식 노드 밖으로 나가지 않는다. */
export type FrameMeta = Omit<EngineFrame, "jpeg" | "sha256"> & { fresh_position?: boolean };
/** 가까이 본 한 장(사진 없음): 원본 엔진 프레임 id·촬영 시각·카메라·크기와 잘라 본 사진의 감지(엔진 프레임 픽셀, edge는 잘라 본 경계에 닿음). World State의 CloserPass와 같은 모양이다. */
export interface CloserPassInput { frameId: string; capturedAtMs: number; view: CameraView; width: number; height: number; dets: (Detection & { edge: boolean })[] }

/** 위치 찾기 답(구현명세서 6.15): position은 AR 자세와 맞는 사진 위치(트윈 [x, 높이, y], 모르거나 다르면 null),
 *  conflict는 사진 위치를 찾았는데 AR 자세와 기준(17절) 넘게 다른 때다. */
export interface PhotoFix { position: [number, number, number] | null; conflict: boolean }
