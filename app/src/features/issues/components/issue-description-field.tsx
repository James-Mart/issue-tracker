import { useCallback, useEffect, useRef, useState } from "react";
import type { IssueDetail } from "@server/schemas";
import { READING_MEASURE_CLASS } from "@/components/page-shell";
import { cn } from "@/lib/utils/cn";
import { useUpdateIssue } from "../api/mutations";
import { useDescriptionEditorUpload } from "../hooks/use-description-editor-upload";
import type { UploadAttachmentMutation } from "../hooks/use-issue-detail-file-upload";
import { DESCRIPTION_EDITOR_ATTR } from "../lib/attachment-files";
import { supportsAttachments } from "../lib/attachments";
import {
  clearDescriptionDraft,
  readDescriptionDraft,
  writeDescriptionDraft,
} from "../lib/description-draft-storage";
import { InlineField } from "./inline-field";
import { Markdown } from "./markdown";

const DRAFT_PERSIST_DEBOUNCE_MS = 300;

export function IssueDescriptionField({
  issue,
  upload,
}: {
  issue: IssueDetail;
  upload?: UploadAttachmentMutation;
}) {
  const update = useUpdateIssue();
  const attach = supportsAttachments(issue.kind);
  const [draft, setDraft] = useState(issue.description);
  const [editing, setEditing] = useState(false);
  const setDraftRef = useRef<((next: string) => void) | null>(null);
  const skipDraftPersistRef = useRef(true);

  const applyDraft = useCallback((next: string) => {
    setDraft(next);
    setDraftRef.current?.(next);
  }, []);

  const { textareaRef, textareaProps, isUploading } = useDescriptionEditorUpload(
    upload,
    draft,
    applyDraft,
  );

  const resolveEditDraft = useCallback(
    (saved: string) => {
      skipDraftPersistRef.current = true;
      const stored = readDescriptionDraft(issue.id);
      if (stored === "") return saved;
      if (stored === saved) {
        clearDescriptionDraft(issue.id);
        return saved;
      }
      return stored;
    },
    [issue.id],
  );

  const onEditCancel = useCallback(() => {
    clearDescriptionDraft(issue.id);
  }, [issue.id]);

  useEffect(() => {
    if (!editing) return;
    if (skipDraftPersistRef.current) {
      skipDraftPersistRef.current = false;
      return;
    }
    const handle = window.setTimeout(() => {
      writeDescriptionDraft(issue.id, draft, issue.description);
    }, DRAFT_PERSIST_DEBOUNCE_MS);
    return () => window.clearTimeout(handle);
  }, [issue.id, issue.description, draft, editing]);

  return (
    <section className="rounded-lg border border-border bg-card p-5">
      <p className="mb-3 font-display text-[11px] font-semibold uppercase tracking-[0.22em] text-[hsl(var(--current))]">
        Description
      </p>
      <div className={cn("min-w-0", READING_MEASURE_CLASS)}>
        <InlineField
          value={issue.description}
          issue={issue}
          multiline
          richDisplay
          inputClassName="min-h-[280px] text-[13px] leading-relaxed"
          textareaRef={textareaRef}
          textareaProps={textareaProps}
          textareaAttrs={{ [DESCRIPTION_EDITOR_ATTR]: "" }}
          shouldDeferBlurCommit={() => isUploading}
          onDraftChange={setDraft}
          setDraftRef={setDraftRef}
          resolveEditDraft={resolveEditDraft}
          onEditCancel={onEditCancel}
          onEditingChange={setEditing}
          onSave={async (next) => {
            if (next === issue.description) return;
            await update.mutateAsync({
              id: issue.id,
              patch: { description: next },
            });
            clearDescriptionDraft(issue.id);
          }}
          renderDisplayContent={(value) =>
            value.trim() ? (
              <Markdown issueId={attach ? issue.id : undefined}>{value}</Markdown>
            ) : (
              <p className="text-[15px] leading-[1.55] text-muted-foreground">
                Add a description.
              </p>
            )
          }
        />
      </div>
    </section>
  );
}
