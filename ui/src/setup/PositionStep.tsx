import { Smartphone, TriangleAlert } from "lucide-react";
import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import type { SetupView } from "../../../src/contract/setup.ts";
import { Alert, AlertTitle } from "../components/ui/alert";
import { Avatar, AvatarFallback } from "../components/ui/avatar";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardDescription } from "../components/ui/card";
import { Item, ItemContent, ItemMedia, ItemTitle } from "../components/ui/item";
import { QRCode } from "../components/ui/qr-code";
import { Input } from "../components/ui/input";
import { Skeleton } from "../components/ui/skeleton";
import { Status } from "../components/ui/status";
import { cn } from "../lib/utils";
import { pickPhoneUrl, urlParts } from "../panels/phone-url";
import { hideViewerBar } from "../twin/embed";
import { waitForViewer } from "../twin/viewer";
import { call, failText, isOk } from "./setup-api";

// 4 위치 동기화: 3D 트윈에서 벽 두 곳(A·B)을 골라 저장하면 폰이 실제 그 벽 바로 아래 바닥을 조준해 맞춘다(높이는 눈높이 고정).
// 말풍선 안은 트윈 칸(data-twin-box) 하나이고 모든 일을 그 위에 떠 있는 부품으로 한다(사용자 2026-11-09 「4번은 트윈화면만 띄워놓고 다 해결가능하게 수정해」):
// 위쪽 띠에 지금 할 일 한 줄과 그 아래 한 줄로 A·B 칩(이름·다시 고르기: 집 위 핀 이름표를 가리지 않게 띠 안에만), 오른쪽 위 폰 칩(누르면 주소·QR), 아래 가운데 저장·지우기, 왼쪽 아래 배치 보정(고친 게 있을 때), 오른쪽 아래 이전·완료.
// 뷰어가 핀 누름을 알려 주지 않아 핀 대신 A·B 칩으로 이름을 고치고 다시 고른다. 점이 없으면 트윈이 뜨자마자 벽 고르기가 켜져 벽 하나로 A·B를 잡는다.
// 「완료하고 대시보드로」는 A·B를 저장한 뒤에만 누를 수 있다(기준점 맞추기가 꺼진 집은 바로). 좁은 화면(lg 아래)은 떠 있는 부품이 트윈 아래로 쌓인다.
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

/**
 * 3D 트윈 iframe(21st.dev Card 안). 뜨면 뷰어 위 막대를 숨기고, 집을 다 불러오면 배지를 끄고 캔버스를 다시 맞춘 뒤 onReady.
 * 그때까지 트윈을 숨기고(invisible) Skeleton·글로 자리를 채운다. 뷰어는 load 전부터 막대·가전 패널을 그리고, embed 접기는 장면을 받은 뒤에 한다.
 */
function TwinBox({ home, frame, onReady, className }: { home: string; frame: React.RefObject<HTMLIFrameElement | null>; onReady: () => void; className?: string }) {
  const [twin, setTwin] = useState<"checking" | "none" | "loading" | "failed" | "ready">("checking");
  const onLoad = () => {
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
        setTwin("ready");
      })
      .catch(() => { if (frame.current === f) setTwin("failed"); });
  };
  useEffect(() => {
    let live = true;
    setTwin("checking");
    fetch("/twin/viewer/", { method: "HEAD" }).then((r) => r.ok).catch(() => false).then((ok) => { if (live) setTwin(ok ? "loading" : "none"); });
    return () => { live = false; };
  }, [home]);
  const cover = { checking: "3D 트윈 불러오는 중…", loading: "3D 트윈 불러오는 중…", none: "3D 트윈을 찾을 수 없어요.", failed: "3D 트윈을 불러오지 못했어요.", ready: null }[twin];
  const waiting = twin === "checking" || twin === "loading";
  return (
    <Card className={cn("relative min-h-[360px] overflow-hidden", className)}>
      {twin !== "checking" && twin !== "none" && (
        <iframe
          ref={frame} title="3D 집 트윈" src={`${TWIN_SRC}&home=${encodeURIComponent(home)}`}
          className={cn("absolute inset-0 size-full", cover && "invisible")} onLoad={onLoad}
        />
      )}
      {cover && waiting && (
        <Skeleton className="absolute inset-0 grid place-items-center p-4"><CardDescription>{cover}</CardDescription></Skeleton>
      )}
      {cover && !waiting && (
        <div className="absolute inset-0 grid place-items-center p-4">
          <Alert variant="error" className="w-auto"><TriangleAlert aria-hidden="true" /><AlertTitle>{cover}</AlertTitle></Alert>
        </div>
      )}
    </Card>
  );
}

export function PositionStep({ view, onBack, onDone, onNotice, layoutTick }: {
  view: SetupView; onBack: () => void; onDone: () => void; onNotice: (text: string, error?: boolean) => void; layoutTick: number;
}) {
  const home = view.home!.id;
  const frame = useRef<HTMLIFrameElement>(null);
  const [touchOn, setTouchOn] = useState<boolean | null>(null);
  const [twinReady, setTwinReady] = useState(false);
  const [phoneOpen, setPhoneOpen] = useState(false);
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
  const [info, setInfo] = useState<{ text: string; error?: boolean }>({ text: "트윈이 뜨면 벽 하나를 눌러 A·B를 잡아요." });
  const [arm, setArm] = useState(0); // 벽 하나로 A·B 고르기를 켤 차례(트윈이 뜰 때·지운 뒤)
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
      if (!isOk(r)) return;
      apply(r.json, true);
      // 저장한 A·B를 불러오면 할 일 줄은 저장한 상태를 보인다
      if (r.json.points) setInfo({ text: r.json.distance_m === null ? "저장했어요." : `저장했어요. A–B ${r.json.distance_m.toFixed(2)}m.` });
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
    setArm((n) => n + 1);
  };
  const layoutAct = async (what: "save" | "reset") => {
    const r = await call<{ ok: true; count?: number; path?: string; reverted?: number }>(`/api/layout/${what}`, { home });
    if (!isOk(r)) onNotice(failText(r, "배치 보정을 바꾸지 못했어요."), true);
    else onNotice(what === "save" ? `배치 보정 ${r.json.count ?? 0}건을 저장했어요: ${r.json.path ?? ""}` : `배치 보정 ${r.json.reverted ?? 0}곳을 되돌렸어요.`);
    void loadLayout();
  };

  // 점이 없으면 트윈이 뜨자마자(그리고 지운 뒤) 벽 하나로 A·B 고르기를 켠다
  useEffect(() => {
    if (!twinReady || !touchOn || pointsRef.current.A || pointsRef.current.B) return;
    pickWall();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [twinReady, touchOn, arm]);

  const urls = view.position.phone_urls;
  const best = pickPhoneUrl(urls).best;
  const both = Boolean(points.A && points.B);
  const any = Boolean(points.A || points.B);
  const canFinish = touchOn === false || (touchOn === true && saved);
  return (
    <section aria-labelledby="h-position" className="flex min-h-0 flex-1 flex-col">
      <CardContent className="flex min-h-0 flex-1">
        <div data-twin-box className="relative flex min-h-0 flex-1 flex-col gap-2 lg:block">
          <TwinBox
            home={home} frame={frame} className="lg:absolute lg:inset-0 lg:min-h-0"
            onReady={() => { showMarkers(pointsRef.current, labelsRef.current); setTwinReady(true); }}
          />
          {touchOn && (
            <section aria-label="폰 기준점" className="flex flex-col gap-2 lg:pointer-events-none lg:absolute lg:inset-0">
              <div className="flex flex-col items-start gap-2 lg:pointer-events-auto lg:absolute lg:left-3 lg:right-48 lg:top-3">
                <Item role="status" aria-live="polite" variant="muted" size="sm">
                  {info.error && <ItemMedia><TriangleAlert aria-hidden="true" /></ItemMedia>}
                  <ItemContent><ItemTitle>{info.text}</ItemTitle></ItemContent>
                </Item>
                <div data-pin-chips className="flex w-full flex-col gap-2 lg:flex-row">
                {IDS.map((id) => (
                  <Card key={id} className="flex items-center gap-1.5 p-2 lg:w-72">
                    <Avatar size="marker" aria-hidden="true"><AvatarFallback tone={id === "A" ? "marker-a" : "marker-b"}>{id}</AvatarFallback></Avatar>
                    <Input
                      type="text" maxLength={MAX_LABEL} value={labels[id]} aria-label={`${id} 지점 이름`}
                      placeholder={id === "A" ? "예: 거실 창 오른쪽 벽" : "예: 반대편 벽"}
                      onChange={(e) => { const l = { ...labels, [id]: e.target.value }; setLabels(l); showMarkers(points, l); }}
                      className="min-w-0 flex-1"
                    />
                    <Button variant="secondary" size="sm" aria-label={`${id} 다시 고르기`} onClick={() => pick(id)}>다시 고르기</Button>
                  </Card>
                ))}
                </div>
              </div>
              {(any || saved) && (
                <Card className="flex justify-center gap-1.5 self-center p-2 lg:pointer-events-auto lg:absolute lg:bottom-3 lg:left-1/2 lg:-translate-x-1/2">
                  {picking && any ? <Button variant="ghost" size="sm" onClick={() => viewer()?.cancelPick?.()}>고르기 취소</Button> : (
                    <>
                      <Button size="sm" disabled={!both} onClick={save}>저장</Button>
                      <Button variant="outline" size="sm" disabled={!points.A && !points.B && !saved} onClick={clear}>지우기</Button>
                    </>
                  )}
                </Card>
              )}
            </section>
          )}
          <div className="flex flex-col items-end gap-2 lg:absolute lg:right-3 lg:top-3">
            {urls.length > 0 ? (
              <Button variant="outline" size="sm" aria-expanded={phoneOpen} onClick={() => setPhoneOpen((o) => !o)}>
                <Smartphone aria-hidden="true" />폰 연결
              </Button>
            ) : (
              <Status variant="error">폰 서버가 꺼져 있어요.</Status>
            )}
            {phoneOpen && urls.length > 0 && (
              <Card className="flex w-64 flex-col items-center gap-2 p-3">
                {best && <QRCode value={best} size={132} variant="squares" aria-label="폰 연결 QR" />}
                <CardDescription>폰 크롬에서 이 주소를 열고 기준점을 조준해 기록하세요.</CardDescription>
                <ul className="m-0 w-full list-disc break-words pl-5">
                  {urls.map((u) => <li key={u}><code>{urlParts(u).map((p, i) => <Fragment key={i}>{p}<wbr /></Fragment>)}</code></li>)}
                </ul>
              </Card>
            )}
          </div>
          {layout && layout.edits > 0 && (
            <section aria-label="배치 보정" className="lg:absolute lg:bottom-3 lg:left-3">
              <Card className="flex flex-wrap items-center gap-1.5 p-2">
                <Status variant={layout.dirty ? "error" : "success"}>{`보정 ${layout.edits}건 · ${layout.dirty ? "저장 안 함" : "저장됨"}`}</Status>
                <Button variant="outline" size="sm" onClick={() => layoutAct("reset")}>되돌리기</Button>
                <Button size="sm" disabled={!layout.dirty} onClick={() => layoutAct("save")}>저장</Button>
              </Card>
            </section>
          )}
          <div className="flex justify-end gap-2 lg:absolute lg:bottom-3 lg:right-3">
            <Button variant="outline" onClick={onBack}>이전</Button>
            <Button disabled={!canFinish} onClick={onDone}>완료하고 대시보드로</Button>
          </div>
        </div>
      </CardContent>
    </section>
  );
}
