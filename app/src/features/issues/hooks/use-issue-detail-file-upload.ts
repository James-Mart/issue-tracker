import { useCallback, useEffect, useRef, useState } from "react";
import type { DragEvent, HTMLAttributes } from "react";
import type { useUploadAttachment } from "../api/mutations";
import {
  dataTransferHasFiles,
  ensureAttachmentFileName,
  filesFromDataTransfer,
  isDescriptionEditorTarget,
} from "../lib/attachment-files";

export type UploadAttachmentMutation = ReturnType<typeof useUploadAttachment>;

export type IssueDetailFileUploadRootProps = Pick<
  HTMLAttributes<HTMLDivElement>,
  "className" | "onDragEnter" | "onDragLeave" | "onDragOver" | "onDrop"
>;

/** Covers the gap between sequential editor `mutateAsync` calls when `isPending` flickers false. */
const editorUploadBatchBusy = { current: false };

export function setEditorUploadBatchBusy(busy: boolean): void {
  editorUploadBatchBusy.current = busy;
}

export function isAttachmentUploadBusy(
  mutation: UploadAttachmentMutation,
): boolean {
  return mutation.isPending || editorUploadBatchBusy.current;
}

function shouldHandleFileDrag(
  target: EventTarget | null,
  dataTransfer: DataTransfer | null,
): boolean {
  return (
    dataTransferHasFiles(dataTransfer) && !isDescriptionEditorTarget(target)
  );
}

/** Page-level file drop/paste upload; skips the description editor. */
export function useIssueDetailFileUpload(
  upload: UploadAttachmentMutation | undefined,
): { rootProps: IssueDetailFileUploadRootProps } {
  const enabled = upload !== undefined;
  const uploadRef = useRef(upload);
  uploadRef.current = upload;

  const depthRef = useRef(0);
  const [isFileDragOver, setIsFileDragOver] = useState(false);

  const clearDrag = useCallback(() => {
    depthRef.current = 0;
    setIsFileDragOver(false);
  }, []);

  const uploadFiles = useCallback((files: File[]) => {
    const mutation = uploadRef.current;
    if (!mutation || files.length === 0 || isAttachmentUploadBusy(mutation)) {
      return;
    }
    for (const file of files) {
      mutation.mutate(ensureAttachmentFileName(file));
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;

    const onPaste = (event: ClipboardEvent) => {
      if (isDescriptionEditorTarget(event.target)) return;
      const files = filesFromDataTransfer(event.clipboardData);
      if (files.length === 0) return;
      event.preventDefault();
      uploadFiles(files);
    };

    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [enabled, uploadFiles]);

  useEffect(() => {
    if (!enabled) clearDrag();
  }, [enabled, clearDrag]);

  const onDragEnter = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      if (!enabled || !shouldHandleFileDrag(event.target, event.dataTransfer)) {
        return;
      }
      event.preventDefault();
      depthRef.current += 1;
      setIsFileDragOver(true);
    },
    [enabled],
  );

  const onDragLeave = useCallback(() => {
    if (!enabled) return;
    // dragleave often has an empty dataTransfer; still pair with enter depth.
    depthRef.current = Math.max(0, depthRef.current - 1);
    if (depthRef.current === 0) setIsFileDragOver(false);
  }, [enabled]);

  const onDragOver = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      if (!enabled || !dataTransferHasFiles(event.dataTransfer)) return;
      if (isDescriptionEditorTarget(event.target)) {
        depthRef.current = 0;
        setIsFileDragOver(false);
        return;
      }
      event.preventDefault();
      event.dataTransfer.dropEffect = "copy";
      setIsFileDragOver(true);
    },
    [enabled],
  );

  const onDrop = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      if (!enabled) return;
      clearDrag();
      if (!shouldHandleFileDrag(event.target, event.dataTransfer)) return;
      const files = filesFromDataTransfer(event.dataTransfer);
      if (files.length === 0) return;
      event.preventDefault();
      uploadFiles(files);
    },
    [enabled, clearDrag, uploadFiles],
  );

  if (!enabled) return { rootProps: {} };

  return {
    rootProps: {
      className: isFileDragOver ? "rounded-lg ring-2 ring-primary/40" : undefined,
      onDragEnter,
      onDragLeave,
      onDragOver,
      onDrop,
    },
  };
}
