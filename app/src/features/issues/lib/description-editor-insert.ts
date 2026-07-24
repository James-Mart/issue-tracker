const IMAGE_EXTENSIONS = new Set([
  "apng",
  "avif",
  "bmp",
  "gif",
  "heic",
  "heif",
  "ico",
  "jpeg",
  "jpg",
  "png",
  "svg",
  "tif",
  "tiff",
  "webp",
]);

/** Markdown link for an uploaded attachment basename (image extension → embed). */
export function attachmentMarkdownLink(name: string): string {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  const isImage = IMAGE_EXTENSIONS.has(ext);
  return isImage ? `![${name}](${name})` : `[${name}](${name})`;
}

/** Insert `insert` at caret; when start/end are nullish, append at end. */
export function insertTextAtCaret(
  value: string,
  insert: string,
  selectionStart: number | null | undefined,
  selectionEnd: number | null | undefined,
): { value: string; selectionStart: number; selectionEnd: number } {
  const start =
    typeof selectionStart === "number" && selectionStart >= 0
      ? selectionStart
      : value.length;
  const end =
    typeof selectionEnd === "number" && selectionEnd >= 0
      ? selectionEnd
      : start;
  const next = value.slice(0, start) + insert + value.slice(end);
  const caret = start + insert.length;
  return { value: next, selectionStart: caret, selectionEnd: caret };
}

/**
 * Text to insert for one attachment, with `\n\n` between batch items and when
 * appending at end onto non-empty content that lacks a trailing newline.
 */
export function attachmentMarkdownInsert(
  value: string,
  name: string,
  options: {
    selectionStart: number | null | undefined;
    afterPriorInsert: boolean;
  },
): string {
  const link = attachmentMarkdownLink(name);
  if (options.afterPriorInsert) return `\n\n${link}`;

  const appendingAtEnd =
    typeof options.selectionStart !== "number" || options.selectionStart < 0;
  if (appendingAtEnd && value.length > 0 && !/(?:\r?\n)$/.test(value)) {
    return `\n\n${link}`;
  }
  return link;
}
