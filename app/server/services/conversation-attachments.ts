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
import { conversationsDir } from "../config.js";
import {
  MAX_ATTACHMENT_BYTES,
  uniqueAttachmentBasename,
} from "./attachments.js";
import { conversationExists, serialize } from "./conversations.js";
import { IssueError } from "./errors.js";

export interface ConversationAttachmentInfo {
  name: string;
  size: number;
  mimeType: string;
}

function attachmentsDir(conversationId: string): string {
  return join(conversationsDir, conversationId, "attachments");
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

function requireConversation(conversationId: string): void {
  if (!conversationExists(conversationId)) {
    throw new IssueError(
      "not_found",
      `unknown conversation "${conversationId}"`,
    );
  }
}

function toInfo(dir: string, name: string): ConversationAttachmentInfo {
  const st = statSync(join(dir, name));
  return {
    name,
    size: st.size,
    mimeType: mimeOf(name),
  };
}

function attachmentFilenames(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => statSync(join(dir, name)).isFile())
    .sort();
}

function withAttachmentOp<T>(
  conversationId: string,
  name: string,
  fn: (dir: string) => T,
): Promise<T> {
  return serialize(() => {
    requireConversation(conversationId);
    assertSafeBasename(name);
    return fn(attachmentsDir(conversationId));
  });
}

export function listConversationAttachments(
  conversationId: string,
): Promise<ConversationAttachmentInfo[]> {
  requireConversation(conversationId);
  const dir = attachmentsDir(conversationId);
  return Promise.resolve(
    attachmentFilenames(dir).map((name) => toInfo(dir, name)),
  );
}

export function putConversationAttachment(
  conversationId: string,
  filename: string,
  bytes: Buffer,
): Promise<ConversationAttachmentInfo> {
  return withAttachmentOp(conversationId, filename, (dir) => {
    if (bytes.byteLength > MAX_ATTACHMENT_BYTES) {
      throw new IssueError(
        "validation",
        `attachment exceeds ${MAX_ATTACHMENT_BYTES} byte limit`,
      );
    }
    mkdirSync(dir, { recursive: true });
    const stored = uniqueAttachmentBasename(filename, attachmentFilenames(dir));
    writeFileSync(join(dir, stored), bytes);
    return toInfo(dir, stored);
  });
}

export function getConversationAttachment(
  conversationId: string,
  name: string,
): Promise<{ bytes: Buffer; mimeType: string }> {
  return withAttachmentOp(conversationId, name, (dir) => {
    const path = join(dir, name);
    if (!existsSync(path) || !statSync(path).isFile()) {
      throw new IssueError(
        "not_found",
        `attachment "${name}" not found on "${conversationId}"`,
      );
    }
    return {
      bytes: readFileSync(path),
      mimeType: mimeOf(name),
    };
  });
}

export function removeConversationAttachment(
  conversationId: string,
  name: string,
): Promise<void> {
  return withAttachmentOp(conversationId, name, (dir) => {
    const path = join(dir, name);
    if (!existsSync(path) || !statSync(path).isFile()) {
      throw new IssueError(
        "not_found",
        `attachment "${name}" not found on "${conversationId}"`,
      );
    }
    rmSync(path);
  });
}
