import * as React from "react";
import { cn } from "../../lib/utils";

const baseClass =
  "inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--tw-ring))] focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50";

const variantClasses = {
  default: "bg-[hsl(var(--tw-primary))] text-[hsl(var(--tw-primary-foreground))] hover:bg-[hsl(var(--tw-primary))]/90",
  destructive:
    "bg-[hsl(var(--tw-destructive))] text-[hsl(var(--tw-destructive-foreground))] hover:bg-[hsl(var(--tw-destructive))]/90",
  outline:
    "border border-[hsl(var(--tw-border))] bg-transparent hover:bg-[hsl(var(--tw-accent))] hover:text-[hsl(var(--tw-accent-foreground))]",
  secondary:
    "bg-[hsl(var(--tw-secondary))] text-[hsl(var(--tw-secondary-foreground))] hover:bg-[hsl(var(--tw-secondary))]/80",
  ghost: "hover:bg-[hsl(var(--tw-accent))] hover:text-[hsl(var(--tw-accent-foreground))]",
  link: "text-[hsl(var(--tw-primary))] underline-offset-4 hover:underline",
} as const;

const sizeClasses = {
  default: "h-10 px-4 py-2",
  sm: "h-9 rounded-md px-3",
  lg: "h-11 rounded-md px-8",
  icon: "h-10 w-10",
} as const;

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  asChild?: boolean;
  variant?: keyof typeof variantClasses;
  size?: keyof typeof sizeClasses;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "default", size = "default", asChild = false, ...props }, ref) => {
    return (
      <button
        className={cn(baseClass, variantClasses[variant], sizeClasses[size], className)}
        ref={ref}
        {...props}
      />
    );
  },
);
Button.displayName = "Button";

export { Button };
