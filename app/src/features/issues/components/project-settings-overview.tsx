import { FIELD_LABELS } from "@server/fields";
import type { IssueDetail } from "@server/schemas";
import { cn } from "@/lib/utils/cn";
import type { UploadAttachmentMutation } from "../hooks/use-issue-detail-file-upload";
import { IssueAttachmentsSection } from "./attachments-panel";
import { SettingsCard } from "./detail-section";
import { IssueDescriptionField } from "./issue-description-field";
import { IssueInspirationAppsField } from "./issue-inspiration-apps-field";
import { IssuePersonasField } from "./issue-personas-field";
import { IssueMergePolicyField } from "./issue-merge-policy-field";
import { IssueProjectLabelsField } from "./issue-project-labels-field";
import { IssueSupportingDocsField } from "./issue-supporting-docs-field";
import { IssueWorkspaceField } from "./issue-workspace-field";
import { MetaRow } from "./meta-row";

const SETTINGS_ROW_CLASS = "grid-cols-[7rem_minmax(0,1fr)]";

/**
 * Project config as a settings surface: prose at reading measure, then config
 * modules tiled across the width. Two columns from `xl` — below that each
 * module's own table needs the full width. Personas and inspiration apps stay
 * full width because their text columns do not fit half of one.
 */
export function ProjectSettingsOverview({
  issue,
  upload,
}: {
  issue: Extract<IssueDetail, { kind: "project" }>;
  upload?: UploadAttachmentMutation;
}) {
  return (
    <div className="flex flex-col gap-4">
      <IssueDescriptionField issue={issue} upload={upload} />

      <div className="flex flex-col gap-4 xl:flex-row xl:items-start">
        <div className="flex min-w-0 flex-1 flex-col gap-4">
          <SettingsCard title="Delivery">
            <div className="flex flex-col gap-1.5">
              <MetaRow
                className={SETTINGS_ROW_CLASS}
                label={FIELD_LABELS.workspace}
                value={<IssueWorkspaceField issue={issue} />}
              />
              <MetaRow
                className={cn(SETTINGS_ROW_CLASS, "items-center")}
                label={FIELD_LABELS.mergePolicy}
                value={
                  <div className="max-w-[13rem]">
                    <IssueMergePolicyField issue={issue} />
                  </div>
                }
              />
            </div>
          </SettingsCard>
          <IssueSupportingDocsField issue={issue} />
        </div>

        <div className="flex min-w-0 flex-1 flex-col gap-4">
          <IssueProjectLabelsField issue={issue} />
          <IssueAttachmentsSection issue={issue} upload={upload} />
        </div>
      </div>

      <IssuePersonasField issue={issue} />
      <IssueInspirationAppsField issue={issue} />
    </div>
  );
}
