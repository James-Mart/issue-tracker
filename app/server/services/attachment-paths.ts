import { existsSync, readdirSync, statSync } from "fs";
import { join } from "path";
import { issuesDir } from "../config.js";

export function attachmentsDir(id: string): string {
  return join(issuesDir, id, "attachments");
}

/** Absolute on-disk path for `issues/<id>/attachments/<name>`. */
export function attachmentPath(id: string, name: string): string {
  return join(attachmentsDir(id), name);
}

export function attachmentFilenames(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => statSync(join(dir, name)).isFile())
    .sort();
}
