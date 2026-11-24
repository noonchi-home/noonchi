import { FlaskConical, Info, PlugZap, TriangleAlert } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ControlMode, SetupView, ThinqDevicesView } from "../../../src/contract/setup.ts";
import { MOKRYEON_HOME, thinqListPath } from "../../../src/contract/mobile-home.ts";
import { Alert, AlertTitle } from "../components/ui/alert";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader,
  AlertDialogIcon, AlertDialogTitle,
} from "../components/ui/alert-dialog";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "../components/ui/card";
import { Item, ItemActions, ItemContent, ItemTitle } from "../components/ui/item";
import { RadioCard, RadioGroup } from "../components/ui/radio-group";
import { SelectNative } from "../components/ui/select-native";
import { Status } from "../components/ui/status";
import { shortName } from "../lib/hub";
import { call, failText, isOk } from "./setup-api";

// 운영 모드는 연결한 실제 가전을 사용한다. 테스트 모드에서는 트윈에서만 동작한다.
// 실제 모드로 바꿀 때는 화면 안 확인 창에서 한 번 더 묻는다(브라우저 대화상자를 쓰지 않는다). 시험 모드로는 바로 바꾼다.
// ThinQ 기기 목록은 실제 모드일 때만 부른다.

type List = { status: "pending" | "loading" } | { status: "error"; error: string } | { status: "ready"; devices: ThinqDevicesView["devices"] };

const MODES: { id: ControlMode; name: string; line: string }[] = [
  { id: "test", name: "시험 모드", line: "트윈에서만 다뤄요" },
  { id: "live", name: "실제 모드", line: "연결한 가전을 다뤄요" },
];


/** 실제 모드 확인 창(21st.dev Alert Dialog with icon). */
function AskLive({ open, busy, onYes, onNo, phone }: { open: boolean; busy: boolean; onYes: () => void; onNo: () => void; phone: boolean }) {
  const label = phone ? "운영 모드" : "실제 모드";
  return (
    <AlertDialog open={open} onOpenChange={(o) => { if (!o) onNo(); }}>
      <AlertDialogContent className="motion-reduce:animate-none">
        <div className="flex flex-col gap-2 max-sm:items-center sm:flex-row sm:gap-4">
          <AlertDialogIcon><TriangleAlert size={16} strokeWidth={2} /></AlertDialogIcon>
          <AlertDialogHeader>
            <AlertDialogTitle>{label}로 바꿀까요?</AlertDialogTitle>
            <AlertDialogDescription>실제 가전이 움직여요.</AlertDialogDescription>
          </AlertDialogHeader>
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel>취소</AlertDialogCancel>
          <AlertDialogAction variant="destructive" disabled={busy} onClick={(e) => { e.preventDefault(); onYes(); }}>{label}로 바꾸기</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function Pairs({ view, onView, onNotice, pending, onPending, phone, manual = false }: {
  view: SetupView; onView: (v: SetupView) => void; onNotice: (text: string | null, error?: boolean) => void;
  pending: boolean; onPending: (pending: boolean) => void; phone: boolean; manual?: boolean;
}) {
  const [list, setList] = useState<List>({ status: manual ? "pending" : "loading" });
  const sequence = useRef(0);
  const activePair = useRef(false);
  const home = view.home?.id;
  const canLoad = view.thinq.ready && !!home && !view.switching && (view.mode === "live" || home === MOKRYEON_HOME);
  const load = useCallback(async () => {
    const request = ++sequence.current;
    setList({ status: "loading" });
    const r = await call<ThinqDevicesView>(manual && home ? thinqListPath(home) : "/api/setup/thinq");
    if (request !== sequence.current) return;
    if (isOk(r) && Array.isArray(r.json.devices) && (!manual || r.json.home === home)) {
      setList({ status: "ready", devices: r.json.devices });
    } else {
      setList({ status: "error", error: failText(r, "ThinQ 기기 목록을 받지 못했어요.") });
    }
  }, [home, manual]);
  useEffect(() => {
    if (!manual) void load();
    return () => { sequence.current++; };
  }, [load, manual]);

  const pair = async (id: string, target: string) => {
    if (!home || pending || activePair.current) return;
    activePair.current = true;
    const request = sequence.current;
    onPending(true);
    const r = await call<SetupView>("/api/setup/pairs", { home, pairs: { [id]: target || null } });
    activePair.current = false;
    if (request !== sequence.current) return;
    onPending(false);
    if (!isOk(r)) return onNotice(failText(r, "연결을 저장하지 못했어요."), true);
    onNotice(null);
    onView(r.json);
  };

  const devices = view.devices.filter((d) => d.pairable);
  return (
    <section aria-label="ThinQ 가전 연결" className="max-w-2xl">
      <Card>
        <CardHeader>
          <CardTitle size="md">{manual ? "LG ThinQ API 기본 연결" : "가전 연결"}</CardTitle>
          {manual && view.home && <CardDescription>{shortName(view.home.name)}</CardDescription>}
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {manual && (!view.thinq.ready ? <p role="status">허브에 ThinQ 연결 설정이 없어요.</p>
            : !canLoad ? <p role="status">이 집의 ThinQ 기기는 운영 모드에서 확인할 수 있어요.</p>
              : <>
                {list.status === "pending" && <p role="status">허브에 설정됨 · 조회 전</p>}
                {list.status === "ready" && <p role="status">조회 성공 · 기기 {list.devices.length}개</p>}
              </>)}
          {manual && <Button size="setup-sm" className="min-h-11" disabled={!canLoad || list.status === "loading" || pending}
            onClick={() => void load()}>{list.status === "loading" ? "기기 확인 중" : "LG ThinQ 기기 확인"}</Button>}
          {list.status === "loading" && <CardDescription size="lg">ThinQ 기기를 불러오는 중…</CardDescription>}
          {list.status === "error" && (
            <Alert variant="error" size="setup">
              <TriangleAlert aria-hidden="true" />
              <AlertTitle>{list.error}</AlertTitle>
              {!manual && <div className="col-start-2 mt-2"><Button variant="secondary" size="setup-sm" onClick={() => void load()}>다시 불러오기</Button></div>}
            </Alert>
          )}
          {list.status === "ready" && devices.length === 0 && <CardDescription size="lg">이 집에는 연결할 가전이 없어요.</CardDescription>}
          {manual && list.status === "ready" && list.devices.length > 0 && list.devices.every(device => device.kind === null)
            && <CardDescription size="lg">연결할 수 있는 ThinQ 기기가 없어요.</CardDescription>}
          {list.status === "ready" && devices.map((d) => {
            const value = view.pairs[d.id] ?? "";
            const options = list.devices.filter((t) => t.kind === d.kind);
            const missing = value && !options.some((t) => t.id === value);
            return (
              <Item key={d.id} size="setup" variant="outline" className={phone ? "flex-wrap" : "flex-nowrap"}>
                <ItemContent><ItemTitle>{d.label}</ItemTitle></ItemContent>
                <ItemActions className={phone ? "w-full" : "w-64"}>
                  <div className="w-full">
                    <SelectNative textSize="lg" disabled={pending} aria-label={`${d.label} ThinQ 기기`} value={value} onChange={(e) => void pair(d.id, e.target.value)}>
                      <option value="">연결 안 함</option>
                      {missing && <option value={value}>{value}</option>}
                      {options.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                    </SelectNative>
                  </div>
                </ItemActions>
              </Item>
            );
          })}
        </CardContent>
      </Card>
    </section>
  );
}

export function PhoneApplianceSettings({ view, onView, onNotice, onNext }: {
  view: SetupView; onView: (value: SetupView) => void; onNotice: (text: string | null, error?: boolean) => void; onNext: () => void;
}) {
  const [pending, setPending] = useState(false);
  return <>
    <CardContent className="grid gap-3">
      <Pairs view={view} onView={onView} onNotice={onNotice} pending={pending} onPending={setPending} phone manual />
      <p>적외선 리모컨</p>
      <p>Matter</p>
      <Button asChild size="setup-sm" variant="outline"><a href="#devices">읽을 가전 선택</a></Button>
    </CardContent>
    <CardFooter className="justify-end">
      <Button size="setup" disabled={pending} onClick={onNext}>완료하고 돌아가기</Button>
    </CardFooter>
  </>;
}

/** 3 운영 모드. 제목(h-mode)은 설정 화면 말풍선이 단다. */
export function ModeStep({ view, onView, onNotice, onBack, onNext, phone = false }: {
  view: SetupView; onView: (v: SetupView) => void; onNotice: (text: string | null, error?: boolean) => void; onBack: () => void; onNext: () => void; phone?: boolean;
}) {
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [pairing, setPairing] = useState(false);
  const [draft, setDraft] = useState(view.mode);
  const saving = useRef(false);

  const change = async (mode: ControlMode) => {
    if (saving.current) return;
    saving.current = true;
    setBusy(true);
    const r = await call<SetupView>("/api/setup/mode", mode === "live" ? { mode, confirm: true } : { mode });
    saving.current = false;
    setBusy(false);
    setAsking(false);
    if (!isOk(r)) return onNotice(failText(r, "모드를 바꾸지 못했어요."), true);
    onNotice(null);
    onView(r.json);
  };
  const liveReady = view.thinq.ready || view.ir?.ready;
  const pick = (mode: ControlMode) => {
    if (busy || pairing) return;
    if (phone) { setDraft(mode); return; }
    if (mode === view.mode) return;
    if (mode === "live") setAsking(true);
    else void change("test");
  };

  return (
    <section aria-labelledby="h-mode" className="flex min-h-0 flex-1 flex-col">
      <CardContent className="flex min-h-0 flex-1 flex-col gap-3">
        <RadioGroup aria-labelledby="h-mode" value={phone ? draft : view.mode} onValueChange={(v) => pick(v as ControlMode)} className="max-w-xl gap-2">
          {MODES.map((m) => (
            <RadioCard
              key={m.id} value={m.id} label={phone ? (m.id === "live" ? "운영 모드" : "테스트 모드") : m.name}
              size="lg" disabled={busy || (m.id === "live" && !liveReady)}
              icon={m.id === "live" ? <PlugZap /> : <FlaskConical />}
              description={m.id === "live" ? <Status variant="warning" size="setup">{m.line}</Status> : m.line}
            />
          ))}
        </RadioGroup>
        {!liveReady && <Alert size="setup" className="max-w-xl"><Info aria-hidden="true" /><AlertTitle>{phone ? "허브에 연결된 실제 가전이 없어요." : "ThinQ 토큰이 없어요."}</AlertTitle></Alert>}
        {phone && <Button size="setup" disabled={busy || draft === view.mode}
          onClick={() => draft === "live" ? setAsking(true) : void change(draft)}>모드 저장</Button>}
        {!phone && view.mode === "live" && view.thinq.ready && view.home && <Pairs view={view} onView={onView} onNotice={onNotice} pending={pairing} onPending={setPairing} phone={false} />}
      </CardContent>
      <CardFooter className="mt-auto justify-end gap-2">
        {!phone && <Button variant="outline" size="setup" onClick={onBack}>이전</Button>}
        <Button size="setup" disabled={busy || pairing} onClick={onNext}>{phone ? "완료하고 돌아가기" : "다음"}</Button>
      </CardFooter>
      <AskLive open={asking} busy={busy} onYes={() => void change("live")} onNo={() => setAsking(false)} phone={phone} />
    </section>
  );
}
