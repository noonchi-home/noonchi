import { useCallback, useEffect, useRef, useState } from "react";
import type { SetupView } from "../../../src/contract/setup.ts";
import { cn } from "../lib/utils";
import { hideViewerBar } from "../twin/embed";
import { waitForViewer } from "../twin/viewer";
import { btn, call, failText, isOk, primary, small } from "./setup-api";

// 4 위치 동기화: 3D 트윈에서 벽 두 곳(A·B)을 골라 저장하면 폰이 실제 그 벽 바로 아래 바닥을 조준해 맞춘다(높이는 눈높이 고정).
// 고르기는 같은 출처 iframe의 뷰어 API(aptViewer.startPick)를 쓰고, 저장한 점은 3D에 핀으로 보인다.
// "벽 하나로 A·B 고르기"는 누른 벽 하나를 서버(/api/phone/touch-points/auto)에 보내 A·B 구석을 받는다. 저장은 따로 한다.
// 손으로 다시 고른 점의 「<방> 벽」 이름은 서버(/api/phone/touch-points/room)가 정한 방으로 짓는다. 같은 쪽을 여러 방이 쓰는 벽에서 뷰어는 첫 방을 보낸다.
// 3D는 대시보드(TwinStage)처럼 뷰어 위 막대를 숨기고 배지를 끈다. 벽은 고르기에 온전한 벽이 필요해 낮추지 않는다.
// live=auto는 그대로 둔다: 뷰어는 live가 있을 때만 embed=1(가전 패널 접기·오른쪽 패널 숨김)을 쓰고, 배치 보정·폰 눈 마커도 live로 받는다.

const TWIN_SRC = "/twin/viewer/?live=auto&embed=1";
const IDS = ["A", "B"] as const;
type Id = (typeof IDS)[number];
type Pos = [number, number];
const MAX_LABEL = 40;
const WALL = " 벽";
// 서버(src/phone/corners.ts cornerLabels)가 짓는 구석 이름 꼴. 방 이름은 긴 쪽(맞은편)에 맞춰 같이 줄인다
const CORNER = " 구석";
const OPPOSITE = " 맞은편 구석";
/** 방 이름을 이름 꼴 끝말(suffix)과 합쳐 40자가 넘지 않게 줄인다. */
const cut = (room: string, suffix: string) => room.trim().slice(0, MAX_LABEL - suffix.length).trim();
/** 뷰어가 돌려주는 벽 점: 방 쪽 면 위 점, 그 면의 방·법선. */
type WallHit = { position: Pos; room?: string; normal?: Pos };

/** 뷰어(twin-studio main.mjs) 중 기준점 고르기에 쓰는 부분. */
interface PickViewer {
  startPick?(cb: (hit: WallHit | null) => void): void;
  cancelPick?(): void;
  setTouchPoints?(points: { id: string; label: string; position: Pos }[]): void;
}

interface TouchView {
  ok: true;
  points: { id: Id; label: string; position: Pos }[] | null;
  distance_m: number | null;
}

interface AutoView {
  ok: true;
  points: { id: Id; label: string; position: Pos }[];
}

interface RoomView {
  ok: true;
  room: string | null;
}

interface LayoutView {
  ok: true;
  edits: number;
  dirty: boolean;
}

/** 3D 트윈 iframe. 뜨면 뷰어 위 막대를 숨기고, 집을 다 불러오면 배지를 끄고 캔버스를 다시 맞춘 뒤 onReady. */
function TwinBox({ home, frame, onReady }: { home: string; frame: React.RefObject<HTMLIFrameElement | null>; onReady: () => void }) {
  const [twin, setTwin] = useState<"checking" | "none" | "ready">("checking");
  const [loaded, setLoaded] = useState(false);
  const onLoad = () => {
    setLoaded(true);
    const f = frame.current;
    const win = f?.contentWindow;
    if (!f || !win) return;
    if (f.contentDocument) hideViewerBar(f.contentDocument);
    waitForViewer(win)
      .then((v) => {
        if (frame.current !== f) return; // 그사이 닫혔거나 집이 바뀌었다
        v.setBadges(false);
        if (f.contentDocument) hideViewerBar(f.contentDocument); // 다 불러온 집을 막대 없는 캔버스에 다시 맞춘다
        onReady();
      })
      .catch(() => {}); // 뷰어가 없으면 고르기 단추가 알린다
  };
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
          className="absolute inset-0 size-full border-0" onLoad={onLoad}
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
  const [labels, setLabelsState] = useState<Record<Id, string>>({ A: "", B: "" });
  const labelsRef = useRef(labels);
  const setLabels = (l: Record<Id, string>) => { labelsRef.current = l; setLabelsState(l); };
  // 앱이 채운 이름. 사용자가 고치지 않아 아직 이 글 그대로면 손으로 다시 고를 때 새 자리에 맞게 바꾼다.
  // 저장 파일에는 누가 쓴 이름인지 없어서, 처음 불러온 이름은 아는 방의 이름 꼴(autoLabels)이면 앱이 채운 것으로 본다
  const filled = useRef<Record<Id, string | null>>({ A: null, B: null });
  const [saved, setSaved] = useState(false);
  const [info, setInfo] = useState<{ text: string; error?: boolean }>({ text: "벽 하나로 A·B 구석을 고르세요." });
  const [picking, setPicking] = useState(false);
  const [layout, setLayout] = useState<LayoutView | null>(null);

  const viewer = (): PickViewer | null => {
    try {
      return (frame.current?.contentWindow as (Window & { aptViewer?: PickViewer }) | null)?.aptViewer ?? null;
    } catch {
      return null;
    }
  };
  /** 앱이 채우는 이름 꼴 전부: 방마다 「<방> 구석」·「<방> 맞은편 구석」·「<방> 벽」. */
  const autoLabels = () => new Set(view.rooms.flatMap((r) => {
    const corner = cut(r.label ?? "", OPPOSITE), wall = cut(r.label ?? "", WALL);
    return [...(corner ? [`${corner}${CORNER}`, `${corner}${OPPOSITE}`] : []), ...(wall ? [`${wall}${WALL}`] : [])];
  }));
  const list = (p = points, l = labels) => IDS.map((id) => ({ id, label: l[id].trim(), position: p[id] }));
  const showMarkers = (p = points, l = labels) => {
    viewer()?.setTouchPoints?.(list(p, l).filter((x) => x.position).map((x) => ({ id: x.id, label: x.label || `${x.id} 지점`, position: x.position! })));
  };
  /** 서버가 준 A·B로 바꾼다. loaded: 화면을 열며 처음 불러온 값. */
  const apply = (t: TouchView, loaded = false) => {
    setSaved(Boolean(t.points));
    const p: Record<Id, Pos | null> = { A: null, B: null };
    const l: Record<Id, string> = { A: "", B: "" };
    const auto = loaded ? autoLabels() : null;
    for (const id of IDS) {
      const hit = t.points?.find((x) => x.id === id);
      p[id] = hit?.position ?? null;
      l[id] = hit?.label ?? "";
      const app = l[id] === filled.current[id] || Boolean(auto?.has(l[id]));
      filled.current = { ...filled.current, [id]: app ? l[id] : null };
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
    filled.current = { A: null, B: null };
    call<TouchView>("/api/phone/touch-points").then((r) => {
      if (!live) return;
      setTouchOn(isOk(r)); // 집 scene.json이 없으면 쓰지 않는다
      if (isOk(r)) apply(r.json, true);
    });
    return () => { live = false; };
  }, [home]);
  useEffect(() => { void loadLayout(); }, [loadLayout, layoutTick, home]);

  const distance = (p = points) => (p.A && p.B ? Math.hypot(p.B[0] - p.A[0], p.B[1] - p.A[1]) : null);
  /** 3D에서 벽 하나를 고르게 하고, 고르면 onHit. 취소하면 알리기만 한다. */
  const startPick = (prompt: string, onHit: (hit: WallHit) => void) => {
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
      onHit(hit);
    });
    setPicking(true);
    setInfo({ text: prompt });
  };
  /** 손으로 고른 벽의 이름: 「<방> 벽」(40자까지). 방 이름을 모르면 빈 글. */
  const wallLabel = (room?: string) => {
    const name = cut(view.rooms.find((r) => r.id === room)?.label ?? "", WALL);
    return name ? `${name}${WALL}` : "";
  };
  /** 누른 벽 점의 방 id. 서버가 모르거나 닿지 못하면 undefined. */
  const roomOf = async (hit: WallHit) => {
    const r = await call<RoomView>("/api/phone/touch-points/room", { home, position: hit.position, room: hit.room, normal: hit.normal });
    return isOk(r) ? r.json.room ?? undefined : undefined;
  };
  const pick = (id: Id) => startPick(`3D 트윈에서 ${id} 지점의 벽을 누르세요.`, async (hit) => {
    // 앱이 채운 이름을 고치지 않았을 때만 방을 묻고, 답을 기다리는 동안 이름을 고쳤으면 그대로 둔다
    const was = filled.current[id];
    const rename = was !== null && labelsRef.current[id] === was;
    const room = rename ? await roomOf(hit) : undefined;
    const next = { ...pointsRef.current, [id]: hit.position };
    let l = labelsRef.current;
    if (rename && filled.current[id] === was && l[id] === was) {
      const label = wallLabel(room);
      l = { ...l, [id]: label };
      filled.current = { ...filled.current, [id]: label || null };
      setLabels(l);
    }
    const d = distance(next);
    setPoints(next);
    setInfo({ text: d === null ? `${id} 지점을 골랐어요. 다른 지점도 고르세요.` : `A–B 수평 거리 ${d.toFixed(2)}m. 저장하면 폰이 이 두 벽으로 맞춰요.` });
    showMarkers(next, l);
  });
  // 벽 하나 → 서버가 A(그 벽의 가까운 구석)·B(맞은편 벽의 대각선 구석)를 돌려준다. B를 못 찾으면 A만 온다
  const pickWall = () => startPick("3D 트윈에서 벽 하나를 누르세요.", async (hit) => {
    const r = await call<AutoView>("/api/phone/touch-points/auto", { home, position: hit.position, room: hit.room, normal: hit.normal });
    if (!isOk(r)) return setInfo({ text: failText(r, "구석을 찾지 못했어요."), error: true });
    if (r.json.points.length === 0) return setInfo({ text: "이 벽에서 구석을 찾지 못했어요. 다른 벽을 누르거나 A·B를 직접 고르세요." });
    const next: Record<Id, Pos | null> = { A: null, B: null };
    const names: Record<Id, string> = { A: "", B: "" };
    for (const p of r.json.points) {
      next[p.id] = p.position;
      names[p.id] = p.label;
    }
    const d = distance(next);
    setPoints(next);
    setLabels(names);
    filled.current = { A: names.A || null, B: names.B || null };
    showMarkers(next, names);
    setInfo({ text: d === null ? "A 구석을 골랐어요. B 지점을 고르세요." : `A–B 수평 거리 ${d.toFixed(2)}m. 저장하면 폰이 이 두 구석으로 맞춰요.` });
  });
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
        <TwinBox home={home} frame={frame} onReady={() => showMarkers(pointsRef.current, labelsRef.current)} />
        <div className="flex flex-col gap-3 overflow-auto text-sm">
          {touchOn && (
            <section aria-label="폰 기준점" className="rounded-xl border border-glass-line bg-field p-3">
              <h3 className="mb-2 font-semibold">폰 기준점 A·B</h3>
              {!picking && <button type="button" className={cn(btn, "mb-2 w-full")} onClick={pickWall}>벽 하나로 A·B 고르기</button>}
              {!picking && IDS.map((id) => (
                <div key={id} className="mb-2 grid grid-cols-[auto_1fr_auto] items-center gap-1.5">
                  <b className={cn("grid size-6 place-items-center rounded-full text-xs text-white", id === "A" ? "bg-[#e8590c]" : "bg-[#1c7ed6]")}>{id}</b>
                  <input
                    type="text" maxLength={MAX_LABEL} value={labels[id]} aria-label={`${id} 지점 이름`}
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
