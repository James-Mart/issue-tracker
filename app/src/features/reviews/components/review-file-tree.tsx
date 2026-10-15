import { type KeyboardEvent } from "react";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import {
  changedFileRowClass,
  DiffLineCounts,
} from "@/features/issues/components/changed-file-row";
import type { ReviewFileRow } from "../lib/review-files";
import { ChangedSinceReviewedBadge } from "./changed-since-reviewed-badge";
import { ReviewPathScroll } from "./review-path-scroll";

/** Checkbox look without the control: the mark does not toggle reviewed. */
function ReviewMarkIndicator({ reviewed }: { reviewed: boolean }) {
  return (
    <span
      role="img"
      aria-label={reviewed ? "Reviewed" : "Not reviewed"}
      data-testid="review-tree-reviewed"
      className={cn(
        "flex h-4 w-4 shrink-0 items-center justify-center rounded-sm border text-primary-foreground",
        reviewed ? "border-primary bg-primary" : "border-input bg-card",
      )}
    >
      {reviewed ? <Check className="h-3.5 w-3.5" aria-hidden="true" /> : null}
    </span>
  );
}

function ReviewFileTreeRow({
  file,
  reviewed,
  changedSinceReviewed,
  selected,
  onSelect,
}: ReviewFileRow & {
  selected: boolean;
  onSelect: (path: string) => void;
}) {
  const select = () => onSelect(file.path);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    select();
  };

  return (
    // A button element does not scroll an overflow child on touch.
    <div
      role="button"
      tabIndex={0}
      title={file.path}
      aria-current={selected ? "true" : undefined}
      data-testid="review-tree-file"
      data-path={file.path}
      data-reviewed={reviewed ? "true" : "false"}
      onClick={select}
      onKeyDown={onKeyDown}
      className={cn("flex w-full flex-col items-start gap-1", changedFileRowClass(selected))}
    >
      <span className="flex w-full min-w-0 items-center gap-2">
        <ReviewMarkIndicator reviewed={reviewed} />
        <ReviewPathScroll pathKey={file.path} title={file.path}>
          {file.path}
        </ReviewPathScroll>
        <DiffLineCounts
          additions={file.additions}
          deletions={file.deletions}
          className="ml-auto shrink-0"
        />
      </span>
      {changedSinceReviewed ? <ChangedSinceReviewedBadge /> : null}
    </div>
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
    <nav aria-label="Changed files" data-testid="review-file-tree" className="min-w-0">
      <ul className="flex max-h-48 flex-col gap-1 overflow-y-auto shell:max-h-none shell:overflow-visible">
        {rows.map((row) => (
          <li key={row.file.path}>
            <ReviewFileTreeRow
              {...row}
              selected={row.file.path === selectedPath}
              onSelect={onSelect}
            />
          </li>
        ))}
      </ul>
    </nav>
  );
}
