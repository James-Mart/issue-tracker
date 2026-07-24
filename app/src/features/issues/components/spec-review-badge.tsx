import type { SpecReviewStatus } from "@server/schemas";
import { Badge } from "@/components/ui/badge";
import {
  SPEC_REVIEW_BADGE_VARIANT,
  SPEC_REVIEW_LABEL,
} from "../lib/derived";

export function SpecReviewBadge({ status }: { status: SpecReviewStatus }) {
  return (
    <Badge variant={SPEC_REVIEW_BADGE_VARIANT[status]}>
      specReview: {SPEC_REVIEW_LABEL[status]}
    </Badge>
  );
}
