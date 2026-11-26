import { useCallback, useEffect, useRef, useState } from "react";
import { Alert, AppState, BackHandler, Image, Linking, StyleSheet, View } from "react-native";
import { CameraView, useCameraPermissions } from "expo-camera";
import type { SetupView } from "../../src/contract/setup";
import type { SceneJson } from "../../src/contract/layout";
import { Action, Choice, Copy, Failure, Field, Heading, Loading, Panel, colors, useResource, useTask } from "./ConnectedUi";
import { ConnectedPlan } from "./ConnectedPlan";
import { confirmConnectedHouse, connectedHouse, matchesConnectedHouse, prepareConnectedHouse, type ConnectedHub } from "./connected-hub";
import { readReferenceScenes, saveReferencePhoto, selectScanScene, type NativePhoto, type ReferenceScene, type SavedPhoto } from "./connected-scan";
import { prepareNativePhoto, removeTemporary, type ConnectedStore } from "./connected-storage";

type Page = "root" | "review" | "building" | "preview" | "floor" | "scan";
const twinFloor = require("./assets/mokryeon-plan.png");
const twinPreview = require("./assets/mokryeon-twin-overview.webp");

export function ConnectedHouse({ hub, setup, home, store, onBlock, onBuilding, onChooseHouse, onRegistered, onHome }: {
  hub: ConnectedHub; setup: SetupView; home: SetupView["home"]; store: ConnectedStore;
  onBuilding: (building: boolean) => void; onChooseHouse: () => void;
  onBlock: (block: boolean) => void; onRegistered: (value: SetupView) => void; onHome: () => void;
}) {
  const [page, setPage] = useState<Page>("root");
  const [query, setQuery] = useState("");
  const [reviewSaved, setReviewSaved] = useState(false);
  const [preview, setPreview] = useState<"loading" | "ready" | "error">("loading");
  const [previewTry, retryPreview] = useState(0);
  const task = useTask();
  const matches = matchesConnectedHouse(query) && setup.homes.some(candidate => candidate.id === connectedHouse.id);
  const begin = (review: boolean) => { setReviewSaved(review); setPage("scan"); };
  useEffect(() => { if (page !== "scan") onBlock(page === "building" || task.busy); }, [task.busy, page, onBlock]);
  useEffect(() => { onBuilding(page === "building"); return () => onBuilding(false); }, [page, onBuilding]);
  useEffect(() => {
    if (page !== "building" && !(page === "preview" && task.busy)) return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => true);
    return () => sub.remove();
  }, [page, task.busy]);
  useEffect(() => () => onBlock(false), [onBlock]);

  if (page === "review") return <PlanReview hub={hub} onBack={() => setPage("root")} busy={task.busy} error={task.error} onApprove={() => {
    void task.run(async () => {
      setPage("building");
      try {
        await prepareConnectedHouse(hub, setup);
        setPreview("loading");
        setPage("preview");
      } catch (error) {
        setPage("review");
        throw error;
      }
    });
  }} />;
  if (page === "building") return <View style={styles.building}><Loading>트윈 제작 중</Loading></View>;
  if (page === "preview") return <Panel>
    <Heading>트윈 미리보기</Heading>
    <Image key={previewTry} source={twinPreview} resizeMode="contain" style={styles.overview}
      accessibilityLabel={connectedHouse.name + " 트윈 조감도"}
      onLoad={() => setPreview("ready")} onError={() => setPreview("error")} />
    {preview === "error" && <>
      <Failure>트윈 미리보기를 열지 못했어요.</Failure>
      <Action title="다시 불러오기" secondary onPress={() => { setPreview("loading"); retryPreview(n => n + 1); }} />
    </>}
    <Failure>{task.error}</Failure>
    <Action title="확인" disabled={preview !== "ready" || task.busy} onPress={() => void task.run(async () => {
      const next = await confirmConnectedHouse(hub, store.remember);
      onRegistered(next);
      begin(false);
    })} />
    <Action title="주소 다시 확인" secondary disabled={task.busy} onPress={() => setPage("review")} />
  </Panel>;
  if (page === "floor" && home) return home.id === connectedHouse.id
    ? <PlanReview hub={hub} onBack={() => setPage("root")} />
    : <SavedFloor hub={hub} name={home.name} onBack={() => setPage("root")} />;
  if (page === "scan" && home) return <ScanScenes key={home.id} hub={hub} home={home.id} store={store} review={reviewSaved}
    onBack={() => setPage("root")} onFinish={onHome} onBlock={onBlock} />;

  return <Panel>
    <Heading>{home?.name ?? "우리 집 찾기"}</Heading>
    {home ? <>
      {home.id === connectedHouse.id && <Copy>{connectedHouse.address}</Copy>}
      <Choice title="평면도 보기" onPress={() => setPage("floor")} />
      <Choice title="기준 사진 이어 찍기" onPress={() => begin(false)} />
      <Choice title="저장한 기준 사진 보기·다시 찍기" onPress={() => begin(true)} />
      <Choice title="허브의 집 고르기" onPress={onChooseHouse} />
    </> : <>
      <Field label="단지명 또는 도로명 주소" value={query} onChangeText={setQuery} placeholder="예: 한양목련" />
      {matches ? <Choice title={connectedHouse.name} value={connectedHouse.address} onPress={() => { task.setError(""); setPage("review"); }} />
        : <Copy>{query.trim().length >= 2 ? "등록할 수 있는 집을 찾지 못했어요." : "등록할 집의 단지명이나 도로명 주소를 입력해 주세요."}</Copy>}
      {setup.homes.length > 0 && <Choice title="허브의 집 고르기" onPress={onChooseHouse} />}
    </>}
  </Panel>;
}

function PlanReview({ hub, busy = false, error = "", onBack, onApprove }: {
  hub: ConnectedHub; busy?: boolean; error?: string; onBack: () => void; onApprove?: () => void;
}) {
  const [image, setImage] = useState<"loading" | "ready" | "twin">("loading");
  return <Panel>
    <Heading>{onApprove ? "이 도면이 맞나요?" : "평면도"}</Heading>
    <Copy>{connectedHouse.name} · {connectedHouse.address}</Copy>
    <Image source={image === "twin" ? twinFloor : { uri: hub.url(connectedHouse.floorPlan) }}
      accessibilityLabel={image === "twin" ? "한양목련 180B 트윈 평면도" : "한양목련 180B 공개 평면도"}
      style={styles.floor} resizeMode="contain" onLoad={() => setImage(previous => previous === "twin" ? previous : "ready")}
      onError={() => setImage("twin")} />
    {image === "loading" ? <Loading>공개 평면도를 불러오는 중이에요.</Loading>
      : <Copy>{image === "twin" ? "간략 평면도" : "KB부동산 공개 도면"}</Copy>}
    <Failure>{error}</Failure>
    {onApprove && <Action title={busy ? "트윈을 준비하고 있어요" : "이 도면이 맞아요"} onPress={onApprove} disabled={busy || image === "loading"} />}
    <Action title={onApprove ? "다른 주소 찾기" : "우리 집으로"} onPress={onBack} disabled={busy} secondary />
  </Panel>;
}

function SavedFloor({ hub, name, onBack }: { hub: ConnectedHub; name: string; onBack: () => void }) {
  const read = useCallback((signal: AbortSignal) => hub.get<{ scene: SceneJson }>("/api/scene", signal), [hub]);
  const source = useResource(read);
  return <Panel><Heading>{name} 평면도</Heading>
    {source.value ? <ConnectedPlan scene={source.value.scene} /> : source.error ? <>
      <Failure>{source.error}</Failure><Action title="다시 불러오기" onPress={source.refresh} secondary />
    </> : <Loading />}
    <Action title="우리 집으로" onPress={onBack} secondary />
  </Panel>;
}

function ScanScenes({ hub, home, review, store, onBack, onFinish, onBlock }: {
  hub: ConnectedHub; home: string; review: boolean; store: ConnectedStore; onBack: () => void; onFinish: () => void; onBlock: (block: boolean) => void;
}) {
  const read = useCallback(async (signal: AbortSignal) => {
    if (!/^[A-Za-z0-9_-]+$/.test(home)) throw new Error("집 번호를 확인해 주세요.");
    const [data, photos] = await Promise.all([hub.get<unknown>(`/api/homes/${home}/scenes`, signal), store.list(home)]);
    const rows = readReferenceScenes(hub, home, data);
    if (!rows.length) throw new Error("이 집의 기준 장면이 없어요.");
    return { rows, photos };
  }, [hub, home, store]);
  const resource = useResource(read);
  const [selection, setSelection] = useState<number>();
  const [added, setAdded] = useState<Record<string, SavedPhoto>>({});
  if (!resource.value) return <Panel><Heading>집 스캔</Heading>{resource.error ? <>
    <Failure>{resource.error}</Failure><Action title="다시 불러오기" onPress={resource.refresh} />
  </> : <Loading>기준 장면과 촬영 기록을 불러오는 중이에요.</Loading>}
  <Action title="우리 집으로" onPress={onBack} secondary /></Panel>;

  const { rows } = resource.value;
  const photos = { ...resource.value.photos, ...added };
  const index = selection ?? selectScanScene(rows, photos, review);
  const scene = rows[index] ?? rows[0]!;
  const count = rows.filter(item => Object.hasOwn(photos, item.id)).length;
  return <Panel><Heading>집 스캔</Heading><Copy>촬영 {count} / {rows.length}</Copy>
    <SceneCapture key={scene.id} scene={scene} saved={Object.hasOwn(photos, scene.id) ? photos[scene.id] : undefined} hub={hub} home={home} store={store}
      review={review} onBlock={onBlock} onBack={onBack} onFinish={onFinish}
      onPrevious={index > 0 ? () => setSelection(index - 1) : undefined} onNext={index + 1 < rows.length ? () => setSelection(index + 1) : undefined}
      onSaved={photo => { setSelection(index); setAdded(current => ({ ...current, [scene.id]: photo })); }} />
  </Panel>;
}

function SceneCapture({ scene, saved, review, hub, home, store, onBlock, onSaved, onBack, onFinish, onPrevious, onNext }: {
  scene: ReferenceScene; saved?: SavedPhoto; review: boolean; hub: ConnectedHub; home: string; store: ConnectedStore;
  onBlock: (block: boolean) => void; onSaved: (value: SavedPhoto) => void; onBack: () => void;
  onFinish: () => void; onPrevious?: () => void; onNext?: () => void;
}) {
  const task = useTask();
  const [permission, requestPermission] = useCameraPermissions();
  const camera = useRef<CameraView>(null);
  const alive = useRef(true);
  const cached = useRef<string | undefined>(undefined);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [ready, setReady] = useState(false);
  const [guide, setGuide] = useState(false);
  const [photo, setPhoto] = useState<NativePhoto>();
  const [showPhoto, setShowPhoto] = useState(review && !!saved);
  const [imageStatus, setImageStatus] = useState<"loading" | "ready" | "error">("loading");
  const [retry, setRetry] = useState(0);

  useEffect(() => { onBlock(task.busy || cameraOpen || !!photo); }, [cameraOpen, onBlock, photo, task.busy]);
  useEffect(() => () => onBlock(false), [onBlock]);
  useEffect(() => {
    alive.current = true;
    const activity = AppState.addEventListener("change", state => { if (state !== "active") setCameraOpen(false); });
    return () => { alive.current = false; activity.remove(); if (cached.current) void removeTemporary(cached.current); };
  }, []);

  function openCamera() {
    void task.run(async () => {
      let allowed = permission;
      if (!allowed?.granted) {
        if (allowed?.canAskAgain === false) { await Linking.openSettings(); return; }
        allowed = await requestPermission();
      }
      if (!allowed.granted) throw new Error("기준 사진을 찍으려면 카메라 권한이 필요해요.");
      setReady(false); setGuide(false); setCameraOpen(true);
    });
  }
  async function discard() {
    if (cached.current) await removeTemporary(cached.current);
    cached.current = undefined; setPhoto(undefined); setShowPhoto(false); task.setError("");
  }
  const preview = photo?.uri ?? saved?.uri;
  const blocked = task.busy || cameraOpen || !!photo;
  function skip() {
    if (task.busy || cameraOpen) return;
    if (!photo) { onBack(); return; }
    Alert.alert("저장하지 않은 사진을 지울까요?", "이미 저장한 사진은 남아요.", [
      { text: "계속 비교하기", style: "cancel" },
      { text: "지우고 건너뛰기", style: "destructive", onPress: () => { void discard().then(onBack); } },
    ]);
  }
  return <>
    <View style={styles.scanHeading}>
      <View style={styles.scanTitle}><Heading>{[scene.name, scene.direction].filter(Boolean).join(" · ")}</Heading></View>
      <Action title="건너뛰기" disabled={task.busy || cameraOpen} onPress={skip} secondary />
    </View>
    <Copy>같은 자리에 서서 폰을 가로로 들고 기준 뷰와 구도를 맞춰 주세요.</Copy>
    {cameraOpen ? <><View style={[styles.camera, { aspectRatio: scene.width / scene.height }]}>
      <CameraView ref={camera} style={StyleSheet.absoluteFill} facing="back" mode="picture" onCameraReady={() => setReady(true)}
        onMountError={() => { setCameraOpen(false); task.setError("카메라를 열지 못했어요."); }} />
      {guide && <View pointerEvents="none" style={StyleSheet.absoluteFill}>
        <Image source={{ uri: scene.image }} accessible={false}
          style={[StyleSheet.absoluteFill, styles.guide]} resizeMode="contain" />
      </View>}
    </View><Choice title="기준 뷰 겹쳐 보기" selected={guide} onPress={() => setGuide(value => !value)} /></> : <>
      <Image key={`reference-${retry}`} source={{ uri: scene.image }} accessibilityLabel={`${scene.name} 기준 뷰`}
        style={[styles.reference, { aspectRatio: scene.width / scene.height }, showPhoto && preview ? styles.hidden : null]} resizeMode="contain"
        onLoad={() => setImageStatus("ready")} onError={() => setImageStatus("error")} />
      {showPhoto && preview && <Image source={{ uri: preview }} accessibilityLabel={photo ? "찍은 사진" : "이 폰에 저장한 사진"}
        style={[styles.reference, { aspectRatio: scene.width / scene.height }]} resizeMode="contain" />}
      {preview && <Choice title={showPhoto ? "기준 뷰 보기" : photo ? "찍은 사진 보기" : "저장한 사진 보기"} onPress={() => setShowPhoto(value => !value)} />}
      {imageStatus === "error" && <><Failure>기준 뷰가 열리지 않았어요.</Failure><Action title="기준 뷰 다시 열기" onPress={() => { setImageStatus("loading"); setRetry(n => n + 1); }} secondary /></>}
    </>}
    <Failure>{task.error}</Failure>
    {saved && !photo && !task.busy && <Copy>저장 완료</Copy>}
    {cameraOpen ? <>
      <Action title="찍기" disabled={!ready || task.busy} onPress={() => void task.run(async () => {
        const capturedAt = new Date().toISOString();
        const input = await camera.current?.takePictureAsync({ quality: 0.92 });
        if (!input) throw new Error("사진을 찍지 못했어요. 다시 시도해 주세요.");
        const result = { ...await prepareNativePhoto(input, scene), capturedAt };
        if (!alive.current) { await removeTemporary(result.uri); return; }
        cached.current = result.uri; setPhoto(result); setCameraOpen(false); setShowPhoto(true);
      })} />
      <Action title="카메라 닫기" disabled={task.busy} onPress={() => setCameraOpen(false)} secondary />
    </> : photo ? <>
      <Action title={task.busy ? "사진을 저장하는 중이에요" : "사진 확인"} disabled={task.busy} onPress={() => void task.run(async () => {
        const savedPhoto = await saveReferencePhoto(hub, home, scene, photo, store);
        onSaved(savedPhoto); await discard();
      })} />
      <Action title="사진 지우기" disabled={task.busy} onPress={() => void discard()} secondary />
    </> : saved ? <View style={styles.savedActions}>
      <Action title="다시 찍기" secondary onPress={openCamera} disabled={task.busy || imageStatus !== "ready"} />
      <Action title={onNext ? "다음 장면" : "완료"} onPress={onNext ?? onFinish} disabled={task.busy} />
    </View> : <Action title="기준 사진 찍기" onPress={openCamera} disabled={task.busy || imageStatus !== "ready"} />}
    {!saved && onPrevious && <Action title="이전 장면" onPress={onPrevious} disabled={blocked} secondary />}
  </>;
}

const styles = StyleSheet.create({
  building: { flex: 1, minHeight: 240, alignItems: "center", justifyContent: "center" },
  overview: { width: "100%", aspectRatio: 1200 / 960 },
  scanHeading: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 8 },
  scanTitle: { flex: 1 },
  savedActions: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  floor: { width: "100%", height: 300, backgroundColor: colors.white, borderRadius: 7 },
  camera: { width: "100%", minHeight: 140, backgroundColor: colors.ink, borderRadius: 8, overflow: "hidden" },
  guide: { width: "100%", height: "100%", opacity: 0.42 },
  reference: { width: "100%", backgroundColor: colors.white, borderRadius: 8 }, hidden: { display: "none" },
});
