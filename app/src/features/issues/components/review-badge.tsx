import type { ReviewStatus } from "@server/schemas";
import { Badge } from "@/components/ui/badge";
import {
  REVIEW_BADGE_VARIANT,
  REVIEW_LABEL,
} from "../lib/derived";

export function ReviewBadge({ status }: { status: ReviewStatus }) {
  return (
    <Badge variant={REVIEW_BADGE_VARIANT[status]}>
      review: {REVIEW_LABEL[status]}
    </Badge>
  );
}
