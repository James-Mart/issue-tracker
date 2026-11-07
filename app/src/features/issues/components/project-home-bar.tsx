import { useMemo } from "react";
import { Link } from "react-router-dom";
import { tabTriggerClassName } from "@/components/ui/tab-button";
import { projectReviewPath } from "@/features/reviews/lib/links";
import {
  PROJECT_HOME_PEER_LABELS,
  projectHomePeerHref,
  type ProjectHomeBarActive,
  type ProjectHomePeer,
} from "../lib/project-home";

type HomePeerLink = {
  id: ProjectHomeBarActive;
  label: string;
  to: string;
  replace: boolean;
};

export type { ProjectHomeBarActive };

const PROJECT_HOME_TAB_PEERS: ProjectHomePeer[] = [
  "structure",
  "overview",
  "outlines",
];

export function ProjectHomeBar({
  projectId,
  showSupportingDocsTab,
  active,
}: {
  projectId: string;
  showSupportingDocsTab: boolean;
  active: ProjectHomeBarActive;
}) {
  const peers = useMemo(() => {
    const links: HomePeerLink[] = PROJECT_HOME_TAB_PEERS.map((peer) => ({
      id: peer,
      label: PROJECT_HOME_PEER_LABELS[peer],
      to: projectHomePeerHref(projectId, peer),
      replace: true,
    }));
    if (showSupportingDocsTab) {
      links.push({
        id: "supportingDocs",
        label: PROJECT_HOME_PEER_LABELS.supportingDocs,
        to: projectHomePeerHref(projectId, "supportingDocs"),
        replace: true,
      });
    }
    links.push({
      id: "review",
      label: "Code review",
      to: projectReviewPath(projectId),
      replace: false,
    });
    return links;
  }, [projectId, showSupportingDocsTab]);

  return (
    <nav
      aria-label="Project home"
      className="flex shrink-0 flex-wrap gap-1 border-b border-border shell:flex-nowrap"
    >
      {peers.map((peer) => {
        const selected = active === peer.id;
        return (
          <Link
            key={peer.id}
            to={peer.to}
            replace={peer.replace}
            aria-current={selected ? "page" : undefined}
            className={tabTriggerClassName(selected)}
          >
            {peer.label}
          </Link>
        );
      })}
    </nav>
  );
}
