// 21st.dev「Table」(id 88, originui/table) 받은 코드.
// 바꾼 것: 기존 표에 놓는 이름 셀의 가지와 활동 머리행에 공용 토큰을 연결했다.
// 원래 글 크기: text-sm(14px).
import type { ReactNode } from "react";
import { TableRow } from "./table";
import "./trace-tree-cell.css";

export function TraceActivityRow({ title, running, outcome, reason }: {
  title: string;
  running?: boolean;
  outcome?: string;
  reason?: string;
}) {
  return <TableRow className="trace-activity-row" data-current={running || undefined}>
    <th scope="rowgroup" colSpan={5}>
      <span className="trace-activity-title">{title}</span>
      {reason && <span className="trace-activity-detail">{reason}</span>}
      {outcome && <span className="trace-activity-detail">{outcome}</span>}
    </th>
  </TableRow>;
}

export function TraceNameCell({ children, last, opensBranch, continuesRoot, guard, className }: {
  children: ReactNode;
  last: boolean;
  opensBranch?: boolean;
  continuesRoot?: boolean;
  guard?: string;
  className?: string;
}) {
  return <td className={className} data-trace-name data-last={last}>
    <span aria-hidden="true" className="trace-stem"><span /></span>
    {opensBranch && <span aria-hidden="true" className="trace-child-stem" />}
    {continuesRoot && <span aria-hidden="true" className="trace-root-stem" />}
    <span>{children}</span>
    {guard && <span className="trace-guard"><span>관련 안전 개입</span> · <span>{guard}</span></span>}
  </td>;
}
