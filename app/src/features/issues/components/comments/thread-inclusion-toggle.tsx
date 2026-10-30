import { Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils/cn";

const INCLUDED_LABEL = "Included in next submission";
const EXCLUDED_LABEL = "Not included in next submission";

/** Send glyph for whether an open review thread goes out with the next submission. */
export function ThreadInclusionToggle({
  included,
  pending = false,
  onToggle,
}: {
  included: boolean;
  pending?: boolean;
  onToggle: () => void;
}) {
  const label = included ? INCLUDED_LABEL : EXCLUDED_LABEL;
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      className={cn(
        "shrink-0",
        included
          ? "text-[hsl(var(--current))] hover:text-[hsl(var(--current))]"
          : "text-muted-foreground",
      )}
      aria-pressed={included}
      aria-label={label}
      title={label}
      data-testid="thread-inclusion-toggle"
      disabled={pending}
      onClick={onToggle}
    >
      <Send aria-hidden fill={included ? "currentColor" : "none"} />
    </Button>
  );
}
