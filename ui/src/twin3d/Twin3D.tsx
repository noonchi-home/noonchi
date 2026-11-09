import { TriangleAlert } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { Alert, AlertTitle } from "../components/ui/alert";
import { TwinEngine } from "./engine";
import { CAMERA_MS, type Box, type MapCamera } from "./view";

/** 상자 레이아웃 크기(transform 앞, ResizeObserver). 처음에는 바로 읽고, 바뀌면 150 ms 동안 더 바뀌지 않을 때 한 번 읽는다. */
export function useLayoutBox(ref: RefObject<HTMLElement | null>): Box {
  const [box, setBox] = useState<Box>({ width: 0, height: 0 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const read = () => setBox((b) => (b.width === el.offsetWidth && b.height === el.offsetHeight ? b : { width: el.offsetWidth, height: el.offsetHeight }));
    read();
    if (typeof ResizeObserver === "undefined") return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const ro = new ResizeObserver(() => { clearTimeout(timer); timer = setTimeout(read, 150); });
    ro.observe(el);
    return () => { clearTimeout(timer); ro.disconnect(); };
  }, [ref]);
  return box;
}

/**
 * 구운 집 3D 트윈 캔버스 하나. 상자(box)가 정해지면 엔진을 한 번 불러오고, view가 바뀌면 moveMs 동안 카메라를 옮긴다.
 * 그 view로 첫 그림을 그리면 캔버스에 data-twin3d="ready"를 단다. 캔버스는 마우스를 받지 않는다.
 */
export function Twin3D({ home, box, view, moveMs = CAMERA_MS, onReady, onEngine }: {
  home: string;
  box: Box;
  view: MapCamera;
  moveMs?: number;
  onReady?: () => void;
  onEngine?: (engine: TwinEngine | null) => void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [engine, setEngine] = useState<TwinEngine | null>(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const latest = useRef({ box, view, onReady, onEngine });
  latest.current = { box, view, onReady, onEngine };
  const sized = box.width > 0 && box.height > 0;

  useEffect(() => {
    const el = canvas.current;
    if (!el || !sized) return;
    let live = true;
    let made: TwinEngine | null = null;
    // StrictMode의 붙였다 떼기에서는 시작하지 않는다(같은 그림판에 엔진 둘이 붙지 않게)
    const start = setTimeout(() => {
      TwinEngine.load({ canvas: el, home, box: latest.current.box, dpr: window.devicePixelRatio || 1 })
        .then((e) => {
          if (!live) { e.dispose(); return; }
          made = e;
          const off = e.onView(() => {
            off();
            if (!live) return;
            setReady(true);
            latest.current.onReady?.();
          });
          e.resize(latest.current.box);
          e.setView(latest.current.view, 0);
          setEngine(e);
          latest.current.onEngine?.(e);
        })
        .catch((err: unknown) => {
          if (!live) return;
          console.error(err);
          setFailed(true);
        });
    }, 0);
    return () => {
      live = false;
      clearTimeout(start);
      if (made) { latest.current.onEngine?.(null); made.dispose(); }
      setEngine(null);
      setReady(false);
    };
  }, [home, sized]);

  useEffect(() => { engine?.resize(box); }, [engine, box.width, box.height]);
  useEffect(() => { engine?.setView(latest.current.view, moveMs); }, [engine, view.cx, view.cy, view.scale, moveMs]);

  return (
    <>
      <canvas ref={canvas} data-twin3d={ready ? "ready" : "loading"} aria-hidden="true" className="pointer-events-none absolute inset-0 size-full" />
      {failed && (
        <div className="absolute inset-0 grid place-items-center p-4">
          <Alert variant="error" className="w-auto max-w-md"><TriangleAlert aria-hidden="true" /><AlertTitle>3D 트윈을 불러오지 못했어요.</AlertTitle></Alert>
        </div>
      )}
    </>
  );
}
