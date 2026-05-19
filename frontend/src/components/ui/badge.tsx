import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "../../lib/utils";

const badgeVariants = cva(
  "inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-semibold transition-colors",
  {
    variants: {
      variant: {
        default: "border-transparent bg-[var(--focus)] text-white",
        secondary:
          "border-transparent bg-[var(--wash)] text-[var(--muted-strong)]",
        destructive:
          "border-transparent bg-[var(--red-soft)] text-[var(--red)]",
        outline: "border-[var(--line)] text-[var(--ink)]",
        success:
          "border-transparent bg-[var(--green-soft)] text-[var(--green)]",
        warning:
          "border-transparent bg-[var(--amber-soft)] text-[var(--amber)]",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
