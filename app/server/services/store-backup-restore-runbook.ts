import { readFileSync, writeFileSync } from "fs";
import { join } from "path";
import {
  PROJECTS_MANIFEST_FILENAME,
  type ProjectsManifest,
} from "./store-backup-projects-manifest.js";

export const RESTORE_RUNBOOK_FILENAME = "RESTORE.md";

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

export function formatRestoreRunbook(manifest: ProjectsManifest): string {
  const lines: string[] = [
    "# Restore the issue tracker store",
    "",
    "This mirror holds a copy of the issue tracker store under `issues/`.",
    "",
    "## Restore the store",
    "",
    "1. Clone this mirror repository to the machine where you want the tracker to run.",
    "2. Point the issue tracker at the store copy by setting `ISSUES_DIR` to",
    "   `<clone>/issues` (replace `<clone>` with the path where you cloned this mirror).",
    "",
    "## Restore project code",
    "",
    "Each project record expects its code at a workspace path. Clone each project's",
    "remote into that path so the tracker can find the product code again.",
    "",
  ];

  if (manifest.projects.length === 0) {
    lines.push("_No projects were recorded at the time of the last snapshot._", "");
  }

  for (const project of manifest.projects) {
    lines.push(`### ${project.title}`, "");
    if (project.workspace === null) {
      lines.push("- **Workspace:** _(unset)_", "");
    } else {
      lines.push(`- **Workspace:** \`${project.workspace}\``, "");
    }

    if (project.remote === null) {
      lines.push(
        "- **Code location:** unknown (no git remote was recorded at last snapshot)",
        "",
      );
      continue;
    }

    if (project.workspace === null) {
      lines.push(
        "- **Clone:** unknown workspace path — set the project's workspace before cloning.",
        "",
      );
      continue;
    }

    lines.push("- **Clone:**", "");
    lines.push("  ```bash");
    lines.push(
      `  git clone ${shellQuote(project.remote)} ${shellQuote(project.workspace)}`,
    );
    lines.push("  ```", "");
  }

  return `${lines.join("\n")}\n`;
}

/** Write `RESTORE.md` at the mirror root from the current `projects.json`. */
export function writeRestoreRunbook(mirrorDir: string): void {
  const manifest = JSON.parse(
    readFileSync(join(mirrorDir, PROJECTS_MANIFEST_FILENAME), "utf8"),
  ) as ProjectsManifest;
  writeFileSync(
    join(mirrorDir, RESTORE_RUNBOOK_FILENAME),
    formatRestoreRunbook(manifest),
  );
}
