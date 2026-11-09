import { FlaskConical, Info, PlugZap, TriangleAlert } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import type { ControlMode, SetupView, ThinqDeviceView } from "../../../src/contract/setup.ts";
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
import { call, failText, isOk } from "./setup-api";

// 3 운영 모드: 시험 모드(트윈에서만, 기본) · 실제 모드(짝지은 에어컨·냉장고는 ThinQ로 실제 가전).
// 실제 모드로 바꿀 때는 화면 안 확인 창에서 한 번 더 묻는다(브라우저 대화상자를 쓰지 않는다). 시험 모드로는 바로 바꾼다.
// ThinQ 기기 목록은 실제 모드일 때만 부른다.

type List = { status: "loading" } | { status: "error"; error: string } | { status: "ready"; devices: ThinqDeviceView[] };

const MODES: { id: ControlMode; name: string; line: string }[] = [
  { id: "test", name: "시험 모드", line: "트윈에서만 다뤄요" },
  { id: "live", name: "실제 모드", line: "ThinQ로 실제 가전을 다뤄요" },
];

/** 실제 모드 확인 창(21st.dev Alert Dialog with icon). */
function AskLive({ open, busy, onYes, onNo }: { open: boolean; busy: boolean; onYes: () => void; onNo: () => void }) {
  return (
    <AlertDialog open={open} onOpenChange={(o) => { if (!o) onNo(); }}>
      <AlertDialogContent className="motion-reduce:animate-none">
        <div className="flex flex-col gap-2 max-sm:items-center sm:flex-row sm:gap-4">
          <AlertDialogIcon><TriangleAlert size={16} strokeWidth={2} /></AlertDialogIcon>
          <AlertDialogHeader>
            <AlertDialogTitle>실제 모드로 바꿀까요?</AlertDialogTitle>
            <AlertDialogDescription>실제 가전이 움직여요.</AlertDialogDescription>
          </AlertDialogHeader>
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel>취소</AlertDialogCancel>
          <AlertDialogAction variant="destructive" disabled={busy} onClick={(e) => { e.preventDefault(); onYes(); }}>실제 모드로 바꾸기</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function Pairs({ view, onView, onNotice }: { view: SetupView; onView: (v: SetupView) => void; onNotice: (text: string | null, error?: boolean) => void }) {
  const [list, setList] = useState<List>({ status: "loading" });
  const load = useCallback(async () => {
    setList({ status: "loading" });
    const r = await call<{ ok: true; devices: ThinqDeviceView[] }>("/api/setup/thinq");
    setList(isOk(r) ? { status: "ready", devices: r.json.devices } : { status: "error", error: failText(r, "ThinQ 기기 목록을 받지 못했어요.") });
  }, []);
  useEffect(() => { void load(); }, [load]);

  const pair = async (id: string, target: string) => {
    const r = await call<SetupView>("/api/setup/pairs", { home: view.home!.id, pairs: { [id]: target || null } });
    if (!isOk(r)) return onNotice(failText(r, "짝을 저장하지 못했어요."), true);
    onView(r.json);
  };

  const devices = view.devices.filter((d) => d.pairable);
  return (
    <section aria-label="ThinQ 짝" className="max-w-xl">
      <Card>
        <CardHeader><CardTitle>ThinQ 기기와 짝짓기</CardTitle></CardHeader>
        <CardContent className="flex flex-col gap-2">
          {list.status === "loading" && <CardDescription>ThinQ 기기를 불러오는 중…</CardDescription>}
          {list.status === "error" && (
            <Alert variant="error">
              <TriangleAlert aria-hidden="true" />
              <AlertTitle>{list.error}</AlertTitle>
              <div className="col-start-2 mt-2"><Button variant="secondary" size="sm" onClick={() => void load()}>다시 불러오기</Button></div>
            </Alert>
          )}
          {list.status === "ready" && devices.length === 0 && <CardDescription>이 집에는 짝지을 에어컨·냉장고가 없어요.</CardDescription>}
          {list.status === "ready" && devices.map((d) => {
            const value = view.pairs[d.id] ?? "";
            const options = list.devices.filter((t) => t.kind === d.kind);
            const missing = value && !options.some((t) => t.id === value);
            return (
              <Item key={d.id} size="sm" variant="outline" className="flex-nowrap">
                <ItemContent><ItemTitle>{d.label}</ItemTitle></ItemContent>
                <ItemActions className="w-56">
                  <div className="w-full">
                    <SelectNative aria-label={`${d.label} ThinQ 기기`} value={value} onChange={(e) => void pair(d.id, e.target.value)}>
                      <option value="">짝 없음</option>
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

/** 3 운영 모드. 제목(h-mode)은 설정 화면 말풍선이 단다. */
export function ModeStep({ view, onView, onNotice, onBack, onNext }: {
  view: SetupView; onView: (v: SetupView) => void; onNotice: (text: string | null, error?: boolean) => void; onBack: () => void; onNext: () => void;
}) {
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);

  const change = async (mode: ControlMode) => {
    setBusy(true);
    const r = await call<SetupView>("/api/setup/mode", mode === "live" ? { mode, confirm: true } : { mode });
    setBusy(false);
    setAsking(false);
    if (!isOk(r)) return onNotice(failText(r, "모드를 바꾸지 못했어요."), true);
    onNotice(null);
    onView(r.json);
  };
  const pick = (mode: ControlMode) => {
    if (mode === view.mode || busy) return;
    if (mode === "live") setAsking(true);
    else void change("test");
  };

  return (
    <section aria-labelledby="h-mode" className="flex min-h-0 flex-1 flex-col">
      <CardContent className="flex min-h-0 flex-1 flex-col gap-3">
        <RadioGroup aria-labelledby="h-mode" value={view.mode} onValueChange={(v) => pick(v as ControlMode)} className="max-w-xl gap-2">
          {MODES.map((m) => (
            <RadioCard
              key={m.id} value={m.id} label={m.name} disabled={m.id === "live" && !view.thinq.ready}
              icon={m.id === "live" ? <PlugZap /> : <FlaskConical />}
              description={m.id === "live" ? <Status variant="warning">{m.line}</Status> : m.line}
            />
          ))}
        </RadioGroup>
        {!view.thinq.ready && <Alert className="max-w-xl"><Info aria-hidden="true" /><AlertTitle>ThinQ 토큰이 없어요.</AlertTitle></Alert>}
        {view.mode === "live" && view.home && <Pairs view={view} onView={onView} onNotice={onNotice} />}
      </CardContent>
      <CardFooter className="mt-auto justify-end gap-2">
        <Button variant="outline" onClick={onBack}>이전</Button>
        <Button onClick={onNext}>다음</Button>
      </CardFooter>
      <AskLive open={asking} busy={busy} onYes={() => void change("live")} onNo={() => setAsking(false)} />
    </section>
  );
}
