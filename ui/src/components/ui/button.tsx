// 21st.dev「Button」(id 133, originui/button) 받은 코드.
// 바꾼 것: shadow-black/5 → shadow-shade/5, hover:bg-accent·hover:text-accent-foreground → hover:bg-hover·hover:text-ink(accent 별칭 없음).
// 원래 글 크기: text-sm(14px). 받은 크기 그대로다(sm은 text-xs). 더 큰 글은 npm run lint(scripts/lint-ui-type.ts)가 막는다.
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";

import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center whitespace-nowrap rounded-lg text-sm font-medium transition-colors outline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring/70 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default:
          "bg-primary text-primary-foreground shadow-sm shadow-shade/5 hover:bg-primary/90",
        destructive:
          "bg-destructive text-destructive-foreground shadow-sm shadow-shade/5 hover:bg-destructive/90",
        outline:
          "border border-input bg-background shadow-sm shadow-shade/5 hover:bg-hover hover:text-ink",
        secondary:
          "bg-secondary text-secondary-foreground shadow-sm shadow-shade/5 hover:bg-secondary/80",
        ghost: "hover:bg-hover hover:text-ink",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "h-9 px-4 py-2",
        sm: "h-8 rounded-lg px-3 text-xs",
        lg: "h-10 rounded-lg px-8",
        icon: "h-9 w-9",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export interface ButtonProps
  extends
    React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    );
  },
);
Button.displayName = "Button";

export { Button, buttonVariants };

export default Button;
