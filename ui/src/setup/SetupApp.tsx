import { useCallback, useEffect, useRef, useState } from "react";
import type { ServerMessage } from "../../../src/contract/events.ts";
import type { SetupView } from "../../../src/contract/setup.ts";
import { CircleCheck, TriangleAlert } from "lucide-react";
import { Alert, AlertTitle } from "../components/ui/alert";
import { Card } from "../components/ui/card";
import { SimpleNavbar } from "../components/ui/header-navbar";
import { Stepper, StepperIndicator, StepperItem, StepperSeparator, StepperTitle, StepperTrigger } from "../components/ui/stepper";
import { useEvents } from "../lib/use-events";
import { cn } from "../lib/utils";
import { DeviceStep, sourcesFrom, type SourceKind } from "./DeviceStep";
import { HomeStep } from "./HomeStep";
import { ModeStep } from "./ModeStep";
import { PositionStep } from "./PositionStep";
import { call, failText, isOk } from "./setup-api";

// 설정 화면(/setup/): 단계 표시와 단계별 화면. 단계는 주소 #home·#devices·#mode·#position으로 남는다.
// 서버가 판단·검사를 하고(/api/setup*), 여기서는 고른 것을 보내고 결과를 그린다.

const STEPS = [
  { id: "home", label: "집 고르기" },
  { id: "devices", label: "가전 선택" },
  { id: "mode", label: "운영 모드" },
  { id: "position", label: "위치 동기화" },
] as const;
type StepId = (typeof STEPS)[number]["id"];
type Notice = { text: string; error?: boolean } | null;

const stepOf = (raw: string, view: SetupView | null): StepId => {
  const s = STEPS.find((x) => x.id === raw)?.id ?? "home";
  return view?.home ? s : "home";
};

export function SetupApp({ navigate = (url: string) => location.assign(url) }: { navigate?: (url: string) => void }) {
  const [view, setView] = useState<SetupView | null>(null);
  const [step, setStep] = useState<StepId>("home");
  const [notice, setNotice] = useState<Notice>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const [sources, setSources] = useState<Map<string, SourceKind>>(new Map());
  const [busy, setBusy] = useState(false);
  const [layoutTick, setLayoutTick] = useState(0);
  const viewRef = useRef<SetupView | null>(null);
  const switching = useRef(false); // 이 화면이 집을 바꾸는 중(그동안 오는 hello는 내 것)

  const show = useCallback((v: SetupView) => {
    viewRef.current = v;
    setView(v);
    setSources(sourcesFrom(v));
  }, []);

  const go = useCallback((raw: string, v = viewRef.current) => {
    const s = stepOf(raw, v);
    setStep(s);
    if (location.hash !== `#${s}`) history.replaceState(null, "", `#${s}`);
  }, []);

  const load = useCallback(async () => {
    const r = await call<SetupView>("/api/setup");
    if (!isOk(r)) {
      setNotice({ text: failText(r, "설정을 불러오지 못했어요."), error: true });
      return null;
    }
    show(r.json);
    setPicked((p) => p ?? r.json.home?.id ?? r.json.homes[0]?.id ?? null);
    if (r.json.error) setNotice({ text: `지난번 집 바꾸기가 실패했어요: ${r.json.error}`, error: true });
    return r.json;
  }, [show]);

  useEffect(() => {
    let live = true;
    void load().then((v) => { if (live && v) go(location.hash.slice(1) || "home", v); });
    const onHash = () => go(location.hash.slice(1));
    window.addEventListener("hashchange", onHash);
    return () => { live = false; window.removeEventListener("hashchange", onHash); };
  }, [load, go]);

  // 실시간: 다른 곳에서 집을 바꿨으면 알리고, 대화·폰으로 배치를 바꾸면 보정 상태를 다시 읽는다
  const onMessage = useCallback((m: ServerMessage) => {
    const v = viewRef.current;
    if (m.type === "hello" && !switching.current && v?.home && m.home && m.home !== v.home.id) {
      setNotice({ text: "다른 화면에서 집을 바꿨어요. 처음 단계부터 다시 볼게요.", error: true });
      setPicked(null);
      void load().then((nv) => nv && go("home", nv));
    } else if (m.type === "agent" && m.event === "reply") setLayoutTick((t) => t + 1);
  }, [load, go]);
  useEvents(onMessage);

  const chooseHome = async () => {
    const v = viewRef.current;
    if (!picked || !v) return;
    const changing = picked !== v.home?.id;
    setBusy(true);
    if (changing) setNotice({ text: "집을 바꾸는 중이에요. 수십 초 걸릴 수 있어요…" });
    switching.current = true;
    const r = await call<SetupView>("/api/setup/home", { home: picked });
    switching.current = false;
    setBusy(false);
    if (!isOk(r)) {
      setNotice({ text: failText(r, "집을 바꾸지 못했어요."), error: true });
      await load();
      return;
    }
    show(r.json);
    setNotice(changing && r.json.home ? { text: `${r.json.home.name}(으)로 바꿨어요.` } : null);
    go("devices", r.json);
  };

  const saveDevices = async () => {
    const v = viewRef.current;
    if (!v?.home) return;
    setBusy(true);
    const r = await call<SetupView>("/api/setup/devices", { home: v.home.id, sources: Object.fromEntries(sources) });
    setBusy(false);
    if (!isOk(r)) {
      setNotice({ text: failText(r, "저장하지 못했어요."), error: true });
      return;
    }
    show(r.json);
    setNotice(null);
    go("mode", r.json);
  };

  const finish = async () => {
    const v = viewRef.current;
    if (!v?.home) return;
    const r = await call<SetupView>("/api/setup/done", { home: v.home.id });
    if (!isOk(r)) {
      setNotice({ text: failText(r, "끝내지 못했어요."), error: true });
      return;
    }
    navigate("/");
  };

  const at = STEPS.findIndex((s) => s.id === step);
  return (
    <div className="flex min-h-full flex-col">
      <header>
        <SimpleNavbar title="NOONCHI" label="설정">
          <Stepper value={at + 1} onValueChange={(v) => go(STEPS[v - 1]!.id)} role="list" aria-label="설정 단계" className="w-[min(640px,60vw)]">
            {STEPS.map((s, i) => (
              <StepperItem key={s.id} step={i + 1} role="listitem" aria-current={i === at ? "step" : undefined} className="not-last:flex-1">
                <StepperTrigger className="gap-2"><StepperIndicator /><StepperTitle className="whitespace-nowrap">{s.label}</StepperTitle></StepperTrigger>
                {i < STEPS.length - 1 && <StepperSeparator className="mx-3" />}
              </StepperItem>
            ))}
          </Stepper>
        </SimpleNavbar>
      </header>
      {notice && (
        <Alert role="status" aria-live="polite" variant={notice.error ? "error" : "success"} className="mx-auto mt-4 w-[calc(100%-2rem)] max-w-6xl">
          {notice.error ? <TriangleAlert aria-hidden="true" /> : <CircleCheck aria-hidden="true" />}
          <AlertTitle>{notice.text}</AlertTitle>
        </Alert>
      )}
      <main className="flex min-h-0 flex-1 p-4">
        <Card className={cn("mx-auto flex w-full flex-1 flex-col", step === "position" ? "max-w-6xl" : "max-w-[760px]")}>
          {view && step === "home" && <HomeStep view={view} picked={picked} onPick={setPicked} onNext={chooseHome} busy={busy} />}
          {view && step === "devices" && (
            <DeviceStep view={view} sources={sources} onSources={setSources} onBack={() => go("home")} onNext={saveDevices} busy={busy} />
          )}
          {view?.home && step === "mode" && (
            <ModeStep
              view={view} onView={show} onBack={() => go("devices")} onNext={() => go("position")}
              onNotice={(text, error) => setNotice(text ? { text, error } : null)}
            />
          )}
          {view?.home && step === "position" && (
            <PositionStep
              view={view} onBack={() => go("mode")} onDone={finish} layoutTick={layoutTick}
              onNotice={(text, error) => setNotice({ text, error })}
            />
          )}
        </Card>
      </main>
    </div>
  );
}
