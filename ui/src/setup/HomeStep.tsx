import { House } from "lucide-react";
import type { SetupView } from "../../../src/contract/setup.ts";
import { Button } from "../components/ui/button";
import { CardContent, CardFooter } from "../components/ui/card";
import { RadioCard, RadioGroup } from "../components/ui/radio-group";
import { Status } from "../components/ui/status";
import { shortName } from "../lib/hub";

/** 1 집 고르기. 지금 띄운 집이 먼저 골라져 있다. 제목(h-home)은 설정 화면 말풍선이 단다. */
export function HomeStep({ view, picked, onPick, onNext, busy }: {
  view: SetupView; picked: string | null; onPick: (id: string) => void; onNext: () => void; busy: boolean;
}) {
  return (
    <section aria-labelledby="h-home" className="flex min-h-0 flex-1 flex-col">
      <CardContent>
        <RadioGroup aria-labelledby="h-home" value={picked ?? ""} onValueChange={onPick} className="max-w-xl gap-2">
          {view.homes.map((h) => (
            <RadioCard
              key={h.id} value={h.id} label={shortName(h.name)} icon={<House />}
              size="lg" description={h.id === view.home?.id ? <Status size="setup">지금 띄운 집</Status> : undefined}
            />
          ))}
        </RadioGroup>
      </CardContent>
      <CardFooter className="mt-auto justify-end gap-2">
        <Button size="setup" disabled={busy || !picked} onClick={onNext}>다음</Button>
      </CardFooter>
    </section>
  );
}
