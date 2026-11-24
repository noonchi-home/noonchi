import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { BeforeAfterCard } from "../components/ui/before-after-card";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "../components/ui/alert-dialog";
import { Button } from "../components/ui/button";
import { CardTitle } from "../components/ui/card";
import { Input } from "../components/ui/input";
import { house } from "./house";
import { loadReferences, type ReferenceScene } from "./scenes";
import { savePhoto, type CapturePhoto, type PreparedPhoto, type ScanProgress, type ScanStore, type StorageLocation } from "./scan-storage";

interface ScanProps {
  store: ScanStore;
  capturePhoto: CapturePhoto;
  sceneId?: string;
  preferSaved?: boolean;
  onActivity: (activity: CaptureActivity) => void;
  onScene: (id: string) => void;
  onFinish: () => void;
  onSkip: () => void;
}

export type CaptureActivity = "idle" | "preparing" | "preview" | "saving";

export function ScanFlow({ store, capturePhoto, sceneId, preferSaved, onActivity, onScene, onFinish, onSkip }: ScanProps) {
  const [retry, setRetry] = useState(0);
  const [scenes, setScenes] = useState<ReferenceScene[]>([]);
  const [progress, setProgress] = useState<ScanProgress>({});
  const [error, setError] = useState(false);

  useEffect(() => {
    let live = true;
    Promise.all([loadReferences(house.id), store.list(house.id)]).then(([rows, saved]) => {
      if (!live) return;
      setScenes(rows);
      setProgress(saved);
    }).catch(() => { if (live) setError(true); });
    return () => { live = false; };
  }, [retry, store]);

  if (error) return <div className="grid gap-3">
    <p role="alert">기준 장면이나 촬영 기록을 불러오지 못했어요.</p>
    <Button onClick={() => { setError(false); setRetry(retry + 1); }}>다시 시도</Button>
  </div>;
  if (!scenes.length) return <p role="status">기준 장면과 촬영 기록을 불러오는 중이에요.</p>;

  const unfinished = scenes.findIndex((row) => !progress[row.id]);
  const chosen = scenes.findIndex((row) => row.id === sceneId);
  const saved = preferSaved ? scenes.findIndex((row) => progress[row.id]) : -1;
  const index = [chosen, saved, unfinished].find((candidate) => candidate >= 0) ?? 0;
  const scene = scenes[index]!;
  const count = scenes.filter((row) => progress[row.id]).length;
  const next = scenes[index + 1];

  return <div className="grid gap-4">
    <p aria-live="polite">촬영 {count} / {scenes.length}</p>
    <SceneCapture key={scene.id} scene={scene} saved={progress[scene.id]} store={store} capturePhoto={capturePhoto} onActivity={onActivity}
      onSave={(where) => {
        setProgress((current) => ({ ...current, [scene.id]: where }));
        onScene(scene.id);
      }}
      onPrevious={index > 0 ? () => onScene(scenes[index - 1]!.id) : undefined}
      onNext={next ? () => onScene(next.id) : undefined}
      onFinish={onFinish} onSkip={onSkip} />
  </div>;
}

interface PhotoPreview extends PreparedPhoto { url: string; capturedAt: string }

interface SceneCaptureProps {
  scene: ReferenceScene;
  saved?: StorageLocation;
  store: ScanStore;
  capturePhoto: CapturePhoto;
  onActivity: (activity: CaptureActivity) => void;
  onSave: (where: StorageLocation) => void;
  onPrevious?: () => void;
  onNext?: () => void;
  onFinish: () => void;
  onSkip: () => void;
}

function SceneCapture({ scene, saved, store, capturePhoto, onActivity, onSave, onPrevious, onNext, onFinish, onSkip }: SceneCaptureProps) {
  const input = useRef<HTMLInputElement>(null);
  const live = useRef(false);
  const operation = useRef(false);
  const [imageState, setImageState] = useState<"loading" | "ready" | "error">("loading");
  const [retry, setRetry] = useState(0);
  const [preview, setPreview] = useState<PhotoPreview>();
  const [busy, setBusy] = useState<"preparing" | "saving">();
  const [error, setError] = useState("");
  const [skipConfirm, setSkipConfirm] = useState(false);
  const activity: CaptureActivity = busy ?? (preview ? "preview" : "idle");
  useLayoutEffect(() => {
    onActivity(activity);
    return () => onActivity("idle");
  }, [activity, onActivity]);
  useEffect(() => {
    if (activity === "idle") return;
    function beforeUnload(event: BeforeUnloadEvent) {
      event.preventDefault();
      event.returnValue = "";
    }
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, [activity]);
  useEffect(() => {
    live.current = true;
    return () => { live.current = false; };
  }, []);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview.url); }, [preview]);

  async function take(file: File) {
    if (operation.current) return;
    operation.current = true;
    setError("");
    setBusy("preparing");
    try {
      const capturedAt = new Date().toISOString();
      const photo = await capturePhoto(file, scene);
      if (live.current) setPreview({ ...photo, capturedAt, url: URL.createObjectURL(file) });
    } catch {
      if (live.current) setError("사진을 열지 못했어요. 폰을 가로로 돌려 다시 찍어 주세요.");
    } finally {
      operation.current = false;
      if (live.current) setBusy(undefined);
    }
  }

  async function confirm() {
    if (!preview || operation.current) return;
    operation.current = true;
    setError("");
    setBusy("saving");
    try {
      const where = await savePhoto(house.id, scene, preview, preview.capturedAt, store);
      if (live.current) {
        onSave(where);
        setPreview(undefined);
      }
    } catch {
      if (live.current) setError("사진을 저장하지 못했어요. 사진 확인을 눌러 다시 시도해 주세요.");
    } finally {
      operation.current = false;
      if (live.current) setBusy(undefined);
    }
  }

  return <section aria-label="기준 사진 촬영" className="grid min-w-0 gap-4">
    <div className="flex items-start justify-between gap-2">
      <CardTitle>{[scene.name, scene.direction].filter(Boolean).join(" · ")}</CardTitle>
      <Button size="setup-sm" variant="ghost" className="min-h-11 shrink-0 px-2" disabled={!!busy}
        onClick={() => preview ? setSkipConfirm(true) : onSkip()}>건너뛰기</Button>
    </div>
    <p>같은 자리에 서서 폰을 가로로 들고 기준 뷰와 구도를 맞춰 주세요.</p>
    {preview
      ? <BeforeAfterCard beforeSrc={scene.image} afterSrc={preview.url} beforeAlt={scene.name + " 기준 뷰"} afterAlt="찍은 사진"
        width={scene.width} height={scene.height} />
      : <img key={retry} className="aspect-video w-full object-contain" src={scene.image} alt={scene.name + " 기준 뷰"}
        referrerPolicy="no-referrer" onLoad={() => setImageState("ready")} onError={() => setImageState("error")} />}
    {imageState === "error" && <div className="grid gap-2">
      <p role="alert">기준 뷰가 열리지 않았어요.</p>
      <Button variant="outline" onClick={() => { setImageState("loading"); setRetry(retry + 1); }}>기준 뷰 다시 열기</Button>
    </div>}
    {error && <p role="alert">{error}</p>}
    <div role="status">
      {busy === "preparing" ? "찍은 사진을 여는 중이에요."
        : busy === "saving" ? "사진을 저장하는 중이에요."
        : saved && !preview ? "저장 완료" : ""}
    </div>
    <Input ref={input} aria-label="기준 사진 파일" type="file" accept="image/*" capture="environment" tabIndex={-1}
      hidden disabled={!!busy || imageState === "error"} onChange={(event) => {
        const file = event.currentTarget.files?.[0];
        event.currentTarget.value = "";
        if (file) void take(file);
      }} />
    {preview
      ? <div className="grid gap-2 sm:grid-cols-2">
        <Button size="setup-sm" variant="outline" disabled={!!busy} onClick={() => {
          setPreview(undefined);
          setError("");
          input.current?.click();
        }}>다시 찍기</Button>
        <Button size="setup-sm" disabled={!!busy} onClick={() => void confirm()}>사진 확인</Button>
        <Button size="setup-sm" variant="ghost" disabled={!!busy} onClick={() => {
          setPreview(undefined);
          setError("");
        }}>사진 지우기</Button>
      </div>
      : saved
        ? <div role="group" aria-label="저장한 장면" className="flex items-center justify-between gap-2">
          <Button size="setup-sm" variant="outline" className="min-h-11 px-3" disabled={!!busy || imageState !== "ready"}
            onClick={() => input.current?.click()}>다시 찍기</Button>
          <Button size="setup-sm" className="min-h-11 px-3" disabled={!!busy}
            onClick={onNext ?? onFinish}>{onNext ? "다음 장면" : "완료"}</Button>
        </div>
        : <Button size="setup" disabled={!!busy || imageState !== "ready"} onClick={() => input.current?.click()}>기준 사진 찍기</Button>}
    {!saved && (onPrevious || onNext) && <div className="flex flex-wrap gap-2">
      {onPrevious && <Button size="setup-sm" variant="outline" disabled={!!busy || !!preview} onClick={onPrevious}>이전 장면</Button>}
      {onNext && <Button size="setup-sm" variant="outline" disabled>다음 장면</Button>}
    </div>}
    <AlertDialog open={skipConfirm} onOpenChange={setSkipConfirm}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>저장하지 않은 사진을 지울까요?</AlertDialogTitle>
          <AlertDialogDescription>이미 저장한 사진은 남아요.</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>계속 비교하기</AlertDialogCancel>
          <AlertDialogAction onClick={onSkip}>지우고 건너뛰기</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </section>;
}
