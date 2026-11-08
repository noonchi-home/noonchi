// 화면 사진 페이지(PHONE_SHOTS=1 빌드에만 들어간다): 주소 #이름의 상태 예시(fixtures.ts)를 폰 화면 그대로 그린다.
// AR 상태는 카메라 자리에 ink-4 바탕을 깔고 조준점·초점 그림을 그 위에 그린다. 다 그리면 html에 data-shot을 단다(npm run capture --ready).
import { useEffect, useRef } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource-variable/noto-sans-kr";
import "../styles.css";
import { color } from "../../../src/design/tokens.ts";
import { drawOverlay, fitCanvas, labelFont, markLabel } from "./draw";
import { SHOTS, SHOT_NAMES, type ShotName } from "./fixtures";
import { PhoneScreen } from "./PhoneScreen";
import type { PhoneActions } from "./state";

const noop = () => {};
const act: PhoneActions = {
  startAr: noop, stopAr: noop, takePhoto: noop, recordAnchor: noop, resetAnchors: noop, setMenu: noop,
  say: noop, confirm: noop, cancel: noop, brainReply: noop, talkDown: noop, talkUp: noop,
};

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
      const w = innerWidth;
      const h = innerHeight;
      const dpr = devicePixelRatio || 1;
      if (shot.view.ar && backdrop.current) {
        const b = fitCanvas(backdrop.current, w, h, dpr);
        if (b) {
          b.fillStyle = color["ink-4"];
          b.fillRect(0, 0, w, h);
        }
      }
      if (shot.view.ar && overlay.current) {
        const c = fitCanvas(overlay.current, w, h, dpr);
        if (c) drawOverlay(c, { width: w, height: h }, shot.draw, 0, true);
      }
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
