import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import type { ServerMessage } from "../../../src/contract/events.ts";
import type { SetupView } from "../../../src/contract/setup.ts";
import { CircleCheck, TriangleAlert } from "lucide-react";
import { Alert, AlertTitle } from "../components/ui/alert";
import { Avatar, AvatarImage } from "../components/ui/avatar";
import { CardHeader, CardTitle } from "../components/ui/card";
import { SimpleNavbar } from "../components/ui/header-navbar";
import { MessageBubble } from "../components/ui/message-bubble";
import { ScrollReveal } from "../components/ui/scroll-reveal";
import { Stepper, StepperIndicator, StepperItem, StepperSeparator, StepperTitle, StepperTrigger } from "../components/ui/stepper";
import { useEvents } from "../lib/use-events";
import { shortName } from "../dashboard/hub";
import { MASCOT } from "../dashboard/mascot-image";
import { DeviceStep, sourcesFrom, type SourceKind } from "./DeviceStep";
import { HomeStep } from "./HomeStep";
import { ModeStep } from "./ModeStep";
import { PositionStep } from "./PositionStep";
import { call, failText, isOk } from "./setup-api";

// 설정 화면(/setup/): 단계 표시와 단계별 화면. 단계는 주소 #home·#devices·#mode·#position으로 남는다.
// 서버가 판단·검사를 하고(/api/setup*), 여기서는 고른 것을 보내고 결과를 그린다.
// 배치: 왼쪽 아래에 큰 마스코트 상반신(머리~가슴 LG 표시 바로 아래, 화면 밑선에 잘림)이 처음 들어올 때만 아래에서 올라오고(Scroll Reveal),
// 오른쪽 큰 말풍선(Message Bubble) 하나에 지금 단계 질문(제목)·알림 줄·단계 내용과 단추가 들어간다.
// 말풍선과 마스코트 머리 사이에는 점점 작아지는 빈 동그라미 셋(같은 부품 shape="dot")을 두어 마스코트가 생각하는 말풍선으로 읽힌다.
// 좁은 화면(lg 아래)은 말풍선이 위, 동그라미가 왼쪽 아래로, 작은 마스코트가 왼쪽 아래.

const STEPS = [
  { id: "home", label: "집 고르기", question: "어느 집을 쓸까요?" },
  { id: "devices", label: "가전 선택", question: "어떤 가전의 상태를 읽을까요?" },
  { id: "mode", label: "운영 모드", question: "가전을 어떻게 다룰까요?" },
  { id: "position", label: "위치 동기화", question: "폰과 트윈의 위치를 맞춰요" },
] as const;
type StepId = (typeof STEPS)[number]["id"];
type Notice = { text: string; error?: boolean } | null;

// 마스코트 그림(1254×1254)에서 보이는 칸: 가로 x0~x1, 세로 머리 꼭대기 위 8px~LG 표시 아래 20px(cut, 화면 밑선).
// 크기는 (화면 높이 3/4·가로 화면 너비 34% 중 작은 쪽)의 2/3, 좁은 화면은 세로 160px의 2/3.
export const UPPER_BODY = { top: MASCOT.headTop[1] - 8, cut: MASCOT.logo.center[1] + MASCOT.logo.r + 20 };
const SHOWN = UPPER_BODY.cut - UPPER_BODY.top;
const BOX_W = MASCOT.x1 - MASCOT.x0;
const px = (n: number) => `calc(${n} * var(--s))`;
const SCALE = { wide: `calc(min(75dvh / ${SHOWN}, 34vw / ${BOX_W}) * 2 / 3)`, narrow: `calc(160px / ${SHOWN} * 2 / 3)` };
const BUBBLE_LEFT = `max(20%, calc(2.5% + ${BOX_W} * var(--s) + 7rem))`;
// 생각 동그라미 줄: 말풍선 왼쪽 아래(FOOT)에서 마스코트 주둥이 위(HEAD)로. t는 FOOT에서 HEAD 쪽으로 간 몫, px는 큰 화면 지름.
const FOOT = { x: `(${BUBBLE_LEFT} - 20px)`, b: "(5dvh + 20%)" };
const HEAD = { x: `(2.5% + ${MASCOT.snout[0] - MASCOT.x0} * var(--s) + 14px)`, b: `(${UPPER_BODY.cut - MASCOT.snout[1] + 20} * var(--s))` };
const DOTS = [
  { size: "lg", t: 0.15, px: 48, className: "size-6 lg:size-12", place: "left-[80px] top-0" },
  { size: "md", t: 0.5, px: 30, className: "size-4 lg:size-[30px]", place: "left-[64px] top-[26px]" },
  { size: "sm", t: 0.82, px: 18, className: "size-2.5 lg:size-[18px]", place: "left-[54px] top-[46px]" },
] as const;
const along = (a: string, b: string, t: number, r: number) => `calc(${a} * ${1 - t} + ${b} * ${t} - ${r}px)`;
// 처음 들어올 때 아래에서 올라온다(단계가 바뀌어도 다시 하지 않는다). 움직임 줄이기면 입구의 MotionConfig가 바로 끝낸다.
const RISE = { hidden: { y: "45%", opacity: 0 }, visible: { y: 0, opacity: 1 } };

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
    setNotice(changing && r.json.home ? { text: `${shortName(r.json.home.name)}(으)로 바꿨어요.` } : null);
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
  const ready = step === "home" || step === "devices" ? Boolean(view) : Boolean(view?.home);
  return (
    <div className="flex min-h-full flex-col lg:h-full lg:overflow-hidden">
      <header>
        <SimpleNavbar title="NOONCHI" label="설정" logo={<Avatar shape="logo" className="size-[34px]"><AvatarImage src="/brand/face-128.png" alt="" /></Avatar>}>
          <Stepper value={at + 1} onValueChange={(v) => go(STEPS[v - 1]!.id)} role="list" aria-label="설정 단계" className="data-[orientation=horizontal]:w-[min(640px,60vw)]">
            {STEPS.map((s, i) => (
              <StepperItem key={s.id} step={i + 1} role="listitem" aria-current={i === at ? "step" : undefined} className="not-last:flex-1">
                <StepperTrigger className="gap-2"><StepperIndicator /><StepperTitle className="whitespace-nowrap">{s.label}</StepperTitle></StepperTrigger>
                {i < STEPS.length - 1 && <StepperSeparator className="mx-3" />}
              </StepperItem>
            ))}
          </Stepper>
        </SimpleNavbar>
      </header>
      <main
        className="relative flex min-h-0 flex-1 flex-col gap-4 p-4 [--s:var(--s-narrow)] lg:block lg:overflow-hidden lg:p-0 lg:[--s:var(--s-wide)]"
        style={{ "--s-wide": SCALE.wide, "--s-narrow": SCALE.narrow } as CSSProperties}
      >
        <div aria-hidden="true" className="pointer-events-none order-last self-start lg:absolute lg:bottom-0 lg:left-[2.5%]">
          <ScrollReveal once variants={RISE} transition={{ duration: 0.5, ease: "easeOut" }}>
            <div className="relative overflow-hidden" style={{ width: px(BOX_W), height: px(SHOWN) }}>
              <img
                src={MASCOT.src} alt="" width={MASCOT.width} height={MASCOT.height} draggable={false}
                className="absolute max-w-none select-none"
                style={{ left: px(-MASCOT.x0), top: px(-UPPER_BODY.top), width: px(MASCOT.width), height: px(MASCOT.height) }}
              />
            </div>
          </ScrollReveal>
        </div>
        <div
          className="flex min-h-0 flex-1 lg:absolute lg:top-6 lg:right-[3%] lg:bottom-[5dvh] lg:left-[var(--bubble-left)]"
          style={{ "--bubble-left": BUBBLE_LEFT } as CSSProperties}
        >
          <MessageBubble className="flex min-h-0 w-full max-w-full flex-1 flex-col overflow-auto">
            {view && ready && (
              <CardHeader><CardTitle id={`h-${step}`}>{STEPS[at]!.question}</CardTitle></CardHeader>
            )}
            {notice && (
              <Alert role="status" aria-live="polite" variant={notice.error ? "error" : "success"} className="mx-6 mb-4 w-auto">
                {notice.error ? <TriangleAlert aria-hidden="true" /> : <CircleCheck aria-hidden="true" />}
                <AlertTitle>{notice.text}</AlertTitle>
              </Alert>
            )}
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
          </MessageBubble>
        </div>
        <div aria-hidden="true" className="pointer-events-none relative h-14 shrink-0 lg:static lg:h-auto">
          {DOTS.map((d) => (
            <div
              key={d.size}
              className={`absolute ${d.place} lg:top-auto lg:bottom-[var(--y)] lg:left-[var(--x)]`}
              style={{ "--x": along(FOOT.x, HEAD.x, d.t, d.px / 2), "--y": along(FOOT.b, HEAD.b, d.t, d.px / 2) } as CSSProperties}
            >
              <MessageBubble shape="dot" data-size={d.size} className={d.className} />
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}
