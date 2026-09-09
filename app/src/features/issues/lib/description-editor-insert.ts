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
