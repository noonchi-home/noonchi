import { Fragment } from "react";
import { Item, ItemDescription, ItemTitle } from "../components/ui/item";
import type { NarrationLines } from "./narration";

const fields = [["status", "상태"], ["judgment", "판단"], ["execution", "실행"]] as const;

export function NarrationPane({ lines }: { lines: NarrationLines }) {
  return (
    <Item asChild size="sm" className="grid w-full min-w-0 grid-cols-[max-content_minmax(0,1fr)] items-baseline gap-x-3 gap-y-1.5">
      <dl data-narration aria-label="클로이드의 설명" aria-live="polite">
        {fields.map(([key, label]) => (
          <Fragment key={key}>
            <dt><ItemDescription>{label}</ItemDescription></dt>
            <dd className="min-w-0 wrap-anywhere">
              {key === "execution" ? <ItemTitle className="block">{lines[key]}</ItemTitle> : lines[key]}
            </dd>
          </Fragment>
        ))}
      </dl>
    </Item>
  );
}
