/** Top-level CLI verbs removed in favor of `issue <kind> get|set`. */
export const DELETED_FIELD_VERBS = [
  "set-status",
  "set-commit",
  "set-workspace",
  "set-merge-policy",
  "set-branch-name",
  "set-stacked-on",
  "set-part-of",
  "set-spec-review",
  "set-no-diff",
  "set-description",
  "assign",
  "assignee",
  "open-pr",
  "set-merged",
  "block",
  "attention",
] as const;
