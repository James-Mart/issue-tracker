import { useEffect, useRef, type ReactNode } from "react";
import { cn } from "@/lib/utils/cn";

export function MessageScroller({
  children,
  bottomKey,
  className,
}: {
  children: ReactNode;
  bottomKey: unknown;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [bottomKey]);

  return (
    <div
      ref={ref}
      className={cn(
        "flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-1 py-2",
        className,
      )}
    >
      {children}
    </div>
  );
}
