import type { ReactNode } from "react";
import { useMemo } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import { useIssuesQuery } from "../api/queries";
import { issuesById, projectIdOf } from "../lib/build-tree";
import {
  type IssueBackLocationState,
  issueBackNavigateState,
} from "../lib/issue-back";
import { issuePath, linkNotFoundMessage } from "../lib/links";

export function useIssueLinkNavigate(): {
  go: (id: string) => void;
  hrefFor: (id: string) => string;
} {
  const navigate = useNavigate();
  const location = useLocation();
  const { projectId: routeProjectId } = useParams();
  const { data } = useIssuesQuery();
  const byId = useMemo(
    () => issuesById(data?.issues ?? []),
    [data?.issues],
  );

  const hrefFor = (id: string): string => {
    const projectId = projectIdOf(id, byId) ?? routeProjectId;
    return projectId ? issuePath(projectId, id) : "#";
  };

  const go = (id: string) => {
    if (data && !byId.has(id)) {
      toast.error(linkNotFoundMessage(id));
      return;
    }
    const projectId = projectIdOf(id, byId) ?? routeProjectId;
    if (!projectId) {
      toast.error(linkNotFoundMessage(id));
      return;
    }
    const navigateState = issueBackNavigateState(
      location.pathname,
      location.search,
      (location.state as IssueBackLocationState | null)?.issueBackStack,
    );
    navigate(
      issuePath(projectId, id),
      navigateState ? { state: navigateState } : undefined,
    );
  };

  return { go, hrefFor };
}

export function IssueLink({
  id,
  children,
  className,
}: {
  id: string;
  children: ReactNode;
  className?: string;
}) {
  const { go, hrefFor } = useIssueLinkNavigate();

  return (
    <a
      href={hrefFor(id)}
      className={className}
      onClick={(e) => {
        e.preventDefault();
        go(id);
      }}
    >
      {children}
    </a>
  );
}
