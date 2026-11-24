// 화면 사진 페이지(PHONE_SHOTS=1 빌드에만 들어간다): 주소 #이름의 상태 예시(fixtures.ts)를 실제 폰 화면 그대로 그린다.
// AR 상태는 카메라 자리에 ink-4 바탕을 깔고 화면 밖이거나 칸에 가린 명령 대상 쪽 세모·조준점(찍기·맞추기 때만)을 그 위에 그린다. 다 그리면 html에 data-shot을 단다(npm run capture --ready).
// AR 상태는 그린 뒤 배치를 잰다(layout-check.ts): 화면 밖 단추, 세로 화면에서 아래 1/3 밖·가로 화면에서 오른쪽 아래 밖의 엄지 자리 단추, 옆으로 넘친 모달 내용, 조준점이나 그 칸 밖 단추를 가리는 칸(위 줄·엄지 자리),
// 잘린 명령·비전 상태 글, 칸·단추와 겹친 화면 밖 세모가 있으면 console.error로 내서 capture가 실패한다. 모달 안 단추는 칸 위에 뜨므로 가림 검사에서 뺀다.
// 처음 화면은 「카메라 켜기」 단추가 첫 화면 밖이면 같은 방법으로 실패한다.
import { useEffect, useRef } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource-variable/noto-sans-kr";
import "../styles.css";
import { color } from "../../../src/design/tokens.ts";
import { drawOverlay, fitCanvas, overlayEdges, type Drawn } from "./draw";
import { SHOTS, SHOT_NAMES, type ShotName } from "./fixtures";
import { bubbleIssues, clipIssues, introIssues, layoutIssues, modalIssues, MODAL_ZONE, type Box } from "./layout-check";
import { PhoneScreen } from "./PhoneScreen";
import type { PhoneActions } from "./state";

const noop = () => {};
const act: PhoneActions = {
  startAr: noop, startPlace: noop, startFromSpot: noop, confirmStart: noop, endSetup: noop, setSettings: noop, micOn: noop,
  say: noop, confirm: noop, answer: noop,
};

const ZONE_NAMES: Record<string, string> = { top: "위 줄", thumb: "엄지 자리" };
const zoneOf = (el: Element) =>
  el.closest("[role=alertdialog]") ? MODAL_ZONE : ZONE_NAMES[el.closest("[data-phone-zone]")?.getAttribute("data-phone-zone") ?? ""];
const rect = (el: Element | Range): Box => {
  const r = el.getBoundingClientRect();
  return { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
};
/** 글 줄 높이(CSS px). normal이면 글자 크기의 1.2배. */
const lineHeight = (el: Element) => {
  const s = getComputedStyle(el);
  return parseFloat(s.lineHeight) || parseFloat(s.fontSize) * 1.2;
};
/** 덮개의 보이는 단추(담은 스크롤 칸과 함께)와 위 줄·엄지 자리 칸, 잘리면 안 되는 글을 재서 배치 문제를 돌려준다. */
function measureOverlay(drawn: Drawn): string[] {
  const root = document.querySelector<HTMLElement>("[data-phone-overlay]");
  if (!root || root.hidden) return [];
  const scrollerOf = (el: Element) => {
    for (let p = el.parentElement; p && p !== root; p = p.parentElement) {
      if (/auto|scroll/.test(getComputedStyle(p).overflowY) && p.scrollHeight > p.clientHeight) return rect(p);
    }
    return null;
  };
  const targets = [...root.querySelectorAll("button")].filter((b) => b.getClientRects().length > 0)
    .map((b) => ({ name: b.getAttribute("aria-label") ?? b.textContent ?? "", box: rect(b), scroller: scrollerOf(b), zone: zoneOf(b) }));
  const panels = [...root.querySelectorAll("[data-phone-zone]")].filter((el) => el.getClientRects().length > 0)
    .map((el) => ({ name: ZONE_NAMES[el.getAttribute("data-phone-zone")!] ?? "", box: rect(el) }));
  const texts = [...root.querySelectorAll<HTMLElement>("[data-phone-text]")].filter((el) => el.getClientRects().length > 0)
    .map((el) => ({ name: el.dataset.phoneText!, line: lineHeight(el), scroll: { width: el.scrollWidth, height: el.scrollHeight }, client: { width: el.clientWidth, height: el.clientHeight } }));
  const modals = [...root.querySelectorAll<HTMLElement>("[role=alertdialog]")].filter((el) => el.getClientRects().length > 0)
    .map((el) => ({ name: el.querySelector("h2")?.textContent ?? "", scroll: { width: el.scrollWidth, height: el.scrollHeight }, client: { width: el.clientWidth, height: el.clientHeight } }));
  // 위 줄 명령 말풍선: 말풍선 자리, 글 범위(Range), 말풍선 안 좌우 여백 합
  const bubbles = [...root.querySelectorAll<HTMLElement>("[data-phone-zone=top] [data-phone-text]")].filter((el) => el.getClientRects().length > 0).flatMap((el) => {
    const glass = el.closest("[data-slot=liquid-glass]");
    if (!glass || !el.parentElement) return [];
    const range = document.createRange();
    range.selectNodeContents(el);
    const pad = parseFloat(getComputedStyle(el.parentElement).paddingLeft) + parseFloat(getComputedStyle(el.parentElement).paddingRight);
    const text = rect(range);
    return [{ name: el.dataset.phoneText!, box: rect(glass), text, pad, lines: Math.max(1, Math.round((text.bottom - text.top) / lineHeight(el))) }];
  });
  return [...layoutIssues({ width: innerWidth, height: innerHeight }, targets, panels, drawn.arrows), ...clipIssues(texts), ...modalIssues(modals), ...bubbleIssues({ width: innerWidth, height: innerHeight }, bubbles)];
}

/** 처음 화면이 보이면 「카메라 켜기」 단추가 첫 화면 안에 있는지 잰다. */
function measureIntro(): string[] {
  const intro = document.querySelector("main");
  if (!intro || intro.hidden) return [];
  const start = intro.querySelector("button[data-phone-action='start-camera']");
  return introIssues({ width: innerWidth, height: innerHeight }, start ? rect(start) : null);
}

function Shot({ name }: { name: ShotName }) {
  const shot = SHOTS[name];
  const backdrop = useRef<HTMLCanvasElement>(null);
  const overlay = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    let live = true;
    void (async () => {
      await document.fonts.ready;
      if (!live) return;
      // 덮개 칸·모달이 자리 잡은 뒤 그린다(화면 밖 세모가 위 줄·엄지 자리를 잰 값으로 비킨다)
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      if (!live) return;
      const w = innerWidth;
      const h = innerHeight;
      const dpr = devicePixelRatio || 1;
      let drawn: Drawn = { arrows: [] };
      if (shot.view.ar && backdrop.current) {
        const b = fitCanvas(backdrop.current, w, h, dpr);
        if (b) {
          b.fillStyle = color["ink-4"];
          b.fillRect(0, 0, w, h);
        }
      }
      if (shot.view.ar && overlay.current) {
        const c = fitCanvas(overlay.current, w, h, dpr);
        const root = document.querySelector("[data-phone-overlay]");
        const scene = { aim: shot.view.setup !== null, hit: shot.view.hit, hitEstimated: shot.view.hitEstimated, marks: shot.marks };
        if (c) drawn = drawOverlay(c, { width: w, height: h }, scene, overlayEdges(root, h));
      }
      // 모달이 열리는 움직임(200ms)이 끝난 뒤 잰다
      await new Promise((r) => setTimeout(r, 400));
      if (!live) return;
      for (const issue of [...measureIntro(), ...measureOverlay(drawn)]) console.error(`배치: ${issue}`);
      document.documentElement.dataset.shot = name;
    })();
    return () => { live = false; };
  }, [name, shot]);
  return (
    <>
      <canvas ref={backdrop} aria-hidden="true" className="pointer-events-none fixed inset-0 size-full" />
      <PhoneScreen view={shot.view} act={act} canvasRef={overlay} />
    </>
  );
}

const name = location.hash.slice(1) as ShotName;
createRoot(document.getElementById("root")!).render(<Shot name={SHOT_NAMES.includes(name) ? name : "intro"} />);
