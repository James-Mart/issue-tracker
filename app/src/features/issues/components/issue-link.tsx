import type { ReactNode } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import { projectIdOf } from "../lib/build-tree";
import {
  type IssueBackLocationState,
  issueBackNavigateState,
} from "../lib/issue-back";
import { issuePath, linkNotFoundMessage } from "../lib/links";
import {
  IssueLinkResolution,
  type IssueSupplement,
  useSupplementedById,
} from "../hooks/use-supplemented-by-id";

export type { IssueSupplement };

export function useBoundNavigate(supplement: IssueSupplement): {
  go: (targetId: string) => void;
  hrefFor: (targetId: string) => string;
} & IssueSupplement {
  const navigate = useNavigate();
  const location = useLocation();
  const { projectId: routeProjectId } = useParams();

  const hrefFor = (targetId: string): string => {
    const projectId = projectIdOf(targetId, supplement.byId) ?? routeProjectId;
    return projectId ? issuePath(projectId, targetId) : "#";
  };

  const go = (targetId: string) => {
    if (supplement.listReady && !supplement.byId.has(targetId)) {
      // The per-issue read is still in flight. Stay quiet until it settles.
      if (
        supplement.missingIds.includes(targetId) &&
        !supplement.failedIds.has(targetId)
      ) {
        return;
      }
      toast.error(
        supplement.messageFor(targetId) ?? linkNotFoundMessage(targetId),
      );
      return;
    }
    const projectId = projectIdOf(targetId, supplement.byId) ?? routeProjectId;
    if (!projectId) {
      toast.error(linkNotFoundMessage(targetId));
      return;
    }
    const navigateState = issueBackNavigateState(
      location.pathname,
      location.search,
      (location.state as IssueBackLocationState | null)?.issueBackStack,
    );
    navigate(
      issuePath(projectId, targetId),
      navigateState ? { state: navigateState } : undefined,
    );
  };

  return { go, hrefFor, ...supplement };
}

export function useIssueLinkNavigate(id: string) {
  const supplement = useSupplementedById(id ? [id] : []);
  return useBoundNavigate(supplement);
}

function IssueAnchor({
  id,
  children,
  className,
  nav,
  resolve,
}: {
  id: string;
  children: ReactNode;
  className?: string;
  nav: ReturnType<typeof useBoundNavigate>;
  resolve: boolean;
}) {
  return (
    <>
      {resolve ? (
        <IssueLinkResolution
          missingIds={nav.missingIds}
          accept={nav.accept}
          reject={nav.reject}
        />
      ) : null}
      <a
        href={nav.hrefFor(id)}
        className={className}
        onClick={(e) => {
          e.preventDefault();
          nav.go(id);
        }}
      >
        {children}
      </a>
    </>
  );
}

function IssueLinkOwned({
  id,
  children,
  className,
}: {
  id: string;
  children: ReactNode;
  className?: string;
}) {
  const nav = useIssueLinkNavigate(id);
  return (
    <IssueAnchor
      id={id}
      className={className}
      nav={nav}
      resolve
    >
      {children}
    </IssueAnchor>
  );
}

function IssueLinkShared({
  id,
  children,
  className,
  supplement,
}: {
  id: string;
  children: ReactNode;
  className?: string;
  supplement: IssueSupplement;
}) {
  const nav = useBoundNavigate(supplement);
  return (
    <IssueAnchor id={id} className={className} nav={nav} resolve={false}>
      {children}
    </IssueAnchor>
  );
}

export function IssueLink({
  id,
  children,
  className,
  supplement,
}: {
  id: string;
  children: ReactNode;
  className?: string;
  supplement?: IssueSupplement;
}) {
  if (supplement) {
    return (
      <IssueLinkShared
        id={id}
        className={className}
        supplement={supplement}
      >
        {children}
      </IssueLinkShared>
    );
  }
  return (
    <IssueLinkOwned id={id} className={className}>
      {children}
    </IssueLinkOwned>
  );
}
