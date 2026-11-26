import { ItemDescription, ItemTitle } from "../components/ui/item";
import { Table, TableBody, TableHeader, TableRow } from "../components/ui/table";
import type { Rect } from "./layout";
import type { StatusRow } from "./timeline";
import { WORDS } from "./words";

function ChangedAt({ since, tzMinutes }: { since: number | null; tzMinutes?: number | null }) {
  if (since === null) return <>—</>;
  const date = new Date(since);
  const offset = tzMinutes ?? -date.getTimezoneOffset();
  const time = new Date(since + offset * 60_000).toISOString().slice(11, 19);
  return <time dateTime={date.toISOString()}>{time}</time>;
}

export function StatusTable({ rows, box, tzMinutes, progress }: { progress?: { label: string; index: number; total: number }; rows: readonly StatusRow[]; box: Rect; tzMinutes?: number | null }) {
  return (
    <div data-status-table className="absolute flex items-center overflow-auto px-2 py-2 sm:px-5" style={{ left: box.left, top: box.top, width: box.width, height: box.height }}>
      <Table aria-label="현재 상태" className="w-full table-auto text-left">
        <TableHeader><TableRow>{["대상", "지금 상태", "바뀐 시각"].map(label => <th key={label} scope="col" className="pb-2 pr-1 last:pr-0 last:text-right">
          <ItemDescription>{label}</ItemDescription>
        </th>)}</TableRow></TableHeader>
        <TableBody>{rows.map(row => (
          <TableRow key={row.id} data-actor={row.id} aria-live="polite" aria-atomic="true">
            <th scope="row" className="py-2 pr-2"><ItemTitle className="whitespace-nowrap">{WORDS.timeline.rows[row.id]}</ItemTitle></th>
            <td className="py-2 pr-2"><ItemTitle className="block wrap-anywhere">{row.current ?? "—"}</ItemTitle>
              {row.id === "robot" && progress && progress.label === row.current && <ItemDescription>{progress.index}/{progress.total}단계</ItemDescription>}
            </td>
            <td className="py-2 text-right"><ItemDescription className="whitespace-nowrap tabular-nums"><ChangedAt since={row.since} tzMinutes={tzMinutes} /></ItemDescription></td>
          </TableRow>
        ))}</TableBody>
      </Table>
    </div>
  );
}
