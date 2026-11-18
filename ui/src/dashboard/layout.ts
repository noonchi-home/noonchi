// 대시보드 화면 배치(순수 함수). 화면 크기 → 트윈·비전 미니맵(대시보드 폰 칸)·마스코트 단추·생각 말풍선·말풍선 카드 자리와 지도 카메라가 맞출 칸(화면 px).
// 트윈은 화면 전체(여백 안)를 쓰고 나머지는 그 위에 얹는다:
//   비전 미니맵은 트윈 오른쪽 위 가로 16:9 칸(1280 너비에서 320×180, 화면 너비에 비례), 마스코트는 판 없이 트윈 오른쪽 아래(보이는 높이는 화면 높이의 0.3,
//   단추 아래 끝이 화면 밑 선이고 그림은 그 아래로 이어진다), 생각 말풍선은 마스코트 위(크기 고정)이고 꼬리 점 둘이 마스코트로 이어진다.
//   메시지 상자는 트윈 아래쪽 마스코트 바로 왼쪽, 남은 너비의 절반이다. 그 왼쪽 남은 자리 전체(위는 화면 아래에서 1/3)가 FSM 카드다.
//   마스코트를 좌우로 뒤집어도(행동하는 동안, Mascot.tsx) 단추 가운데 축을 중심으로 뒤집어 단추 자리는 그대로다.
// 지도 카메라는 그 단계에 중요한 것(길·목적지·클로이드·확인한 기기 말풍선·방 이름표)을 트윈 위쪽 여백 아래·메시지 상자 위·미니맵과 마스코트 왼쪽 칸(focus)에 맞춰,
//   얹은 것(가린 자리 blocked) 밑에 깔리지 않게 한다.
// 여백은 디자인 토큰(layout, 1680px부터 hub1920 값)이다. 글 줄 높이는 부품 글 크기(text-sm 줄 20px, 말풍선 카드 Item say text-base 줄 24px)라 화면 너비와 상관없다.
// 자리는 화면 크기와 미니맵 영상 비율로만 정해지고 단계와 상관없다. 영상 비율이 바뀌면(폰을 돌림·영상 종류가 바뀜) 미니맵 높이만 바뀐다.
import tokens from "../../../src/design/tokens.json";
import { mascotImageBox, mascotLogoBox, mascotScale } from "./bust";
import type { BoxSize } from "./fit";
import type { MascotImage } from "../lib/mascot-image";

export interface Rect { left: number; top: number; width: number; height: number }

/** 칸 안쪽 여백(px): 지도 카메라가 맞출 칸(focus)의 트윈 칸 기준 위·오른쪽·아래·왼쪽 여백. */
export interface Pad { top: number; right: number; bottom: number; left: number }

export interface PageLayout {
  /** 화면 둘레 여백과, 얹은 것 사이(px). */
  pad: number;
  gap: number;
  /** 마스코트 그림 배율(화면 px / 그림 픽셀). */
  scale: number;
  /** 트윈 칸(화면 전체, 여백 안). 지도는 이 칸을 꽉 채운다. */
  twin: Rect;
  /** 지도 카메라가 그 단계에 중요한 것을 맞출 칸(트윈 위쪽 여백 아래·메시지 상자 위·미니맵과 마스코트 왼쪽)과, 그 칸의 트윈 기준 여백. */
  focus: Rect;
  camPad: Pad;
  /** 지도 위에 얹어 지도를 가리는 자리: [메시지 상자, 마스코트 단추(초점 고리 포함), 미니맵, FSM 카드]. */
  blocked: Rect[];
  /** 비전 미니맵(대시보드 폰 칸): 트윈 오른쪽 위. 너비는 화면 너비 몫이고 높이는 영상 비율을 따른다(영상이 없으면 16:9, 세로 영상은 높이 상한까지). */
  video: Rect;
  /** 트윈 오른쪽 위 칩(위치 모름·연결 끊김)의 트윈 오른쪽 끝 기준 띄움(px): 미니맵 왼쪽. */
  chipsRight: number;
  /** 마스코트 단추: 트윈 오른쪽 아래, 아래 끝은 화면 밑 선. */
  mascot: Rect;
  /** 단추 안 마스코트 그림 자리(단추 왼쪽 위 기준 px). 단추 아래로 넘친 몸은 단추가 자른다. */
  image: Rect;
  /** 가슴 LG 표시 원을 담는 네모(단추 왼쪽 위 기준 px). 그림을 뒤집을 때 이 원만 다시 뒤집어 바로 읽히게 한다. */
  logo: Rect;
  /** 메시지 상자(트윈 아래쪽, 마스코트 바로 왼쪽, 남은 너비의 TALK_SHARE). 높이는 TALK_H로 정해져 있다. */
  bubble: Rect;
  /** FSM 카드(메시지 상자 왼쪽 남은 자리 전체): 바닥 줄은 상자와 같고 위는 화면 높이의 FSM_TOP_SHARE. */
  fsm: Rect;
}

/** 이 너비부터 hub1920 토큰(여백·글 크기). tokens.css의 @media (min-width: 1680px)와 같다. */
export const WIDE = 1680;
/** 비전 미니맵 너비: 화면 너비에 곱하는 몫(1280에서 320). 높이는 너비 ÷ 영상 비율.
 *  메시지 셋이 드는 생각 말풍선(높이 210) 아래에서도 가장 낮은 화면(1522×722)의 16:9 미니맵(380.5×214)이 높이 상한(말풍선 위 사이 219.4)에 걸리지 않는 몫이다. */
export const MINIMAP_SHARE = 320 / 1280;
/** 영상이 없을 때(연결 QR·빈 칸) 미니맵 비율(가로/세로). */
export const MINIMAP_ASPECT = 16 / 9;
/** 미니맵 높이 상한: 트윈 칸 높이에 곱하는 몫. 세로 영상이 와도 칸이 이보다 길어지지 않고, 그때만 영상을 contain으로 넣어 양옆이 빈다. 마스코트 위 사이(gap)도 넘지 않는다. */
export const MINIMAP_MAX_SHARE = 0.5;
/** 영상 비율이 지금 비율과 이 몫 넘게 다를 때만 미니맵 비율을 바꾼다(프레임 크기가 1px씩 흔들려도 칸이 떨리지 않게). */
export const ASPECT_STEP = 0.02;

/** 미니맵이 쓸 영상 비율(가로/세로): 영상 크기를 모르면 16:9, 지금 비율과 ASPECT_STEP 안이면 지금 비율 그대로, 넘으면 새 비율. */
export function nextAspect(now: number, video: BoxSize | null): number {
  if (!video || video.width <= 0 || video.height <= 0) return MINIMAP_ASPECT;
  const next = video.width / video.height;
  return now > 0 && Math.abs(next / now - 1) <= ASPECT_STEP ? now : next;
}
/** 마스코트 단추 둘레 초점 고리(px): Button의 선 2 + 띄움 2. */
export const RING = 4;
/** 마우스를 올리거나 초점이 오면 마스코트 그림이 올라오는 만큼(px, group-hover:-translate-y-2). */
export const LIFT = 8;
/** 마스코트 단추 높이(보이는 높이): 화면 높이에 곱하는 몫. */
export const MASCOT_SHARE = 0.3;
/** 단추 위 끝에서 머리 꼭대기까지(px): 그림이 올라와도 머리가 잘리지 않게. */
const HEAD_ROOM = LIFT + 2;
/** 부품 원래 글(text-sm 14px)의 줄 높이(px). 화면 너비로 커지지 않는다. */
export const TEXT_LINE = 20;
/** 메시지 상자 높이(px, 마스코트 목 높이쯤): Item sm 위아래 여백(py-3) 24 + 테두리 2 + 맨 위 목표 줄(Status) 24 + 사이 4 + 문장 세 줄(20씩)과 사이 둘(4씩) 68 + 둘레 여유 6 = 128.
 *  화면 크기·글 길이와 상관없다. */
export const TALK_H = 128;
/** 메시지 상자 너비: 마스코트 왼쪽 남은 너비(트윈 안쪽 여백부터)에 곱하는 몫(2026-11-18 사용자 결정 「메시지박스를 절반으로」). */
export const TALK_SHARE = 0.5;
/** FSM 카드 위 끝: 화면 높이에 곱하는 몫(화면 아래에서 1/3 높이까지, 2026-11-18 사용자 결정 「FSM은 훨씬 더 크게」). */
export const FSM_TOP_SHARE = 2 / 3;
/** 지도 카메라 칸: 위는 칩 줄(top-4 16 + 칩 28) 아래 4(할 일 진행도 알약은 없다), 왼쪽은 40, 얹은 것(메시지 상자·미니맵·마스코트)과는 FOCUS_GAP 떨어진다. */
const FOCUS_TOP = 48;
const FOCUS_LEFT = 40;
const FOCUS_GAP = 24;
/** 미니맵·생각 말풍선 쪽은 더 띄운다: 칸 오른쪽 끝에 맞춘 대상의 확인 말풍선(가로 약 176, 꼬리 끝 가운데)이 미니맵 밑에 깔리지 않게 그 반 너비 + 8. */
const FOCUS_SIDE = 96;
const ZERO: Rect = { left: 0, top: 0, width: 0, height: 0 };
const right = (r: Rect) => r.left + r.width;
const bottom = (r: Rect) => r.top + r.height;

/** 화면 크기와 미니맵 영상 비율(videoAspect, 가로/세로)에 맞는 대시보드 자리. 크기를 모르면(0) 모두 0 크기다. */
export function pageLayout(view: BoxSize, mascot: Pick<MascotImage, "width" | "height" | "x0" | "x1" | "headTop" | "cut" | "logo">, videoAspect = MINIMAP_ASPECT): PageLayout {
  const wide = view.width >= WIDE;
  const space = wide ? tokens.layout.hub1920 : tokens.layout.hub1440;
  const pad = space.gutter;
  const gap = space.gap;
  if (view.width <= 0 || view.height <= 0) {
    return { pad, gap, scale: 0, twin: ZERO, focus: ZERO, camPad: { top: 0, right: 0, bottom: 0, left: 0 }, blocked: [], video: ZERO, chipsRight: 0, mascot: ZERO, image: ZERO, logo: ZERO, bubble: ZERO, fsm: ZERO };
  }
  // 트윈: 여백 안 화면 전체
  const twin: Rect = { left: pad, top: pad, width: Math.max(0, view.width - 2 * pad), height: Math.max(0, view.height - 2 * pad) };
  const inset = space.panelPadding;
  // 마스코트: 트윈 오른쪽 아래, 아래 끝은 화면 밑 선
  const shown = view.height * MASCOT_SHARE;
  const scale = mascotScale(mascot, shown, HEAD_ROOM);
  const mw = (mascot.x1 - mascot.x0) * scale;
  const m: Rect = { left: right(twin) - inset - mw, top: view.height - shown, width: mw, height: shown };

  // 비전 미니맵: 트윈 오른쪽 위. 높이는 너비 ÷ 영상 비율이고 상한(트윈 높이 몫, 마스코트 위 사이)을 넘지 않는다
  const videoW = view.width * MINIMAP_SHARE;
  const videoTop = twin.top + inset;
  const videoMax = Math.max(0, Math.min(twin.height * MINIMAP_MAX_SHARE, m.top - LIFT - gap - videoTop));
  const video: Rect = { left: right(twin) - inset - videoW, top: videoTop, width: videoW, height: Math.min(videoW / (videoAspect > 0 ? videoAspect : MINIMAP_ASPECT), videoMax) };

  // 메시지 상자: 트윈 아래쪽 안, 마스코트 왼쪽(초점 고리 밖)에서 사이만큼 띄우고(마스코트가 상자 옆에서 말한다) 남은 너비의 TALK_SHARE
  const bubbleH = TALK_H;
  const roomLeft = twin.left + inset;
  const bubbleRight = m.left - RING - gap;
  const bubbleW = Math.max(0, (bubbleRight - roomLeft) * TALK_SHARE);
  const bubble: Rect = { left: bubbleRight - bubbleW, top: bottom(twin) - inset - bubbleH, width: bubbleW, height: bubbleH };
  // FSM 카드: 상자 왼쪽 남은 자리 전체, 바닥 줄은 상자와 같고 위는 화면 높이의 FSM_TOP_SHARE(상자보다 낮지 않게)
  const fsmTop = Math.min(bubble.top, view.height * FSM_TOP_SHARE);
  const fsm: Rect = { left: roomLeft, top: fsmTop, width: Math.max(0, bubble.left - gap - roomLeft), height: bottom(bubble) - fsmTop };
  const image = mascotImageBox(mascot, scale, HEAD_ROOM);
  const logo = mascotLogoBox(mascot, scale, image);

  // 지도 위에 얹는 것: 메시지 상자, 마스코트 단추(초점 고리 포함), 미니맵, FSM 카드
  const blocked: Rect[] = [
    { ...bubble },
    { left: m.left - RING, top: m.top - RING, width: m.width + 2 * RING, height: m.height + RING },
    { ...video },
    { ...fsm },
  ];
  // 지도 카메라 칸: 칩 줄 아래, 메시지 상자·FSM 카드 위(트윈 칸 크기는 그대로, 카메라만 위쪽 빈 곳에 맞춘다), 미니맵·마스코트 왼쪽
  const fx = twin.left + FOCUS_LEFT;
  const fy = twin.top + FOCUS_TOP;
  const edge = Math.min(video.left, m.left - RING);
  const focus: Rect = { left: fx, top: fy, width: Math.max(0, edge - FOCUS_SIDE - fx), height: Math.max(0, Math.min(bubble.top, fsm.top) - FOCUS_GAP - fy) };
  const camPad: Pad = { left: focus.left - twin.left, top: focus.top - twin.top, right: right(twin) - right(focus), bottom: bottom(twin) - bottom(focus) };

  return { pad, gap, scale, twin, focus, camPad, blocked, video, chipsRight: right(twin) - video.left + gap, mascot: m, image, logo, bubble, fsm };
}

/** 마스코트 그림 픽셀 [x, y] → 화면 자리. */
export function mascotPoint(l: PageLayout, mascot: Pick<MascotImage, "x0">, [u, v]: [number, number]) {
  return { x: l.mascot.left + (u - mascot.x0) * l.scale, y: l.mascot.top + l.image.top + v * l.scale };
}
