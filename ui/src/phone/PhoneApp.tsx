// 실제 폰 화면 뿌리: 제어(controller.ts)의 상태를 그리고, AR 덮개 뿌리와 canvas 그림(draw.ts)을 잇는다.
// 조준점·고리는 XR 프레임마다 React 상태를 거치지 않고 canvas에 바로 그린다. 덮개를 열 때 한 번 지우고,
// 그 뒤로는 조준점을 켜고 끌 때, 조준점이 켜진 동안 바닥 닿음이 바뀔 때, 고리가 있거나 막 사라질 때만 다시 그린다.
import { useEffect, useRef, useSyncExternalStore } from "react";
import type { PhoneController } from "./controller";
import { drawOverlay, fitCanvas, overlayEdges, type OverlayScene } from "./draw";
import { PhoneScreen } from "./PhoneScreen";

export function PhoneApp({ controller }: { controller: PhoneController }) {
  const view = useSyncExternalStore(controller.subscribe, controller.view);
  const overlayRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const scene: OverlayScene = { aim: false, hit: false, marks: [] };
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    const paint = () => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = fitCanvas(canvas, innerWidth, innerHeight, devicePixelRatio || 1);
      // 화면 밖 세모가 위 줄·엄지 자리를 비키도록 그릴 때마다 두 칸을 잰다(명령·카드가 뜨고 지면 바뀐다)
      if (ctx) drawOverlay(ctx, { width: innerWidth, height: innerHeight }, scene, performance.now(), reduced.matches, overlayEdges(overlayRef.current, innerHeight));
    };
    controller.attach(overlayRef.current, {
      start() {
        scene.hit = false;
        scene.marks = [];
        paint();
      },
      aim(on) {
        scene.aim = on;
        paint();
      },
      hit(on) {
        if (scene.hit === on) return;
        scene.hit = on;
        if (scene.aim) paint();
      },
      marks(marks) {
        if (!marks.length && !scene.marks.length) return;
        scene.marks = marks;
        paint();
      },
    });
  }, [controller]);
  return <PhoneScreen view={view} act={controller.actions} overlayRef={overlayRef} canvasRef={canvasRef} />;
}
