// video-ar.js의 형.
import type { HeardAt, PhoneCommand, PhoneStepKind } from "../../../../src/contract/phone.ts";
import type { ArHooks, PhoneAr } from "./ar.js";
import type { JpegEncoder } from "./capture.js";
import type { PhoneLink } from "./link.js";

/** 2D 그림판 중 영상 모드가 쓰는 것(시험이 바꾼다). */
export interface VideoCanvas {
  width: number;
  height: number;
  getContext(kind: "2d", opts?: object): { getImageData(x: number, y: number, w: number, h: number): { data: Uint8ClampedArray } } | null;
}
/** 영상 출처: 브라우저는 <video>, 시험은 대역. currentTime은 초. */
export interface VideoSource {
  /** 화면에 깔 요소(없으면 깔지 않는다). */
  readonly element: HTMLElement | null;
  readonly currentTime: number;
  readonly videoWidth: number;
  readonly videoHeight: number;
  readonly ended: boolean;
  drawTo(ctx: unknown, width: number, height: number): void;
  play(): Promise<void>;
  /** 다음 영상 프레임에 한 번 부른다(now: performance.now 기준 ms). */
  nextFrame(cb: (now: number) => void): void;
  onEnded(cb: () => void): void;
  close(): void;
}
/** 단계 영상 칸(?step=<종류>:<대상 낱말>:<영상>): 명령 종류가 같고 대상 id에 word가 들면 clipUrl로 바꿔 튼다. */
export interface VideoStep { kind: PhoneStepKind; word: string; clipUrl: string }
export interface VideoArDeps {
  /** /phone/videos/<이름>. */
  clipUrl: string;
  /** 세로 시야각(도, 기본 60). */
  fovDeg?: number;
  /** 숙인 각(도, 기본 −25). */
  pitchDeg?: number;
  /** 카메라 높이(m, 기본 1.4). */
  heightM?: number;
  /** 단계 영상 칸(기본 없음). */
  steps?: VideoStep[];
  /** 명령을 받고 단계 영상으로 바꾸기까지(ms, 기본 1500). */
  reactMs?: number;
  createVideo?: (url: string) => VideoSource;
  createEncoder?: () => JpegEncoder;
  createCanvas?: () => VideoCanvas;
  /** 화면 크기(CSS px, 기본 innerWidth·innerHeight). */
  screen?: () => { width: number; height: number };
}
export interface VideoAr extends PhoneAr {
  /** 지금 영상 시각(ms, 앞 단계 영상들 시각에 이어 센다). 재생 전·끝낸 뒤는 0. */
  videoTime(): number;
  /** 받은 명령: 재생 중 맞는 step 칸이 있으면 그 id·step에 한 번, reactMs 뒤 단계 영상으로 바꾸고 go면 대상 0.6m 앞까지 걷고,
   *  집기·놓기면 걷기를 멈추고 그 자리에서 대상을 바라본다. */
  command(cmd: PhoneCommand): void;
  /** 서버 상태 sync마다: 재생 중 맞춤이 없고(none) 시작 자리가 있으면 start fixed를 다시 보낸다. */
  syncStatus(sync: { state: string; start: unknown } | null | undefined): void;
}
export interface VideoCommandEntry { video_ms: number; id: string; step: string; text: string }
/** 단계 영상으로 바꾼 영상 시각과 영상 이름, 그 영상 길이(알면). */
export interface VideoClipEntry { video_ms: number; clip: string; duration_ms?: number }
/** 판정 기록. t0: 재생 시작 순간의 서버 시계(ms, 시계를 맞추기 전에는 폰 시계). ended: 첫 영상이 끝남.
 *  hold: 영상(첫 영상이나 단계 영상)이 끝나 마지막 장면을 붙잡는 중이면 그 영상과 붙잡기 시작한 영상 시각, 아니면 null. */
export interface VideoRecord {
  t0: number | null; ended: boolean; hold: { clip: string; since: number } | null; commands: VideoCommandEntry[]; clips: VideoClipEntry[];
  /** [서버 시각, 영상 시각] 짝: 시계를 맞춘 뒤 첫 프레임과, 1:1로 이어 셀 수 없게 어긋난(멈칫) 곳의 앞뒤 프레임(noteSync). 판정 도구가 서버 사건을 영상 시각에 옮긴다. */
  sync: [number, number][];
  /** 지금 말의 at(화면이 바뀔 때마다 heardAtOf로 다시 쓴다, 영상 판정 --say가 그대로 싣는다). 기록 전이면 없음. */
  at?: HeardAt;
}

/** 영상 모드인지 아는 하나뿐인 길: 주소의 clip(영상 이름)이 있으면 그 이름과 영상 AR 값, 없으면 null(실제 모드). clip은 여기서만 읽는다. */
export function videoParams(params: URLSearchParams): (Required<Pick<VideoArDeps, "clipUrl" | "fovDeg" | "pitchDeg" | "heightM" | "steps" | "reactMs">> & { clip: string }) | null;
export function videoRecord(target?: object): VideoRecord;
/** 짝 수 상한. */
export const SYNC_MAX: number;
/** [서버 시각, 영상 시각] 짝 기록: note마다 견줘 같은 직선 구간은 끝점만 둔다(모든 표본 오차 50ms 안). */
export function createSyncLog(sync: [number, number][]): { note(at: number, ms: number): void };
export function logVideoCommand(videoMs: number, command: { id: string; step: string; text: string }): void;
export function logVideoAt(at: HeardAt): void;
export function createVideoAr(opts: { link: PhoneLink; params: URLSearchParams; hooks: ArHooks; deps: VideoArDeps }): VideoAr;

declare global {
  interface Window { __noonchiVideo?: VideoRecord }
}
