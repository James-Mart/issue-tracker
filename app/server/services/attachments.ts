import { mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "fs";
import { basename, join } from "path";
import mime from "mime";
import type { Issue } from "../schemas.js";
import { attachmentFilenames, attachmentsDir } from "./attachment-paths.js";
import { IssueError } from "./errors.js";
import { requireKindCapability, serialize } from "./issues.js";
import { assertOutlineAttachmentName } from "./outline-attachments.js";
import { assertStoreWritable } from "./store-read-only.js";
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

export { attachmentPath } from "./attachment-paths.js";

function mimeOf(name: string): string {
  return mime.lookup(name) || "application/octet-stream";
}

export function assertSafeAttachmentName(name: string): void {
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

function requireAttachable(id: string): Issue {
  return requireKindCapability(id, "attachments");
}

/** Outlines accept only their allow-listed names; every other attachable kind accepts any safe name. */
function assertWritableAttachmentName(issue: Issue, name: string): void {
  if (issue.kind === "outline") assertOutlineAttachmentName(name);
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
  fn: (dir: string, issue: Issue) => T,
): Promise<T> {
  return serialize(() => {
    const issue = requireAttachable(id);
    assertSafeAttachmentName(name);
    return fn(attachmentsDir(id), issue);
  });
}

function attachmentNotFound(id: string, name: string): IssueError {
  return new IssueError(
    "not_found",
    `attachment "${name}" not found on "${id}"`,
  );
}

function requireExistingAttachmentFile(
  dir: string,
  id: string,
  name: string,
): string {
  const path = join(dir, name);
  let st;
  try {
    st = statSync(path);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      throw attachmentNotFound(id, name);
    }
    throw err;
  }
  if (!st.isFile()) {
    throw attachmentNotFound(id, name);
  }
  return path;
}

function assertWritableAttachmentBytes(bytes: Uint8Array): void {
  assertStoreWritable();
  if (bytes.byteLength > MAX_ATTACHMENT_BYTES) {
    throw new IssueError(
      "validation",
      `attachment exceeds ${MAX_ATTACHMENT_BYTES} byte limit`,
    );
  }
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
    const path = requireExistingAttachmentFile(dir, id, name);
    return {
      meta: toAttachment(dir, name),
      bytes: readFileSync(path),
    };
  });
}

/**
 * Store an attachment under a unique basename; creates the directory when
 * needed. An outline refuses a taken name instead, since a suffixed bundle
 * name would read as another direction.
 */
export function putAttachment(
  id: string,
  name: string,
  bytes: Uint8Array,
): Promise<Attachment> {
  return withAttachmentOp(id, name, (dir, issue) => {
    assertWritableAttachmentBytes(bytes);
    assertWritableAttachmentName(issue, name);
    mkdirSync(dir, { recursive: true });
    const taken = attachmentFilenames(dir);
    if (issue.kind === "outline" && taken.includes(name)) {
      throw new IssueError(
        "conflict",
        `attachment "${name}" already exists on outline "${id}"`,
      );
    }
    const stored = uniqueAttachmentBasename(name, taken);
    writeFileSync(join(dir, stored), bytes);
    return toAttachment(dir, stored);
  });
}

/** Create or overwrite an outline attachment at the exact basename. */
export function replaceOutlineAttachment(
  outlineId: string,
  name: string,
  bytes: Uint8Array,
): Promise<Attachment> {
  return withAttachmentOp(outlineId, name, (dir, issue) => {
    if (issue.kind !== "outline") {
      throw new IssueError("validation", `issue "${outlineId}" is not an outline`);
    }
    assertWritableAttachmentBytes(bytes);
    assertOutlineAttachmentName(name);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, name), bytes);
    return toAttachment(dir, name);
  });
}

/** Overwrite an existing attachment at the exact basename; refuses when missing. */
export function replaceAttachment(
  id: string,
  name: string,
  bytes: Uint8Array,
): Promise<Attachment> {
  return withAttachmentOp(id, name, (dir, issue) => {
    assertWritableAttachmentBytes(bytes);
    assertWritableAttachmentName(issue, name);
    const path = requireExistingAttachmentFile(dir, id, name);
    writeFileSync(path, bytes);
    return toAttachment(dir, name);
  });
}

/** Create or replace an attachment from one upload. */
export function postAttachment(
  id: string,
  name: string,
  bytes: Uint8Array,
  opts?: { replace?: boolean },
): Promise<{ meta: Attachment; created: boolean }> {
  if (opts?.replace) {
    return replaceAttachment(id, name, bytes).then((meta) => ({
      meta,
      created: false,
    }));
  }
  return putAttachment(id, name, bytes).then((meta) => ({ meta, created: true }));
}

function deleteExistingAttachment(dir: string, id: string, name: string): void {
  assertStoreWritable();
  rmSync(requireExistingAttachmentFile(dir, id, name));
}

/** Delete one attachment file. */
export function removeAttachment(id: string, name: string): Promise<void> {
  return withAttachmentOp(id, name, (dir) => {
    deleteExistingAttachment(dir, id, name);
  });
}

/** Delete one outline attachment at the exact basename. */
export function removeOutlineAttachment(outlineId: string, name: string): Promise<void> {
  return withAttachmentOp(outlineId, name, (dir, issue) => {
    if (issue.kind !== "outline") {
      throw new IssueError("validation", `issue "${outlineId}" is not an outline`);
    }
    assertOutlineAttachmentName(name);
    deleteExistingAttachment(dir, outlineId, name);
  });
}
