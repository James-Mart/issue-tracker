import * as React from "react";
import { formControlSurface } from "@/components/ui/form-surfaces";
import { cn } from "@/lib/utils/cn";

export const Input = React.forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement>
>(({ className, type, ...props }, ref) => (
  <input
    type={type}
    ref={ref}
    className={cn(
      "flex h-9 w-full rounded-md px-3 py-1 text-sm",
      formControlSurface,
      className,
    )}
    {...props}
  />
));
Input.displayName = "Input";
