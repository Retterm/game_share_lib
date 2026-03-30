import type { HTMLAttributes } from "react";

import { cn } from "../../lib/utils";

type AlertVariant = "default" | "destructive";

const variantClassName: Record<AlertVariant, string> = {
  default: "border-border bg-card text-card-foreground",
  destructive:
    "border-destructive/40 bg-destructive/10 text-destructive-foreground",
};

export function Alert({
  className,
  variant = "default",
  ...props
}: HTMLAttributes<HTMLDivElement> & { variant?: AlertVariant }) {
  return (
    <div
      className={cn(
        "rounded-lg border px-4 py-3 text-sm",
        variantClassName[variant],
        className,
      )}
      {...props}
    />
  );
}
