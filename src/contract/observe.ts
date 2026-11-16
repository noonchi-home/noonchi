// World State 입력 모양: 감지·관절·물체 모양·엔진 프레임·카메라. 관찰 흐름·실제 폰이 만들고 World State·기록이 받는다(도메인 나누기 F1·F7).

import type { DetLabel } from "../world/vocab.js";
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
