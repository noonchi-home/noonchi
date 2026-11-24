import { useCallback, useEffect, useEffectEvent, useRef, useState } from "react";
import { LoaderCircle } from "lucide-react";
import { MOKRYEON_TWIN_PREVIEW, waitForTwinPreview } from "../../../src/contract/mobile-home";
import { PhoneHomePeek, PhoneLaunchHero, PhonePortalHeader, PhonePortalNav, type PhonePortalTab } from "../components/phone-portal-chrome";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { SearchInput } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { OnboardingStepper } from "../components/ui/onboarding-stepper";
import { StatusCard } from "../components/ui/status-card";
import { pickPhoneUrl } from "../lib/phone-url";
import { PhoneApp, usePhonePortal } from "../phone";
import { FloorReview } from "./FloorReview";
import { HomeDetails } from "./HomeDetails";
import { activeTwin, house, isHouseAddress, matchesHouse, setupHome } from "./house";
import { PostcodeSearch } from "./PostcodeSearch";
import { ScanFlow, type CaptureActivity } from "./ScanFlow";
import { phoneScanStore, preparePhoto, type CapturePhoto, type ScanStore } from "./scan-storage";
import { firstMobileLaunch, markMobileLaunched, readAddressDraft, rememberAddressDraft, requestedTab,
  type AddressDraft, type RegisteredTab } from "./navigation";

type ReadyStage = RegisteredTab | "saved-floor";
type SetupStage = "search" | "floor" | "prepare" | "preview";
type Stage = SetupStage | ReadyStage | "unregistered-home";
type Resume = {
  home: string; stage: "home" | "scan"; sceneId?: string; firstScanPending?: boolean; homeIntroPending?: boolean; preferSaved?: boolean;
};
const storageKey = "noonchi-mobile-home";

function readResume(): Resume | null {
  try {
    const value = JSON.parse(localStorage.getItem(storageKey) ?? "null") as Partial<Resume> | null;
    if (value?.home === house.id && (value.stage === "scan" || value.stage === "home")) {
      return {
        home: house.id, stage: value.stage, firstScanPending: value.firstScanPending === true,
        homeIntroPending: value.homeIntroPending === true, preferSaved: value.preferSaved === true,
        sceneId: typeof value.sceneId === "string" ? value.sceneId : undefined,
      };
    }
  } catch { /* Storage is optional for navigation during this visit. */ }
  return null;
}

function routeOf(state: unknown, resume: Resume | null, draft: AddressDraft): Stage {
  const route = (state as { noonchiMobile?: Stage } | null)?.noonchiMobile;
  const tab = requestedTab();
  if (!resume) {
    if (tab !== "house" && tab !== "scan") return "unregistered-home";
    if (route === "search" || route === "floor") return route;
    return draft.review ? "floor" : "search";
  }
  if (route === "search" || route === "floor") return route;
  if (resume.firstScanPending || route === "prepare") return "prepare";
  if (tab === "house" && route === "saved-floor") return route;
  if (!tab && route === "unregistered-home") return "home";
  return tab ?? (route === "scan" || route === "home" || route === "house" ? route : resume.stage);
}

const titles: Record<SetupStage | "scan", string> = {
  search: "우리 집 찾기", floor: "이 도면이 맞나요?", prepare: "트윈 제작 중", preview: "트윈 미리보기", scan: "집 스캔",
};
const steps = ["집 찾기", "평면도 확인", "집 스캔"] as const;
const stepOf = { search: 0, floor: 1, prepare: 2, preview: 2, scan: 2 } as const;

interface MobileProps { store?: ScanStore; capturePhoto?: CapturePhoto }
type HubState = "loading" | "available" | "unavailable" | "error";

export function MobileApp({ store = phoneScanStore, capturePhoto = preparePhoto }: MobileProps) {
  const [resume, setResume] = useState(readResume);
  const [draft, setDraft] = useState(readAddressDraft);
  const [stage, setStage] = useState<Stage>(() => routeOf(history.state, resume, draft));
  const [launching, setLaunching] = useState(firstMobileLaunch);
  const [hub, setHub] = useState<HubState>("loading");
  const [connection, setConnection] = useState<Awaited<ReturnType<typeof activeTwin>> | null>(null);
  const [problem, setProblem] = useState<{ otherHome?: string }>();
  const [previewImage, setPreviewImage] = useState<"loading" | "ready" | "error">("loading");
  const [previewTry, setPreviewTry] = useState(0);
  const confirming = useRef(false);
  const [checkingPreview, setCheckingPreview] = useState(false);
  const [tabWarning, setTabWarning] = useState("");
  const navigation = useRef(stage);
  const registration = useRef(resume);
  const addressDraft = useRef(draft);
  const browserEntry = useRef({ url: location.href, state: history.state });
  const captureActivity = useRef<CaptureActivity>("idle");
  const cameraEntry = useRef(false);
  const request = useRef(0);

  const finishLaunch = useCallback(() => setLaunching(false), []);
  const homeCanRefreshInPlace = useEffectEvent(() => stage === "home" && connection !== null);
  useEffect(() => {
    if (!launching) return;
    markMobileLaunched();
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      const timer = window.setTimeout(finishLaunch, 120);
      return () => window.clearTimeout(timer);
    }
  }, [finishLaunch, launching]);

  const updateDraft = useCallback((change: Partial<AddressDraft>) => {
    const next = { ...addressDraft.current, ...change };
    addressDraft.current = next;
    setDraft(next);
    rememberAddressDraft(next);
  }, []);

  const remember = useCallback((value: Resume) => {
    registration.current = value;
    setResume(value);
    try { localStorage.setItem(storageKey, JSON.stringify(value)); } catch { /* Continue in memory. */ }
  }, []);

  const enterHome = useCallback((value: Resume) => {
    remember({ ...value, stage: "home", homeIntroPending: false });
    if (value.homeIntroPending) setLaunching(true);
  }, [remember]);

  const move = useCallback((next: Stage, mode: "push" | "replace" | "pop" = "push", target?: RegisteredTab) => {
    if (navigation.current !== next || next !== "prepare") request.current++;
    if (mode !== "pop") {
      const state = { ...history.state, noonchiMobile: next };
      const url = new URL(location.href);
      const destination = target ?? (next === "saved-floor" ? "house" : next === "home" || next === "house" || next === "scan" ? next : null);
      if (destination) url.searchParams.set("tab", destination);
      if (mode === "push") history.pushState(state, "", url);
      else history.replaceState(state, "", url);
    }
    browserEntry.current = { url: location.href, state: history.state };
    navigation.current = next;
    setStage(next);
    if (next === "search" || next === "floor") updateDraft({ review: next === "floor" });
  }, [updateDraft]);

  const captureChanged = useCallback((activity: CaptureActivity) => {
    captureActivity.current = activity;
    setTabWarning("");
  }, []);

  const canLeave = useCallback(() => {
    const activity = captureActivity.current;
    if (activity === "idle") return true;
    setTabWarning(activity === "preview" ? "사진을 확인하거나 지운 뒤 탭을 이동해 주세요."
      : activity === "saving" ? "사진 저장이 끝난 뒤 탭을 이동해 주세요."
        : "찍은 사진을 연 뒤 탭을 이동해 주세요.");
    return false;
  }, []);

  const checkHub = useCallback(async () => {
    const id = ++request.current;
    setHub("loading");
    try {
      const setup = await setupHome();
      if (id === request.current) setHub(setup.homes.some((home) => home.id === house.id) ? "available" : "unavailable");
    } catch {
      if (id === request.current) setHub("error");
    }
  }, []);

  const prepare = useCallback(async (target: ReadyStage, approvedNow = false) => {
    const id = ++request.current;
    const started = Date.now();
    setProblem(undefined);
    setConnection(null);
    function notReady(otherHome?: string) {
      if (id !== request.current) return;
      if (navigation.current !== "prepare") move("prepare", "replace");
      setProblem({ otherHome });
    }
    try {
      const setup = await setupHome(approvedNow);
      if (id !== request.current) return;
      if (setup.switching || setup.home?.id !== house.id) {
        notReady(setup.home?.id !== house.id ? setup.home?.name : undefined);
        return;
      }
      const active = await activeTwin();
      if (id !== request.current) return;
      const registered = registration.current;
      if (registered?.firstScanPending) {
        await waitForTwinPreview(started);
        if (id !== request.current) return;
        const current = await setupHome();
        if (id !== request.current) return;
        if (current.switching || current.home?.id !== house.id) { notReady(current.home?.name); return; }
        setPreviewImage("loading");
        setConnection(active);
        move("preview", "replace");
        return;
      }
      const destination = navigation.current === "prepare" ? requestedTab() ?? target : target;
      setConnection(active);
      const resumeStage = destination === "home" || destination === "scan" ? destination : registered?.stage ?? "home";
      const ready: Resume = { ...registered, home: house.id, stage: resumeStage, firstScanPending: false };
      if (destination === "home") enterHome(ready);
      else remember(ready);
      if (navigation.current === "prepare") move(destination, "replace");
    } catch {
      notReady();
    }
  }, [enterHome, move, remember]);

  useEffect(() => {
    function restore(next: Stage) {
      if (next === "unregistered-home") return;
      if (next === "search" || next === "floor") void checkHub();
      else void prepare(next === "prepare" || next === "preview" ? requestedTab() ?? registration.current?.stage ?? "scan" : next);
    }
    if (!history.state?.noonchiMobile) history.replaceState({ ...history.state, noonchiMobile: navigation.current }, "");
    browserEntry.current = { url: location.href, state: history.state };
    restore(navigation.current);
    function onPop(event: PopStateEvent) {
      if (cameraEntry.current) {
        cameraEntry.current = false;
        browserEntry.current = { url: location.href, state: history.state };
        return;
      }
      if (!canLeave()) {
        const entry = browserEntry.current;
        history.pushState(entry.state, "", entry.url);
        return;
      }
      const next = routeOf(event.state, registration.current, addressDraft.current);
      move(next, "pop");
      restore(next);
    }
    function onPageShow(event: PageTransitionEvent) {
      if (event.persisted && captureActivity.current === "idle" && !homeCanRefreshInPlace()) restore(navigation.current);
    }
    window.addEventListener("popstate", onPop);
    window.addEventListener("pageshow", onPageShow);
    return () => {
      request.current++;
      window.removeEventListener("popstate", onPop);
      window.removeEventListener("pageshow", onPageShow);
    };
  }, [canLeave, checkHub, move, prepare]);

  function approve() {
    if (navigation.current !== "floor" || hub !== "available") return;
    const registered = registration.current;
    remember({ ...registered, home: house.id, stage: "scan", firstScanPending: true,
      homeIntroPending: !registered || registered.homeIntroPending === true });
    move("prepare", "push", "scan");
    void prepare("scan", true);
  }

  function backToSearch() {
    move("search");
    void checkHub();
  }

  async function confirmTwin() {
    const registered = registration.current;
    if (!registered?.firstScanPending || navigation.current !== "preview" || previewImage !== "ready" || confirming.current) return;
    confirming.current = true;
    setCheckingPreview(true);
    const id = ++request.current;
    try {
      const setup = await setupHome();
      if (id !== request.current) return;
      if (setup.switching || setup.home?.id !== house.id) throw new Error("집이 바뀌었어요.");
      remember({ ...registered, stage: "scan", firstScanPending: false });
      move("scan", "replace");
    } catch {
      if (id === request.current) {
        move("prepare", "replace");
        setProblem({});
      }
    } finally {
      confirming.current = false;
      setCheckingPreview(false);
    }
  }

  function startRegistration(next: "search" | "floor" = "search") {
    move(next, "push", "house");
    void checkHub();
  }

  function continueAt(next: ReadyStage, retake = false) {
    if (navigation.current === next) return;
    const registered = registration.current;
    if (next === "home" && connection && registered) enterHome(registered);
    if (next === "scan") {
      remember({ ...registered, home: house.id, stage: next, ...(retake ? { sceneId: undefined, preferSaved: true } : {}) });
    }
    move(next);
    if (!connection) void prepare(next);
  }

  function finishScan() {
    const registered = registration.current;
    if (!registered) return;
    enterHome({ ...registered, preferSaved: false });
    move("home");
  }

  function selectTab(next: PhonePortalTab) {
    if (!canLeave()) return;
    if (next === "settings") {
      location.assign("/mobile/settings/");
      return;
    }
    const target = next === "home" ? "home" : "house";
    const current = navigation.current;
    if (!registration.current) {
      if (target === "home" && current !== "unregistered-home") move("unregistered-home", "push", "home");
      if (target === "house" && current === "unregistered-home") startRegistration(addressDraft.current.review ? "floor" : "search");
      return;
    }
    if (current === "preview") return;
    if (current === "search" || current === "floor" || current === "prepare") {
      if (requestedTab() === target) return;
      move(current, "push", target);
      if (current !== "prepare" && hub === "loading") void checkHub();
    } else continueAt(target);
  }

  const chooseAddress = useCallback((address: string) => {
    updateDraft({ query: address, addressPicked: true });
  }, [updateDraft]);
  const { query, addressPicked } = draft;
  const hasFloor = addressPicked ? isHouseAddress(query) : matchesHouse(query);
  const candidate = hub === "available" && hasFloor;
  const directPhone = connection && pickPhoneUrl(connection.phoneUrls).best;
  const { phone, view: cameraView } = usePhonePortal(stage === "home" && !launching && connection?.portalCamera === true);
  useEffect(() => {
    if (cameraView?.ar && !cameraEntry.current) {
      history.pushState({ ...history.state, noonchiCamera: true }, "", location.href);
      cameraEntry.current = true;
    } else if (!cameraView?.ar && cameraEntry.current && history.state?.noonchiCamera) {
      history.back();
    }
  }, [cameraView?.ar]);
  const support = cameraView?.support.kind ?? "checking";
  const canStart = phone !== null && !cameraView?.ar && (support === "ready" || support === "failed");
  const cameraFailed = support === "failed";
  const fallbackPhone = !connection?.portalCamera || support === "insecure" ? directPhone : null;
  const cameraStatus = {
    checking: "카메라 지원을 확인하는 중이에요.",
    starting: "카메라를 여는 중이에요.",
    insecure: "카메라를 켜려면 HTTPS 주소로 열어 주세요.",
    "no-ar": "AR을 지원하는 안드로이드 크롬에서 열어 주세요.",
    ready: null,
    failed: "카메라를 열지 못했어요.",
  }[support];
  const homeStatus = !connection ? "허브의 집을 확인하는 중이에요."
    : connection.portalCamera ? cameraStatus
      : directPhone ? "기존 카메라 페이지에서 지원 여부를 확인해 주세요." : "카메라 연결 주소가 아직 없어요.";
  const homeTab = stage === "home" || stage === "unregistered-home";
  const pageClass = stage === "home" ? "phone-portal-page phone-portal-page--home phone-portal-page--registered-home"
    : homeTab ? "phone-portal-page phone-portal-page--home" : "phone-portal-page";
  if (launching) return <PhoneLaunchHero onDone={finishLaunch} />;
  if (stage === "prepare" && resume?.firstScanPending && !problem) return <main
    className="grid min-h-dvh place-content-center justify-items-center gap-4 p-4" aria-live="polite">
    <LoaderCircle className="size-9 animate-spin motion-reduce:animate-none" aria-hidden="true" />
    <h1>{titles.prepare}</h1>
  </main>;
  return <>
    {phone && <PhoneApp controller={phone} onExit={phone.stopAr} />}
    <div className={pageClass} hidden={cameraView?.ar}>
    <PhonePortalHeader />
    <main className="mx-auto grid w-full max-w-2xl gap-4 p-4 sm:p-6">
      {tabWarning && <p role="alert">{tabWarning}</p>}
      {stage === "unregistered-home" ? <Card>
        <CardHeader><StatusCard title="우리 집" tone="plain" live="등록한 집이 없어요." /></CardHeader>
        <CardContent>
          <Button type="button" size="setup" className="w-full" onClick={() => startRegistration()}>우리 집 등록하기</Button>
        </CardContent>
      </Card> : stage === "home" ? <Card>
        <CardHeader><CardTitle size="md">{house.name}</CardTitle></CardHeader>
        <CardContent className="grid gap-3">
          {connection ? <HomeDetails /> : <p role="status">{homeStatus}</p>}
          <Button type="button" size="setup" disabled={!canStart} onClick={() => phone?.actions.startAr()}>클로이드 켜기</Button>
          {connection && homeStatus && <p role="status">{homeStatus}</p>}
          {cameraFailed && <p role="alert">브라우저에서 카메라 권한을 확인해 주세요. 다른 탭에서 카메라를 켰다면 먼저 꺼 주세요.</p>}
          {fallbackPhone && <Button asChild variant="link" className="w-fit"><a href={fallbackPhone}>기존 카메라 페이지 열기</a></Button>}
        </CardContent>
      </Card> : stage === "house" ? <Card>
        <CardHeader><CardTitle size="md">{house.name}</CardTitle></CardHeader>
        <CardContent className="grid gap-3">
          <p>{house.address}</p>
          <Button size="setup-sm" variant="outline" onClick={() => continueAt("saved-floor")}>평면도 보기</Button>
          <Button size="setup-sm" onClick={() => continueAt("scan")}>스캔 이어가기</Button>
          <Button size="setup-sm" variant="outline" onClick={() => continueAt("scan", true)}>기준 사진 다시 찍기</Button>
          <Button asChild size="setup-sm" variant="outline"><a href="/mobile/settings/#home">허브의 집 고르기</a></Button>
        </CardContent>
      </Card> : stage === "saved-floor" ? <Card>
        <CardHeader><CardTitle size="md">{house.name} 평면도</CardTitle></CardHeader>
        <CardContent><FloorReview onBack={() => history.back()} /></CardContent>
      </Card> : <>
      <OnboardingStepper steps={steps} current={stepOf[stage]} />
      <Card>
        <CardHeader><CardTitle size="md">{stage === "prepare" && problem ? "트윈 준비" : titles[stage]}</CardTitle></CardHeader>
        <CardContent className="grid gap-4">
          {stage === "search" && <>
            <div className="grid gap-2">
              <Label htmlFor="mobile-house-search">단지명 또는 도로명 주소</Label>
              <SearchInput id="mobile-house-search" textSize="lg" autoComplete="off" value={query}
                placeholder="예: 한양목련" onChange={(event) => updateDraft({ addressPicked: false, query: event.currentTarget.value })} />
            </div>
            <PostcodeSearch onSelect={chooseAddress} />
            {hub === "loading" && <p role="status">허브의 집 목록을 불러오는 중이에요.</p>}
            {hub === "error" && <>
              <p role="alert">허브의 집 목록을 불러오지 못했어요.</p>
              <Button variant="outline" onClick={() => void checkHub()}>다시 시도</Button>
            </>}
            {candidate && <Button size="setup-sm" variant="outline" onClick={() => move("floor")}>
              {house.name} · {house.address}
            </Button>}
            {addressPicked && !hasFloor
              ? <p role="status">선택한 주소의 도면이 없어요.</p>
              : (hub === "unavailable" || (hub === "available" && query.trim().length >= 2 && !candidate))
                && <p role="status">등록할 수 있는 집을 찾지 못했어요</p>}
            <Button variant="link" asChild className="w-fit justify-self-start">
              <a href="https://www.juso.go.kr/" target="_blank" rel="noreferrer">공식 도로명주소 검색</a>
            </Button>
            {hub === "available" && <Button asChild variant="outline" size="setup-sm"><a href="/mobile/settings/#home">허브의 집 고르기</a></Button>}
          </>}
          {stage === "floor" && <FloorReview canApprove={hub === "available"} onApprove={approve} onBack={backToSearch} />}
          {stage === "prepare" && <>
            {problem
              ? <><p role="alert">트윈을 준비하지 못했어요</p>
                {problem.otherHome && <p>허브에 열린 집은 {problem.otherHome}이에요. 집을 바꾸려면 주소와 도면을 다시 확인해 주세요.</p>}
                <Button size="setup-sm" onClick={() => void prepare(requestedTab() ?? registration.current?.stage ?? "scan")}>다시 시도</Button>
                <Button variant="outline" onClick={backToSearch}>주소 다시 확인</Button></>
              : <p role="status">허브에서 {house.name} 트윈 장면을 불러오는 중이에요.</p>}
          </>}
          {stage === "preview" && <>
            <img key={previewTry} className="w-full object-contain" width={1200} height={960} src={MOKRYEON_TWIN_PREVIEW}
              alt={house.name + " 트윈 조감도"} onLoad={() => setPreviewImage("ready")} onError={() => setPreviewImage("error")} />
            {previewImage === "error" && <>
              <p role="alert">트윈 미리보기를 열지 못했어요.</p>
              <Button size="setup" variant="outline" onClick={() => { setPreviewImage("loading"); setPreviewTry(n => n + 1); }}>다시 불러오기</Button>
            </>}
            <Button size="setup" disabled={previewImage !== "ready" || checkingPreview} onClick={() => void confirmTwin()}>확인</Button>
          </>}
          {stage === "scan" && connection && <ScanFlow store={store} capturePhoto={capturePhoto} sceneId={resume?.sceneId}
            preferSaved={resume?.preferSaved} onActivity={captureChanged}
            onScene={(sceneId) => remember({ ...registration.current, home: house.id, stage: "scan", sceneId, preferSaved: false })}
            onFinish={finishScan} onSkip={() => continueAt("house")} />}
          {stage === "scan" && !connection && <p role="status">허브의 집을 확인하는 중이에요.</p>}
        </CardContent>
      </Card>
      </>}
    </main>
    {homeTab && <PhoneHomePeek registered={stage === "home"} />}
    {stage !== "preview" && <PhonePortalNav active={homeTab ? "home" : "scan"} onTab={selectTab} />}
    </div>
  </>;
}
