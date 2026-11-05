import { useEffect, useRef, useState, type ReactNode } from "react";
import { hideViewerBar } from "./embed";
import { ViewerContext, waitForViewer, type AptViewer } from "./viewer";

const SRC = "/twin/viewer/?live=auto&embed=1";

/**
 * 화면 전체 3D 트윈(iframe) + 그 위 덮개 층. 덮개는 마우스를 3D로 흘려보내고, 덮개의 바로 아래 자식만 클릭을 받는다.
 * 화면 전체를 덮는 자식(말풍선 층 등)은 자기 상자가 클릭을 막지 않게 만든다.
 */
export function TwinStage({ children }: { children?: ReactNode }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [viewer, setViewer] = useState<AptViewer | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const f = frame.current;
    if (!f) return;
    let live = true;
    const onLoad = () => {
      const win = f.contentWindow;
      if (!win) return;
      if (f.contentDocument) hideViewerBar(f.contentDocument); // 뷰어 도구는 React 패널이 대신한다
      waitForViewer(win)
        .then((v) => {
          if (!live) return;
          v.setBadges(false); // 뷰어 배지 대신 React 말풍선을 쓴다
          v.setWallMode("low"); // 처음에는 집 전체가 보이게(뷰어 막대를 숨겨서 벽 선택은 이대로 둔다)
          if (f.contentDocument) hideViewerBar(f.contentDocument); // 다 불러온 집을 막대 없는 캔버스에 다시 맞춘다
          setError(null);
          setViewer(v);
        })
        .catch((e: Error) => { if (live) setError(e.message); });
    };
    f.addEventListener("load", onLoad);
    return () => { live = false; f.removeEventListener("load", onLoad); };
  }, []);
  return (
    <ViewerContext.Provider value={viewer}>
      <section className="absolute inset-0" aria-label="3D 트윈">
        <iframe ref={frame} src={SRC} title="3D 집 트윈" className="absolute inset-0 h-full w-full border-0" />
        {error && <p className="absolute inset-0 grid place-items-center text-ink-dim">{error}</p>}
        <div className="pointer-events-none absolute inset-0 *:pointer-events-auto">{children}</div>
      </section>
    </ViewerContext.Provider>
  );
}
