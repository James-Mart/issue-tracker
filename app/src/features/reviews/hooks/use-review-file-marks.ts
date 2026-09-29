import { useMemo, useState, type Dispatch, type SetStateAction } from "react";
import type { ReviewDiffFile, ReviewView } from "@server/schemas";
import { useSetReviewMark } from "../api/mutations";
import { scopeFileRows, type ReviewFileRow } from "../lib/review-files";
import type { ReviewMarkOverrides } from "../lib/review-scope";

/**
 * Scope rows with optimistic Reviewed marks, plus each file's collapse state.
 * A file starts collapsed when reviewed; checking collapses it and unchecking
 * expands it. A failed write reverts both the mark and the collapse.
 */
export function useReviewFileMarks(
  projectId: string,
  review: ReviewView,
  files: ReviewDiffFile[],
  scope: string,
  overrides: ReviewMarkOverrides,
  setOverrides: Dispatch<SetStateAction<ReviewMarkOverrides>>,
): {
  rows: ReviewFileRow[];
  isCollapsed: (row: ReviewFileRow) => boolean;
  toggleCollapsed: (row: ReviewFileRow) => void;
  setReviewed: (path: string, reviewed: boolean) => void;
} {
  const setMark = useSetReviewMark(projectId);
  const [collapsedOverrides, setCollapsedOverrides] = useState<
    Record<string, Record<string, boolean>>
  >({});
  const scopeOverrides = overrides[scope];
  const scopeCollapsed = collapsedOverrides[scope];

  const rows = useMemo(
    () =>
      scopeFileRows(review, files, scope).map((row) => ({
        ...row,
        reviewed: scopeOverrides?.[row.file.path] ?? row.reviewed,
      })),
    [files, review, scope, scopeOverrides],
  );

  const isCollapsed = (row: ReviewFileRow) =>
    scopeCollapsed?.[row.file.path] ?? row.reviewed;

  const toggleCollapsed = (row: ReviewFileRow) =>
    setCollapsedOverrides((prev) => ({
      ...prev,
      [scope]: { ...prev[scope], [row.file.path]: !isCollapsed(row) },
    }));

  const setReviewed = (path: string, reviewed: boolean) => {
    setOverrides((prev) => ({
      ...prev,
      [scope]: { ...prev[scope], [path]: reviewed },
    }));
    setCollapsedOverrides((prev) => ({
      ...prev,
      [scope]: { ...prev[scope], [path]: reviewed },
    }));
    setMark.mutate(
      { reviewId: review.id, scope, path, reviewed },
      {
        onError: () =>
          setCollapsedOverrides((prev) => {
            const bucket = prev[scope];
            if (!bucket || !(path in bucket)) return prev;
            const { [path]: _dropped, ...rest } = bucket;
            return { ...prev, [scope]: rest };
          }),
        // A later click on the same file owns the optimistic mark until its own write settles.
        onSettled: () =>
          setOverrides((prev) => {
            const bucket = prev[scope];
            if (!bucket || bucket[path] !== reviewed) return prev;
            const { [path]: _dropped, ...rest } = bucket;
            return { ...prev, [scope]: rest };
          }),
      },
    );
  };

  return { rows, isCollapsed, toggleCollapsed, setReviewed };
}
