import * as React from "react";
import { formControlSurface } from "@/components/ui/form-surfaces";
import { cn } from "@/lib/utils/cn";

export const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(({ className, ...props }, ref) => (
  <textarea
    ref={ref}
    className={cn(
      "flex min-h-[80px] w-full rounded-md px-3 py-2 text-sm",
      formControlSurface,
      className,
    )}
    {...props}
  />
));
Textarea.displayName = "Textarea";
