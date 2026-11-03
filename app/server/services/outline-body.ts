import { spawnSync } from "child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { dirname, join } from "path";
import { issuesDir } from "../config.js";
import type { Issue } from "../schemas.js";
import { IssueError } from "./errors.js";
import { descriptionPath, readDescription } from "./issues-detail.js";
import { replaceFileAtomically } from "./issues-store-lock.js";

type OutlineIssue = Extract<Issue, { kind: "outline" }>;

function outlineVersionPath(id: string, version: number): string {
  return join(issuesDir, id, "versions", `${version}.md`);
}

function writeSnapshot(id: string, version: number, body: string): void {
  const path = outlineVersionPath(id, version);
  mkdirSync(dirname(path), { recursive: true });
  replaceFileAtomically(path, body);
}

/**
 * Keep an outline's saved bodies. Call before replacing `description.md`.
 * The first save writes `versions/<bodyVersion>.md`. A different body keeps
 * the current snapshot, then advances `bodyVersion`.
 */
export function recordOutlineBody(issue: OutlineIssue, description: string): void {
  const path = descriptionPath(issue.id);
  if (!existsSync(path)) {
    if (existsSync(outlineVersionPath(issue.id, issue.bodyVersion))) {
      throw new IssueError(
        "validation",
        `outline "${issue.id}" is missing description.md`,
      );
    }
    writeSnapshot(issue.id, issue.bodyVersion, description);
    return;
  }
  const previous = readDescription(issue.id);
  if (previous === description) return;
  if (!existsSync(outlineVersionPath(issue.id, issue.bodyVersion))) {
    writeSnapshot(issue.id, issue.bodyVersion, previous);
  }
  issue.bodyVersion += 1;
  writeSnapshot(issue.id, issue.bodyVersion, description);
}

export function parseOutlineVersion(raw: string): number {
  if (!/^[1-9]\d*$/.test(raw)) {
    throw new Error(`version must be a positive integer (got ${JSON.stringify(raw)})`);
  }
  const version = Number(raw);
  if (!Number.isSafeInteger(version)) {
    throw new Error(`version must be a positive integer (got ${JSON.stringify(raw)})`);
  }
  return version;
}

/** Body of snapshot `version`. `latest` is the outline's `bodyVersion`. */
export function readOutlineBody(id: string, version: number, latest: number): string {
  if (version > latest) {
    throw new Error(`outline "${id}" has no version ${version} (latest is ${latest})`);
  }
  const path = outlineVersionPath(id, version);
  if (!existsSync(path)) {
    throw new Error(`outline "${id}" has no version ${version}`);
  }
  return readFileSync(path, "utf8");
}

/**
 * Body of saved version `version`. The latest body is `latestBody` when the
 * caller already has it, otherwise `description.md`. An older version is its snapshot.
 */
export function outlineVersionBody(
  id: string,
  bodyVersion: number,
  version: number,
  latestBody?: string,
): string {
  if (version === bodyVersion) return latestBody ?? readDescription(id);
  return readOutlineBody(id, version, bodyVersion);
}

/**
 * Body and version number for `issue outline view`. The latest body is
 * `description.md`; older versions are snapshots.
 */
export function outlineBodyForView(
  id: string,
  bodyVersion: number,
  latestBody: string,
  versionRaw: string | undefined,
): { body: string; shownVersion: number } {
  if (versionRaw === undefined) {
    return { body: latestBody, shownVersion: bodyVersion };
  }
  const shownVersion = parseOutlineVersion(versionRaw);
  return {
    body: outlineVersionBody(id, bodyVersion, shownVersion, latestBody),
    shownVersion,
  };
}

/** Unified diff of two saved versions, using the same body each version shows. */
export function outlineVersionDiff(
  id: string,
  bodyVersion: number,
  from: number,
  to: number,
): string {
  return diffOutlineBodies(
    from,
    outlineVersionBody(id, bodyVersion, from),
    to,
    outlineVersionBody(id, bodyVersion, to),
  );
}

/** Unified diff of outline body `fromVersion` against `toVersion`. */
export function diffOutlineBodies(
  fromVersion: number,
  fromBody: string,
  toVersion: number,
  toBody: string,
): string {
  const dir = mkdtempSync(join(tmpdir(), "outline-diff-"));
  try {
    const fromPath = join(dir, "from");
    const toPath = join(dir, "to");
    writeFileSync(fromPath, fromBody);
    writeFileSync(toPath, toBody);
    const result = spawnSync(
      "diff",
      [
        "-u",
        "--label",
        `version/${fromVersion}`,
        "--label",
        `version/${toVersion}`,
        fromPath,
        toPath,
      ],
      { encoding: "utf8" },
    );
    if (result.error) throw result.error;
    if (result.status !== 0 && result.status !== 1) {
      throw new Error(result.stderr || "diff failed");
    }
    return result.stdout ?? "";
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
