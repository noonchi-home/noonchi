// 21st.dev「Table」(id 88, originui/table) 받은 코드.
// 바꾼 것: 읽기 전용 상태표에 쓰는 표·머리·몸·행만 쓰고, 선택과 마우스 효과 대신 행 주체 점과 현재 상태 글에 주제 색을 준다.
// 원래 글 크기: text-sm(14px).
import * as React from "react";

import { cn } from "@/lib/utils";

const Table = React.forwardRef<HTMLTableElement, React.HTMLAttributes<HTMLTableElement>>(
  ({ className, ...props }, ref) => (
    <div className="relative w-full overflow-auto">
      <table ref={ref} className={cn("w-full caption-bottom text-sm", className)} {...props} />
    </div>
  ),
);
Table.displayName = "Table";

const TableHeader = React.forwardRef<
  HTMLTableSectionElement,
  React.HTMLAttributes<HTMLTableSectionElement>
>(({ className, ...props }, ref) => <thead ref={ref} className={cn(className)} {...props} />);
TableHeader.displayName = "TableHeader";

const TableBody = React.forwardRef<
  HTMLTableSectionElement,
  React.HTMLAttributes<HTMLTableSectionElement>
>(({ className, ...props }, ref) => (
  <tbody ref={ref} className={cn("[&_tr:last-child]:border-0", className)} {...props} />
));
TableBody.displayName = "TableBody";

const TableRow = React.forwardRef<HTMLTableRowElement, React.HTMLAttributes<HTMLTableRowElement>>(
  ({ className, ...props }, ref) => (
    <tr
      ref={ref}
      className={cn(
        "border-b border-border [&[data-actor]_th>div]:before:inline-block [&[data-actor]_th>div]:before:size-2 [&[data-actor]_th>div]:before:shrink-0 [&[data-actor]_th>div]:before:rounded-full [&[data-actor]_th>div]:before:bg-muted-foreground [&[data-actor=robot]_th>div]:before:bg-brand [&[data-actor]_td:first-of-type>div:first-child]:text-brand",
        className,
      )}
      {...props}
    />
  ),
);
TableRow.displayName = "TableRow";

export { Table, TableBody, TableHeader, TableRow };
