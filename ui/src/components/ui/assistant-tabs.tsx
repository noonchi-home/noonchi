"use client";

// 21st.dev「Assistant Tabs」(id 28429, shadcnspace/tabs-10) 받은 코드.
// 바꾼 것: 데모 패널(대화·음성·영상·설정)과 그 안의 입력칸·스위치는 뺐다. 탭 목록과 내용은 밖에서 받는다.
// 고르지 않은 탭은 아이콘만 보여서 탭마다 aria-label을 붙였다.
import type { ReactNode } from "react";
import { motion, AnimatePresence } from "motion/react";
import type { LucideIcon } from "lucide-react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

export type AssistantTab = { value: string; label: string; icon: LucideIcon };

/** 알약 탭 목록: 고른 탭만 이름이 펼쳐진다. */
export function AssistantTabsList({ tabs, value, className }: { tabs: AssistantTab[]; value: string; className?: string }) {
  return (
    <TabsList className={cn("h-auto! gap-1 rounded-full bg-muted p-1 flex w-full items-center justify-between", className)}>
      {tabs.map(({ value: itemValue, label, icon: Icon }) => {
        const isActive = value === itemValue;
        return (
          <TabsTrigger
            key={itemValue}
            value={itemValue}
            aria-label={label}
            className={cn(
              "rounded-full border-none py-1.5 text-sm font-medium text-muted-foreground dark:data-active:bg-background data-active:bg-background data-active:text-foreground group-data-[variant=default]/tabs-list:data-active:shadow-xs cursor-pointer transition-all duration-300 flex items-center justify-center flex-1",
              isActive ? "px-4" : "px-3",
            )}
          >
            <Icon className="size-4 shrink-0" />
            <AnimatePresence initial={false}>
              {isActive && (
                <motion.span
                  initial={{ width: 0, opacity: 0, marginLeft: 0 }}
                  animate={{ width: "auto", opacity: 1, marginLeft: 6 }}
                  exit={{ width: 0, opacity: 0, marginLeft: 0 }}
                  transition={{ duration: 0.2, ease: "easeInOut" }}
                  className="overflow-hidden whitespace-nowrap text-sm font-medium inline-block"
                >
                  {label}
                </motion.span>
              )}
            </AnimatePresence>
          </TabsTrigger>
        );
      })}
    </TabsList>
  );
}

/** 탭 내용: 바뀔 때 살짝 올라오며 나타난다. */
export function AssistantTabPanel({ value, className, children }: { value: string; className?: string; children: ReactNode }) {
  return (
    <TabsContent value={value} className={cn("outline-none p-0 mt-0", className)}>
      <motion.div
        key={value}
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -8 }}
        transition={{ duration: 0.2, ease: "easeOut" }}
        className="flex h-full min-h-0 w-full flex-col"
      >
        {children}
      </motion.div>
    </TabsContent>
  );
}

export { Tabs };
