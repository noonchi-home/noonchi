import { useCallback, useEffect, useRef, useState } from "react";
import type { SetupView } from "../../../src/contract/setup.ts";
import { cn } from "../lib/utils";
import { btn, call, failText, isOk, primary, small } from "./setup-api";

// 3 위치 동기화: 3D 트윈에서 벽 두 곳(A·B)을 골라 저장하면 폰이 실제 그 벽 바로 아래 바닥을 조준해 맞춘다(높이는 눈높이 고정).
// 고르기는 같은 출처 iframe의 뷰어 API(aptViewer.startPick)를 쓰고, 저장한 점은 3D에 핀으로 보인다.

const TWIN_SRC = "/twin/viewer/?live=auto&embed=1";
const IDS = ["A", "B"] as const;
type Id = (typeof IDS)[number];
type Pos = [number, number];

/** 뷰어(twin-studio main.mjs) 중 기준점 고르기에 쓰는 부분. */
interface PickViewer {
  startPick?(cb: (hit: { position: Pos } | null) => void): void;
  cancelPick?(): void;
  setTouchPoints?(points: { id: string; label: string; position: Pos }[]): void;
}

interface TouchView {
  ok: true;
  points: { id: Id; label: string; position: Pos }[] | null;
  distance_m: number | null;
}

interface LayoutView {
  ok: true;
  edits: number;
  dirty: boolean;
}

function TwinBox({ home, frame, onLoad }: { home: string; frame: React.RefObject<HTMLIFrameElement | null>; onLoad: () => void }) {
  const [twin, setTwin] = useState<"checking" | "none" | "ready">("checking");
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    let live = true;
    setTwin("checking");
    setLoaded(false);
    fetch("/twin/viewer/", { method: "HEAD" }).then((r) => r.ok).catch(() => false).then((ok) => { if (live) setTwin(ok ? "ready" : "none"); });
    return () => { live = false; };
  }, [home]);
  return (
    <div className="relative min-h-[360px] overflow-hidden rounded-xl border border-glass-line bg-black/30">
      {twin === "ready" && (
        <iframe
          ref={frame} title="3D 집 트윈" src={`${TWIN_SRC}&home=${encodeURIComponent(home)}`}
          className="absolute inset-0 size-full border-0" onLoad={() => { setLoaded(true); onLoad(); }}
        />
      )}
      {!(twin === "ready" && loaded) && (
        <p className="absolute inset-0 m-0 grid place-items-center p-4 text-center text-ink-dim">
          {twin === "none" ? "3D 트윈을 찾을 수 없어요." : "3D 트윈 불러오는 중…"}
        </p>
      )}
    </div>
  );
}

export function PositionStep({ view, onBack, onDone, onNotice, layoutTick }: {
  view: SetupView; onBack: () => void; onDone: () => void; onNotice: (text: string, error?: boolean) => void; layoutTick: number;
}) {
  const home = view.home!.id;
  const frame = useRef<HTMLIFrameElement>(null);
  const [touchOn, setTouchOn] = useState(false);
  const [points, setPointsState] = useState<Record<Id, Pos | null>>({ A: null, B: null });
  const pointsRef = useRef(points);
  const setPoints = (p: Record<Id, Pos | null>) => { pointsRef.current = p; setPointsState(p); };
  const [labels, setLabels] = useState<Record<Id, string>>({ A: "", B: "" });
  const [saved, setSaved] = useState(false);
  const [info, setInfo] = useState<{ text: string; error?: boolean }>({ text: "멀리 떨어진 두 벽을 고르세요." });
  const [picking, setPicking] = useState(false);
  const [layout, setLayout] = useState<LayoutView | null>(null);

  const viewer = (): PickViewer | null => {
    try {
      return (frame.current?.contentWindow as (Window & { aptViewer?: PickViewer }) | null)?.aptViewer ?? null;
    } catch {
      return null;
    }
  };
  const list = (p = points, l = labels) => IDS.map((id) => ({ id, label: l[id].trim(), position: p[id] }));
  const showMarkers = (p = points, l = labels) => {
    viewer()?.setTouchPoints?.(list(p, l).filter((x) => x.position).map((x) => ({ id: x.id, label: x.label || `${x.id} 지점`, position: x.position! })));
  };
  const apply = (t: TouchView) => {
    setSaved(Boolean(t.points));
    const p: Record<Id, Pos | null> = { A: null, B: null };
    const l: Record<Id, string> = { A: "", B: "" };
    for (const id of IDS) {
      const hit = t.points?.find((x) => x.id === id);
      p[id] = hit?.position ?? null;
      l[id] = hit?.label ?? "";
    }
    setPoints(p);
    setLabels(l);
    showMarkers(p, l);
  };

  const loadLayout = useCallback(async () => {
    const r = await call<LayoutView>("/api/layout");
    setLayout(isOk(r) ? r.json : null);
  }, []);

  useEffect(() => {
    let live = true;
    call<TouchView>("/api/phone/touch-points").then((r) => {
      if (!live) return;
      setTouchOn(isOk(r)); // 집 scene.json이 없으면 쓰지 않는다
      if (isOk(r)) apply(r.json);
    });
    return () => { live = false; };
  }, [home]);
  useEffect(() => { void loadLayout(); }, [loadLayout, layoutTick, home]);

  const distance = (p = points) => (p.A && p.B ? Math.hypot(p.B[0] - p.A[0], p.B[1] - p.A[1]) : null);
  const pick = (id: Id) => {
    const v = viewer();
    if (!v?.startPick) {
      setInfo({ text: "3D 트윈이 아직 준비되지 않았어요. 잠시 뒤 다시 눌러 주세요.", error: true });
      return;
    }
    // 이미 고르는 중이면 startPick이 이전 것을 먼저 취소(콜백 null)하므로 접기는 그 뒤에 한다
    v.startPick((hit) => {
      setPicking(false);
      if (!hit) {
        setInfo({ text: "고르기를 취소했어요." });
        return;
      }
      const next = { ...pointsRef.current, [id]: hit.position };
      const d = distance(next);
      setPoints(next);
      setInfo({ text: d === null ? `${id} 지점을 골랐어요. 다른 지점도 고르세요.` : `A–B 수평 거리 ${d.toFixed(2)}m. 저장하면 폰이 이 두 벽으로 맞춰요.` });
      showMarkers(next);
    });
    setPicking(true);
    setInfo({ text: `3D 트윈에서 ${id} 지점의 벽을 누르세요.` });
  };
  const save = async () => {
    const r = await call<TouchView>("/api/phone/touch-points", { home, points: list().map((p) => ({ label: p.label, position: p.position })) });
    if (!isOk(r)) return setInfo({ text: failText(r, "저장하지 못했어요."), error: true });
    apply(r.json);
    setInfo({ text: `저장했어요. A–B ${(r.json.distance_m ?? 0).toFixed(2)}m. 폰 화면에 A·B 기록 버튼이 떠요.` });
  };
  const clear = async () => {
    const r = await call<TouchView>("/api/phone/touch-points/clear", { home });
    if (!isOk(r)) return setInfo({ text: failText(r, "지우지 못했어요."), error: true });
    apply(r.json);
    setInfo({ text: "지웠어요. 폰은 평면도 바닥 기준점으로 맞춰요." });
  };
  const layoutAct = async (what: "save" | "reset") => {
    const r = await call<{ ok: true; count?: number; path?: string; reverted?: number }>(`/api/layout/${what}`, { home });
    if (!isOk(r)) onNotice(failText(r, "배치 보정을 바꾸지 못했어요."), true);
    else onNotice(what === "save" ? `배치 보정 ${r.json.count ?? 0}건을 저장했어요: ${r.json.path ?? ""}` : `배치 보정 ${r.json.reverted ?? 0}곳을 되돌렸어요.`);
    void loadLayout();
  };

  const urls = view.position.phone_urls;
  const both = Boolean(points.A && points.B);
  return (
    <section aria-labelledby="h-position" className="flex min-h-0 flex-1 flex-col gap-3">
      <h2 id="h-position" className="text-[18px] font-semibold">폰과 트윈의 위치를 맞춰요</h2>
      <div className="grid min-h-[420px] flex-1 gap-3 md:grid-cols-[minmax(0,1fr)_360px]">
        <TwinBox home={home} frame={frame} onLoad={() => setTimeout(() => showMarkers(), 500)} />
        <div className="flex flex-col gap-3 overflow-auto text-sm">
          {touchOn && (
            <section aria-label="폰 기준점" className="rounded-xl border border-glass-line bg-field p-3">
              <h3 className="mb-2 font-semibold">폰 기준점 A·B</h3>
              {!picking && IDS.map((id) => (
                <div key={id} className="mb-2 grid grid-cols-[auto_1fr_auto] items-center gap-1.5">
                  <b className={cn("grid size-6 place-items-center rounded-full text-xs text-white", id === "A" ? "bg-[#e8590c]" : "bg-[#1c7ed6]")}>{id}</b>
                  <input
                    type="text" maxLength={40} value={labels[id]} aria-label={`${id} 지점 이름`}
                    placeholder={id === "A" ? "예: 거실 창 오른쪽 벽" : "예: 반대편 벽"}
                    onChange={(e) => { const l = { ...labels, [id]: e.target.value }; setLabels(l); showMarkers(points, l); }}
                    className="min-w-0 rounded-md border border-glass-line bg-black/20 px-2 py-1 text-ink outline-none focus:border-on"
                  />
                  <button type="button" className={small} onClick={() => pick(id)}>3D에서 고르기</button>
                  <span className="col-start-2 col-end-4 text-xs text-ink-dim">
                    {points[id] ? `벽 위치 (${points[id]![0].toFixed(2)}, ${points[id]![1].toFixed(2)})m` : "미지정"}
                  </span>
                </div>
              ))}
              <p role="status" aria-live="polite" className={cn("my-2 text-xs", info.error && "text-alert")}>{info.text}</p>
              <div className="flex justify-end gap-1.5">
                {picking ? <button type="button" className={small} onClick={() => viewer()?.cancelPick?.()}>고르기 취소</button> : (
                  <>
                    <button type="button" className={btn} disabled={!both} onClick={save}>저장</button>
                    <button type="button" className={small} disabled={!points.A && !points.B && !saved} onClick={clear}>지우기</button>
                  </>
                )}
              </div>
            </section>
          )}
          {layout && (
            <section aria-label="배치 보정" className="rounded-xl border border-glass-line bg-field p-3">
              <h3 className="mb-2 font-semibold">배치 보정</h3>
              <p className="mb-2">
                <span className={cn("rounded-full px-2 py-0.5 text-xs", layout.dirty ? "bg-alert/15 text-alert" : "bg-on/15 text-on")}>
                  {layout.edits === 0 ? "보정 없음" : `보정 ${layout.edits}건 · ${layout.dirty ? "저장 안 함" : "저장됨"}`}
                </span>
              </p>
              <div className="flex justify-end gap-1.5">
                <button type="button" className={small} disabled={layout.edits === 0} onClick={() => layoutAct("reset")}>되돌리기</button>
                <button type="button" className={btn} disabled={layout.edits === 0 && !layout.dirty} onClick={() => layoutAct("save")}>저장</button>
              </div>
            </section>
          )}
          <section aria-label="폰 연결" className="rounded-xl border border-glass-line bg-field p-3">
            <h3 className="mb-2 font-semibold">폰</h3>
            <p className="mb-1 text-xs">{urls.length > 0 ? "폰 크롬에서 이 주소를 열고 기준점을 조준해 기록하세요." : "폰 서버가 꺼져 있어요."}</p>
            <ul className="list-disc break-all pl-5 text-xs">
              {urls.map((u) => <li key={u}><code>{u}</code></li>)}
            </ul>
          </section>
        </div>
      </div>
      <div className="flex justify-end gap-2 pt-1">
        <button type="button" className={btn} onClick={onBack}>이전</button>
        <button type="button" className={primary} onClick={onDone}>{saved ? "완료하고 대시보드로" : "건너뛰고 대시보드로"}</button>
      </div>
    </section>
  );
}
