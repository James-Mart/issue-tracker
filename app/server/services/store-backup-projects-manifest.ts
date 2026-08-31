import { existsSync, writeFileSync } from "fs";
import { join } from "path";
import type { Issue } from "../schemas.js";
import { getOriginRemoteUrl } from "./git-read.js";
import { readAll } from "./issues.js";

export const PROJECTS_MANIFEST_FILENAME = "projects.json";

export type ProjectManifestEntry = {
  id: string;
  title: string;
  workspace: string | null;
  trunk: string;
  remote: string | null;
};

export type ProjectsManifest = {
  generatedAt: string;
  projects: ProjectManifestEntry[];
};

export type WriteProjectsManifestDeps = {
  listProjects: () => Extract<Issue, { kind: "project" }>[];
  getOriginRemote: (workspace: string) => Promise<string | null>;
  isGitRepository: (workspace: string) => boolean;
  now: () => Date;
};

function listStoreProjects(): Extract<Issue, { kind: "project" }>[] {
  return readAll().issues.filter(
    (issue): issue is Extract<Issue, { kind: "project" }> =>
      issue.kind === "project",
  );
}

const defaultDeps = (): WriteProjectsManifestDeps => ({
  listProjects: listStoreProjects,
  getOriginRemote: getOriginRemoteUrl,
  isGitRepository: (workspace) => existsSync(join(workspace, ".git")),
  now: () => new Date(),
});

export function formatProjectsManifest(manifest: ProjectsManifest): string {
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

export async function buildProjectManifestEntries(
  projects: Extract<Issue, { kind: "project" }>[],
  deps: Pick<
    WriteProjectsManifestDeps,
    "getOriginRemote" | "isGitRepository"
  >,
): Promise<ProjectManifestEntry[]> {
  const entries: ProjectManifestEntry[] = [];
  for (const project of projects) {
    const workspace = project.workspace ?? null;
    let remote: string | null = null;
    if (
      workspace !== null &&
      existsSync(workspace) &&
      deps.isGitRepository(workspace)
    ) {
      remote = await deps.getOriginRemote(workspace);
    }
    entries.push({
      id: project.id,
      title: project.title,
      workspace,
      trunk: project.trunk,
      remote,
    });
  }
  return entries;
}

/** Write `projects.json` at the mirror root from the current store projects. */
export async function writeProjectsManifest(
  mirrorDir: string,
  deps: WriteProjectsManifestDeps = defaultDeps(),
): Promise<void> {
  const projects = deps.listProjects();
  const projectEntries = await buildProjectManifestEntries(projects, deps);
  const manifest: ProjectsManifest = {
    generatedAt: deps.now().toISOString(),
    projects: projectEntries,
  };
  writeFileSync(
    join(mirrorDir, PROJECTS_MANIFEST_FILENAME),
    formatProjectsManifest(manifest),
  );
}
