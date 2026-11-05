import { useMemo, useRef, useState, type KeyboardEvent } from "react";
import type { SetupDeviceView, SetupView } from "../../../src/contract/setup.ts";
import { cn } from "../lib/utils";
import { searchDevices } from "./device-search";
import { btn, primary, small } from "./setup-api";

export type SourceKind = "virtual" | "none";

/** 검색해서 추가한 가전만 가상, 나머지는 신호 없음. 이 집 가전을 고른 적이 없으면 모두 신호 없음으로 시작한다. */
export function sourcesFrom(view: SetupView): Map<string, SourceKind> {
  return new Map(view.devices.map((d) => [d.id, view.devices_saved ? d.source.kind : "none"]));
}

const deviceName = (d: SetupDeviceView) => (d.label.includes(d.kindLabel) ? d.label : `${d.label} · ${d.kindLabel}`);

/** 2 가전 선택. */
export function DeviceStep({ view, sources, onSources, onBack, onNext, busy }: {
  view: SetupView; sources: Map<string, SourceKind>; onSources: (next: Map<string, SourceKind>) => void;
  onBack: () => void; onNext: () => void; busy: boolean;
}) {
  const [query, setQuery] = useState("");
  const box = useRef<HTMLInputElement>(null);
  const isPicked = (id: string) => sources.get(id) === "virtual";
  const set = (changes: [string, SourceKind][]) => {
    const next = new Map(sources);
    for (const [id, kind] of changes) next.set(id, kind);
    onSources(next);
  };
  const devices = view.devices;
  const picked = devices.filter((d) => isPicked(d.id));
  const rooms = useMemo(() => [...new Map(devices.map((d) => [d.room, d.roomLabel])).values()], [devices]);
  const hits = useMemo(() => searchDevices(devices, query), [devices, query]);
  const rest = hits.filter((d) => !isPicked(d.id));

  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") setQuery("");
    else if (e.key === "Enter") {
      // 엔터: 아직 안 넣은 첫 결과를 추가한다
      const first = rest[0];
      if (first) set([[first.id, "virtual"]]);
    }
  };

  return (
    <section aria-labelledby="h-devices" className="flex min-h-0 flex-1 flex-col gap-3">
      <h2 id="h-devices" className="text-lg font-semibold">어떤 가전의 상태를 읽을까요?</h2>
      <div className="grid max-w-2xl gap-2">
        <input
          ref={box} type="search" value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={onKey}
          placeholder="가전이나 방 이름으로 검색" aria-label="가전 검색" aria-controls="device-results" autoComplete="off"
          className="w-full rounded-xl border border-glass-line bg-field px-3 py-2.5 text-[15px] text-ink outline-none placeholder:text-ink-dim focus:border-on"
        />
        <div aria-label="방으로 찾기" className="flex flex-wrap gap-1">
          {rooms.map((label) => (
            <button key={label} type="button" className={small} onClick={() => { setQuery(label); box.current?.focus(); }}>{label}</button>
          ))}
        </div>
        {query.trim() && (
          <ul id="device-results" aria-label="검색 결과" className="max-h-80 overflow-auto rounded-xl border border-glass-line bg-field p-1">
            {hits.length === 0 ? <li className="p-2 text-sm text-ink-dim">맞는 가전이 없어요.</li> : (
              <>
                <li className="flex items-center justify-between gap-2 px-2 py-1 text-xs text-ink-dim">
                  <span>{`${hits.length}개`}</span>
                  {rest.length > 1 && (
                    <button type="button" className={small} onClick={() => set(rest.map((d) => [d.id, "virtual"]))}>{`모두 추가 (${rest.length})`}</button>
                  )}
                </li>
                {hits.map((d) => {
                  const on = isPicked(d.id);
                  return (
                    <li key={d.id}>
                      <button
                        type="button" aria-pressed={on} onClick={() => set([[d.id, on ? "none" : "virtual"]])}
                        className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-sm hover:bg-field-strong"
                      >
                        <span className="whitespace-nowrap text-xs text-ink-dim">{d.roomLabel}</span>
                        <span className="min-w-0 flex-1 truncate">{deviceName(d)}</span>
                        <span className={cn("whitespace-nowrap text-xs font-semibold", on ? "text-on" : "text-ink")}>{on ? "추가됨 ✓" : "추가"}</span>
                      </button>
                    </li>
                  );
                })}
              </>
            )}
          </ul>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded-full bg-field px-2.5 py-1 text-xs text-ink-dim">{`추가 ${picked.length} · 신호 없음 ${devices.length - picked.length}`}</span>
        {picked.length > 0 && <button type="button" className={small} onClick={() => set(devices.map((d) => [d.id, "none"]))}>모두 빼기</button>}
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {devices.length === 0 ? <p className="text-sm text-ink-dim">이 집 배치에 가전이 없어요.</p>
          : picked.length === 0 ? <p className="text-sm text-ink-dim">아직 추가한 가전이 없어요. 위에서 검색해서 추가하세요.</p>
          : (
            <ul aria-label="추가한 가전" className="flex flex-wrap gap-1.5">
              {picked.map((d) => (
                <li key={d.id} className="inline-flex items-center gap-1.5 rounded-full bg-on/15 py-1 pl-3 pr-1 text-sm">
                  {!d.label.includes(d.roomLabel) && <span className="text-xs text-ink-dim">{d.roomLabel}</span>}
                  <span>{deviceName(d)}</span>
                  <button
                    type="button" aria-label={`${d.roomLabel} ${d.label} 빼기`} onClick={() => set([[d.id, "none"]])}
                    className="grid size-6 place-items-center rounded-full text-ink-dim hover:bg-field-strong hover:text-alert"
                  >×</button>
                </li>
              ))}
            </ul>
          )}
      </div>
      <div className="flex justify-end gap-2 pt-1">
        <button type="button" className={btn} onClick={onBack}>이전</button>
        <button type="button" className={primary} disabled={busy} onClick={onNext}>다음</button>
      </div>
    </section>
  );
}
