import { useMemo, useState } from "react";
import type { ReviewDiffFile, ReviewView } from "@server/schemas";
import { useSetReviewMark } from "../api/mutations";
import { allChangesFileRows, type ReviewFileRow } from "../lib/review-files";

const ALL_CHANGES_SCOPE = "all";

/**
 * "All changes" rows with optimistic Reviewed marks, plus each file's collapse
 * state. A file starts collapsed when reviewed; checking collapses it and
 * unchecking expands it. A failed write reverts both the mark and the collapse.
 */
export function useReviewFileMarks(
  projectId: string,
  review: ReviewView,
  files: ReviewDiffFile[],
): {
  rows: ReviewFileRow[];
  isCollapsed: (row: ReviewFileRow) => boolean;
  toggleCollapsed: (row: ReviewFileRow) => void;
  setReviewed: (path: string, reviewed: boolean) => void;
} {
  const setMark = useSetReviewMark(projectId);
  const [optimisticMarks, setOptimisticMarks] = useState<Record<string, boolean>>({});
  const [collapsedOverrides, setCollapsedOverrides] = useState<Record<string, boolean>>({});

  const rows = useMemo(
    () =>
      allChangesFileRows(review, files).map((row) => ({
        ...row,
        reviewed: optimisticMarks[row.file.path] ?? row.reviewed,
      })),
    [files, optimisticMarks, review],
  );

  const isCollapsed = (row: ReviewFileRow) =>
    collapsedOverrides[row.file.path] ?? row.reviewed;

  const toggleCollapsed = (row: ReviewFileRow) =>
    setCollapsedOverrides((prev) => ({ ...prev, [row.file.path]: !isCollapsed(row) }));

  const setReviewed = (path: string, reviewed: boolean) => {
    setOptimisticMarks((prev) => ({ ...prev, [path]: reviewed }));
    setCollapsedOverrides((prev) => ({ ...prev, [path]: reviewed }));
    setMark.mutate(
      { reviewId: review.id, scope: ALL_CHANGES_SCOPE, path, reviewed },
      {
        onError: () =>
          setCollapsedOverrides(({ [path]: _dropped, ...rest }) => rest),
        // A later click on the same file owns the optimistic mark until its own write settles.
        onSettled: () =>
          setOptimisticMarks((prev) => {
            if (prev[path] !== reviewed) return prev;
            const { [path]: _dropped, ...rest } = prev;
            return rest;
          }),
      },
    );
  };

  return { rows, isCollapsed, toggleCollapsed, setReviewed };
}
