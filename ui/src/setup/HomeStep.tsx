import { House } from "lucide-react";
import type { SetupView } from "../../../src/contract/setup.ts";
import { Button } from "../components/ui/button";
import { CardContent, CardFooter, CardHeader, CardTitle } from "../components/ui/card";
import { RadioCard, RadioGroup } from "../components/ui/radio-group";
import { Status } from "../components/ui/status";

/** 1 집 고르기. 지금 띄운 집이 먼저 골라져 있다. */
export function HomeStep({ view, picked, onPick, onNext, busy }: {
  view: SetupView; picked: string | null; onPick: (id: string) => void; onNext: () => void; busy: boolean;
}) {
  return (
    <section aria-labelledby="h-home" className="flex flex-col">
      <CardHeader className="flex-row items-start justify-between space-y-0">
        <CardTitle id="h-home">어느 집을 쓸까요?</CardTitle>
        <img src="/brand/mascot@1x.webp" alt="" className="m-3 h-[120px] w-auto shrink-0" />
      </CardHeader>
      <CardContent>
        <RadioGroup aria-labelledby="h-home" value={picked ?? ""} onValueChange={onPick} className="max-w-xl gap-2">
          {view.homes.map((h) => (
            <RadioCard
              key={h.id} value={h.id} label={h.name} icon={<House />}
              description={h.id === view.home?.id ? <Status>지금 띄운 집</Status> : undefined}
            />
          ))}
        </RadioGroup>
      </CardContent>
      <CardFooter className="justify-end gap-2">
        <Button disabled={busy || !picked} onClick={onNext}>다음</Button>
      </CardFooter>
    </section>
  );
}
