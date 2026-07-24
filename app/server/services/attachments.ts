import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "fs";
import { basename, join } from "path";
import mime from "mime";
import { issuesDir } from "../config.js";
import { IssueError } from "./errors.js";
import { requireKindCapability, serialize } from "./issues.js";
import { firstFreeSuffixedName } from "./slug.js";

export const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;

export interface Attachment {
  name: string;
  size: number;
  mtime: string;
  mime: string;
}

export interface AttachmentBytes {
  meta: Attachment;
  bytes: Buffer;
}

function attachmentsDir(id: string): string {
  return join(issuesDir, id, "attachments");
}

/** Absolute on-disk path for `issues/<id>/attachments/<name>`. */
export function attachmentPath(id: string, name: string): string {
  return join(attachmentsDir(id), name);
}

function mimeOf(name: string): string {
  return mime.lookup(name) || "application/octet-stream";
}

function assertSafeBasename(name: string): void {
  if (
    !name ||
    name.includes("\0") ||
    name.includes("/") ||
    name.includes("\\") ||
    name === "." ||
    name === ".." ||
    basename(name) !== name
  ) {
    throw new IssueError("validation", `unsafe attachment name "${name}"`);
  }
}

function requireAttachable(id: string): void {
  requireKindCapability(id, "attachments");
}

function toAttachment(dir: string, name: string): Attachment {
  const st = statSync(join(dir, name));
  return {
    name,
    size: st.size,
    mtime: st.mtime.toISOString(),
    mime: mimeOf(name),
  };
}

function splitBasename(name: string): { stem: string; ext: string } {
  const lastDot = name.lastIndexOf(".");
  if (lastDot <= 0) return { stem: name, ext: "" };
  return { stem: name.slice(0, lastDot), ext: name.slice(lastDot) };
}

function attachmentFilenames(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => statSync(join(dir, name)).isFile())
    .sort();
}

/** Collision-free basename among `taken` (stem + last extension). */
export function uniqueAttachmentBasename(
  requested: string,
  taken: Iterable<string>,
): string {
  const { stem, ext } = splitBasename(requested);
  return firstFreeSuffixedName(stem, ext, taken);
}

function withAttachmentOp<T>(
  id: string,
  name: string,
  fn: (dir: string) => T,
): Promise<T> {
  return serialize(() => {
    requireAttachable(id);
    assertSafeBasename(name);
    return fn(attachmentsDir(id));
  });
}

/** List attachment metadata under `issues/<id>/attachments/`. */
export function listAttachments(id: string): Attachment[] {
  requireAttachable(id);
  const dir = attachmentsDir(id);
  return attachmentFilenames(dir).map((name) => toAttachment(dir, name));
}

/** Read one attachment's metadata and bytes. */
export function getAttachment(
  id: string,
  name: string,
): Promise<AttachmentBytes> {
  return withAttachmentOp(id, name, (dir) => {
    const path = join(dir, name);
    if (!existsSync(path) || !statSync(path).isFile()) {
      throw new IssueError(
        "not_found",
        `attachment "${name}" not found on "${id}"`,
      );
    }
    return {
      meta: toAttachment(dir, name),
      bytes: readFileSync(path),
    };
  });
}

/** Store an attachment under a unique basename; creates the directory when needed. */
export function putAttachment(
  id: string,
  name: string,
  bytes: Uint8Array,
): Promise<Attachment> {
  return withAttachmentOp(id, name, (dir) => {
    if (bytes.byteLength > MAX_ATTACHMENT_BYTES) {
      throw new IssueError(
        "validation",
        `attachment exceeds ${MAX_ATTACHMENT_BYTES} byte limit`,
      );
    }
    mkdirSync(dir, { recursive: true });
    const stored = uniqueAttachmentBasename(name, attachmentFilenames(dir));
    writeFileSync(join(dir, stored), bytes);
    return toAttachment(dir, stored);
  });
}

/** Delete one attachment file. */
export function removeAttachment(id: string, name: string): Promise<void> {
  return withAttachmentOp(id, name, (dir) => {
    const path = join(dir, name);
    if (!existsSync(path) || !statSync(path).isFile()) {
      throw new IssueError(
        "not_found",
        `attachment "${name}" not found on "${id}"`,
      );
    }
    rmSync(path);
  });
}
