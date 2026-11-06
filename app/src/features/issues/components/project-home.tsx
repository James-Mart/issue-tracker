import { useEffect, useMemo } from "react";
import { Link, useSearchParams } from "react-router-dom";
import type { IssueDetail, ProjectLabel } from "@server/schemas";
import { tabTriggerClassName } from "@/components/ui/tab-button";
import { cn } from "@/lib/utils/cn";
import { projectReviewPath } from "@/features/reviews/lib/links";
import type { UploadAttachmentMutation } from "../hooks/use-issue-detail-file-upload";
import { issuePath } from "../lib/links";
import {
  projectHomeSearchAfterResolve,
  resolveProjectHomeTab,
  supportingDocForHome,
  type ProjectHomePeer,
} from "../lib/project-home";
import { previewableSupportingDocs } from "../lib/supporting-docs";
import { ProjectStructureSection } from "./project-structure-lens";
import { ProjectOutlinesTab } from "./project-outlines-tab";
import { ProjectSettingsOverview } from "./project-settings-overview";
import { SupportingDocPreview } from "./supporting-doc-preview";

type HomePeerLink = {
  id: ProjectHomePeer | "review";
  label: string;
  to: string;
  replace: boolean;
};

function projectHomePeerHref(projectId: string, peer: ProjectHomePeer): string {
  const base = issuePath(projectId, projectId);
  if (peer === "structure") return base;
  return `${base}?tab=${peer}`;
}

/**
 * Project-issue home: Structure, Overview, Outlines, Supporting docs, and
 * Code review. Structure is the address with no `tab`. Code review leaves
 * for `/projects/:id/review`.
 */
export function ProjectHome({
  issue,
  projectId,
  catalog,
  upload,
}: {
  issue: Extract<IssueDetail, { kind: "project" }>;
  projectId: string;
  catalog: ProjectLabel[];
  upload?: UploadAttachmentMutation;
}) {
  const [searchParams, setSearchParams] = useSearchParams();
  const previewable = useMemo(
    () => previewableSupportingDocs(issue.supportingDocs),
    [issue.supportingDocs],
  );
  const previewableKeys = useMemo(
    () => previewable.map((doc) => doc.key),
    [previewable],
  );
  const rawTab = searchParams.get("tab");
  const selection = resolveProjectHomeTab(rawTab, previewableKeys);
  const doc = supportingDocForHome(
    previewable,
    selection,
    searchParams.get("doc"),
  );

  const searchKey = searchParams.toString();
  useEffect(() => {
    const next = projectHomeSearchAfterResolve(
      new URLSearchParams(searchKey),
      previewableKeys,
    );
    if (!next) return;
    setSearchParams(next, { replace: true });
  }, [previewableKeys, searchKey, setSearchParams]);

  const peers: HomePeerLink[] = [
    {
      id: "structure",
      label: "Structure",
      to: projectHomePeerHref(projectId, "structure"),
      replace: true,
    },
    {
      id: "overview",
      label: "Overview",
      to: projectHomePeerHref(projectId, "overview"),
      replace: true,
    },
    {
      id: "outlines",
      label: "Outlines",
      to: projectHomePeerHref(projectId, "outlines"),
      replace: true,
    },
  ];
  if (previewable.length > 0) {
    peers.push({
      id: "supportingDocs",
      label: "Supporting docs",
      to: projectHomePeerHref(projectId, "supportingDocs"),
      replace: true,
    });
  }
  peers.push({
    id: "review",
    label: "Code review",
    to: projectReviewPath(projectId),
    replace: false,
  });

  const fillsReadingArea =
    selection.peer === "supportingDocs" && doc?.format === "html";

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-4">
      <nav
        aria-label="Project home"
        className="flex shrink-0 flex-wrap gap-1 border-b border-border shell:flex-nowrap"
      >
        {peers.map((peer) => {
          const selected = peer.id !== "review" && selection.peer === peer.id;
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

      <div
        className={cn(
          "flex min-h-0 min-w-0 flex-1 flex-col",
          fillsReadingArea ? "" : "overflow-y-auto",
        )}
      >
        {selection.peer === "overview" ? (
          <ProjectSettingsOverview issue={issue} upload={upload} />
        ) : null}
        {selection.peer === "outlines" ? (
          <ProjectOutlinesTab projectId={projectId} />
        ) : null}
        {selection.peer === "supportingDocs" && doc ? (
          <SupportingDocPreview projectId={projectId} tab={doc} />
        ) : null}
        {selection.peer === "structure" ? (
          <ProjectStructureSection projectId={projectId} catalog={catalog} />
        ) : null}
      </div>
    </div>
  );
}
