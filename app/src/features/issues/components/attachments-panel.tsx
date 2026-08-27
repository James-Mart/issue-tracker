import { useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Download, Paperclip, Trash2, Upload } from "lucide-react";
import type { IssueDetail } from "@server/schemas";
import type { Attachment } from "@server/services/attachments";
import { ShellInlineFault } from "@/app/shell-state";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils/cn";
import { useAttachmentsQuery } from "../api/queries";
import { useDeleteAttachment } from "../api/mutations";
import type { UploadAttachmentMutation } from "../hooks/use-issue-detail-file-upload";
import {
  attachmentsApiPath,
  formatAttachmentSize,
  isImageMime,
  supportsAttachments,
} from "../lib/attachments";
import { SETTINGS_HEADING_CLASS, SettingsCard } from "./detail-section";

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

function DownloadLink({
  issueId,
  item,
  className,
}: {
  issueId: string;
  item: Attachment;
  className?: string;
}) {
  return (
    <a
      href={attachmentsApiPath(issueId, item.name)}
      download={item.name}
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-accent-foreground",
        className,
      )}
      title={`Download ${item.name}`}
    >
      <Download className="h-3.5 w-3.5" />
    </a>
  );
}

function DeleteButton({
  item,
  remove,
  className,
}: {
  item: Attachment;
  remove: ReturnType<typeof useDeleteAttachment>;
  className?: string;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      className={className}
      title={`Delete ${item.name}`}
      disabled={remove.isPending && remove.variables === item.name}
      onClick={() => remove.mutate(item.name)}
    >
      <Trash2 className="h-3.5 w-3.5 text-destructive" />
    </Button>
  );
}

function FilmstripThumb({
  issueId,
  item,
  isActive,
  onOpen,
  remove,
}: {
  issueId: string;
  item: Attachment;
  isActive: boolean;
  onOpen: () => void;
  remove: ReturnType<typeof useDeleteAttachment>;
}) {
  const href = attachmentsApiPath(issueId, item.name);
  return (
    <article className="flex w-[5rem] shrink-0 flex-col gap-0.5 sm:w-[7.25rem] sm:gap-1">
      <button
        type="button"
        className={cn(
          "h-[4.25rem] w-[4.25rem] shrink-0 overflow-hidden rounded-md border border-border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:h-28 sm:w-28",
          isActive && "ring-2 ring-[hsl(var(--current))]",
        )}
        onClick={onOpen}
        aria-label={`View ${item.name}`}
        aria-current={isActive ? "true" : undefined}
      >
        <img src={href} alt="" className="h-full w-full object-cover" />
      </button>
      <div className="min-w-0">
        <p
          className="truncate font-mono text-[9px] leading-tight text-foreground sm:text-[10px]"
          title={item.name}
        >
          {item.name}
        </p>
        <p className="font-mono text-[9px] tabular-nums text-muted-foreground sm:text-[10px]">
          {formatAttachmentSize(item.size)}
        </p>
      </div>
      <div className="flex items-center justify-end gap-0.5">
        <DownloadLink
          issueId={issueId}
          item={item}
          className="h-6 w-6 sm:h-7 sm:w-7"
        />
        <DeleteButton
          item={item}
          remove={remove}
          className="h-6 w-6 sm:h-7 sm:w-7"
        />
      </div>
    </article>
  );
}

function cycleImageIndex(index: number, delta: number, length: number): number {
  return (index + delta + length) % length;
}

function AttachmentLightbox({
  issueId,
  images,
  item,
  index,
  onClose,
  onShow,
  remove,
}: {
  issueId: string;
  images: Attachment[];
  item: Attachment;
  index: number;
  onClose: () => void;
  onShow: (index: number) => void;
  remove: ReturnType<typeof useDeleteAttachment>;
}) {
  const href = attachmentsApiPath(issueId, item.name);
  const count = images.length;

  const showPrev = () => onShow(cycleImageIndex(index, -1, count));
  const showNext = () => onShow(cycleImageIndex(index, 1, count));

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        className="w-[min(96vw,80rem)] max-w-[min(96vw,80rem)] gap-3 p-4 sm:p-5"
        onKeyDown={(event) => {
          if (event.key === "ArrowLeft") {
            event.preventDefault();
            showPrev();
          } else if (event.key === "ArrowRight") {
            event.preventDefault();
            showNext();
          }
        }}
      >
        <DialogTitle className="min-w-0 truncate pr-8 font-mono text-sm font-medium">
          {item.name}
        </DialogTitle>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="icon-sm"
            className="shrink-0 rounded-full"
            aria-label="Previous image"
            onClick={showPrev}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <img
            src={href}
            alt=""
            className="mx-auto max-h-[70vh] min-w-0 flex-1 rounded-md object-contain"
          />
          <Button
            type="button"
            variant="outline"
            size="icon-sm"
            className="shrink-0 rounded-full"
            aria-label="Next image"
            onClick={showNext}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="font-mono text-[11px] tabular-nums text-muted-foreground">
            {index + 1} / {count} · {formatAttachmentSize(item.size)}
          </p>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" asChild>
              <a href={href} download={item.name}>
                <Download className="h-3.5 w-3.5" />
                Download
              </a>
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="text-destructive"
              disabled={remove.isPending && remove.variables === item.name}
              onClick={() => remove.mutate(item.name)}
            >
              <Trash2 className="h-3.5 w-3.5" />
              Delete
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function AttachmentFileRow({
  issueId,
  item,
  remove,
}: {
  issueId: string;
  item: Attachment;
  remove: ReturnType<typeof useDeleteAttachment>;
}) {
  return (
    <li className="flex items-center gap-2 border-t border-border py-2 text-sm first:border-t-0 first:pt-0 last:pb-0">
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
      <DownloadLink issueId={issueId} item={item} className="h-7 w-7" />
      <DeleteButton item={item} remove={remove} />
    </li>
  );
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
  const [openName, setOpenName] = useState<string | null>(null);

  const items = data ?? [];
  const images = items.filter((item) => isImageMime(item.mime));
  const others = items.filter((item) => !isImageMime(item.mime));
  const openIndex = openName === null
    ? -1
    : images.findIndex((item) => item.name === openName);
  const openItem = openIndex >= 0 ? images[openIndex] : undefined;

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
    <SettingsCard
      title="Attachments"
      action={
        <>
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
        </>
      }
    >
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
          <span>No attachments yet. Use Upload to add a file.</span>
        </p>
      ) : items.length > 0 ? (
        <div>
          {images.length > 0 ? (
            <div>
              <p className={cn(SETTINGS_HEADING_CLASS, "mb-1")}>Images</p>
              <div className="-mx-0.5 flex gap-2 overflow-x-auto px-0.5 pb-0.5">
                {images.map((item) => (
                  <FilmstripThumb
                    key={item.name}
                    issueId={issue.id}
                    item={item}
                    isActive={openName === item.name}
                    onOpen={() => setOpenName(item.name)}
                    remove={remove}
                  />
                ))}
              </div>
            </div>
          ) : null}

          {others.length > 0 ? (
            <div
              className={cn(
                images.length > 0 && "mt-2.5 border-t border-border pt-2.5",
              )}
            >
              <p className={cn(SETTINGS_HEADING_CLASS, "mb-1.5")}>Other files</p>
              <ul className="flex flex-col">
                {others.map((item) => (
                  <AttachmentFileRow
                    key={item.name}
                    issueId={issue.id}
                    item={item}
                    remove={remove}
                  />
                ))}
              </ul>
            </div>
          ) : null}
        </div>
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

      {openItem ? (
        <AttachmentLightbox
          issueId={issue.id}
          images={images}
          item={openItem}
          index={openIndex}
          onClose={() => setOpenName(null)}
          onShow={(next) => setOpenName(images[next].name)}
          remove={remove}
        />
      ) : null}
    </SettingsCard>
  );
}
