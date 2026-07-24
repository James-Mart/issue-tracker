import type { IssueKind } from "@server/schemas";
import { kindHas } from "@server/kind";
import { ISSUE_LINK_PREFIX } from "./links";

/** Attachments are allowed on every kind that has the attachments capability. */
export function supportsAttachments(kind: IssueKind): boolean {
  return kindHas(kind, "attachments");
}

export function formatAttachmentSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) {
    const kb = bytes / 1024;
    return `${kb < 10 ? kb.toFixed(1) : Math.round(kb)} KB`;
  }
  const mb = bytes / (1024 * 1024);
  return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`;
}

/** List/upload collection path, or one attachment when `name` is set. */
export function attachmentsApiPath(id: string, name?: string): string {
  const base = `/api/issues/${encodeURIComponent(id)}/attachments`;
  return name === undefined
    ? base
    : `${base}/${encodeURIComponent(name)}`;
}

/** Mirrors server `assertSafeBasename` — plain basenames only. */
export function isSafeAttachmentName(name: string): boolean {
  if (
    !name ||
    name.includes("\0") ||
    name.includes("/") ||
    name.includes("\\") ||
    name === "." ||
    name === ".."
  ) {
    return false;
  }
  return true;
}

/** True when `href` is a protocol URL (http:, mailto:, …), not a relative path. */
function hasUrlProtocol(href: string): boolean {
  const colon = href.indexOf(":");
  if (colon === -1) return false;
  const slash = href.indexOf("/");
  const questionMark = href.indexOf("?");
  const numberSign = href.indexOf("#");
  return (
    (slash === -1 || colon < slash) &&
    (questionMark === -1 || colon < questionMark) &&
    (numberSign === -1 || colon < numberSign)
  );
}

function stripQueryAndFragment(href: string): string {
  const q = href.indexOf("?");
  const h = href.indexOf("#");
  let end = href.length;
  if (q !== -1) end = Math.min(end, q);
  if (h !== -1) end = Math.min(end, h);
  return href.slice(0, end);
}

/**
 * Map issue-local relative Markdown hrefs (e.g. `foo.tsx`) to that issue's
 * attachment download URL. Leaves `issue:`, absolute `/…`, and `http(s):` alone.
 * Rejects non-basename paths (`../x`, `dir/foo`, `attachments/foo`).
 */
export function attachmentLinkHref(
  href: string | undefined,
  issueId: string,
): string | null {
  if (!href) return null;
  if (href.startsWith(ISSUE_LINK_PREFIX)) return null;
  if (href.startsWith("#") || href.startsWith("/") || href.startsWith("//")) {
    return null;
  }
  if (hasUrlProtocol(href)) return null;
  let name = stripQueryAndFragment(href);
  if (name.startsWith("./")) name = name.slice(2);
  if (!isSafeAttachmentName(name)) return null;
  return attachmentsApiPath(issueId, name);
}

/** Basename for `download=` when `href` is an attachments API URL. */
export function attachmentDownloadName(href: string | undefined): string | null {
  if (!href || !href.startsWith("/api/issues/")) return null;
  const marker = "/attachments/";
  const i = href.indexOf(marker);
  if (i === -1) return null;
  const encoded = href.slice(i + marker.length);
  if (!encoded || encoded.includes("/")) return null;
  try {
    const name = decodeURIComponent(encoded);
    return isSafeAttachmentName(name) ? name : null;
  } catch {
    return null;
  }
}
