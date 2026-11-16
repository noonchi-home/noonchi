import { RotateCcw, RotateCw, Smartphone, TriangleAlert } from "lucide-react";
import { Fragment, useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import type { SetupView } from "../../../src/contract/setup.ts";
import { Alert, AlertTitle } from "../components/ui/alert";
import { Avatar, AvatarFallback } from "../components/ui/avatar";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardDescription } from "../components/ui/card";
import { Input } from "../components/ui/input";
import { Item, ItemContent, ItemMedia, ItemTitle } from "../components/ui/item";
import { LineDrawSvg } from "../components/ui/line-draw-svg";
import { QRCode } from "../components/ui/qr-code";
import { Skeleton } from "../components/ui/skeleton";
import { Status } from "../components/ui/status";
import { cn } from "../lib/utils";
import { pickPhoneUrl, urlParts } from "../panels/phone-url";
import { hideViewerBar } from "../twin/embed";
import { waitForViewer, type AptViewer } from "../twin/viewer";
import { call, failText, isOk } from "./setup-api";
import { arrowPath, clockwiseSign, floorAtBox, useFloorClicks, useOverlay, yawOf, type Pos } from "./start-pick";

// 4 위치 동기화: 3D 트윈에서 폰을 켤 시작 자리와 서서 볼 방향을 한 번 골라 저장한다(GET/POST /api/phone/start-pose).
// 폰은 그 자리에 서서 그 쪽을 보고 「여기서 시작」을 한 뒤, 걸으면서 벽 모양·물건으로 저절로 맞춘다(src/phone/sync).
// 말풍선 안은 트윈 칸(data-twin-box) 하나이고 모든 일을 그 위에 떠 있는 부품으로 한다(사용자 2026-11-09 「4번은 트윈화면만 띄워놓고 다 해결가능하게 수정해」):
// 위쪽 띠에 지금 할 일 한 줄과 그 아래 한 줄로 자리·보는 쪽 칩(이름 고치기·다시 고르기·돌리기), 오른쪽 위 폰 칩(누르면 주소·QR), 아래 가운데 저장·지우기,
// 왼쪽 아래 배치 보정(고친 게 있을 때), 오른쪽 아래 이전·완료. 구조는 스케치(dashboard-proto/options/setup-sync-sketch.html)를 따른다.
// 트윈 바닥을 누르면(끌지 않은 짧은 누름) 자리, 자리가 있으면 누른 곳을 보는 방향이 된다. 화살표 끝 손잡이를 끌어도 돌아간다.
// 자리 핀·화살표는 뷰어 카메라로 그림마다 트윈 칸 픽셀로 옮겨 그린다(start-pick.ts). 이름은 비워 두면 서버가 채운다(가까운 물건 「… 앞」, 보는 쪽 물건).
// 「완료하고 대시보드로」는 시작 위치를 저장한 뒤에만 누를 수 있다(시작 위치를 못 쓰는 집은 바로).
// 3D는 대시보드(TwinStage)처럼 뷰어 위 막대를 숨기고 배지를 끈다. live=auto는 그대로 둔다: 배치 보정·폰 눈 마커도 live로 받는다.

const TWIN_SRC = "/twin/viewer/?live=auto&embed=1";
const MAX_LABEL = 40;
/** 돌리기 단추 한 번(도). */
const TURN_DEG = 15;

interface StartView {
  ok: true;
  start: { position: Pos; yaw_deg: number; label: string; facing_label: string } | null;
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
function TwinBox({ home, frame, onReady, className }: { home: string; frame: React.RefObject<HTMLIFrameElement | null>; onReady: (v: AptViewer) => void; className?: string }) {
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
        onReady(v);
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
  const box = useRef<HTMLDivElement>(null);
  const [viewer, setViewer] = useState<AptViewer | null>(null);
  const [startOn, setStartOn] = useState<boolean | null>(null);
  const [phoneOpen, setPhoneOpen] = useState(false);
  const [spot, setSpot] = useState<Pos | null>(null);
  const [yaw, setYaw] = useState(0);
  const [label, setLabel] = useState("");
  const [facing, setFacing] = useState("");
  // 사용자가 고친 이름은 다시 고를 때 서버가 채운 이름으로 덮지 않는다
  const edited = useRef({ label: false, facing: false });
  const [saved, setSaved] = useState(false);
  const [repick, setRepick] = useState(false);
  const [info, setInfo] = useState<{ text: string; error?: boolean }>({ text: "트윈 바닥을 눌러 폰을 켤 자리를 고르세요." });
  const [layout, setLayout] = useState<LayoutView | null>(null);

  const loadLayout = useCallback(async () => {
    const r = await call<LayoutView>("/api/layout");
    setLayout(isOk(r) ? r.json : null);
  }, []);
  useEffect(() => { void loadLayout(); }, [loadLayout, layoutTick, home]);

  /** 서버가 준 시작 위치로 화면을 채운다. */
  const apply = (s: StartView["start"]) => {
    setSpot(s ? [s.position[0], s.position[1]] : null);
    setYaw(s?.yaw_deg ?? 0);
    setLabel(s?.label ?? "");
    setFacing(s?.facing_label ?? "");
    edited.current = { label: false, facing: false };
    setSaved(Boolean(s));
  };
  useEffect(() => {
    let live = true;
    call<StartView>("/api/phone/start-pose").then((r) => {
      if (!live) return;
      setStartOn(isOk(r)); // 집 scene.json이 없으면 쓰지 않는다
      if (!isOk(r)) return;
      apply(r.json.start);
      if (r.json.start) setInfo({ text: "저장했어요. 폰에서 이 자리에 서서 「여기서 시작」을 하세요." });
    });
    return () => { live = false; };
  }, [home]);

  /** 자리·방향이 바뀌면 서버에 이름만 물어 채운다(저장하지 않는다). 방 바닥이 아니면 그 까닭. */
  const preview = async (p: Pos, y: number) => {
    const r = await call<StartView>("/api/phone/start-pose/preview", { home, position: p, yaw_deg: y });
    if (!isOk(r)) return setInfo({ text: failText(r, "그 자리는 쓸 수 없어요."), error: true });
    const s = r.json.start!;
    if (!edited.current.label) setLabel(s.label);
    if (!edited.current.facing) setFacing(s.facing_label);
  };
  const aim = (p: Pos, y: number) => {
    setSaved(false);
    setInfo({ text: "볼 쪽을 누르거나 화살표 끝을 끌어 방향을 정하고 저장하세요." });
    void preview(p, y);
  };
  // 트윈 바닥 누름: 자리가 없거나 다시 고르는 중이면 자리, 아니면 그쪽을 본다(30cm 안이면 무시)
  useFloorClicks(viewer, (p) => {
    if (!startOn) return;
    if (!spot || repick) {
      setSpot(p);
      setRepick(false);
      aim(p, yaw);
      return;
    }
    if (Math.hypot(p[0] - spot[0], p[1] - spot[1]) < 0.3) return;
    const y = yawOf(spot, p);
    setYaw(y);
    aim(spot, y);
  });
  const overlay = useOverlay(viewer, frame, box, spot, yaw);
  const turn = (deg: number) => {
    if (!spot) return;
    const y = ((((yaw + deg) % 360) + 360) % 360);
    setYaw(y);
    aim(spot, y);
  };
  const sign = clockwiseSign(overlay, viewer, frame.current, box.current, spot, yaw);
  // 화살표 끝 손잡이 끌기: 누른 동안 바닥 점을 따라 방향을 바꾸고, 놓으면 이름을 다시 묻는다
  const onKnob = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!viewer || !spot || !frame.current || !box.current) return;
    e.preventDefault();
    const f = frame.current, b = box.current;
    let last = yaw;
    const move = (ev: PointerEvent) => {
      const p = floorAtBox(viewer, f, b, ev.clientX, ev.clientY);
      if (!p || Math.hypot(p[0] - spot[0], p[1] - spot[1]) < 0.2) return;
      last = yawOf(spot, p);
      setYaw(last);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      aim(spot, last);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };
  const save = async () => {
    if (!spot) return;
    const r = await call<StartView>("/api/phone/start-pose", {
      home, position: spot, yaw_deg: yaw, label: edited.current.label ? label : "", facing_label: edited.current.facing ? facing : "",
    });
    if (!isOk(r)) return setInfo({ text: failText(r, "저장하지 못했어요."), error: true });
    apply(r.json.start);
    setInfo({ text: "저장했어요. 폰에서 이 자리에 서서 「여기서 시작」을 하세요." });
  };
  const clear = async () => {
    const r = await call<StartView>("/api/phone/start-pose/clear", { home });
    if (!isOk(r)) return setInfo({ text: failText(r, "지우지 못했어요."), error: true });
    apply(null);
    setRepick(false);
    setInfo({ text: "지웠어요. 트윈 바닥을 눌러 다시 고르세요." });
  };
  const layoutAct = async (what: "save" | "reset") => {
    const r = await call<{ ok: true; count?: number; path?: string; reverted?: number }>(`/api/layout/${what}`, { home });
    if (!isOk(r)) onNotice(failText(r, "배치 보정을 바꾸지 못했어요."), true);
    else onNotice(what === "save" ? `배치 보정 ${r.json.count ?? 0}건을 저장했어요: ${r.json.path ?? ""}` : `배치 보정 ${r.json.reverted ?? 0}곳을 되돌렸어요.`);
    void loadLayout();
  };

  const urls = view.position.phone_urls;
  const best = pickPhoneUrl(urls).best;
  const canFinish = startOn === false || (startOn === true && saved);
  return (
    <section aria-labelledby="h-position" className="flex min-h-0 flex-1 flex-col">
      <CardContent className="flex min-h-0 flex-1">
        <div ref={box} data-twin-box className="relative flex min-h-0 flex-1 flex-col gap-2 lg:block">
          <TwinBox home={home} frame={frame} className="lg:absolute lg:inset-0 lg:min-h-0" onReady={setViewer} />
          {startOn && spot && overlay.spot?.visible && (
            <div data-start-overlay aria-hidden="true" className="pointer-events-none absolute inset-0">
              <LineDrawSvg path={arrowPath(overlay)} tone="cloidHeading" width={overlay.width} height={overlay.height} strokeWidth={4} className="absolute inset-0" />
              <div data-start-spot className="absolute -translate-x-1/2 -translate-y-1/2" style={{ left: overlay.spot.x, top: overlay.spot.y }}>
                <Avatar size="marker"><AvatarFallback tone="marker-a">시작</AvatarFallback></Avatar>
              </div>
              {overlay.tip && (
                <div data-start-knob className="pointer-events-auto absolute -translate-x-1/2 -translate-y-1/2 cursor-grab touch-none" style={{ left: overlay.tip.x, top: overlay.tip.y }} onPointerDown={onKnob}>
                  <Avatar size="md"><AvatarFallback tone="marker-a" /></Avatar>
                </div>
              )}
            </div>
          )}
          {startOn && (
            <section aria-label="시작 위치" className="flex flex-col gap-2 lg:pointer-events-none lg:absolute lg:inset-0">
              <div className="flex flex-col items-start gap-2 lg:pointer-events-auto lg:absolute lg:left-3 lg:right-48 lg:top-3">
                <Item role="status" aria-live="polite" variant="muted" size="sm">
                  {info.error && <ItemMedia><TriangleAlert aria-hidden="true" /></ItemMedia>}
                  <ItemContent><ItemTitle>{info.text}</ItemTitle></ItemContent>
                </Item>
                {spot && (
                  <div data-start-chips className="flex w-full flex-col gap-2 lg:flex-row">
                    <Card className="flex items-center gap-1.5 p-2 lg:w-80">
                      <Avatar size="marker" aria-hidden="true"><AvatarFallback tone="marker-a">시작</AvatarFallback></Avatar>
                      <Input
                        type="text" maxLength={MAX_LABEL} value={label} aria-label="시작 자리 이름" placeholder="예: 거실 소파 앞" className="min-w-0 flex-1"
                        onChange={(e) => { edited.current.label = true; setLabel(e.target.value); setSaved(false); }}
                      />
                      <Button variant="secondary" size="sm" aria-label="시작 자리 다시 고르기" onClick={() => { setRepick(true); setInfo({ text: "트윈 바닥을 눌러 새 자리를 고르세요." }); }}>다시 고르기</Button>
                    </Card>
                    <Card className="flex items-center gap-1.5 p-2 lg:w-80">
                      <Input
                        type="text" maxLength={MAX_LABEL} value={facing} aria-label="보는 쪽 이름" placeholder="예: TV" className="min-w-0 flex-1"
                        onChange={(e) => { edited.current.facing = true; setFacing(e.target.value); setSaved(false); }}
                      />
                      <Button variant="secondary" size="icon" aria-label="반시계 방향으로 15° 돌리기" onClick={() => turn(-TURN_DEG * sign)}><RotateCcw aria-hidden="true" /></Button>
                      <Button variant="secondary" size="icon" aria-label="시계 방향으로 15° 돌리기" onClick={() => turn(TURN_DEG * sign)}><RotateCw aria-hidden="true" /></Button>
                    </Card>
                  </div>
                )}
              </div>
              {(spot || saved) && (
                <Card className="flex justify-center gap-1.5 self-center p-2 lg:pointer-events-auto lg:absolute lg:bottom-3 lg:left-1/2 lg:-translate-x-1/2">
                  <Button size="sm" disabled={!spot || saved} onClick={save}>저장</Button>
                  <Button variant="outline" size="sm" onClick={clear}>지우기</Button>
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
                <CardDescription>폰 크롬에서 이 주소를 열고 시작 자리에서 「여기서 시작」을 하세요.</CardDescription>
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
