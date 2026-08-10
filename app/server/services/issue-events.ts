import chokidar, { type FSWatcher } from "chokidar";
import { basename, relative, sep } from "path";
import { issuesDir } from "../config.js";
import type {
  IssueEventScope,
  IssueEventType,
} from "../schemas.js";
import { publishFrame } from "./conversation-stream.js";

export const ISSUES_TOPIC = "issues";

let watcher: FSWatcher | null = null;

export function issueIdFromPath(baseDir: string, filePath: string): string | null {
  const rel = relative(baseDir, filePath);
  if (!rel || rel.startsWith("..")) return null;
  const [id] = rel.split(sep);
  return id || null;
}

export function scopeFromPath(filePath: string): IssueEventScope {
  if (basename(filePath) === "comments.jsonl") return "comments";
  const normalized = filePath.replace(/\\/g, "/");
  if (
    normalized.endsWith("/attachments") ||
    normalized.includes("/attachments/")
  ) {
    return "attachments";
  }
  return "issue";
}

function emit(type: IssueEventType, filePath: string): void {
  const id = issueIdFromPath(issuesDir, filePath);
  if (!id) return;
  publishFrame(ISSUES_TOPIC, {
    event: { type, id, scope: scopeFromPath(filePath) },
    persist: false,
  });
}

/** Start the issues-dir watcher once; publishes frames on the `issues` topic. */
export function startIssueEventsWatcher(): void {
  if (watcher) return;
  watcher = chokidar.watch(issuesDir, {
    ignoreInitial: true,
    awaitWriteFinish: { stabilityThreshold: 80, pollInterval: 20 },
  });
  watcher
    .on("add", (path) => emit("add", path))
    .on("change", (path) => emit("change", path))
    .on("unlink", (path) => emit("unlink", path))
    .on("unlinkDir", (path) => emit("unlink-dir", path))
    .on("error", (err) => console.error("issues watcher error:", err));
}
