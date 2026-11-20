import { Link } from "react-router-dom";
import { issuePath } from "../lib/links";

/**
 * Planning tab while an append Idea holds the outline planner lock.
 * The Idea title opens that Idea.
 */
export function OutlinePlanningLockNote({
  projectId,
  ideaId,
  ideaTitle,
}: {
  projectId: string;
  ideaId: string;
  ideaTitle: string;
}) {
  return (
    <p
      data-testid="outline-planning-lock"
      className="shrink-0 border-b border-border px-4 py-3 text-sm text-muted-foreground"
    >
      Planning continues on{" "}
      <Link
        to={issuePath(projectId, ideaId)}
        className="text-primary hover:underline"
      >
        {ideaTitle}
      </Link>
      .
    </p>
  );
}
