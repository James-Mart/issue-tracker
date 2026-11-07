import { useEffect, useMemo } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import type { IssueDetail, ProjectLabel } from "@server/schemas";
import { cn } from "@/lib/utils/cn";
import type { UploadAttachmentMutation } from "../hooks/use-issue-detail-file-upload";
import {
  locationWithSearch,
  projectHomeSearchAfterResolve,
  resolveProjectHomeTab,
  supportingDocForHome,
} from "../lib/project-home";
import { previewableSupportingDocs } from "../lib/supporting-docs";
import { ProjectHomeBar } from "./project-home-bar";
import { ProjectStructureSection } from "./project-structure-lens";
import { ProjectOutlinesTab } from "./project-outlines-tab";
import { ProjectSettingsOverview } from "./project-settings-overview";
import { SupportingDocsHome } from "./supporting-docs-home";

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
  const location = useLocation();
  const navigate = useNavigate();
  const searchParams = useMemo(
    () => new URLSearchParams(location.search),
    [location.search],
  );
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

  useEffect(() => {
    const next = projectHomeSearchAfterResolve(searchParams, previewableKeys);
    if (!next) return;
    navigate(
      locationWithSearch(
        { pathname: location.pathname, hash: location.hash },
        next,
      ),
      { replace: true },
    );
  }, [
    location.hash,
    location.pathname,
    navigate,
    previewableKeys,
    searchParams,
  ]);

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-4">
      <ProjectHomeBar
        projectId={projectId}
        showSupportingDocsTab={previewable.length > 0}
        active={selection.peer}
      />

      <div
        className={cn(
          "flex min-h-0 min-w-0 flex-1 flex-col",
          selection.peer === "supportingDocs"
            ? "overflow-hidden"
            : "overflow-y-auto",
        )}
      >
        {selection.peer === "overview" ? (
          <ProjectSettingsOverview issue={issue} upload={upload} />
        ) : null}
        {selection.peer === "outlines" ? (
          <ProjectOutlinesTab projectId={projectId} />
        ) : null}
        {selection.peer === "supportingDocs" && doc ? (
          <SupportingDocsHome
            projectId={projectId}
            docs={previewable}
            selected={doc}
            searchParams={searchParams}
          />
        ) : null}
        {selection.peer === "structure" ? (
          <ProjectStructureSection projectId={projectId} catalog={catalog} />
        ) : null}
      </div>
    </div>
  );
}
