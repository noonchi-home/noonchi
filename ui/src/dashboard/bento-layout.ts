import tokens from "../../../src/design/tokens.json";
import { mascotImageBox, mascotLogoBox } from "./bust";
import { MINIMAP_ASPECT, pageLayout, WIDE, type PageLayout, type Rect } from "./layout";
import type { MascotImage } from "../lib/mascot-image";
import type { BoxSize } from "./fit";

/** 기본 라이브 보기 여백·칸 사이(px)와 왼쪽 열 몫(배치 시안 work/dashboard-sketch/layout.html, 2026-11-25 사용자 확인). */
export const SCENE = { pad: 16, gap: 16, left: 0.55, stackBelow: 720 } as const;

/**
 * 기본 라이브 보기(세 칸): 왼쪽 열(여백 안 너비에서 칸 사이를 뺀 몫의 55%)에 Vision(16:9 고정) 위·트윈 아래,
 * 오른쪽에 Agent Trace를 화면 높이 전체로 둔다. 들어온 영상 비율과 상관없이 Vision 칸은 16:9이다(영상은 칸 안에 맞춘다).
 * 여백 안 너비가 720px 미만이면 Vision → 트윈 → Agent Trace를 세로로 쌓는다. 화면에 설정 단추는 없다(설정 창은 Ctrl+1).
 */
export function sceneLayout(view: BoxSize, mascot: MascotImage): PageLayout & { trace: Rect } {
  const base = pageLayout(view, mascot, MINIMAP_ASPECT);
  const { pad, gap } = SCENE;
  const width = Math.max(0, view.width - 2 * pad);
  const stacked = width < SCENE.stackBelow;
  const left = stacked ? width : Math.round((width - gap) * SCENE.left);
  const video: Rect = { left: pad, top: pad, width: left, height: Math.round((left * 9) / 16) };
  const twinTop = video.top + video.height + gap;
  const twin: Rect = stacked
    ? { left: pad, top: twinTop, width, height: Math.max(240, Math.round(width * 0.78)) }
    : { left: pad, top: twinTop, width: left, height: Math.max(0, view.height - pad - twinTop) };
  const trace: Rect = stacked
    ? { left: pad, top: twin.top + twin.height + gap, width, height: 480 }
    : { left: pad + left + gap, top: pad, width: width - left - gap, height: Math.max(0, view.height - 2 * pad) };
  const camPad = { left: 16, right: 16, top: 16, bottom: 36 };
  const focus = { left: twin.left + camPad.left, top: twin.top + camPad.top,
    width: Math.max(0, twin.width - camPad.left - camPad.right), height: Math.max(0, twin.height - camPad.top - camPad.bottom) };
  return { ...base, pad, gap, video, twin, trace, focus, camPad, blocked: [], chipsRight: 12 };
}


/** 나란히 놓을 때는 원본 폰 영상의 보이는 높이를 두 화면이 공유한다. */
export function bentoLayout(view: BoxSize, mascot: MascotImage, aspect: number, traceHeight = 0): PageLayout & { trace: Rect | null } {
  const space = view.width >= WIDE ? tokens.layout.hub1920 : tokens.layout.hub1440;
  const pad = space.gutter, gap = 1;
  const width = Math.max(0, view.width - 2 * pad);
  const stacked = width < 720;
  const traceAside = traceHeight > 0 && view.width >= 1280;
  const traceWidth = traceAside ? Math.round(width * 0.33) : width;
  const joinedWidth = traceAside ? width - traceWidth - gap : width;
  const left = stacked ? joinedWidth : Math.round((joinedWidth - gap) * (traceAside ? 0.60 : 0.62));
  const right = stacked ? joinedWidth : joinedWidth - gap - left;
  const minNotes = 160;
  const traceBelow = traceAside ? 0 : traceHeight;
  const available = stacked ? view.height * 0.65 : view.height - minNotes - gap - 2 * pad - traceBelow;
  const mediaHeight = Math.min(Math.floor(left / aspect), Math.max(180, Math.floor(available)));
  const phoneHeight = mediaHeight;
  const video: Rect = { left: pad, top: pad, width: left, height: phoneHeight };
  const twin: Rect = {
    left: stacked ? pad : pad + left + gap, top: stacked ? pad + phoneHeight + gap : pad,
    width: right, height: stacked ? Math.max(300, Math.round(right * 0.78)) : phoneHeight,
  };
  const lower = twin.top + twin.height + gap;
  const notesHeight = stacked ? minNotes : Math.min(230, Math.max(minNotes, view.height - lower - pad - traceBelow));
  const timeline = { left: pad, top: lower, width: left, height: notesHeight };
  const bubble = { left: twin.left, top: stacked ? lower + notesHeight + gap : lower, width: right, height: stacked ? Math.max(220, notesHeight) : notesHeight };
  const trace = traceHeight === 0 ? null : traceAside
    ? { left: pad + joinedWidth + gap, top: twin.top, width: traceWidth, height: twin.height }
    : { left: pad, top: bubble.top + bubble.height + gap, width: traceWidth, height: traceHeight };
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
  return { pad, gap, scale, video, twin, timeline, bubble, mascot: m, image, logo: mascotLogoBox(mascot, scale, image), trace,
    chipsRight: 12, camPad, focus, blocked: [] };
}
