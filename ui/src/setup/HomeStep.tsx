import type { SetupView } from "../../../src/contract/setup.ts";
import { cn } from "../lib/utils";
import { primary } from "./setup-api";

/** 1 집 고르기. 지금 띄운 집이 먼저 골라져 있다. */
export function HomeStep({ view, picked, onPick, onNext, busy }: {
  view: SetupView; picked: string | null; onPick: (id: string) => void; onNext: () => void; busy: boolean;
}) {
  return (
    <section aria-labelledby="h-home" className="flex flex-col gap-3">
      <h2 id="h-home" className="text-lg font-semibold">어느 집을 쓸까요?</h2>
      <div role="radiogroup" aria-labelledby="h-home" className="grid max-w-xl gap-2">
        {view.homes.map((h) => (
          <label
            key={h.id}
            className={cn("flex cursor-pointer items-center gap-3 rounded-xl border border-glass-line bg-field px-3 py-2.5",
              picked === h.id && "border-on bg-field-strong")}
          >
            <input type="radio" name="home" value={h.id} checked={picked === h.id} onChange={() => onPick(h.id)} className="accent-[var(--color-on)]" />
            <span className="flex-1">{h.name}</span>
            {h.id === view.home?.id && <span className="rounded-full bg-on/15 px-2 py-0.5 text-xs text-on">지금 띄운 집</span>}
          </label>
        ))}
      </div>
      <div className="flex justify-end gap-2 pt-1">
        <button type="button" className={primary} disabled={busy || !picked} onClick={onNext}>다음</button>
      </div>
    </section>
  );
}
