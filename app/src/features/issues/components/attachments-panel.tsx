import { useRef } from "react";
import { Download, Paperclip, Trash2, Upload } from "lucide-react";
import type { IssueDetail } from "@server/schemas";
import { ShellInlineFault } from "@/app/shell-state";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useAttachmentsQuery } from "../api/queries";
import { useDeleteAttachment } from "../api/mutations";
import type { UploadAttachmentMutation } from "../hooks/use-issue-detail-file-upload";
import {
  attachmentsApiPath,
  formatAttachmentSize,
  supportsAttachments,
} from "../lib/attachments";
import { DetailEyebrow } from "./detail-section";

export function IssueAttachmentsSection({
  issue,
  upload,
}: {
  issue: IssueDetail;
  upload?: UploadAttachmentMutation;
}) {
  if (!supportsAttachments(issue.kind) || !upload) return null;
  return <AttachmentsPanel issue={issue} upload={upload} />;
}

export function AttachmentsPanel({
  issue,
  upload,
}: {
  issue: IssueDetail;
  upload: UploadAttachmentMutation;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const { data, isLoading, error } = useAttachmentsQuery(issue.id);
  const remove = useDeleteAttachment(issue.id);

  const items = data ?? [];

  const onPick = () => inputRef.current?.click();

  const onFileChange = (files: FileList | null) => {
    const file = files?.[0];
    if (!file || upload.isPending) return;
    upload.mutate(file, {
      onSettled: () => {
        if (inputRef.current) inputRef.current.value = "";
      },
    });
  };

  return (
    <section className="rounded-lg border border-border bg-card p-5">
      <div className="mb-3 flex items-center justify-between gap-2">
        <DetailEyebrow>Attachments</DetailEyebrow>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onPick}
          disabled={upload.isPending}
        >
          <Upload className="h-3.5 w-3.5" />
          Upload
        </Button>
        <input
          ref={inputRef}
          type="file"
          className="hidden"
          onChange={(e) => onFileChange(e.target.files)}
        />
      </div>

      {error ? (
        <ShellInlineFault
          message={error.message}
          hint="Check the server, then retry the list."
        />
      ) : null}

      {isLoading ? (
        <div className="space-y-2" role="status" aria-live="polite">
          <p className="font-mono text-[11px] text-muted-foreground">
            Loading attachments…
          </p>
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-2/3" />
        </div>
      ) : items.length === 0 && !error ? (
        <p className="flex items-start gap-2 text-sm text-muted-foreground">
          <Paperclip className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>No attachments yet. Upload a file to attach it.</span>
        </p>
      ) : items.length > 0 ? (
        <ul className="flex flex-col">
          {items.map((item) => (
            <li
              key={item.name}
              className="flex items-center gap-2 border-t border-border py-2 text-sm first:border-t-0 first:pt-0 last:pb-0"
            >
              <Paperclip className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <span
                className="min-w-0 flex-1 truncate font-mono text-[13px]"
                title={item.name}
              >
                {item.name}
              </span>
              <span className="shrink-0 font-mono text-[11px] tabular-nums text-muted-foreground">
                {formatAttachmentSize(item.size)}
              </span>
              <a
                href={attachmentsApiPath(issue.id, item.name)}
                download={item.name}
                className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                title={`Download ${item.name}`}
              >
                <Download className="h-3.5 w-3.5" />
              </a>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                title={`Delete ${item.name}`}
                disabled={remove.isPending && remove.variables === item.name}
                onClick={() => remove.mutate(item.name)}
              >
                <Trash2 className="h-3.5 w-3.5 text-destructive" />
              </Button>
            </li>
          ))}
        </ul>
      ) : null}

      {upload.isPending ? (
        <p className="mt-2 font-mono text-[11px] text-muted-foreground">
          Uploading…
        </p>
      ) : null}

      {upload.isError ? (
        <ShellInlineFault
          className="mt-2"
          message={
            upload.error instanceof Error
              ? upload.error.message
              : "Upload failed."
          }
          hint="Pick the file again, or check the server."
        />
      ) : null}
    </section>
  );
}
