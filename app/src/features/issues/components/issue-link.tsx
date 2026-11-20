import type { ReactNode } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import type { ConversationChannel } from "@server/schemas";
import { toast } from "sonner";
import { projectIdOf } from "../lib/build-tree";
import {
  type IssueBackLocationState,
  issueBackNavigateState,
} from "../lib/issue-back";
import { issueChannelPath, issuePath, linkNotFoundMessage } from "../lib/links";
import {
  IssueLinkResolution,
  type IssueSupplement,
  useSupplementedById,
} from "../hooks/use-supplemented-by-id";

export type { IssueSupplement };

function issueHref(
  projectId: string,
  targetId: string,
  channel?: ConversationChannel,
): string {
  return channel
    ? issueChannelPath(projectId, targetId, channel)
    : issuePath(projectId, targetId);
}

export function useBoundNavigate(
  supplement: IssueSupplement,
  channel?: ConversationChannel,
): {
  go: (targetId: string) => void;
  hrefFor: (targetId: string) => string;
} & IssueSupplement {
  const navigate = useNavigate();
  const location = useLocation();
  const { projectId: routeProjectId } = useParams();

  const hrefFor = (targetId: string): string => {
    const projectId = projectIdOf(targetId, supplement.byId) ?? routeProjectId;
    return projectId ? issueHref(projectId, targetId, channel) : "#";
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
      issueHref(projectId, targetId, channel),
      navigateState ? { state: navigateState } : undefined,
    );
  };

  return { go, hrefFor, ...supplement };
}

export function useIssueLinkNavigate(id: string, channel?: ConversationChannel) {
  const supplement = useSupplementedById(id ? [id] : []);
  return useBoundNavigate(supplement, channel);
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
  channel,
}: {
  id: string;
  children: ReactNode;
  className?: string;
  channel?: ConversationChannel;
}) {
  const nav = useIssueLinkNavigate(id, channel);
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
  channel,
}: {
  id: string;
  children: ReactNode;
  className?: string;
  supplement: IssueSupplement;
  channel?: ConversationChannel;
}) {
  const nav = useBoundNavigate(supplement, channel);
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
  channel,
}: {
  id: string;
  children: ReactNode;
  className?: string;
  supplement?: IssueSupplement;
  /** Channel tab on the target issue, such as an outline's planner sessions. */
  channel?: ConversationChannel;
}) {
  if (supplement) {
    return (
      <IssueLinkShared
        id={id}
        className={className}
        supplement={supplement}
        channel={channel}
      >
        {children}
      </IssueLinkShared>
    );
  }
  return (
    <IssueLinkOwned id={id} className={className} channel={channel}>
      {children}
    </IssueLinkOwned>
  );
}
