"use client";

// 21st.dev「Radio Group」(id 748, originui/radio-group) 받은 코드.
// 바꾼 것: shadow-black/5 → shadow-shade/5. 「Card with icon」 데모의 카드 틀을 RadioCard로 내보낸다(has-[[data-state=checked]]:border-ring 그대로, ring=brand).
// 카드사 그림 svg는 뺐고 그 자리에 lucide 아이콘(icon)을 받는다. 이름·덧이름·설명 글은 밖에서 받는다(데이터 연결), text-xs → label 토큰(굵기는 받은 대로 보통).
import * as RadioGroupPrimitive from "@radix-ui/react-radio-group";
import * as React from "react";

import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

const RadioGroup = React.forwardRef<
  React.ElementRef<typeof RadioGroupPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof RadioGroupPrimitive.Root>
>(({ className, ...props }, ref) => {
  return (
    <RadioGroupPrimitive.Root
      className={cn("grid gap-3", className)}
      {...props}
      ref={ref}
    />
  );
});
RadioGroup.displayName = RadioGroupPrimitive.Root.displayName;

const RadioGroupItem = React.forwardRef<
  React.ElementRef<typeof RadioGroupPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof RadioGroupPrimitive.Item>
>(({ className, ...props }, ref) => {
  return (
    <RadioGroupPrimitive.Item
      ref={ref}
      className={cn(
        "aspect-square size-4 rounded-full border border-input shadow-sm shadow-shade/5 outline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring/70 disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:border-primary data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground",
        className,
      )}
      {...props}
    >
      <RadioGroupPrimitive.Indicator className="flex items-center justify-center text-current">
        <svg
          width="6"
          height="6"
          viewBox="0 0 6 6"
          fill="currentcolor"
          xmlns="http://www.w3.org/2000/svg"
        >
          <circle cx="3" cy="3" r="3" />
        </svg>
      </RadioGroupPrimitive.Indicator>
    </RadioGroupPrimitive.Item>
  );
});
RadioGroupItem.displayName = RadioGroupPrimitive.Item.displayName;

type RadioCardProps = {
  value: string;
  label: React.ReactNode;
  sublabel?: React.ReactNode;
  description?: React.ReactNode;
  icon?: React.ReactNode;
  disabled?: boolean;
};

/** 「Card with icon」 데모 카드 한 장. */
function RadioCard({ value, label, sublabel, description, icon, disabled }: RadioCardProps) {
  const id = React.useId();
  return (
    <div className="relative flex w-full items-start gap-2 rounded-lg border border-input p-4 shadow-sm shadow-shade/5 has-[[data-state=checked]]:border-ring">
      <RadioGroupItem
        value={value}
        id={`${id}-1`}
        disabled={disabled}
        aria-describedby={description ? `${id}-1-description` : undefined}
        className="order-1 after:absolute after:inset-0"
      />
      <div className="flex grow items-start gap-3">
        {icon && <span className="shrink-0 [&_svg]:size-6" aria-hidden="true">{icon}</span>}
        <div className="grid grow gap-2">
          <Label htmlFor={`${id}-1`}>
            {label}{sublabel && " "}
            {sublabel && (
              <span className="text-label font-normal leading-[inherit] text-muted-foreground">
                {sublabel}
              </span>
            )}
          </Label>
          {description && (
            <div id={`${id}-1-description`} className="text-label font-normal text-muted-foreground">
              {description}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export { RadioGroup, RadioGroupItem, RadioCard };

export default RadioGroup;
