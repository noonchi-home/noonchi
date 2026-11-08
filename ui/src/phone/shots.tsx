// 화면 사진 페이지(PHONE_SHOTS=1 빌드에만 들어간다): 주소 #이름의 상태 예시(fixtures.ts)를 실제 폰 화면 그대로 그린다.
// AR 상태는 카메라 자리에 ink-4 바탕을 깔고 조준점·초점 그림을 그 위에 그린다. 다 그리면 html에 data-shot을 단다(npm run capture --ready).
// AR 상태는 그린 뒤 배치를 잰다(layout-check.ts): 화면 밖 단추, 조준점이나 그 칸 밖 단추를 가리는 칸(위 줄·말풍선·엄지 자리),
// 세로 화면에서 아래 1/3 밖의 큰 단추, 잘린 상태 줄 글, 칸·단추와 겹친 화면 밖 화살표가 있으면 console.error로 내서 capture가 실패한다. 말풍선 자리는 부품이 그린 뒤 정해지므로 두 화면 그림 뒤에 잰다.
// 처음 화면은 「AR 시작」 단추가 첫 화면 밖이면 같은 방법으로 실패한다.
import { useEffect, useRef } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource-variable/noto-sans-kr";
import "../styles.css";
import { color } from "../../../src/design/tokens.ts";
import { drawOverlay, fitCanvas, labelFont, markLabel, overlayEdges, type ArrowBox } from "./draw";
import { SHOTS, SHOT_NAMES, type ShotName } from "./fixtures";
import { clipIssues, introIssues, layoutIssues, type Box } from "./layout-check";
import { PhoneScreen } from "./PhoneScreen";
import type { PhoneActions } from "./state";

const noop = () => {};
const act: PhoneActions = {
  startAr: noop, stopAr: noop, takePhoto: noop, recordAnchor: noop, resetAnchors: noop, setMenu: noop,
  say: noop, confirm: noop, cancel: noop, brainReply: noop, talkDown: noop, talkUp: noop,
};

const ZONE_NAMES: Record<string, string> = { top: "위 줄", thumb: "엄지 자리", bubble: "말풍선" };
const zoneOf = (el: Element) => ZONE_NAMES[el.closest("[data-phone-zone]")?.getAttribute("data-phone-zone") ?? ""];
const rect = (el: Element): Box => {
  const r = el.getBoundingClientRect();
  return { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
};
/** 글 줄 높이(CSS px). normal이면 글자 크기의 1.2배. */
const lineHeight = (el: Element) => {
  const s = getComputedStyle(el);
  return parseFloat(s.lineHeight) || parseFloat(s.fontSize) * 1.2;
};
/** 덮개의 보이는 단추(담은 스크롤 칸과 함께)와 위 줄·엄지 자리 칸, 잘리면 안 되는 글을 재서 배치 문제를 돌려준다. */
function measureOverlay(arrows: ArrowBox[]): string[] {
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
    .map((el) => ({ name: el.dataset.phoneText!, line: lineHeight(el), scroll:{ width: el.scrollWidth, height: el.scrollHeight }, client: { width: el.clientWidth, height: el.clientHeight } }));
  return [...layoutIssues({ width: innerWidth, height: innerHeight }, targets, panels, arrows), ...clipIssues(texts)];
}

/** 처음 화면이 보이면 「AR 시작」 단추가 첫 화면 안에 있는지 잰다. */
function measureIntro(): string[] {
  const intro = document.querySelector("main");
  if (!intro || intro.hidden) return [];
  const start = [...intro.querySelectorAll("button")].find((b) => b.textContent?.trim() === "AR 시작");
  return introIssues({ width: innerWidth, height: innerHeight }, start ? rect(start) : null);
}

function Shot({ name }: { name: ShotName }) {
  const shot = SHOTS[name];
  const backdrop = useRef<HTMLCanvasElement>(null);
  const overlay = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    let live = true;
    void (async () => {
      const text = shot.draw.marks.map((m) => markLabel(m.label)).join("");
      await document.fonts.ready;
      if (text) await document.fonts.load(labelFont, text);
      if (!live) return;
      // 덮개 칸이 자리 잡은 뒤 그린다(화면 밖 화살표가 위 줄·엄지 자리를 잰 값으로 비킨다)
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      if (!live) return;
      const w = innerWidth;
      const h = innerHeight;
      const dpr = devicePixelRatio || 1;
      let arrows: ArrowBox[] = [];
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
        if (c) arrows = drawOverlay(c, { width: w, height: h }, shot.draw, 0, true, overlayEdges(root, h));
      }
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      if (!live) return;
      for (const issue of [...measureIntro(), ...measureOverlay(arrows)]) console.error(`배치: ${issue}`);
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
