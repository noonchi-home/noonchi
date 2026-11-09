// 21st.dev「Input」(id 159, originui/input) 받은 코드.
// 바꾼 것: shadow-black/5 → shadow-shade/5, text-sm → body-sm 토큰, placeholder:text-muted-foreground/70 → placeholder:text-muted-foreground(ink-3, 4.5:1을 지키려고 70% 뺌). 설정 1~3단계 큰 글(사용자 2026-11-09 「1,2,3 글씨 더 키워도될거같고」): textSize lg(text-base, 높이 44px)를 더했다.
// 「Search input with icon and button」 데모 틀을 SearchInput으로 내보낸다(돋보기 아이콘). 데모의 오른쪽 제출 단추는 뺐다.
import { Search } from "lucide-react";
import { cn } from "@/lib/utils";
import * as React from "react";

const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<"input"> & { textSize?: "default" | "lg" }>(
  ({ className, type, textSize = "default", ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(
          "flex h-9 w-full rounded-lg border border-input bg-background px-3 py-2 text-body-sm text-foreground shadow-sm shadow-shade/5 transition-shadow placeholder:text-muted-foreground focus-visible:border-ring focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/20 disabled:cursor-not-allowed disabled:opacity-50",
          textSize === "lg" && "h-11 text-base",
          type === "search" &&
            "[&::-webkit-search-cancel-button]:appearance-none [&::-webkit-search-decoration]:appearance-none [&::-webkit-search-results-button]:appearance-none [&::-webkit-search-results-decoration]:appearance-none",
          type === "file" &&
            "p-0 pr-3 italic text-muted-foreground/70 file:me-3 file:h-full file:border-0 file:border-r file:border-solid file:border-input file:bg-transparent file:px-3 file:text-body-sm file:font-medium file:not-italic file:text-foreground",
          className,
        )}
        ref={ref}
        {...props}
      />
    );
  },
);
Input.displayName = "Input";

/** 돋보기 아이콘이 있는 검색칸(받은 데모 틀). */
const SearchInput = React.forwardRef<HTMLInputElement, Omit<React.ComponentProps<"input">, "type"> & { textSize?: "default" | "lg" }>(
  ({ className, ...props }, ref) => (
    <div className="relative">
      <Input ref={ref} className={cn("peer pe-9 ps-9", className)} type="search" {...props} />
      <div className="pointer-events-none absolute inset-y-0 start-0 flex items-center justify-center ps-3 text-muted-foreground/80 peer-disabled:opacity-50">
        <Search size={16} strokeWidth={2} aria-hidden="true" />
      </div>
    </div>
  ),
);
SearchInput.displayName = "SearchInput";

export { Input, SearchInput };
