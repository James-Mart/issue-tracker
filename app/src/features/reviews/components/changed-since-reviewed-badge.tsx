import { History } from "lucide-react";
import { Badge } from "@/components/ui/badge";

export function ChangedSinceReviewedBadge() {
  return (
    <Badge
      variant="warn"
      className="shrink-0 gap-1 px-1.5 py-0 font-mono font-medium"
      data-testid="review-changed-since-badge"
      title="A newer commit changed this file after it was marked reviewed"
    >
      <History className="h-3 w-3" aria-hidden="true" />
      Changed since reviewed
    </Badge>
  );
}
