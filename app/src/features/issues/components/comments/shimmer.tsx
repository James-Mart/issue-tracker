import { cn } from "@/lib/utils/cn";

/** Current-hued live label; animates only when motion is allowed. */
export function Shimmer({
  label = "agent working…",
  className,
}: {
  label?: string;
  className?: string;
}) {
  return (
    <div
      className={cn("flex items-center gap-1.5 px-1 text-xs", className)}
      role="status"
      aria-live="polite"
    >
      <span className="chat-shimmer font-medium">{label}</span>
    </div>
  );
}
