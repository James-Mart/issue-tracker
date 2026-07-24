/** Marks the issue description textarea so page-level paste/drop skips it. */
export const DESCRIPTION_EDITOR_ATTR = "data-issue-description-editor";

type ClosestNode = { closest: (selector: string) => ClosestNode | null };

export function isDescriptionEditorTarget(target: EventTarget | null): boolean {
  if (
    !target ||
    typeof target !== "object" ||
    !("closest" in target) ||
    typeof (target as ClosestNode).closest !== "function"
  ) {
    return false;
  }
  return (
    (target as ClosestNode).closest(`[${DESCRIPTION_EDITOR_ATTR}]`) !== null
  );
}

/** True when a drag payload includes files (OS / browser file drag). */
export function dataTransferHasFiles(dataTransfer: DataTransfer | null): boolean {
  if (!dataTransfer) return false;
  return Array.from(dataTransfer.types).includes("Files");
}

export function filesFromDataTransfer(
  dataTransfer: DataTransfer | null,
): File[] {
  if (!dataTransfer) return [];
  const fromList = Array.from(dataTransfer.files ?? []);
  if (fromList.length > 0) return fromList;
  const files: File[] = [];
  for (const item of Array.from(dataTransfer.items ?? [])) {
    if (item.kind !== "file") continue;
    const file = item.getAsFile();
    if (file) files.push(file);
  }
  return files;
}

const MIME_DEFAULT_EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/svg+xml": "svg",
  "application/pdf": "pdf",
  "text/plain": "txt",
};

/** Default basename for clipboard blobs that have a type but no filename. */
export function defaultPasteFileName(mimeType: string): string {
  const ext = MIME_DEFAULT_EXT[mimeType] ?? mimeType.split("/")[1] ?? "bin";
  const safe = ext.replace(/[^a-zA-Z0-9.+-]/g, "") || "bin";
  return `paste.${safe}`;
}

/** Ensure upload has a usable basename (clipboard images often arrive unnamed). */
export function ensureAttachmentFileName(file: File): File {
  if (file.name.trim()) return file;
  const name = defaultPasteFileName(file.type || "application/octet-stream");
  return new File([file], name, {
    type: file.type,
    lastModified: file.lastModified,
  });
}
