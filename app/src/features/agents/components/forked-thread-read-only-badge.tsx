import { Badge } from "@/components/ui/badge";

const READ_ONLY_TOOLTIP =
  "Can read the project and search the web, but cannot edit files, run commands, or write to the tracker.";

export function ForkedThreadReadOnlyBadge() {
  return (
    <Badge
      variant="secondary"
      data-testid="forked-thread-read-only-badge"
      title={READ_ONLY_TOOLTIP}
    >
      Read only
    </Badge>
  );
}
