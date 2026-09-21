import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "fs";
import { join } from "path";
import mime from "mime";
import { parse as parseYaml } from "yaml";
import { issuesDir } from "../config.js";
import {
  assertSafeAttachmentName,
  type Attachment,
  MAX_ATTACHMENT_BYTES,
} from "./attachments.js";
import { IssueError } from "./errors.js";
import { requireKindCapability, serialize } from "./issues.js";

/** Reserved draft basenames. Not suffixed and not coerced. */
export const EXPORT_DRAFT_NAME = /^github-export-.+\.md$/;

interface DraftFile {
  name: string;
  content: string;
}

function attachmentsDir(id: string): string {
  return join(issuesDir, id, "attachments");
}

function toAttachment(dir: string, name: string): Attachment {
  const st = statSync(join(dir, name));
  return {
    name,
    size: st.size,
    mtime: st.mtime.toISOString(),
    mime: mime.lookup(name) || "application/octet-stream",
  };
}

function draftTitle(content: string): string | null {
  if (!content.startsWith("---\n") && !content.startsWith("---\r\n")) {
    return null;
  }
  const end = content.indexOf("\n---", 4);
  if (end === -1) return null;
  let parsed: unknown;
  try {
    parsed = parseYaml(content.slice(4, end));
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return null;
  }
  const title = (parsed as { title?: unknown }).title;
  if (typeof title !== "string" || title.length === 0) return null;
  return title;
}

function assertDraft(name: string, content: string): void {
  assertSafeAttachmentName(name);
  if (!EXPORT_DRAFT_NAME.test(name)) {
    throw new IssueError(
      "validation",
      `attachment name "${name}" is not a github-export draft`,
    );
  }
  if (Buffer.byteLength(content) > MAX_ATTACHMENT_BYTES) {
    throw new IssueError(
      "validation",
      `attachment exceeds ${MAX_ATTACHMENT_BYTES} byte limit`,
    );
  }
  if (draftTitle(content) === null) {
    throw new IssueError(
      "validation",
      `github-export draft "${name}" is missing title`,
    );
  }
}

function parseDraftFiles(files: unknown): DraftFile[] {
  if (!Array.isArray(files)) {
    throw new IssueError("validation", "files must be an array");
  }
  const seen = new Set<string>();
  const drafts: DraftFile[] = [];
  for (const file of files) {
    if (!file || typeof file !== "object" || Array.isArray(file)) {
      throw new IssueError(
        "validation",
        "each export draft must have name and content",
      );
    }
    const { name, content } = file as { name?: unknown; content?: unknown };
    if (typeof name !== "string" || typeof content !== "string") {
      throw new IssueError(
        "validation",
        "each export draft must have name and content",
      );
    }
    if (seen.has(name)) {
      throw new IssueError(
        "validation",
        `duplicate github-export draft name "${name}"`,
      );
    }
    seen.add(name);
    assertDraft(name, content);
    drafts.push({ name, content });
  }
  return drafts;
}

function snapshotDrafts(dir: string): Map<string, Buffer> {
  const snap = new Map<string, Buffer>();
  if (!existsSync(dir)) return snap;
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (!statSync(path).isFile() || !EXPORT_DRAFT_NAME.test(name)) continue;
    snap.set(name, readFileSync(path));
  }
  return snap;
}

function restoreDrafts(dir: string, snap: Map<string, Buffer>): void {
  if (!existsSync(dir)) return;
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (!statSync(path).isFile() || !EXPORT_DRAFT_NAME.test(name)) continue;
    if (!snap.has(name)) rmSync(path);
  }
  for (const [name, bytes] of snap) {
    writeFileSync(join(dir, name), bytes);
  }
}

/**
 * Replace the issue's `github-export-*` set. Validates every file before
 * any write. A write or delete failure restores the previous set.
 * Other attachments are left in place.
 */
export function replaceExportDrafts(
  id: string,
  files: unknown,
): Promise<Attachment[]> {
  return serialize(() => {
    requireKindCapability(id, "attachments");
    const drafts = parseDraftFiles(files);
    const dir = attachmentsDir(id);
    const snap = snapshotDrafts(dir);
    const names = new Set(drafts.map((draft) => draft.name));
    try {
      mkdirSync(dir, { recursive: true });
      for (const draft of drafts) {
        writeFileSync(join(dir, draft.name), draft.content);
      }
      for (const name of snap.keys()) {
        if (!names.has(name)) rmSync(join(dir, name));
      }
    } catch (err) {
      restoreDrafts(dir, snap);
      throw err;
    }
    return [...names].sort().map((name) => toAttachment(dir, name));
  });
}

/** Create or overwrite one reserved draft. Refuses any other basename. */
export function overwriteExportDraft(
  id: string,
  name: string,
  content: string,
): Promise<Attachment> {
  return serialize(() => {
    requireKindCapability(id, "attachments");
    assertDraft(name, content);
    const dir = attachmentsDir(id);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, name), content);
    return toAttachment(dir, name);
  });
}
