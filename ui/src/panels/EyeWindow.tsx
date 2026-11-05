import { ChevronDown, ChevronUp, Eye } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { Focus, HealthView } from "../../../src/contract/events.ts";
import { api } from "../lib/api";
import { attachEyeVideo, displayCaption, type DisplayStats, type EyeMode } from "./eye-video";
import { pickPhoneUrl } from "./phone-url";

const LIVE = "클로이드의 눈 · 실시간";
const streamUrl = () => `/api/eye/stream?t=${Date.now()}`;
type EyeStats = { ok?: boolean; fps?: number; kb_per_frame?: number | null; display?: DisplayStats };

/** 폰이 아직 화면을 보내지 않을 때 보일 글. */
function Hint({ health }: { health: HealthView | null }) {
  if (health && !health.eye) return <p>폰 서버가 꺼져 있어요.</p>;
  const { best, others } = pickPhoneUrl(health?.phone_urls ?? []);
  return (
    <div className="space-y-1" title={others.length ? `다른 주소: ${others.join(", ")}` : undefined}>
      <p className="text-ink">폰이 연결되지 않았어요.</p>
      {best ? (
        <p>
          폰 크롬에서
          <code className="my-0.5 block w-fit max-w-full truncate rounded bg-field px-1.5 py-0.5 text-[11px] text-ink">{best}</code>
          을 열고 AR을 시작하세요.
        </p>
      ) : health ? (
        <p>폰에서 AR을 시작하세요.</p>
      ) : null}
    </div>
  );
}

/**
 * 폰 카메라 화면. H.264 표시 영상이 오면 canvas(일꾼이 그림), 아니면 MJPEG <img>. 첫 장이 오기 전에는 안내를 보인다.
 * 캡션은 2초마다 /api/eye/stats로 받은 장 수, 초점이 오면 그동안 주목 대상.
 */
function EyeBody({ health, focus, connected }: { health: HealthView | null; focus?: Focus | null; connected?: boolean | null }) {
  const live = !!health?.eye;
  const [src, setSrc] = useState(streamUrl);
  const [shown, setShown] = useState(false);
  const [mode, setMode] = useState<EyeMode>("jpeg");
  const [caption, setCaption] = useState(LIVE);
  const [focusText, setFocusText] = useState<string | null>(null);
  const modeRef = useRef<EyeMode>("jpeg");
  const videoBox = useRef<HTMLDivElement>(null);
  const img = useRef<HTMLImageElement>(null);
  const retry = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const wasConnected = useRef(connected);

  // 서버가 다시 떴으면(연결이 끊겼다 붙음) 끊긴 MJPEG 스트림도 다시 붙인다
  useEffect(() => {
    if (connected && wasConnected.current === false) setSrc(streamUrl());
    wasConnected.current = connected;
  }, [connected]);

  // H.264: canvas는 한 번만 일꾼에 넘길 수 있어서 붙일 때마다 새로 만든다
  useEffect(() => {
    const box = videoBox.current;
    if (!live || !box) return;
    const canvas = document.createElement("canvas");
    canvas.className = "h-full w-full object-contain";
    canvas.setAttribute("aria-label", "클로이드의 눈 실시간 영상");
    box.append(canvas);
    const video = attachEyeVideo({
      canvas,
      onMode: (m) => {
        modeRef.current = m;
        setMode(m);
        if (m === "video") setShown(true);
      },
    });
    return () => { video.close(); canvas.remove(); };
  }, [live]);

  // 스트림은 첫 장이 와야 크기가 생긴다(브라우저마다 load가 늦을 수 있어 크기로도 본다). 2초마다 받은 장 수로 캡션
  useEffect(() => {
    if (!live) return;
    const sized = setInterval(() => { if ((img.current?.naturalWidth ?? 0) > 0) setShown(true); }, 1000);
    const stats = setInterval(() => {
      api<EyeStats>("/api/eye/stats")
        .then((r) => {
          const s = r.json;
          if (!s?.ok) return;
          setCaption((modeRef.current === "video" && displayCaption(s.display)) || `${LIVE} ${s.fps ?? 0} fps${s.kb_per_frame ? ` · ${s.kb_per_frame}KB` : ""}`);
        })
        .catch(() => {});
    }, 2000);
    return () => { clearInterval(sized); clearInterval(stats); clearTimeout(retry.current); };
  }, [live]);

  useEffect(() => {
    if (!focus?.targets?.length) return;
    setFocusText(`클로이드 주목 · ${focus.targets.map((t) => t.label).join(", ")}`);
    const t = setTimeout(() => setFocusText(null), focus.ttl_ms ?? 8000);
    return () => clearTimeout(t);
  }, [focus]);

  return (
    <div className="px-3 pb-3 text-xs text-ink-dim">
      {live && (
        <figure hidden={!shown} className="m-0">
          <div className="relative h-56 overflow-hidden rounded-lg bg-black/60">
            <div ref={videoBox} hidden={mode !== "video"} className="absolute inset-0" />
            <img
              ref={img}
              src={src}
              alt="클로이드의 눈 실시간 화면"
              hidden={mode === "video"}
              className="absolute inset-0 h-full w-full object-contain"
              onLoad={() => setShown(true)}
              onError={() => { clearTimeout(retry.current); retry.current = setTimeout(() => setSrc(streamUrl()), 2000); }}
            />
          </div>
          <figcaption className="mt-1.5 truncate">{focusText ?? caption}</figcaption>
        </figure>
      )}
      {!shown && <Hint health={health} />}
    </div>
  );
}

/** 왼쪽 위 작은 유리 창. 접으면 머리줄만 남고 화면 받기를 멈춘다. */
export function EyeWindow({ health, focus, connected }: { health: HealthView | null; focus?: Focus | null; connected?: boolean | null }) {
  const [open, setOpen] = useState(true);
  return (
    <section aria-label="클로이드의 눈" className="glass absolute left-3 top-3 z-50 w-72 overflow-hidden text-ink">
      <header className="flex items-center gap-2 px-3 py-2">
        <Eye className="size-4 text-ink-dim" aria-hidden="true" />
        <h2 className="flex-1 text-sm font-medium">클로이드의 눈</h2>
        <button
          type="button"
          aria-label={open ? "눈 창 접기" : "눈 창 펴기"}
          aria-expanded={open}
          onClick={() => setOpen(!open)}
          className="flex size-7 items-center justify-center rounded-lg text-ink-dim transition-colors hover:bg-field hover:text-ink"
        >
          {open ? <ChevronUp className="size-4" aria-hidden="true" /> : <ChevronDown className="size-4" aria-hidden="true" />}
        </button>
      </header>
      {open && <EyeBody health={health} focus={focus} connected={connected} />}
    </section>
  );
}
