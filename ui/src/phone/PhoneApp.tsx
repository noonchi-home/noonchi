// 폰 화면 뿌리: 제어(controller.ts)의 상태를 그리고, AR 덮개 뿌리와 canvas 그림(draw.ts)을 잇는다.
// 조준점·초점은 XR 프레임마다 React 상태를 거치지 않고 canvas에 바로 그린다. 덮개를 열 때 한 번 그리고,
// 그 뒤로는 조준점이 바뀌거나 초점이 있을 때만 다시 그린다(초점이 없던 프레임에 또 없으면 그대로 둔다).
import { useEffect, useRef, useSyncExternalStore } from "react";
import type { PhoneController } from "./controller";
import { drawOverlay, fitCanvas, labelFont, markLabel, type OverlayScene } from "./draw";
import { PhoneScreen } from "./PhoneScreen";

export function PhoneApp({ controller }: { controller: PhoneController }) {
  const view = useSyncExternalStore(controller.subscribe, controller.view);
  const overlayRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const scene: OverlayScene = { hit: false, marks: [] };
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    let labels = "";
    const paint = () => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = fitCanvas(canvas, innerWidth, innerHeight, devicePixelRatio || 1);
      if (ctx) drawOverlay(ctx, { width: innerWidth, height: innerHeight }, scene, performance.now(), reduced.matches);
    };
    controller.attach(overlayRef.current, {
      start() {
        scene.hit = false;
        scene.marks = [];
        paint();
      },
      hit(on) {
        if (scene.hit === on) return;
        scene.hit = on;
        paint();
      },
      marks(marks) {
        if (!marks.length && !scene.marks.length) return;
        scene.marks = marks;
        // 이름표 글자의 글꼴 조각을 받는다(못 받으면 대체 글꼴로 그린다)
        const text = marks.map((m) => markLabel(m.label)).join("");
        if (text && text !== labels) void document.fonts?.load(labelFont, text).catch(() => {});
        labels = text;
        paint();
      },
    });
  }, [controller]);
  return <PhoneScreen view={view} act={controller.actions} overlayRef={overlayRef} canvasRef={canvasRef} />;
}
