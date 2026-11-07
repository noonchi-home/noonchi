import { useMemo, useRef, useState, type KeyboardEvent } from "react";
import type { SetupDeviceView, SetupView } from "../../../src/contract/setup.ts";
import { Alert, AlertTitle } from "../components/ui/alert";
import { RemovableBadge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "../components/ui/card";
import { SearchInput } from "../components/ui/input";
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemHeader, ItemTitle } from "../components/ui/item";
import { Status } from "../components/ui/status";
import { searchDevices } from "./device-search";

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
    <section aria-labelledby="h-devices" className="flex min-h-0 flex-1 flex-col">
      <CardHeader>
        <CardTitle id="h-devices">어떤 가전의 상태를 읽을까요?</CardTitle>
      </CardHeader>
      <CardContent className="flex min-h-0 flex-1 flex-col gap-3">
        <div className="grid max-w-2xl gap-2">
          <SearchInput
            ref={box} value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={onKey}
            placeholder="가전이나 방 이름으로 검색" aria-label="가전 검색" aria-controls="device-results" autoComplete="off"
          />
          <div aria-label="방으로 찾기" className="flex flex-wrap gap-1">
            {rooms.map((label) => (
              <Button key={label} variant="outline" size="sm" onClick={() => { setQuery(label); box.current?.focus(); }}>{label}</Button>
            ))}
          </div>
          {query.trim() && (
            <Card className="max-h-80 overflow-auto">
              <ItemGroup id="device-results" aria-label="검색 결과">
                {hits.length === 0 ? (
                  <Alert><AlertTitle>맞는 가전이 없어요.</AlertTitle></Alert>
                ) : (
                  <>
                    <Item size="sm">
                      <ItemHeader>
                        <ItemDescription>{`${hits.length}개`}</ItemDescription>
                        {rest.length > 1 && (
                          <Button variant="ghost" size="sm" onClick={() => set(rest.map((d) => [d.id, "virtual"]))}>{`모두 추가 (${rest.length})`}</Button>
                        )}
                      </ItemHeader>
                    </Item>
                    {hits.map((d) => {
                      const on = isPicked(d.id);
                      return (
                        <Item key={d.id} size="sm" asChild>
                          <button type="button" aria-pressed={on} onClick={() => set([[d.id, on ? "none" : "virtual"]])} className="w-full flex-nowrap text-left">
                            <ItemContent className="min-w-0">
                              <ItemTitle className="min-w-0 truncate">{deviceName(d)}</ItemTitle>
                              <ItemDescription>{d.roomLabel}</ItemDescription>
                            </ItemContent>
                            <ItemActions>{on ? <Status variant="success">추가됨</Status> : <Status>추가</Status>}</ItemActions>
                          </button>
                        </Item>
                      );
                    })}
                  </>
                )}
              </ItemGroup>
            </Card>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Status>{`추가 ${picked.length} · 신호 없음 ${devices.length - picked.length}`}</Status>
          {picked.length > 0 && <Button variant="ghost" size="sm" onClick={() => set(devices.map((d) => [d.id, "none"]))}>모두 빼기</Button>}
        </div>
        <div className="min-h-0 flex-1 overflow-auto">
          {devices.length === 0 ? <Alert><AlertTitle>이 집 배치에 가전이 없어요.</AlertTitle></Alert>
            : picked.length === 0 ? <Alert><AlertTitle>아직 추가한 가전이 없어요. 위에서 검색해서 추가하세요.</AlertTitle></Alert>
            : (
              <div role="list" aria-label="추가한 가전" className="flex flex-wrap gap-1.5">
                {picked.map((d) => (
                  <RemovableBadge key={d.id} role="listitem" removeLabel={`${d.roomLabel} ${d.label} 빼기`} onRemove={() => set([[d.id, "none"]])}>
                    {!d.label.includes(d.roomLabel) && <span className="me-1.5">{d.roomLabel}</span>}
                    <span>{deviceName(d)}</span>
                  </RemovableBadge>
                ))}
              </div>
            )}
        </div>
      </CardContent>
      <CardFooter className="justify-end gap-2">
        <Button variant="outline" onClick={onBack}>이전</Button>
        <Button disabled={busy} onClick={onNext}>다음</Button>
      </CardFooter>
    </section>
  );
}
