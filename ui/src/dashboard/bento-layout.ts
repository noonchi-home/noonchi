import tokens from "../../../src/design/tokens.json";
import { mascotImageBox, mascotLogoBox } from "./bust";
import { WIDE, type PageLayout, type Rect } from "./layout";
import type { MascotImage } from "../lib/mascot-image";
import type { BoxSize } from "./fit";

export type TwinView = "space" | "overview";


/** 나란히 놓을 때는 원본 폰 영상의 보이는 높이를 두 화면이 공유한다. */
export function bentoLayout(view: BoxSize, mascot: MascotImage, aspect: number): PageLayout {
  const space = view.width >= WIDE ? tokens.layout.hub1920 : tokens.layout.hub1440;
  const pad = space.gutter, gap = 1;
  const width = Math.max(0, view.width - 2 * pad);
  const stacked = width < 720;
  const left = stacked ? width : Math.round((width - gap) * 0.62);
  const right = stacked ? width : width - gap - left;
  const minNotes = 160;
  const available = stacked ? view.height * 0.65 : view.height - minNotes - gap - 2 * pad;
  const mediaHeight = Math.min(Math.floor(left / aspect), Math.max(180, Math.floor(available)));
  const phoneHeight = mediaHeight;
  const video: Rect = { left: pad, top: pad, width: left, height: phoneHeight };
  const twin: Rect = {
    left: stacked ? pad : pad + left + gap, top: stacked ? pad + phoneHeight + gap : pad,
    width: right, height: stacked ? Math.max(300, Math.round(right * 0.78)) : phoneHeight,
  };
  const lower = twin.top + twin.height + gap;
  const notesHeight = stacked ? minNotes : Math.min(230, Math.max(minNotes, view.height - lower - pad));
  const timeline = { left: pad, top: lower, width: left, height: notesHeight };
  const bubble = { left: twin.left, top: stacked ? lower + notesHeight + gap : lower, width: right, height: stacked ? Math.max(220, notesHeight) : notesHeight };
  // 원본의 머리 꼭대기는 y=64, 목 아랫선은 y=393이다. 좁은 화면에서는 같은 범위를 줄여 쓴다.
  const neckY = 393;
  const mascotWidth = Math.min(100, right * 0.17);
  const scale = mascotWidth / (mascot.x1 - mascot.x0);
  const mascotHeight = 10 + (neckY - mascot.headTop[1]) * scale;
  const m = { left: bubble.left + right - mascotWidth - 12, top: bubble.top + (bubble.height - mascotHeight) / 2,
    width: mascotWidth, height: mascotHeight };
  const image = mascotImageBox(mascot, scale, 10);
  // 오른쪽 아래 시계와 상태 안내가 가리는 여백을 둔다.
  const camPad = { left: 16, right: 16, top: 16, bottom: 36 };
  const focus = { left: twin.left + camPad.left, top: twin.top + camPad.top,
    width: Math.max(0, right - 32), height: Math.max(0, twin.height - camPad.top - camPad.bottom) };
  return { pad, gap, scale, video, twin, timeline, bubble, mascot: m, image, logo: mascotLogoBox(mascot, scale, image),
    chipsRight: 12, camPad, focus, blocked: [] };
}
