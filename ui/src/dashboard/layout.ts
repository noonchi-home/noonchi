// 대시보드 화면 배치(순수 함수). 화면 크기 → 트윈·나눔선·영상(대시보드 폰 칸)·FSM 카드·마스코트 단추·말풍선 자리와 지도 카메라가 맞출 칸(화면 px).
// 왼쪽 트윈은 남은 너비를, 오른쪽 영상(세로 9:16)은 화면 높이를 다 쓴다(여백 안). 두 칸은 틈 없이 맞닿고 사이에 1px 나눔선 하나만 있다.
// FSM 상태·행동은 영상 안 위쪽에 끝에서 띄운 반투명 카드로 얹는다.
// 마스코트는 판 없이 가운데 축을 나눔선 위에 둔다: 보이는 높이는 화면 높이의 0.3, 단추 아래 끝이 화면 밑 선이고 그림은 그 아래로 이어진다.
//   좌우로 뒤집어도(행동하는 동안, Mascot.tsx) 축을 중심으로 뒤집어 단추 자리는 그대로다.
// 말풍선은 트윈 아래쪽 안, 마스코트 왼쪽에 겹쳐 띄운 꼬리 없는 카드 하나다(크기는 말풍선 글 두 줄에 맞춰 정해져 있다).
// 트윈 지도는 트윈 칸을 꽉 채우고 말풍선·마스코트는 그 위에 얹는다(가린 자리 blocked). 지도 카메라는 그 단계에 중요한 것(길·목적지·클로이드·확인한 기기
//   말풍선·방 이름표)을 진행도 아래·말풍선 위·마스코트 왼쪽 칸(focus)에 맞춰, 말풍선·마스코트 밑에 깔리지 않게 한다.
// 여백은 디자인 토큰(layout, 1680px부터 hub1920 값)이다. 글 줄 높이는 부품 글 크기(text-sm 줄 20px, 말풍선 카드 Item say text-base 줄 24px)라 화면 너비와 상관없다.
// 자리는 화면 크기로만 정해지고 단계와 상관없다.
import tokens from "../../../src/design/tokens.json";
import { mascotImageBox, mascotLogoBox, mascotScale } from "./bust";
import type { BoxSize } from "./fit";
import type { MascotImage } from "./mascot-image";

export interface Rect { left: number; top: number; width: number; height: number }

/** 칸 안쪽 여백(px): 지도 카메라가 맞출 칸(focus)의 트윈 칸 기준 위·오른쪽·아래·왼쪽 여백. */
export interface Pad { top: number; right: number; bottom: number; left: number }

export interface PageLayout {
  /** 화면 둘레 여백과, FSM 카드를 영상 끝에서 띄우는 사이(px). */
  pad: number;
  gap: number;
  /** 마스코트 그림 배율(화면 px / 그림 픽셀). */
  scale: number;
  /** 트윈 칸(왼쪽, 화면 높이 꽉). 지도는 이 칸을 꽉 채운다. */
  twin: Rect;
  /** 트윈과 영상이 맞닿는 나눔선(너비 DIVIDER): 트윈 오른쪽 끝이 선 왼쪽, 선 오른쪽이 영상 왼쪽이다. */
  divider: Rect;
  /** 지도 카메라가 그 단계에 중요한 것을 맞출 칸(진행도 아래·말풍선 위·마스코트 왼쪽)과, 그 칸의 트윈 기준 여백. */
  focus: Rect;
  camPad: Pad;
  /** 지도 위에 얹어 지도를 가리는 자리: [말풍선 카드, 마스코트 단추(초점 고리 포함)]. */
  blocked: Rect[];
  /** 영상 칸(오른쪽, 세로 9:16, 화면 높이 꽉)과 그 안 위쪽에 떠 있는 FSM 상태·행동 카드(영상 끝에서 gap만큼 띄움). */
  video: Rect;
  card: Rect;
  /** 마스코트 단추: 가운데 축이 나눔선 가운데, 아래 끝은 화면 밑 선. */
  mascot: Rect;
  /** 단추 안 마스코트 그림 자리(단추 왼쪽 위 기준 px). 단추 아래로 넘친 몸은 단추가 자른다. */
  image: Rect;
  /** 가슴 LG 표시 원을 담는 네모(단추 왼쪽 위 기준 px). 그림을 뒤집을 때 이 원만 다시 뒤집어 바로 읽히게 한다. */
  logo: Rect;
  /** 말풍선 카드(트윈 아래쪽). 높이는 말풍선 글(Item say text-base, 줄 24px) 두 줄 + 위아래 여백·테두리 26px로 정해져 있다. */
  bubble: Rect;
}

/** 이 너비부터 hub1920 토큰(여백·글 크기). tokens.css의 @media (min-width: 1680px)와 같다. */
export const WIDE = 1680;
/** 트윈과 영상 사이 나눔선 너비(px, Separator 세로 w-[1px]). */
export const DIVIDER = 1;
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
/** 말풍선 카드 글(Item say text-base 16px, 사용자가 허락한 크기)의 줄 높이(px). 화면 너비로 커지지 않는다. */
export const SAY_LINE = 24;
/** 말풍선 카드 높이에서 글 두 줄을 뺀 위아래 여백 합(px): Item say py-3(12+12) + 테두리 1+1. */
const BUBBLE_PAD = 26;
/** 지도 카메라 칸: 위는 할 일 진행도(top-4 16 + 알약 44) 아래 20, 왼쪽은 40, 말풍선·마스코트와는 FOCUS_GAP 떨어진다. */
const FOCUS_TOP = 80;
const FOCUS_LEFT = 40;
const FOCUS_GAP = 24;
/** FSM 카드: Item 위아래 여백(py-1.5), 아이콘 동그라미(size-7), 두 Item 사이 선. */
const CARD_ITEM_PAD = 12;
const CARD_ICON = 28;
const SEPARATOR = 1;

const ZERO: Rect = { left: 0, top: 0, width: 0, height: 0 };
const right = (r: Rect) => r.left + r.width;
const bottom = (r: Rect) => r.top + r.height;

/** 화면 크기에 맞는 대시보드 자리. 크기를 모르면(0) 모두 0 크기다. */
export function pageLayout(view: BoxSize, mascot: Pick<MascotImage, "width" | "height" | "x0" | "x1" | "headTop" | "cut" | "logo">): PageLayout {
  const wide = view.width >= WIDE;
  const space = wide ? tokens.layout.hub1920 : tokens.layout.hub1440;
  const pad = space.gutter;
  const gap = space.gap;
  if (view.width <= 0 || view.height <= 0) {
    return { pad, gap, scale: 0, twin: ZERO, divider: ZERO, focus: ZERO, camPad: { top: 0, right: 0, bottom: 0, left: 0 }, blocked: [], video: ZERO, card: ZERO, mascot: ZERO, image: ZERO, logo: ZERO, bubble: ZERO };
  }
  // 영상(오른쪽)과 트윈(왼쪽): 둘 다 여백 안 화면 높이, 사이에 나눔선만
  const h = Math.max(0, view.height - 2 * pad);
  const videoW = (h * 9) / 16;
  const video: Rect = { left: view.width - pad - videoW, top: pad, width: videoW, height: h };
  const divider: Rect = { left: video.left - DIVIDER, top: pad, width: DIVIDER, height: h };
  const twin: Rect = { left: pad, top: pad, width: Math.max(0, divider.left - pad), height: h };
  const card: Rect = { left: video.left + gap, top: video.top + gap, width: Math.max(0, videoW - 2 * gap), height: 2 * (CARD_ITEM_PAD + Math.max(TEXT_LINE, CARD_ICON)) + SEPARATOR };

  // 마스코트: 단추 가운데 축은 나눔선 가운데, 아래 끝은 화면 밑 선
  const shown = view.height * MASCOT_SHARE;
  const scale = mascotScale(mascot, shown, HEAD_ROOM);
  const mw = (mascot.x1 - mascot.x0) * scale;
  const axis = divider.left + DIVIDER / 2;
  const m: Rect = { left: axis - mw / 2, top: view.height - shown, width: mw, height: shown };

  // 말풍선 카드: 트윈 아래쪽 안, 마스코트 왼쪽(초점 고리 밖)까지
  const inset = space.panelPadding;
  const bubbleH = 2 * SAY_LINE + BUBBLE_PAD;
  const bubbleLeft = twin.left + inset;
  const bubble: Rect = { left: bubbleLeft, top: bottom(twin) - inset - bubbleH, width: Math.max(0, m.left - RING - bubbleLeft), height: bubbleH };
  const image = mascotImageBox(mascot, scale, HEAD_ROOM);
  const logo = mascotLogoBox(mascot, scale, image);

  // 지도 위에 얹는 것: 말풍선 카드와 마스코트 단추(초점 고리 포함)
  const blocked: Rect[] = [
    { ...bubble },
    { left: m.left - RING, top: m.top - RING, width: m.width + 2 * RING, height: m.height + RING },
  ];
  // 지도 카메라 칸: 진행도 아래, 말풍선 위, 마스코트 왼쪽
  const fx = twin.left + FOCUS_LEFT;
  const fy = twin.top + FOCUS_TOP;
  const focus: Rect = { left: fx, top: fy, width: Math.max(0, m.left - RING - FOCUS_GAP - fx), height: Math.max(0, bubble.top - FOCUS_GAP - fy) };
  const camPad: Pad = { left: focus.left - twin.left, top: focus.top - twin.top, right: right(twin) - right(focus), bottom: bottom(twin) - bottom(focus) };

  return { pad, gap, scale, twin, divider, focus, camPad, blocked, video, card, mascot: m, image, logo, bubble };
}

/** 마스코트 그림 픽셀 [x, y] → 화면 자리. */
export function mascotPoint(l: PageLayout, mascot: Pick<MascotImage, "x0">, [u, v]: [number, number]) {
  return { x: l.mascot.left + (u - mascot.x0) * l.scale, y: l.mascot.top + l.image.top + v * l.scale };
}
