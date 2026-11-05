import { useCallback, useEffect, useRef, useState } from "react";
import type { ServerMessage } from "../../../src/contract/events.ts";
import type { SetupView } from "../../../src/contract/setup.ts";
import { useEvents } from "../lib/use-events";
import { cn } from "../lib/utils";
import { DeviceStep, sourcesFrom, type SourceKind } from "./DeviceStep";
import { HomeStep } from "./HomeStep";
import { PositionStep } from "./PositionStep";
import { call, failText, isOk } from "./setup-api";

// 설정 화면(/setup/): 단계 표시와 단계별 화면. 단계는 주소 #home·#devices·#position으로 남는다.
// 서버가 판단·검사를 하고(/api/setup*), 여기서는 고른 것을 보내고 결과를 그린다.

const STEPS = [
  { id: "home", label: "집 고르기" },
  { id: "devices", label: "가전 선택" },
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
    go("position", r.json);
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
      <header className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
        <h1 className="text-base font-semibold">twin-home 설정</h1>
        <ol aria-label="설정 단계" className="m-0 flex list-none flex-wrap gap-1.5 p-0 text-[13px]">
          {STEPS.map((s, i) => (
            <li
              key={s.id} aria-current={i === at ? "step" : undefined}
              className={cn("inline-flex items-center gap-1.5 rounded-full border border-glass-line px-2.5 py-0.5 text-ink-dim",
                i === at && "border-transparent bg-on/15 font-semibold text-on", i < at && "text-ink")}
            >
              <b className={cn("grid size-[18px] place-items-center rounded-full bg-field text-[11px]", i === at && "bg-on text-[#08201b]")}>{i + 1}</b>
              {s.label}
            </li>
          ))}
        </ol>
      </header>
      {notice && (
        <p role="status" aria-live="polite" className={cn("mx-4 mb-2 rounded-lg px-3 py-2 text-[13px]", notice.error ? "bg-alert/15 text-alert" : "bg-on/15 text-on")}>
          {notice.text}
        </p>
      )}
      <main className="flex min-h-0 flex-1 px-4 pb-4">
        <div className="glass mx-auto flex w-full max-w-6xl flex-1 flex-col p-5">
          {view && step === "home" && <HomeStep view={view} picked={picked} onPick={setPicked} onNext={chooseHome} busy={busy} />}
          {view && step === "devices" && (
            <DeviceStep view={view} sources={sources} onSources={setSources} onBack={() => go("home")} onNext={saveDevices} busy={busy} />
          )}
          {view?.home && step === "position" && (
            <PositionStep
              view={view} onBack={() => go("devices")} onDone={finish} layoutTick={layoutTick}
              onNotice={(text, error) => setNotice({ text, error })}
            />
          )}
        </div>
      </main>
    </div>
  );
}
