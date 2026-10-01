import { Check } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import {
  changedFileRowClass,
  DiffLineCounts,
} from "@/features/issues/components/changed-file-row";
import type { ReviewFileRow } from "../lib/review-files";
import { ChangedSinceReviewedBadge } from "./changed-since-reviewed-badge";

/** Checkbox look without the control: tree rows are buttons, which cannot nest one. */
function ReviewMarkIndicator({ reviewed }: { reviewed: boolean }) {
  return (
    <span
      role="img"
      aria-label={reviewed ? "Reviewed" : "Not reviewed"}
      className={cn(
        "flex h-4 w-4 shrink-0 items-center justify-center rounded-sm border text-primary-foreground",
        reviewed ? "border-primary bg-primary" : "border-input bg-card",
      )}
    >
      {reviewed ? <Check className="h-3.5 w-3.5" aria-hidden="true" /> : null}
    </span>
  );
}

export function ReviewFileTree({
  rows,
  selectedPath,
  onSelect,
}: {
  rows: ReviewFileRow[];
  selectedPath: string | undefined;
  onSelect: (path: string) => void;
}) {
  return (
    <nav
      aria-label="Changed files"
      data-testid="review-file-tree"
      className="min-w-0"
    >
      <ul className="flex max-h-48 flex-col gap-1 overflow-y-auto shell:max-h-none shell:overflow-visible">
        {rows.map(({ file, reviewed, changedSinceReviewed }) => {
          const selected = file.path === selectedPath;
          return (
            <li key={file.path}>
              <button
                type="button"
                title={file.path}
                aria-current={selected ? "true" : undefined}
                data-testid="review-tree-file"
                data-path={file.path}
                data-reviewed={reviewed ? "true" : "false"}
                onClick={() => onSelect(file.path)}
                className={cn(
                  "flex w-full flex-col items-start gap-1",
                  changedFileRowClass(selected),
                )}
              >
                <span className="flex w-full min-w-0 items-center gap-2">
                  <ReviewMarkIndicator reviewed={reviewed} />
                  <span className="min-w-0 truncate">{file.path}</span>
                  <DiffLineCounts
                    additions={file.additions}
                    deletions={file.deletions}
                    className="ml-auto shrink-0"
                  />
                </span>
                {changedSinceReviewed ? <ChangedSinceReviewedBadge /> : null}
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
