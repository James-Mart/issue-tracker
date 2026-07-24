import { useCallback, useRef, useState } from "react";
import type { ClipboardEvent, DragEvent, RefObject } from "react";
import {
  dataTransferHasFiles,
  ensureAttachmentFileName,
  filesFromDataTransfer,
} from "../lib/attachment-files";
import {
  attachmentMarkdownInsert,
  insertTextAtCaret,
} from "../lib/description-editor-insert";
import {
  isAttachmentUploadBusy,
  setEditorUploadBatchBusy,
  type UploadAttachmentMutation,
} from "./use-issue-detail-file-upload";

export type DescriptionEditorUploadProps = {
  onPaste: (event: ClipboardEvent<HTMLTextAreaElement>) => void;
  onDragOver: (event: DragEvent<HTMLTextAreaElement>) => void;
  onDrop: (event: DragEvent<HTMLTextAreaElement>) => void;
  disabled?: boolean;
};

/**
 * Paste/drop on the description textarea: upload each file, then insert
 * markdown at the caret (or at end when the textarea has no caret/focus).
 */
export function useDescriptionEditorUpload(
  upload: UploadAttachmentMutation | undefined,
  description: string,
  setDescription: (value: string) => void,
): {
  textareaRef: RefObject<HTMLTextAreaElement>;
  textareaProps: DescriptionEditorUploadProps | Record<string, never>;
  isUploading: boolean;
} {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const descriptionRef = useRef(description);
  descriptionRef.current = description;
  const uploadRef = useRef(upload);
  uploadRef.current = upload;
  const [isUploading, setIsUploading] = useState(false);

  const uploadAndInsert = useCallback(
    async (files: File[]) => {
      const mutation = uploadRef.current;
      if (!mutation || files.length === 0 || isAttachmentUploadBusy(mutation)) {
        return;
      }

      const el = textareaRef.current;
      const hasCaret = el !== null && document.activeElement === el;
      let next = descriptionRef.current;
      let start: number | null = hasCaret ? el.selectionStart : null;
      let end: number | null = hasCaret ? el.selectionEnd : null;
      let afterPriorInsert = false;

      setEditorUploadBatchBusy(true);
      setIsUploading(true);
      try {
        for (const raw of files) {
          const file = ensureAttachmentFileName(raw);
          const attachment = await mutation.mutateAsync(file);
          const snippet = attachmentMarkdownInsert(next, attachment.name, {
            selectionStart: start,
            afterPriorInsert,
          });
          const inserted = insertTextAtCaret(next, snippet, start, end);
          next = inserted.value;
          start = inserted.selectionStart;
          end = inserted.selectionEnd;
          afterPriorInsert = true;
          descriptionRef.current = next;
          setDescription(next);
          if (el) {
            const caret = start;
            queueMicrotask(() => {
              el.focus();
              el.setSelectionRange(caret, caret);
            });
          }
        }
      } catch {
        // toast from mutation onError; prior successful inserts already applied
      } finally {
        setEditorUploadBatchBusy(false);
        setIsUploading(false);
      }
    },
    [setDescription],
  );

  const onPaste = useCallback(
    (event: ClipboardEvent<HTMLTextAreaElement>) => {
      const mutation = uploadRef.current;
      if (!mutation || isAttachmentUploadBusy(mutation)) return;
      const files = filesFromDataTransfer(event.clipboardData);
      if (files.length === 0) return;
      event.preventDefault();
      void uploadAndInsert(files);
    },
    [uploadAndInsert],
  );

  const onDragOver = useCallback((event: DragEvent<HTMLTextAreaElement>) => {
    if (!uploadRef.current || !dataTransferHasFiles(event.dataTransfer)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  }, []);

  const onDrop = useCallback(
    (event: DragEvent<HTMLTextAreaElement>) => {
      const mutation = uploadRef.current;
      if (!mutation || isAttachmentUploadBusy(mutation)) return;
      const files = filesFromDataTransfer(event.dataTransfer);
      if (files.length === 0) return;
      event.preventDefault();
      event.stopPropagation();
      void uploadAndInsert(files);
    },
    [uploadAndInsert],
  );

  if (!upload) {
    return { textareaRef, textareaProps: {}, isUploading: false };
  }

  return {
    textareaRef,
    textareaProps: {
      onPaste,
      onDragOver,
      onDrop,
      disabled: isUploading,
    },
    isUploading,
  };
}
