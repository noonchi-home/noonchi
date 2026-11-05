import { useCallback, useEffect, useState } from "react";
import type { ControlMode, SetupView, ThinqDeviceView } from "../../../src/contract/setup.ts";
import { cn } from "../lib/utils";
import { btn, call, failText, isOk, primary, small } from "./setup-api";

// 3 운영 모드: 시험 모드(트윈에서만, 기본) · 실제 모드(짝지은 에어컨·냉장고는 ThinQ로 실제 가전).
// 실제 모드로 바꿀 때는 화면 안 확인 창에서 한 번 더 묻는다(브라우저 대화상자를 쓰지 않는다). 시험 모드로는 바로 바꾼다.
// ThinQ 기기 목록은 실제 모드일 때만 부른다.

type List = { status: "loading" } | { status: "error"; error: string } | { status: "ready"; devices: ThinqDeviceView[] };

const MODES: { id: ControlMode; name: string; line: string }[] = [
  { id: "test", name: "시험 모드", line: "트윈에서만 다뤄요" },
  { id: "live", name: "실제 모드", line: "ThinQ로 실제 가전을 다뤄요" },
];

function AskLive({ busy, onYes, onNo }: { busy: boolean; onYes: () => void; onNo: () => void }) {
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-4" onKeyDown={(e) => { if (e.key === "Escape") onNo(); }}>
      <div role="alertdialog" aria-modal="true" aria-labelledby="ask-live-title" aria-describedby="ask-live-body" className="glass w-full max-w-sm p-5">
        <h3 id="ask-live-title" className="mb-2 text-base font-semibold">실제 모드로 바꿀까요?</h3>
        <p id="ask-live-body" className="mb-4 text-sm">실제 가전이 움직여요.</p>
        <div className="flex justify-end gap-2">
          <button type="button" className={btn} onClick={onNo} autoFocus>취소</button>
          <button type="button" className={cn(primary, "bg-alert text-white")} disabled={busy} onClick={onYes}>실제 모드로 바꾸기</button>
        </div>
      </div>
    </div>
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
    <section aria-label="ThinQ 짝" className="flex max-w-xl flex-col gap-2 rounded-xl border border-glass-line bg-field p-3 text-sm">
      <h3 className="font-semibold">ThinQ 기기와 짝짓기</h3>
      {list.status === "loading" && <p className="text-ink-dim">ThinQ 기기를 불러오는 중…</p>}
      {list.status === "error" && (
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-alert">{list.error}</p>
          <button type="button" className={small} onClick={() => void load()}>다시 불러오기</button>
        </div>
      )}
      {list.status === "ready" && devices.length === 0 && <p className="text-ink-dim">이 집에는 짝지을 에어컨·냉장고가 없어요.</p>}
      {list.status === "ready" && devices.map((d) => {
        const value = view.pairs[d.id] ?? "";
        const options = list.devices.filter((t) => t.kind === d.kind);
        const missing = value && !options.some((t) => t.id === value);
        return (
          <div key={d.id} className="grid grid-cols-[1fr_minmax(0,14rem)] items-center gap-2">
            <span>{d.label}</span>
            <select
              aria-label={`${d.label} ThinQ 기기`} value={value} onChange={(e) => void pair(d.id, e.target.value)}
              className="rounded-md border border-glass-line bg-black/30 px-2 py-1 text-ink outline-none focus:border-on"
            >
              <option value="">짝 없음</option>
              {missing && <option value={value}>{value}</option>}
              {options.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </div>
        );
      })}
    </section>
  );
}

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
    <section aria-labelledby="h-mode" className="flex min-h-0 flex-1 flex-col gap-3">
      <h2 id="h-mode" className="text-[18px] font-semibold">가전을 어떻게 다룰까요?</h2>
      <div role="radiogroup" aria-labelledby="h-mode" className="grid max-w-xl gap-2">
        {MODES.map((m) => {
          const off = m.id === "live" && !view.thinq.ready;
          const on = view.mode === m.id;
          return (
            <label
              key={m.id}
              className={cn("flex items-center gap-3 rounded-xl border border-glass-line bg-field px-3 py-2.5",
                off ? "cursor-not-allowed opacity-50" : "cursor-pointer", on && (m.id === "live" ? "border-alert bg-field-strong" : "border-on bg-field-strong"))}
            >
              <input
                type="radio" name="mode" value={m.id} checked={on} disabled={off} onChange={() => pick(m.id)}
                className="accent-[var(--color-on)]"
              />
              <span className="flex flex-col">
                <span className="font-medium">{m.name}</span>
                <span className="text-xs text-ink-dim">{m.line}</span>
              </span>
            </label>
          );
        })}
      </div>
      {!view.thinq.ready && <p className="text-sm text-ink-dim">ThinQ 토큰이 없어요.</p>}
      {view.mode === "live" && view.home && <Pairs view={view} onView={onView} onNotice={onNotice} />}
      <div className="mt-auto flex justify-end gap-2 pt-1">
        <button type="button" className={btn} onClick={onBack}>이전</button>
        <button type="button" className={primary} onClick={onNext}>다음</button>
      </div>
      {asking && <AskLive busy={busy} onYes={() => void change("live")} onNo={() => setAsking(false)} />}
    </section>
  );
}
