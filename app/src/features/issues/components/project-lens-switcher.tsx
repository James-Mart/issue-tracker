import { Link } from "react-router-dom";
import { projectReviewPath } from "@/features/reviews/lib/links";
import { cn } from "@/lib/utils/cn";
import { projectLensPath, projectPath } from "../lib/links";
import {
  OVERVIEW_LENS_OPTIONS,
  type OverviewLens,
} from "../lib/overview-lens";

export type ProjectLens = OverviewLens | "review";

const OVERVIEW_LENS_PATH: Record<OverviewLens, (projectId: string) => string> = {
  structure: projectPath,
  overview: (projectId) => projectLensPath(projectId, "overview"),
};

const LENS_LINK_CLASS =
  "rounded-[calc(var(--radius)-2px)] px-3 py-1.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

/**
 * Structure, Overview, and Code review. Code review is its own route.
 * On that route the other lenses link back to the Project page.
 */
export function ProjectLensSwitcher({
  projectId,
  active,
}: {
  projectId: string;
  active: ProjectLens;
}) {
  const onReview = active === "review";
  const lenses: Array<{
    id: ProjectLens;
    label: string;
    to: string;
    replace: boolean;
  }> = [
    ...OVERVIEW_LENS_OPTIONS.map(({ id, label }) => ({
      id,
      label,
      to: OVERVIEW_LENS_PATH[id](projectId),
      replace: !onReview,
    })),
    {
      id: "review",
      label: "Code review",
      to: projectReviewPath(projectId),
      replace: false,
    },
  ];

  return (
    <nav
      aria-label="Project lenses"
      className="flex flex-wrap items-center gap-0.5 rounded-md border border-border p-0.5"
    >
      {lenses.map(({ id, label, to, replace }) => {
        const selected = active === id;
        return (
          <Link
            key={id}
            to={to}
            replace={replace}
            aria-current={selected ? "page" : undefined}
            className={cn(
              LENS_LINK_CLASS,
              selected
                ? "bg-secondary text-secondary-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
